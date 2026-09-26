package lab.ledgerguard;

import lab.ledgerguard.db.FinancialCommands;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

/** Real PostgreSQL commits. No H2, mocked SQL, enclosing rollback transaction, or Docker-absence skip. */
@Testcontainers
class PostgresFinancialIT {
    private static final String OWNER_PASSWORD=UUID.randomUUID().toString();
    private static final String RUNTIME_PASSWORD=UUID.randomUUID().toString();
    @Container static final PostgreSQLContainer<?> PG=new PostgreSQLContainer<>("postgres:17.11-bookworm")
        .withDatabaseName("ledgerlab").withUsername("postgres").withPassword(UUID.randomUUID().toString());
    static final ObjectMapper JSON=new ObjectMapper();
    static FinancialCommands commands;
    record Fixture(UUID alice,UUID bob,UUID admin,UUID asset,UUID source,UUID target,String recipient) { }
    @BeforeAll static void migrate() throws Exception {
        try(Connection c=DriverManager.getConnection(PG.getJdbcUrl(),PG.getUsername(),PG.getPassword());Statement s=c.createStatement()) {
            s.execute("CREATE ROLE ledger_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+OWNER_PASSWORD+"'");
            s.execute("CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+RUNTIME_PASSWORD+"'");
            s.execute("GRANT CREATE ON DATABASE ledgerlab TO ledger_owner");
            s.execute("GRANT USAGE,CREATE ON SCHEMA public TO ledger_owner");
        }
        Flyway.configure().dataSource(PG.getJdbcUrl(),"ledger_owner",OWNER_PASSWORD).defaultSchema("public")
            .locations("classpath:db/migration").load().migrate();
        commands=new FinancialCommands(new DriverManagerDataSource(PG.getJdbcUrl(),"ledger_runtime",RUNTIME_PASSWORD));
    }
    static Connection owner() throws SQLException { return DriverManager.getConnection(PG.getJdbcUrl(),"ledger_owner",OWNER_PASSWORD); }
    static Connection runtime() throws SQLException { return DriverManager.getConnection(PG.getJdbcUrl(),"ledger_runtime",RUNTIME_PASSWORD); }
    static UUID uuid(Connection c,String sql,Object... args) throws SQLException {
        try(PreparedStatement p=c.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet r=p.executeQuery()){r.next();return r.getObject(1,UUID.class);}}
    }
    static long scalar(Connection c,String sql,Object... args) throws SQLException {
        try(PreparedStatement p=c.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet r=p.executeQuery()){r.next();return r.getLong(1);}}
    }
    static Fixture fixture() throws SQLException {
        try(Connection c=owner()) {
            c.setAutoCommit(false);
            UUID a=uuid(c,"INSERT INTO ledger.app_users(email,password_hash,display_name) VALUES(?,'offline-db-test-hash-not-for-login-000000000000000','Alice') RETURNING id",UUID.randomUUID()+"@example.test");
            UUID b=uuid(c,"INSERT INTO ledger.app_users(email,password_hash,display_name) VALUES(?,'offline-db-test-hash-not-for-login-000000000000000','Bob') RETURNING id",UUID.randomUUID()+"@example.test");
            UUID admin=uuid(c,"INSERT INTO ledger.app_users(email,password_hash,display_name,role) VALUES(?,'offline-db-test-hash-not-for-login-000000000000000','Administrator','ADMIN') RETURNING id",UUID.randomUUID()+"@example.test");
            UUID source=uuid(c,"SELECT ledger.create_account(?,'Alice wallet','CAD')",a);
            UUID target=uuid(c,"SELECT ledger.create_account(?,'Bob wallet','CAD')",b);
            UUID asset=uuid(c,"INSERT INTO ledger.accounts(label,currency,kind) VALUES('Synthetic asset','CAD','SANDBOX_FUNDING_ASSET') RETURNING id");
            try(PreparedStatement p=c.prepareStatement("INSERT INTO ledger.account_balances(account_id) VALUES(?)")){p.setObject(1,asset);p.executeUpdate();}
            uuid(c,"SELECT ledger._post(?,'FUNDING',?,?,10000,'CAD')",UUID.randomUUID(),asset,source);
            String ref;
            try(PreparedStatement p=c.prepareStatement("SELECT public_ref FROM ledger.accounts WHERE id=?")){p.setObject(1,target);try(ResultSet r=p.executeQuery()){r.next();ref=r.getString(1);}}
            c.commit();return new Fixture(a,b,admin,asset,source,target,ref);
        }
    }
    static String intent(Fixture f,long amount) throws Exception {return JSON.writeValueAsString(Map.of("sourceId",f.source.toString(),"recipientRef",f.recipient,"amountMinor",Long.toString(amount),"currency","CAD"));}
    static UUID id(FinancialCommands.Result result) throws Exception {return UUID.fromString(JSON.readTree(result.json()).get("id").asText());}
    static void balanced(Fixture f) throws SQLException {
        try(Connection c=runtime()) {
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);c.setReadOnly(true);c.setAutoCommit(false);
            for(UUID account:List.of(f.source,f.target)) {
                long posted=scalar(c,"SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",account);
                long independentlySummed=scalar(c,"SELECT coalesce(sum(CASE WHEN side='CREDIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) FROM ledger.journal_entries WHERE account_id=?",account);
                assertEquals(independentlySummed,posted,"Ledger entries must reconcile independently");
                assertEquals(scalar(c,"SELECT coalesce(sum(amount_minor),0) FROM ledger.holds WHERE account_id=? AND state='ACTIVE'",account),scalar(c,"SELECT reserved_minor FROM ledger.account_balances WHERE account_id=?",account));
            }
            c.commit();
        }
    }
    @Test void PG01_runtimeCannotBypassPosting() throws Exception {
        Fixture f=fixture();
        for(String sql:List.of("UPDATE ledger.account_balances SET posted_minor=1 WHERE account_id='"+f.source+"'",
            "DELETE FROM ledger.journal_entries","UPDATE ledger.audit_records SET action='forged'",
            "SELECT ledger._post(gen_random_uuid(),'TRANSFER','"+f.source+"','"+f.target+"',1,'CAD')",
            "INSERT INTO ledger.journals(operation_id,kind,currency) VALUES(gen_random_uuid(),'TRANSFER','CAD')")) {
            try(Connection c=runtime();Statement s=c.createStatement()) {SQLException e=assertThrows(SQLException.class,()->s.execute(sql));assertEquals("42501",e.getSQLState());}
        }
        balanced(f);
    }
    @Test void PG02_ownerStillCannotCommitIncompleteJournal() throws Exception {
        fixture();try(Connection c=owner()) {c.setAutoCommit(false);uuid(c,"INSERT INTO ledger.journals(operation_id,kind,currency) VALUES(gen_random_uuid(),'TRANSFER','CAD') RETURNING id");SQLException e=assertThrows(SQLException.class,c::commit);assertEquals("23514",e.getSQLState());c.rollback();}
    }
    @Test void PG03_fundingIsBalancedAndNewAccountsAreZero() throws Exception {
        Fixture f=fixture();try(Connection c=runtime()) {assertEquals(10000,scalar(c,"SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",f.source));assertEquals(0,scalar(c,"SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",f.target));}balanced(f);
    }
    @Test void PG04_replayAndConflict() throws Exception {
        Fixture f=fixture();String key=UUID.randomUUID().toString();
        var first=commands.execute(f.alice,"TRANSFER",null,key,intent(f,2900),UUID.randomUUID());
        var repeat=commands.execute(f.alice,"TRANSFER",null,key,intent(f,2900),UUID.randomUUID());
        assertEquals(201,first.status());assertEquals(first.json(),repeat.json());assertTrue(repeat.replayed());
        var conflict=commands.execute(f.alice,"TRANSFER",null,key,intent(f,2901),UUID.randomUUID());assertEquals(409,conflict.status());
        try(Connection c=runtime()){assertEquals(1,scalar(c,"SELECT count(*) FROM ledger.transfers WHERE source_id=?",f.source));}balanced(f);
    }
    @Test void PG05_concurrentOverspendIndependentConnections() throws Exception {
        Fixture f=fixture();CyclicBarrier barrier=new CyclicBarrier(2);
        try(ExecutorService pool=Executors.newFixedThreadPool(2)) {
            Callable<Integer> request=()->{barrier.await(5,TimeUnit.SECONDS);return commands.execute(f.alice,"TRANSFER",null,UUID.randomUUID().toString(),intent(f,8000),UUID.randomUUID()).status();};
            Future<Integer> a=pool.submit(request),b=pool.submit(request);List<Integer> codes=new ArrayList<>(List.of(a.get(10,TimeUnit.SECONDS),b.get(10,TimeUnit.SECONDS)));Collections.sort(codes);assertEquals(List.of(201,422),codes);
        }
        try(Connection c=runtime()){assertEquals(2000,scalar(c,"SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",f.source));assertEquals(1,scalar(c,"SELECT count(*) FROM ledger.transfers WHERE source_id=?",f.source));}balanced(f);
    }
    @Test void PG06_settlementDeduplicatesBothMessageAndBusinessIdentity() throws Exception {
        Fixture f=fixture();UUID p=id(commands.execute(f.alice,"PAYMENT",null,UUID.randomUUID().toString(),intent(f,2500),UUID.randomUUID()));
        try(Connection c=runtime()){assertEquals(2500,scalar(c,"SELECT reserved_minor FROM ledger.account_balances WHERE account_id=?",f.source));assertEquals(10000,scalar(c,"SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",f.source));}
        UUID event=UUID.randomUUID();assertEquals("SETTLED",commands.settle(event,p,UUID.randomUUID()));assertEquals("DUPLICATE",commands.settle(event,p,UUID.randomUUID()));assertEquals("SETTLED",commands.settle(UUID.randomUUID(),p,UUID.randomUUID()));
        try(Connection c=runtime()){assertEquals(1,scalar(c,"SELECT count(*) FROM ledger.journals WHERE operation_id=?",p));}balanced(f);
    }
    @Test void PG07_cancellationNeverPostsRefund() throws Exception {
        Fixture f=fixture();UUID p=id(commands.execute(f.alice,"PAYMENT",null,UUID.randomUUID().toString(),intent(f,2500),UUID.randomUUID()));
        assertEquals(200,commands.execute(f.alice,"CANCEL",p,UUID.randomUUID().toString(),"{}",UUID.randomUUID()).status());
        assertEquals("CANCELLED",commands.settle(UUID.randomUUID(),p,UUID.randomUUID()));
        try(Connection c=runtime()){assertEquals(0,scalar(c,"SELECT count(*) FROM ledger.journals WHERE operation_id=?",p));assertEquals(10000,scalar(c,"SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",f.source));}balanced(f);
    }
    @Test void PG08_refundAuthorityAndReversalPolicy() throws Exception {
        Fixture f=fixture();UUID p=id(commands.execute(f.alice,"PAYMENT",null,UUID.randomUUID().toString(),intent(f,2500),UUID.randomUUID()));commands.settle(UUID.randomUUID(),p,UUID.randomUUID());
        String refund="{\"amountMinor\":\"1000\",\"reason\":\"Partial return\"}";
        assertEquals(403,commands.execute(f.alice,"REFUND",p,UUID.randomUUID().toString(),refund,UUID.randomUUID()).status());
        assertEquals(201,commands.execute(f.bob,"REFUND",p,UUID.randomUUID().toString(),refund,UUID.randomUUID()).status());
        assertEquals(409,commands.execute(f.admin,"REVERSAL",p,UUID.randomUUID().toString(),"{\"reason\":\"Review\"}",UUID.randomUUID()).status());balanced(f);
    }
    @Test void PG09_concurrentPartialRefundsCannotExceedSettlement() throws Exception {
        Fixture f=fixture();UUID p=id(commands.execute(f.alice,"PAYMENT",null,UUID.randomUUID().toString(),intent(f,10000),UUID.randomUUID()));commands.settle(UUID.randomUUID(),p,UUID.randomUUID());CyclicBarrier gate=new CyclicBarrier(2);
        try(ExecutorService pool=Executors.newFixedThreadPool(2)) {Callable<Integer> request=()->{gate.await(5,TimeUnit.SECONDS);return commands.execute(f.bob,"REFUND",p,UUID.randomUUID().toString(),"{\"amountMinor\":\"8000\"}",UUID.randomUUID()).status();};var a=pool.submit(request);var b=pool.submit(request);List<Integer> codes=new ArrayList<>(List.of(a.get(10,TimeUnit.SECONDS),b.get(10,TimeUnit.SECONDS)));Collections.sort(codes);assertEquals(List.of(201,422),codes);}balanced(f);
    }
    @Test void PG10_incompleteIdempotencyCannotPersist() throws Exception {
        Fixture f=fixture();try(Connection c=owner()) {c.setAutoCommit(false);try(PreparedStatement p=c.prepareStatement("INSERT INTO ledger.idempotency_records(actor_id,operation_kind,key,fingerprint) VALUES(?,'TRANSFER','incomplete-key','test')")){p.setObject(1,f.alice);p.executeUpdate();}SQLException e=assertThrows(SQLException.class,c::commit);assertEquals("23514",e.getSQLState());c.rollback();}
    }
    @Test void PG11_registeredIdentityCannotBecomeAdministrator() throws Exception {
        try(Connection c=runtime()){UUID registered=uuid(c,"SELECT ledger.register_customer(?,'offline-db-test-hash-not-for-login-000000000000000','New user')",UUID.randomUUID()+"@example.test");assertEquals(1,scalar(c,"SELECT count(*) FROM ledger.app_users WHERE id=? AND role='CUSTOMER'",registered));assertEquals(0,scalar(c,"SELECT count(*) FROM ledger.accounts WHERE owner_id=?",registered));}
    }
}
