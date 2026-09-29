package lab.ledgerguard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restassured.response.Response;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import lab.ledgerguard.admin.AdminSnapshot;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/** Disposable real PostgreSQL and real HTTP. No H2, mocked financial store or release test hooks. */
@Testcontainers
class AdministratorInvestigationIT {
    @Container static final PostgreSQLContainer<?> PG=new PostgreSQLContainer<>("postgres:17.11-bookworm")
        .withDatabaseName("ledgeradmin").withUsername("postgres").withPassword(UUID.randomUUID().toString());
    static final ObjectMapper JSON=new ObjectMapper();
    static final String OWNER=UUID.randomUUID().toString(),RUNTIME=UUID.randomUUID().toString();
    static final Path LOG=Path.of("target/admin-http-evidence/api.log");
    static Process process; static int port;
    record Actor(UUID id, String email, Browser browser) { }
    record Fixture(Actor payer,Actor recipient,UUID source,UUID destination,UUID payment) { }
    static final class Browser {
        final Map<String,String> cookies=new HashMap<>(); String csrf;
        Response call(String method,String path,Object body) {
            var request=given().baseUri("http://127.0.0.1").port(port).redirects().follow(false).cookies(cookies).accept("application/json");
            if(csrf!=null) request.header("X-XSRF-TOKEN",csrf);
            if(!"GET".equals(method)) request.header("Idempotency-Key",UUID.randomUUID().toString());
            if(body!=null) request.contentType("application/json").body(body);
            Response response=request.request(method,"/api/v1"+path);
            response.detailedCookies().forEach(cookie->{if(cookie.getMaxAge()==0)cookies.remove(cookie.getName());else cookies.put(cookie.getName(),cookie.getValue());});
            return response;
        }
        void csrf(){Response r=call("GET","/auth/csrf",null);status(200,r);csrf=r.jsonPath().getString("token");}
        Browser copy(){Browser b=new Browser();b.cookies.putAll(cookies);b.csrf=csrf;return b;}
    }
    @BeforeAll static void start() throws Exception {
        Files.createDirectories(LOG.getParent());
        try(Connection c=DriverManager.getConnection(PG.getJdbcUrl(),PG.getUsername(),PG.getPassword());Statement s=c.createStatement()) {
            s.execute("CREATE ROLE ledger_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+OWNER+"'");
            s.execute("CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+RUNTIME+"'");
            s.execute("GRANT CREATE ON DATABASE ledgeradmin TO ledger_owner");s.execute("GRANT USAGE,CREATE ON SCHEMA public TO ledger_owner");
        }
        Flyway.configure().dataSource(PG.getJdbcUrl(),"ledger_owner",OWNER).defaultSchema("public").locations("classpath:db/migration").load().migrate();
        try(ServerSocket socket=new ServerSocket(0)){port=socket.getLocalPort();}
        ProcessBuilder builder=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","java").toString(),"-Xmx256m","-jar","target/ledgerguard.jar",
            "--server.port="+port,"--spring.profiles.active=sandbox","--ledgerguard.auth.bcrypt-strength=10","--ledgerguard.auth.ip-limit=1000","--ledgerguard.auth.identity-limit=1000",
            "--management.health.rabbit.enabled=false","--management.endpoint.health.group.readiness.include=readinessState,ledgerDatabase");
        byte[] key=new byte[64];new SecureRandom().nextBytes(key);var env=builder.environment();
        env.put("LEDGER_DATABASE_URL",PG.getJdbcUrl());env.put("LEDGER_MIGRATION_URL",PG.getJdbcUrl());env.put("LEDGER_OWNER_PASSWORD",OWNER);
        env.put("LEDGER_RUNTIME_PASSWORD",RUNTIME);env.put("LEDGER_AUTH_KEY",Base64.getEncoder().encodeToString(key));env.put("LEDGER_SANDBOX_HTTP","true");
        env.put("LEDGER_RABBIT_PASSWORD",UUID.randomUUID().toString());process=builder.redirectErrorStream(true).redirectOutput(LOG.toFile()).start();
        HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build();long deadline=System.nanoTime()+Duration.ofSeconds(70).toNanos();
        while(System.nanoTime()<deadline&&process.isAlive()){
            try {var response=client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/system")).timeout(Duration.ofSeconds(2)).build(),HttpResponse.BodyHandlers.ofString());
                if(response.statusCode()==200&&JSON.readTree(response.body()).path("databaseRole").asText().equals("ledger_runtime"))return;
            } catch(java.io.IOException ignored) { }
            Thread.sleep(100);
        }
        throw new AssertionError("Administrator API did not become ready; inspect target/admin-http-evidence/api.log");
    }
    @AfterAll static void stop() throws Exception {if(process!=null){process.destroy();if(!process.waitFor(10,TimeUnit.SECONDS)){process.destroyForcibly();assertTrue(process.waitFor(10,TimeUnit.SECONDS));}}}
    static Connection owner() throws SQLException {return DriverManager.getConnection(PG.getJdbcUrl(),"ledger_owner",OWNER);}
    static Connection runtime() throws SQLException {return DriverManager.getConnection(PG.getJdbcUrl(),"ledger_runtime",RUNTIME);}
    static void execute(String sql,Object...args) throws SQLException {try(Connection c=owner();PreparedStatement p=c.prepareStatement(sql)){bind(p,args);p.execute();}}
    static void bind(PreparedStatement p,Object...args) throws SQLException {for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);}
    static String scalar(String sql,Object...args) throws SQLException {try(Connection c=owner();PreparedStatement p=c.prepareStatement(sql)){bind(p,args);try(ResultSet r=p.executeQuery()){assertTrue(r.next());return r.getString(1);}}}
    static void status(int expected,Response response){assertEquals(expected,response.statusCode(),()->response.statusCode()+" "+response.jsonPath().getString("code"));}
    static JsonNode body(Response r) throws Exception{return JSON.readTree(r.asString());}
    static Actor actor(boolean admin) throws Exception {
        Browser b=new Browser();b.csrf();String email="admin-it-"+UUID.randomUUID()+"@example.test",password="Fixture-"+UUID.randomUUID();
        Response r=b.call("POST","/auth/register",Map.of("email",email,"password",password,"displayName","Investigation fixture"));status(201,r);UUID id=UUID.fromString(r.jsonPath().getString("id"));
        if(admin)execute("UPDATE ledger.app_users SET role='ADMIN' WHERE id=?",id);
        status(200,b.call("POST","/auth/login",Map.of("email",email,"password",password)));b.csrf();return new Actor(id,email,b);
    }
    static UUID account(Actor actor) {Response r=actor.browser.call("POST","/accounts",Map.of("name","Investigation wallet","currency","CAD"));status(201,r);return UUID.fromString(r.jsonPath().getString("id"));}
    static void fund(UUID account,long amount) throws Exception {
        UUID asset=UUID.randomUUID();execute("INSERT INTO ledger.accounts(id,label,currency,kind) VALUES(?,'Investigation funding','CAD','SANDBOX_FUNDING_ASSET')",asset);
        execute("INSERT INTO ledger.account_balances(account_id) VALUES(?)",asset);
        execute("SELECT ledger._post(?,'FUNDING',?,?,?,'CAD')",UUID.randomUUID(),asset,account,amount);
    }
    static Map<String,String> intent(UUID source,UUID destination,String amount) throws Exception {return Map.of("sourceId",source.toString(),"recipientRef",scalar("SELECT public_ref FROM ledger.accounts WHERE id=?",destination),"amountMinor",amount,"currency","CAD");}
    static Fixture fixture(boolean settle) throws Exception {
        Actor payer=actor(false),recipient=actor(false);UUID source=account(payer),destination=account(recipient);fund(source,10000);
        Response response=payer.browser.call("POST","/payments",intent(source,destination,"2500"));status(202,response);UUID payment=UUID.fromString(response.jsonPath().getString("id"));
        if(settle)try(Connection c=runtime();PreparedStatement p=c.prepareStatement("SELECT ledger.settle_event(?,?,?)")){
            p.setObject(1,UUID.fromString(scalar("SELECT id FROM ledger.outbox_events WHERE aggregate_id=? AND event_type='payment.requested'",payment)));
            p.setObject(2,payment);p.setObject(3,UUID.randomUUID());p.execute();
        }
        return new Fixture(payer,recipient,source,destination,payment);
    }
    static JsonNode run(Actor admin) throws Exception {Response r=admin.browser.call("POST","/admin/reconciliation",Map.of("id",UUID.randomUUID()));status(201,r);return body(r);}
    @Test void P08FIT01_directAdministratorAuthorization() throws Exception {
        Actor customer=actor(false),admin=actor(true);String id=UUID.randomUUID().toString();
        for(String path:List.of("/admin/transactions","/admin/transactions/"+id,"/admin/audit","/admin/reconciliation","/admin/reconciliation/"+id,"/admin/failed-work")){
            status(401,new Browser().call("GET",path,null));status(403,customer.browser.call("GET",path,null));
        }
        Response allowed=admin.browser.call("GET","/admin/transactions",null);status(200,allowed);assertTrue(allowed.header("Cache-Control").contains("no-store"));
        Browser noCsrf=admin.browser.copy();noCsrf.csrf=null;status(403,noCsrf.call("POST","/admin/reconciliation",Map.of("id",UUID.randomUUID())));
    }
    @Test void P08FIT02_allTransactionFiltersAndExactStrings() throws Exception {
        Fixture f=fixture(true);Actor admin=actor(true);String journal=scalar("SELECT journal_id FROM ledger.payments WHERE id=?",f.payment);
        String query="/admin/transactions?reference="+f.payment+"&kind=PAYMENT&status=SETTLED&currency=CAD&account="+f.source+"&user="+f.payer.id
            +"&minAmountMinor=2500&maxAmountMinor=2500&from=2000-01-01T00:00:00Z&to=2099-01-01T00:00:00Z";
        Response r=admin.browser.call("GET",query,null);status(200,r);JsonNode data=body(r);assertEquals(1,data.path("results").path("items").size());
        JsonNode item=data.path("results").path("items").get(0);assertEquals(f.payment.toString(),item.path("id").asText());assertTrue(item.path("amountMinor").isTextual());assertEquals("2500",item.path("amountMinor").asText());
        assertEquals(f.payment.toString(),body(admin.browser.call("GET","/admin/transactions?reference="+journal,null)).at("/results/items/0/id").asText());
        assertEquals(0,body(admin.browser.call("GET",query+"&parentId="+UUID.randomUUID(),null)).at("/results/items").size());
        assertEquals("repeatable read",data.at("/snapshot/isolation").asText());assertTrue(data.at("/snapshot/readOnly").asBoolean());
    }
    @Test void P08FIT03_badUnknownAndRepeatedFiltersAreControlled() throws Exception {
        Actor admin=actor(true);
        for(String query:List.of("sort=amount","kind=PAYMENT&kind=TRANSFER","offset=10001","minAmountMinor=1e3","reference=1-1-1-1-1","currency=EUR","from=2026-09-01"))
            status(400,admin.browser.call("GET","/admin/transactions?"+query,null));
        status(400,admin.browser.call("GET","/admin/audit?action=x'--",null));
    }
    @Test void P08FIT04_stableTieBreakAndBoundedPages() throws Exception {
        Actor sender=actor(false),recipient=actor(false),admin=actor(true);UUID source=account(sender),destination=account(recipient);fund(source,10000);
        List<String> ids=new ArrayList<>();for(int i=0;i<3;i++){Response r=sender.browser.call("POST","/transfers",intent(source,destination,"100"));status(201,r);ids.add(r.jsonPath().getString("id"));}
        // Deliberately equal timestamps in this disposable fixture, without loosening release permissions.
        try(Connection c=owner();Statement statement=c.createStatement()) {
            c.setAutoCommit(false);statement.execute("ALTER TABLE ledger.transfers DISABLE TRIGGER immutable_transfers");
            try(PreparedStatement update=c.prepareStatement("UPDATE ledger.transfers SET created_at='2026-01-01T00:00:00Z' WHERE source_id=?")) {update.setObject(1,source);update.executeUpdate();}
            statement.execute("ALTER TABLE ledger.transfers ENABLE TRIGGER immutable_transfers");c.commit();
        }
        ids.sort(Comparator.reverseOrder());
        for(int i=0;i<3;i++){JsonNode page=body(admin.browser.call("GET","/admin/transactions?kind=TRANSFER&account="+source+"&limit=1&offset="+i,null)).path("results");
            assertEquals(1,page.path("items").size());assertEquals(ids.get(i),page.at("/items/0/id").asText());assertEquals(i<2,page.path("hasMore").asBoolean());}
    }
    @Test void P08FIT05_detailShowsExactJournalAndLinkedAdjustment() throws Exception {
        Fixture f=fixture(true);Actor admin=actor(true);Response refund=f.recipient.browser.call("POST","/payments/"+f.payment+"/refunds",Map.of("amountMinor","500","reason","Controlled refund"));status(201,refund);
        Response r=admin.browser.call("GET","/admin/transactions/"+f.payment,null);status(200,r);JsonNode detail=body(r);
        assertEquals("PARTIALLY_REFUNDED",detail.at("/transaction/adjustmentState").asText());assertEquals(2,detail.path("entries").size());
        assertEquals("500",detail.at("/payment/refundedMinor").asText());assertEquals("CONSUMED",detail.at("/payment/holdState").asText());
        assertEquals(refund.jsonPath().getString("id"),detail.at("/adjustments/items/0/id").asText());assertEquals("NOT_CHECKED",detail.path("auditIntegrity").asText());
        long debits=0,credits=0;for(JsonNode entry:detail.path("entries")){assertEquals("2500",entry.path("amountMinor").asText());if(entry.path("side").asText().equals("DEBIT"))debits+=Long.parseLong(entry.path("amountMinor").asText());else credits+=Long.parseLong(entry.path("amountMinor").asText());}assertEquals(debits,credits);
        Fixture pending=fixture(false);JsonNode uns=body(admin.browser.call("GET","/admin/transactions/"+pending.payment,null));assertTrue(uns.at("/transaction/journalId").isNull());assertTrue(uns.path("entries").isEmpty());
    }
    @Test void P08FIT06_auditIsBoundedAndDoesNotSerializePrivateBodies() throws Exception {
        Fixture f=fixture(true);Actor admin=actor(true);Response r=admin.browser.call("GET","/admin/audit?aggregateId="+f.payment+"&limit=1",null);status(200,r);JsonNode page=body(r);
        assertEquals(1,page.at("/results/items").size());assertTrue(page.at("/results/hasMore").asBoolean());assertEquals("NOT_CHECKED",page.path("integrity").asText());
        for(String forbidden:List.of("canonicalBody","canonical_body","password","previousHash","previous_hash","cookies","token"))assertFalse(r.asString().contains(forbidden));
        assertEquals("PAYMENT_SETTLED",page.at("/results/items/0/action").asText());
    }
    @Test void P08FIT07_reconciliationSnapshotSavedOnceAndReloaded() throws Exception {
        fixture(true);Actor admin=actor(true);UUID id=UUID.randomUUID();Response first=admin.browser.call("POST","/admin/reconciliation",Map.of("id",id));status(201,first);
        JsonNode report=body(first);assertEquals("PASS",report.path("status").asText());assertEquals("0",report.path("discrepancyCount").asText());assertEquals(8,report.path("checks").size());
        assertTrue(report.at("/snapshot/readOnly").asBoolean());assertFalse(report.at("/snapshot/snapshotId").asText().isBlank());
        Response replay=admin.browser.call("POST","/admin/reconciliation",Map.of("id",id));status(200,replay);assertEquals("true",replay.header("Idempotency-Replayed"));assertEquals(report,body(replay));
        assertEquals(report,body(admin.browser.call("GET","/admin/reconciliation/"+id,null)));assertEquals("1",scalar("SELECT count(*) FROM ledger.reconciliation_runs WHERE id=?",id));
        Actor other=actor(true);status(409,other.browser.call("POST","/admin/reconciliation",Map.of("id",id)));
    }
    @Test void P08FIT08_discrepancyIsReportedWithoutRepairingMoney() throws Exception {
        Fixture f=fixture(true);Actor admin=actor(true);String before=scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",f.source);
        try {
            execute("ALTER TABLE ledger.account_balances DISABLE TRIGGER USER");
            execute("UPDATE ledger.account_balances SET posted_minor=posted_minor+1 WHERE account_id=?",f.source);
            JsonNode report=run(admin);assertEquals("DISCREPANCIES",report.path("status").asText());assertTrue(report.path("checks").toString().contains(f.source.toString()));
            assertEquals(Long.toString(Long.parseLong(before)+1),scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",f.source));
        } finally {
            execute("UPDATE ledger.account_balances SET posted_minor=? WHERE account_id=?",Long.parseLong(before),f.source);
            execute("ALTER TABLE ledger.account_balances ENABLE TRIGGER USER");
        }
        assertEquals("PASS",run(admin).path("status").asText());
    }
    @Test void P08FIT09_auditTamperingDetectedAndRestored() throws Exception {
        Fixture f=fixture(true);Actor admin=actor(true);String original=scalar("SELECT canonical_body FROM ledger.audit_records WHERE aggregate_id=? AND sequence=1",f.payment);
        try {
            execute("ALTER TABLE ledger.audit_records DISABLE TRIGGER immutable_audit");
            execute("UPDATE ledger.audit_records SET canonical_body=canonical_body||' ' WHERE aggregate_id=? AND sequence=1",f.payment);
            JsonNode report=run(admin);assertEquals("DISCREPANCIES",report.path("status").asText());
            assertTrue(report.path("checks").toString().contains("Canonical audit bytes"));
        } finally {
            execute("UPDATE ledger.audit_records SET canonical_body=? WHERE aggregate_id=? AND sequence=1",original,f.payment);
            execute("ALTER TABLE ledger.audit_records ENABLE TRIGGER immutable_audit");
        }
        assertEquals("PASS",run(admin).path("status").asText());
    }
    @Test void P08FIT10_readOnlySnapshotDoesNotMixConcurrentCommits() throws Exception {
        Actor user=actor(false);UUID account=account(user);fund(account,1000);
        DriverManagerDataSource ds=new DriverManagerDataSource(PG.getJdbcUrl(),"ledger_runtime",RUNTIME);JdbcTemplate jdbc=new JdbcTemplate(ds);
        AdminSnapshot snapshots=new AdminSnapshot(jdbc,new DataSourceTransactionManager(ds));
        String observed=snapshots.execute(snapshot->{
            String before=jdbc.queryForObject("SELECT posted_minor::text FROM ledger.account_balances WHERE account_id=?",String.class,account);
            try {fund(account,500);} catch(Exception failure){throw new RuntimeException(failure);}
            assertEquals(before,jdbc.queryForObject("SELECT posted_minor::text FROM ledger.account_balances WHERE account_id=?",String.class,account));
            assertTrue(snapshot.readOnly());return before;
        });
        assertEquals("1000",observed);assertEquals("1500",scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",account));
        assertThrows(org.springframework.dao.DataAccessException.class,()->snapshots.execute(snapshot->{jdbc.update("DELETE FROM ledger.reconciliation_runs WHERE false");return true;}));
    }
    @Test void P08FIT11_concurrentRunIdentityRetainsOneReport() throws Exception {
        Actor admin=actor(true);UUID id=UUID.randomUUID();CyclicBarrier barrier=new CyclicBarrier(2);
        try(ExecutorService pool=Executors.newFixedThreadPool(2)) {
            var one=pool.submit(()->{barrier.await();return admin.browser.copy().call("POST","/admin/reconciliation",Map.of("id",id));});
            var two=pool.submit(()->{barrier.await();return admin.browser.copy().call("POST","/admin/reconciliation",Map.of("id",id));});
            Response a=one.get(20,TimeUnit.SECONDS),b=two.get(20,TimeUnit.SECONDS);assertEquals(Set.of(200,201),Set.of(a.statusCode(),b.statusCode()));assertEquals(body(a),body(b));
        }
        assertEquals("1",scalar("SELECT count(*) FROM ledger.reconciliation_runs WHERE id=?",id));
    }
    @Test void P08FIT12_readsAndRunHistoryCannotMutateFinancialRecords() throws Exception {
        Fixture f=fixture(true);Actor admin=actor(true);String fingerprint=scalar("SELECT md5(row_to_json(p)::text) FROM ledger.payments p WHERE id=?",f.payment);
        status(200,admin.browser.call("GET","/admin/transactions/"+f.payment,null));run(admin);status(200,admin.browser.call("GET","/admin/reconciliation?limit=1",null));
        assertEquals(fingerprint,scalar("SELECT md5(row_to_json(p)::text) FROM ledger.payments p WHERE id=?",f.payment));
        try(Connection c=runtime();Statement s=c.createStatement()){
            assertEquals("42501",assertThrows(SQLException.class,()->s.executeUpdate("UPDATE ledger.audit_records SET action=action")).getSQLState());
            assertEquals("42501",assertThrows(SQLException.class,()->s.executeUpdate("DELETE FROM ledger.reconciliation_runs")).getSQLState());
        }
    }
    @Test void P08FIT13_eventVersionsRemainNumericallyOrderedBeyondNine() throws Exception {
        Fixture f=fixture(true);Actor admin=actor(true);
        for(int i=0;i<12;i++) status(201,f.recipient.browser.call("POST","/payments/"+f.payment+"/refunds",
            Map.of("amountMinor","1","reason","Numeric version ordering regression")));
        Response response=admin.browser.call("GET","/admin/transactions/"+f.payment,null);status(200,response);
        JsonNode detail=body(response);assertEquals("14",detail.at("/transaction/version").asText());
        JsonNode events=detail.at("/events/items");assertEquals(14,events.size());
        for(int i=0;i<events.size();i++) assertEquals(Integer.toString(14-i),events.get(i).path("aggregateVersion").asText());
        JsonNode audit=body(admin.browser.call("GET","/admin/audit?aggregateId="+f.payment,null)).at("/results/items");
        assertEquals(14,audit.size());
        for(int i=0;i<audit.size();i++) assertEquals(Integer.toString(14-i),audit.get(i).path("sequence").asText());
    }

}
