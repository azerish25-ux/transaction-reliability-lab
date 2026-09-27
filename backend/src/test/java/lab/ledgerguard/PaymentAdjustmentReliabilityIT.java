package lab.ledgerguard;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restassured.response.Response;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import lab.ledgerguard.db.FinancialCommands;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/** P06: real HTTP through two API JVMs plus PostgreSQL races and immutable accounting evidence. */
@Testcontainers
class PaymentAdjustmentReliabilityIT {
    @Container static final PostgreSQLContainer<?> PG=new PostgreSQLContainer<>("postgres:17.11-bookworm")
        .withDatabaseName("ledgeradjustments").withUsername("postgres").withPassword(UUID.randomUUID().toString());
    static final ObjectMapper JSON=new ObjectMapper();
    static final String OWNER=UUID.randomUUID().toString(),RUNTIME=UUID.randomUUID().toString();
    static final byte[] KEY=new byte[64];
    static final Path EVIDENCE=Path.of("target/payment-adjustment-http-evidence");
    static App first,second; static FinancialCommands commands;
    record App(Process process,int port,Path log) { }
    record User(UUID id,String email,String password,Browser browser) { }
    record Fixture(User payer,User recipient,String source,String destination,String recipientRef,
                   UUID paymentId,UUID settlementJournal,long amount,long openingBalance) { }

    static class Browser {
        final int port; final Map<String,String> cookies=new HashMap<>(); String csrf;
        Browser(int port){this.port=port;}
        Response call(String method,String path,Object body){return call(method,path,body,Map.of());}
        Response call(String method,String path,Object body,Map<String,String> headers){
            var request=given().baseUri("http://127.0.0.1").port(port).redirects().follow(false)
                .cookies(cookies).headers(headers).accept("application/json");
            if(csrf!=null)request.header("X-XSRF-TOKEN",csrf);
            if(body!=null){request.contentType("application/json");if(body instanceof String raw)request.body(raw);else request.body(body);}
            Response response=request.request(method,"/api/v1"+path);
            response.detailedCookies().forEach(c->{if(c.getMaxAge()==0)cookies.remove(c.getName());else cookies.put(c.getName(),c.getValue());});
            return response;
        }
        void csrf(){Response r=call("GET","/auth/csrf",null);status(200,r);csrf=r.jsonPath().getString("token");assertNotNull(csrf);}
        Browser copy(int targetPort){Browser b=new Browser(targetPort);b.cookies.putAll(cookies);b.csrf=csrf;return b;}
        String cookieHeader(){return cookies.entrySet().stream().map(e->e.getKey()+"="+e.getValue()).collect(java.util.stream.Collectors.joining("; "));}
    }

    /** Consumes a committed upstream response and then resets the caller's connection. */
    static final class DropAfterCommitProxy implements AutoCloseable {
        final ServerSocket server; final ExecutorService worker=Executors.newSingleThreadExecutor(); final Future<Integer> result;
        DropAfterCommitProxy(int upstream) throws IOException {server=new ServerSocket(0,1,InetAddress.getLoopbackAddress());result=worker.submit(()->relay(upstream));}
        int port(){return server.getLocalPort();} int status() throws Exception{return result.get(15,TimeUnit.SECONDS);}
        int relay(int upstreamPort) throws Exception {
            try(Socket client=server.accept()){
                client.setSoTimeout(10000);byte[] headers=readHeaders(client.getInputStream());String text=new String(headers,StandardCharsets.ISO_8859_1);
                byte[] body=client.getInputStream().readNBytes(contentLength(text));String[] lines=text.substring(0,text.length()-4).split("\\r\\n");
                StringBuilder forward=new StringBuilder(lines[0]).append("\r\n");
                for(int i=1;i<lines.length;i++){String lower=lines[i].toLowerCase(Locale.ROOT);if(lower.startsWith("host:")||lower.startsWith("connection:")||lower.startsWith("expect:"))continue;forward.append(lines[i]).append("\r\n");}
                forward.append("Host: 127.0.0.1:").append(upstreamPort).append("\r\nConnection: close\r\n\r\n");
                byte[] response;try(Socket upstream=new Socket(InetAddress.getLoopbackAddress(),upstreamPort)){upstream.setSoTimeout(10000);upstream.getOutputStream().write(forward.toString().getBytes(StandardCharsets.ISO_8859_1));upstream.getOutputStream().write(body);upstream.getOutputStream().flush();response=upstream.getInputStream().readAllBytes();}
                String firstLine=new String(response,0,Math.min(128,response.length),StandardCharsets.ISO_8859_1).split("\\r\\n",2)[0];
                client.setSoLinger(true,0);return Integer.parseInt(firstLine.split(" ")[1]);
            }
        }
        static byte[] readHeaders(InputStream in) throws IOException {ByteArrayOutputStream out=new ByteArrayOutputStream();int state=0;while(out.size()<65536){int v=in.read();if(v<0)throw new EOFException();out.write(v);state=(state==0&&v=='\r')?1:(state==1&&v=='\n')?2:(state==2&&v=='\r')?3:(state==3&&v=='\n')?4:0;if(state==4)return out.toByteArray();}throw new IOException("headers too large");}
        static int contentLength(String headers){for(String line:headers.split("\\r\\n"))if(line.toLowerCase(Locale.ROOT).startsWith("content-length:"))return Integer.parseInt(line.substring(line.indexOf(':')+1).trim());return 0;}
        public void close() throws Exception {server.close();worker.shutdownNow();worker.awaitTermination(5,TimeUnit.SECONDS);}
    }

    @BeforeAll static void start() throws Exception {
        new SecureRandom().nextBytes(KEY);Files.createDirectories(EVIDENCE);
        try(Connection c=DriverManager.getConnection(PG.getJdbcUrl(),PG.getUsername(),PG.getPassword());Statement s=c.createStatement()){
            s.execute("CREATE ROLE ledger_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+OWNER+"'");
            s.execute("CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+RUNTIME+"'");
            s.execute("GRANT CREATE ON DATABASE ledgeradjustments TO ledger_owner");s.execute("GRANT USAGE,CREATE ON SCHEMA public TO ledger_owner");
        }
        Flyway.configure().dataSource(PG.getJdbcUrl(),"ledger_owner",OWNER).defaultSchema("public")
            .locations("classpath:db/migration").load().migrate();
        commands=new FinancialCommands(new DriverManagerDataSource(PG.getJdbcUrl(),"ledger_runtime",RUNTIME));
        first=launch("adjustment-one");second=launch("adjustment-two");
    }
    static App launch(String name) throws Exception {
        int port;try(ServerSocket socket=new ServerSocket(0)){port=socket.getLocalPort();}Path log=EVIDENCE.resolve(name+"-"+port+".log");
        ProcessBuilder builder=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","java").toString(),"-Xmx256m","-jar","target/ledgerguard.jar",
            "--server.port="+port,"--spring.profiles.active=sandbox","--ledgerguard.auth.bcrypt-strength=10","--ledgerguard.auth.ip-limit=1000","--ledgerguard.auth.identity-limit=1000",
            "--management.health.rabbit.enabled=false","--management.endpoint.health.group.readiness.include=readinessState,ledgerDatabase","--spring.datasource.hikari.maximum-pool-size=16");
        var env=builder.environment();env.put("LEDGER_DATABASE_URL",PG.getJdbcUrl());env.put("LEDGER_MIGRATION_URL",PG.getJdbcUrl());env.put("LEDGER_OWNER_PASSWORD",OWNER);env.put("LEDGER_RUNTIME_PASSWORD",RUNTIME);env.put("LEDGER_AUTH_KEY",Base64.getEncoder().encodeToString(KEY));env.put("LEDGER_SANDBOX_HTTP","true");env.put("LEDGER_RABBIT_PASSWORD",UUID.randomUUID().toString());
        builder.redirectErrorStream(true).redirectOutput(log.toFile());App app=new App(builder.start(),port,log);
        try{HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build();long deadline=System.nanoTime()+Duration.ofSeconds(70).toNanos();while(System.nanoTime()<deadline&&app.process.isAlive()){try{var response=client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/system")).timeout(Duration.ofSeconds(2)).build(),HttpResponse.BodyHandlers.ofString());if(response.statusCode()==200&&JSON.readTree(response.body()).path("databaseRole").asText().equals("ledger_runtime"))return app;}catch(IOException ignored){}Thread.sleep(100);}throw new AssertionError("API failed readiness: "+Files.readString(log));}catch(Throwable failure){stop(app);throw failure;}
    }
    static void stop(App app) throws InterruptedException {if(app==null)return;app.process.destroy();if(!app.process.waitFor(10,TimeUnit.SECONDS)){app.process.destroyForcibly();assertTrue(app.process.waitFor(10,TimeUnit.SECONDS));}}
    @AfterAll static void cleanup() throws Exception {try{stop(first);}finally{stop(second);}}

    static Connection owner() throws SQLException{return DriverManager.getConnection(PG.getJdbcUrl(),"ledger_owner",OWNER);}
    static Connection runtime() throws SQLException{return DriverManager.getConnection(PG.getJdbcUrl(),"ledger_runtime",RUNTIME);}
    static UUID uuid(Connection c,String sql,Object...args) throws SQLException{try(PreparedStatement p=c.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet r=p.executeQuery()){assertTrue(r.next());return r.getObject(1,UUID.class);}}}
    static long scalar(String sql,Object...args) throws SQLException{try(Connection c=owner();PreparedStatement p=c.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet r=p.executeQuery()){r.next();return r.getLong(1);}}}
    static String text(String sql,Object...args) throws SQLException{try(Connection c=owner();PreparedStatement p=c.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet r=p.executeQuery()){r.next();return r.getString(1);}}}
    static void status(int expected,Response response){assertEquals(expected,response.statusCode(),()->response.asString());}
    static User user(){String email=UUID.randomUUID()+"@example.test",password="P-"+UUID.randomUUID();Browser b=new Browser(first.port);b.csrf();Response register=b.call("POST","/auth/register",Map.of("email",email,"password",password,"displayName","P06 customer"));status(201,register);UUID id=UUID.fromString(register.jsonPath().getString("id"));status(200,b.call("POST","/auth/login",Map.of("email",email,"password",password)));b.csrf=null;b.csrf();return new User(id,email,password,b);}
    static User admin() throws SQLException {User admin=user();try(Connection c=owner();PreparedStatement p=c.prepareStatement("UPDATE ledger.app_users SET role='ADMIN' WHERE id=?")){p.setObject(1,admin.id);assertEquals(1,p.executeUpdate());}return admin;}
    static String account(User user,String name,String currency){Response r=user.browser.call("POST","/accounts",Map.of("name",name,"currency",currency));status(201,r);return r.jsonPath().getString("id");}
    static String ref(String account) throws SQLException{return text("SELECT public_ref FROM ledger.accounts WHERE id=?",UUID.fromString(account));}
    static void fund(String target,long amount,String currency) throws Exception{try(Connection c=owner()){c.setAutoCommit(false);UUID asset=uuid(c,"INSERT INTO ledger.accounts(label,currency,kind) VALUES(?,?,'SANDBOX_FUNDING_ASSET') RETURNING id","P06 asset "+UUID.randomUUID(),currency);try(PreparedStatement p=c.prepareStatement("INSERT INTO ledger.account_balances(account_id) VALUES(?)")){p.setObject(1,asset);p.executeUpdate();}uuid(c,"SELECT ledger._post(?,'FUNDING',?,?,?,?)",UUID.randomUUID(),asset,UUID.fromString(target),amount,currency);c.commit();}}
    static Map<String,String> intent(String source,String recipient,String amount,String currency){return new LinkedHashMap<>(Map.of("sourceId",source,"recipientRef",recipient,"amountMinor",amount,"currency",currency));}
    static Response payment(Browser browser,String key,Object body){return browser.call("POST","/payments",body,Map.of("Idempotency-Key",key));}
    static Response transfer(Browser browser,String key,Object body){return browser.call("POST","/transfers",body,Map.of("Idempotency-Key",key));}
    static Response cancel(Browser browser,UUID payment,String key,Object body){return browser.call("POST","/payments/"+payment+"/cancel",body,Map.of("Idempotency-Key",key));}
    static Response refund(Browser browser,UUID payment,String key,Object body){return browser.call("POST","/payments/"+payment+"/refunds",body,Map.of("Idempotency-Key",key));}
    static Response reversal(Browser browser,UUID payment,String key,Object body){return browser.call("POST","/payments/"+payment+"/reversal",body,Map.of("Idempotency-Key",key));}
    static Fixture settled(long amount) throws Exception {User payer=user(),recipient=user();String source=account(payer,"P06 source","CAD"),destination=account(recipient,"P06 recipient","CAD");long opening=Math.max(10000,amount);fund(source,opening,"CAD");Response accepted=payment(payer.browser,"payment-"+UUID.randomUUID(),intent(source,ref(destination),Long.toString(amount),"CAD"));status(202,accepted);UUID id=UUID.fromString(accepted.jsonPath().getString("id"));assertEquals("SETTLED",commands.settle(UUID.randomUUID(),id,UUID.randomUUID()));UUID journal=UUID.fromString(text("SELECT journal_id::text FROM ledger.payments WHERE id=?",id));return new Fixture(payer,recipient,source,destination,ref(destination),id,journal,amount,opening);}
    static void reconciled(String account) throws SQLException{assertEquals(0,scalar("SELECT count(*) FROM ledger.account_balances b JOIN ledger.accounts a ON a.id=b.account_id WHERE a.id=? AND (b.posted_minor<>(SELECT coalesce(sum(CASE WHEN side='CREDIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) FROM ledger.journal_entries e WHERE e.account_id=a.id) OR b.reserved_minor<>(SELECT coalesce(sum(amount_minor),0) FROM ledger.holds h WHERE h.account_id=a.id AND h.state='ACTIVE'))",UUID.fromString(account)));}

    @Test void P0601_payerCancellationReplaysAndNeverPostsMoney() throws Exception {
        User payer=user(),recipient=user();String source=account(payer,"Cancel source","CAD"),destination=account(recipient,"Cancel target","CAD");fund(source,10000,"CAD");Response accepted=payment(payer.browser,"payment-cancel-0601",intent(source,ref(destination),"2500","CAD"));status(202,accepted);UUID id=UUID.fromString(accepted.jsonPath().getString("id"));
        Response firstCancel=cancel(payer.browser,id,"cancel-key-0601",Map.of()),replay=cancel(payer.browser,id,"cancel-key-0601",Map.of());status(200,firstCancel);status(200,replay);assertEquals(firstCancel.asString(),replay.asString());assertEquals("false",firstCancel.header("Idempotency-Replayed"));assertEquals("true",replay.header("Idempotency-Replayed"));assertEquals("/api/v1/payments/"+id,firstCancel.header("Location"));
        Response current=payer.browser.call("GET","/payments/"+id,null);status(200,current);assertEquals("CANCELLED",current.jsonPath().getString("state"));assertEquals("NONE",current.jsonPath().getString("adjustmentState"));assertEquals("CANCELLED",commands.settle(UUID.randomUUID(),id,UUID.randomUUID()));
        assertEquals(0,scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?",id));assertEquals("RELEASED",text("SELECT state FROM ledger.holds WHERE payment_id=?",id));assertEquals(0,scalar("SELECT reserved_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(10000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(1,scalar("SELECT count(*) FROM ledger.audit_records WHERE aggregate_id=? AND action='CANCEL'",id));assertEquals(1,scalar("SELECT count(*) FROM ledger.outbox_events WHERE aggregate_id=? AND event_type='payment.updated'",id));reconciled(source);reconciled(destination);
    }

    @Test void P0602_cancellationAuthorityAndAdminReasonAreEnforced() throws Exception {
        User payer=user(),recipient=user(),outsider=user(),admin=admin();String source=account(payer,"Cancel source","CAD"),destination=account(recipient,"Cancel target","CAD");fund(source,10000,"CAD");UUID id=UUID.fromString(payment(payer.browser,"payment-cancel-0602",intent(source,ref(destination),"1000","CAD")).jsonPath().getString("id"));
        status(404,cancel(recipient.browser,id,"recipient-cancel-0602",Map.of()));status(404,cancel(outsider.browser,id,"outsider-cancel-0602",Map.of()));status(403,cancel(admin.browser,id,"admin-no-reason-0602",Map.of()));Response approved=cancel(admin.browser,id,"admin-cancel-0602",Map.of("reason","  fraud review  "));status(200,approved);assertEquals(0,scalar("SELECT count(*) FROM ledger.idempotency_records WHERE actor_id IN (?,?) AND operation_kind='CANCEL'",recipient.id,outsider.id));assertEquals(1,scalar("SELECT count(*) FROM ledger.audit_records WHERE aggregate_id=? AND action='CANCEL' AND canonical_body LIKE '%fraud review%'",id));
    }

    @Test void P0603_cancellationVersusSettlementHasExactlyOneWinner() throws Exception {
        User payer=user(),recipient=user();String source=account(payer,"Race source","CAD"),destination=account(recipient,"Race target","CAD");fund(source,10000,"CAD");UUID id=UUID.fromString(payment(payer.browser,"payment-race-0603",intent(source,ref(destination),"4000","CAD")).jsonPath().getString("id"));CyclicBarrier barrier=new CyclicBarrier(2);Response cancelled;String settled;
        try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> left=pool.submit(()->{barrier.await();return cancel(payer.browser.copy(first.port),id,"cancel-race-0603",Map.of());});Future<String> right=pool.submit(()->{barrier.await();return commands.settle(UUID.randomUUID(),id,UUID.randomUUID());});cancelled=left.get(15,TimeUnit.SECONDS);settled=right.get(15,TimeUnit.SECONDS);}
        assertTrue(cancelled.statusCode()==200||cancelled.statusCode()==409,cancelled.asString());String state=text("SELECT state FROM ledger.payments WHERE id=?",id);if(cancelled.statusCode()==200){assertEquals("CANCELLED",settled);assertEquals("CANCELLED",state);assertEquals(0,scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?",id));assertEquals("RELEASED",text("SELECT state FROM ledger.holds WHERE payment_id=?",id));assertEquals(10000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));}else{assertEquals("SETTLED",settled);assertEquals("SETTLED",state);assertEquals(1,scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?",id));assertEquals("CONSUMED",text("SELECT state FROM ledger.holds WHERE payment_id=?",id));assertEquals(6000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));}assertEquals(0,scalar("SELECT reserved_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(1,scalar("SELECT count(*) FROM ledger.outbox_events WHERE aggregate_id=? AND event_type='payment.updated'",id));reconciled(source);reconciled(destination);
    }

    @Test void P0604_partialAndFullRefundPreserveSettlementHistory() throws Exception {
        Fixture f=settled(10000);Response partial=refund(f.recipient.browser,f.paymentId,"refund-partial-0604",Map.of("amountMinor","3000","reason","First return"));status(201,partial);String firstAdjustment=partial.jsonPath().getString("id");assertEquals("/api/v1/payments/"+f.paymentId+"/adjustments/"+firstAdjustment,partial.header("Location"));Response afterPartial=f.payer.browser.call("GET","/payments/"+f.paymentId,null);assertEquals("PARTIALLY_REFUNDED",afterPartial.jsonPath().getString("adjustmentState"));
        Response full=refund(f.recipient.browser,f.paymentId,"refund-full-0604",Map.of("amountMinor","7000","reason","Final return"));status(201,full);Response current=f.payer.browser.call("GET","/payments/"+f.paymentId,null);status(200,current);assertEquals("SETTLED",current.jsonPath().getString("state"));assertEquals("FULLY_REFUNDED",current.jsonPath().getString("adjustmentState"));assertEquals(f.settlementJournal.toString(),current.jsonPath().getString("journalId"));
        Response page=f.recipient.browser.call("GET","/payments/"+f.paymentId+"/adjustments?limit=1&offset=0",null);status(200,page);assertTrue(page.jsonPath().getBoolean("hasMore"));Response detail=f.payer.browser.call("GET","/payments/"+f.paymentId+"/adjustments/"+firstAdjustment,null);status(200,detail);assertEquals("REFUND",detail.jsonPath().getString("kind"));assertEquals(2,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=? AND kind='REFUND'",f.paymentId));assertEquals(2,scalar("SELECT count(*) FROM ledger.journal_entries WHERE journal_id=?",f.settlementJournal));assertEquals(3,scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=? OR operation_id IN (SELECT id FROM ledger.adjustments WHERE payment_id=?)",f.paymentId,f.paymentId));assertEquals(f.openingBalance,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(f.source)));assertEquals(0,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(f.destination)));reconciled(f.source);reconciled(f.destination);
    }

    @Test void P0605_refundAuthorizationValidationAndDurableRejection() throws Exception {
        Fixture f=settled(2500);User outsider=user(),admin=admin();String payerKey="payer-refund-0605",outsiderKey="outsider-refund-0605",invalidKey="invalid-refund-0605",excessKey="excess-refund-0605";
        status(403,refund(f.payer.browser,f.paymentId,payerKey,Map.of("amountMinor","100")));status(404,refund(outsider.browser,f.paymentId,outsiderKey,Map.of("amountMinor","100")));status(400,refund(f.recipient.browser,f.paymentId,invalidKey,Map.of("amountMinor","01")));assertEquals(0,scalar("SELECT count(*) FROM ledger.idempotency_records WHERE key IN (?,?,?)",payerKey,outsiderKey,invalidKey));
        Response excess=refund(f.recipient.browser,f.paymentId,excessKey,Map.of("amountMinor","2501")),replay=refund(f.recipient.browser,f.paymentId,excessKey,Map.of("amountMinor","2501"));status(422,excess);status(422,replay);assertEquals("EXCESS_REFUND",excess.jsonPath().getString("code"));assertEquals(excess.asString(),replay.asString());assertEquals("true",replay.header("Idempotency-Replayed"));Response adminRefund=refund(admin.browser,f.paymentId,"admin-refund-0605",Map.of("amountMinor","500","reason","Service recovery"));status(201,adminRefund);assertEquals(admin.id.toString(),text("SELECT actor_id::text FROM ledger.adjustments WHERE id=?",UUID.fromString(adminRefund.jsonPath().getString("id"))));
    }

    @Test void P0606_refundRequiresRecipientCurrentAvailability() throws Exception {
        Fixture f=settled(2500);User third=user();String target=account(third,"Spent funds","CAD");Response spent=transfer(f.recipient.browser,"spend-refund-0606",intent(f.destination,ref(target),"2500","CAD"));status(201,spent);Response rejected=refund(f.recipient.browser,f.paymentId,"refund-insufficient-0606",Map.of("amountMinor","100","reason","Unavailable funds"));status(422,rejected);assertEquals("INSUFFICIENT_FUNDS",rejected.jsonPath().getString("code"));assertEquals(0,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",f.paymentId));assertEquals("NONE",f.payer.browser.call("GET","/payments/"+f.paymentId,null).jsonPath().getString("adjustmentState"));reconciled(f.source);reconciled(f.destination);reconciled(target);
    }

    @Test void P0607_concurrentPartialRefundsCannotExceedSettlement() throws Exception {
        Fixture f=settled(10000);CyclicBarrier gate=new CyclicBarrier(2);List<Response> responses;
        try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> a=pool.submit(()->{gate.await();return refund(f.recipient.browser.copy(first.port),f.paymentId,"refund-race-a-0607",Map.of("amountMinor","8000"));});Future<Response> b=pool.submit(()->{gate.await();return refund(f.recipient.browser.copy(second.port),f.paymentId,"refund-race-b-0607",Map.of("amountMinor","8000"));});responses=List.of(a.get(15,TimeUnit.SECONDS),b.get(15,TimeUnit.SECONDS));}
        assertEquals(List.of(201,422),responses.stream().map(Response::statusCode).sorted().toList());assertEquals("EXCESS_REFUND",responses.stream().filter(r->r.statusCode()==422).findFirst().orElseThrow().jsonPath().getString("code"));assertEquals(8000,scalar("SELECT refunded_minor FROM ledger.payments WHERE id=?",f.paymentId));assertEquals(1,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",f.paymentId));assertEquals(8000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(f.source)));assertEquals(2000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(f.destination)));reconciled(f.source);reconciled(f.destination);
    }

    @Test void P0608_concurrentSameKeyCreatesOneRefund() throws Exception {
        Fixture f=settled(5000);String key="same-refund-key-0608";CyclicBarrier gate=new CyclicBarrier(2);Response left,right;
        try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> a=pool.submit(()->{gate.await();return refund(f.recipient.browser.copy(first.port),f.paymentId,key,Map.of("amountMinor","1000","reason","Same intent"));});Future<Response> b=pool.submit(()->{gate.await();return refund(f.recipient.browser.copy(second.port),f.paymentId,key,Map.of("reason","Same intent","amountMinor","1000"));});left=a.get(15,TimeUnit.SECONDS);right=b.get(15,TimeUnit.SECONDS);}
        status(201,left);status(201,right);assertEquals(left.asString(),right.asString());assertEquals(Set.of("true","false"),Set.of(left.header("Idempotency-Replayed"),right.header("Idempotency-Replayed")));assertEquals(1,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",f.paymentId));assertEquals(1000,scalar("SELECT refunded_minor FROM ledger.payments WHERE id=?",f.paymentId));
    }

    @Test void P0609_changedAdjustmentIntentConflictsWithoutExtraPosting() throws Exception {
        Fixture f=settled(5000);String key="refund-conflict-0609";Response firstRefund=refund(f.recipient.browser,f.paymentId,key,Map.of("amountMinor","1000","reason","Original"));status(201,firstRefund);Response changedAmount=refund(f.recipient.browser,f.paymentId,key,Map.of("amountMinor","1001","reason","Original"));status(409,changedAmount);assertEquals("IDEMPOTENCY_CONFLICT",changedAmount.jsonPath().getString("code"));Response changedReason=refund(f.recipient.browser,f.paymentId,key,Map.of("amountMinor","1000","reason","Changed"));status(409,changedReason);assertEquals(1,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",f.paymentId));assertEquals(2,scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=? OR operation_id IN (SELECT id FROM ledger.adjustments WHERE payment_id=?)",f.paymentId,f.paymentId));
    }

    @Test void P0610_lostRefundResponseReplaysOriginalOperation() throws Exception {
        Fixture f=settled(5000);String key="lost-refund-0610",body="{\"amountMinor\":\"1250\",\"reason\":\"Response lost\"}";
        try(DropAfterCommitProxy proxy=new DropAfterCommitProxy(first.port)){HttpRequest request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+proxy.port()+"/api/v1/payments/"+f.paymentId+"/refunds")).timeout(Duration.ofSeconds(10)).header("Accept","application/json").header("Content-Type","application/json").header("Cookie",f.recipient.browser.cookieHeader()).header("X-XSRF-TOKEN",f.recipient.browser.csrf).header("Idempotency-Key",key).POST(HttpRequest.BodyPublishers.ofString(body)).build();HttpClient client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();assertThrows(IOException.class,()->client.send(request,HttpResponse.BodyHandlers.ofString()));assertEquals(201,proxy.status());}
        String committed=text("SELECT id::text FROM ledger.adjustments WHERE payment_id=? AND amount_minor=1250",f.paymentId);Response replay=refund(f.recipient.browser,f.paymentId,key,body);status(201,replay);assertEquals("true",replay.header("Idempotency-Replayed"));assertEquals(committed,replay.jsonPath().getString("id"));assertEquals(1,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",f.paymentId));
    }

    @Test void P0611_adminReversalRestoresFundsAndIsInspectable() throws Exception {
        Fixture f=settled(2500);User admin=admin();status(403,reversal(f.recipient.browser,f.paymentId,"recipient-reversal-0611",Map.of("reason","Not allowed")));status(403,reversal(f.payer.browser,f.paymentId,"payer-reversal-0611",Map.of("reason","Not allowed")));status(400,reversal(admin.browser,f.paymentId,"blank-reversal-0611",Map.of("reason","  ")));
        Response reversed=reversal(admin.browser,f.paymentId,"admin-reversal-0611",Map.of("reason","  duplicate settlement correction  ")),replay=reversal(admin.browser,f.paymentId,"admin-reversal-0611",Map.of("reason","duplicate settlement correction"));status(201,reversed);status(201,replay);assertEquals(reversed.asString(),replay.asString());assertEquals("true",replay.header("Idempotency-Replayed"));String adjustment=reversed.jsonPath().getString("id");assertEquals("REVERSAL",reversed.jsonPath().getString("kind"));assertEquals("2500",reversed.jsonPath().getString("amountMinor"));Response current=f.payer.browser.call("GET","/payments/"+f.paymentId,null);assertEquals("SETTLED",current.jsonPath().getString("state"));assertEquals("REVERSED",current.jsonPath().getString("adjustmentState"));Response detail=admin.browser.call("GET","/payments/"+f.paymentId+"/adjustments/"+adjustment,null);status(200,detail);assertEquals("REVERSAL",detail.jsonPath().getString("kind"));assertEquals(f.openingBalance,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(f.source)));assertEquals(0,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(f.destination)));assertEquals(1,scalar("SELECT count(*) FROM ledger.audit_records WHERE aggregate_id=? AND action='REVERSAL' AND canonical_body LIKE '%duplicate settlement correction%'",f.paymentId));reconciled(f.source);reconciled(f.destination);
    }

    @Test void P0612_forbiddenTransitionsRemainDurableAndHistorySafe() throws Exception {
        User admin=admin();Fixture refunded=settled(3000);status(201,refund(refunded.recipient.browser,refunded.paymentId,"refund-before-reversal-0612",Map.of("amountMinor","100")));Response reverseAfterRefund=reversal(admin.browser,refunded.paymentId,"reverse-after-refund-0612",Map.of("reason","Not permitted"));status(409,reverseAfterRefund);assertEquals("REVERSAL_FORBIDDEN",reverseAfterRefund.jsonPath().getString("code"));status(409,cancel(refunded.payer.browser,refunded.paymentId,"cancel-after-settle-0612",Map.of()));
        Fixture reversed=settled(3000);status(201,reversal(admin.browser,reversed.paymentId,"reversal-0612",Map.of("reason","Correction")));Response refundAfterReverse=refund(reversed.recipient.browser,reversed.paymentId,"refund-after-reversal-0612",Map.of("amountMinor","1"));status(409,refundAfterReverse);Response secondReverse=reversal(admin.browser,reversed.paymentId,"second-reversal-0612",Map.of("reason","Again"));status(409,secondReverse);assertEquals(1,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",reversed.paymentId));
        User pendingPayer=user(),pendingRecipient=user();String source=account(pendingPayer,"Pending source","CAD"),destination=account(pendingRecipient,"Pending destination","CAD");fund(source,1000,"CAD");UUID pending=UUID.fromString(payment(pendingPayer.browser,"pending-0612",intent(source,ref(destination),"500","CAD")).jsonPath().getString("id"));status(409,refund(pendingRecipient.browser,pending,"pending-refund-0612",Map.of("amountMinor","1")));
    }

    @Test void P0613_reversalVersusRecipientSpendingHasOneEconomicWinner() throws Exception {
        Fixture f=settled(5000);User admin=admin(),third=user();String target=account(third,"Race destination","CAD");CyclicBarrier gate=new CyclicBarrier(2);Response reverse,spend;
        try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> a=pool.submit(()->{gate.await();return reversal(admin.browser.copy(first.port),f.paymentId,"reversal-race-0613",Map.of("reason","Concurrent review"));});Future<Response> b=pool.submit(()->{gate.await();return transfer(f.recipient.browser.copy(second.port),"recipient-spend-0613",intent(f.destination,ref(target),"5000","CAD"));});reverse=a.get(15,TimeUnit.SECONDS);spend=b.get(15,TimeUnit.SECONDS);}
        assertEquals(List.of(201,422),List.of(reverse.statusCode(),spend.statusCode()).stream().sorted().toList());assertEquals(1,scalar("SELECT (SELECT count(*) FROM ledger.adjustments WHERE payment_id=? AND kind='REVERSAL')+(SELECT count(*) FROM ledger.transfers WHERE source_id=? AND amount_minor=5000)",f.paymentId,UUID.fromString(f.destination)));if(reverse.statusCode()==201){assertEquals(0,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(target)));assertEquals(f.openingBalance,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(f.source)));}else{assertEquals(5000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(target)));assertEquals(f.openingBalance-5000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(f.source)));}reconciled(f.source);reconciled(f.destination);reconciled(target);
    }

    @Test void P0614_contractCsrfPaginationMigrationAndRuntimeBoundary() throws Exception {
        Browser anonymous=new Browser(first.port);status(401,anonymous.call("GET","/payments/00000000-0000-0000-0000-000000000001/adjustments",null));Fixture f=settled(1000);status(400,f.recipient.browser.call("POST","/payments/"+f.paymentId+"/refunds",Map.of("amountMinor","1")));Browser noCsrf=f.recipient.browser.copy(first.port);noCsrf.csrf=null;status(403,refund(noCsrf,f.paymentId,"missing-csrf-0614",Map.of("amountMinor","1")));Map<String,Object> injected=new HashMap<>(Map.of("amountMinor","1"));injected.put("actorId",f.payer.id.toString());status(400,refund(f.recipient.browser,f.paymentId,"mass-assignment-0614",injected));
        for(int i=0;i<3;i++)status(201,refund(f.recipient.browser,f.paymentId,"page-refund-"+i+"-0614",Map.of("amountMinor","100","reason","Page "+i)));Response page=f.payer.browser.call("GET","/payments/"+f.paymentId+"/adjustments?limit=2&offset=0",null);status(200,page);assertTrue(page.jsonPath().getBoolean("hasMore"));User outsider=user();status(404,outsider.browser.call("GET","/payments/"+f.paymentId+"/adjustments",null));
        Response p06=anonymous.call("GET","/openapi/p06.json",null);status(200,p06);var spec=JSON.readTree(p06.asString());for(String path:List.of("/api/v1/payments/{id}/cancel","/api/v1/payments/{id}/refunds","/api/v1/payments/{id}/reversal","/api/v1/payments/{id}/adjustments","/api/v1/payments/{id}/adjustments/{adjustmentId}"))assertTrue(spec.path("paths").has(path),path);Response p05=anonymous.call("GET","/openapi/p05.json",null);assertFalse(JSON.readTree(p05.asString()).path("paths").has("/api/v1/payments/{id}/cancel"));assertEquals(8,scalar("SELECT count(*) FROM public.flyway_schema_history WHERE success"));
        try(Connection c=runtime();Statement s=c.createStatement()){assertEquals("42501",assertThrows(SQLException.class,()->s.execute("INSERT INTO ledger.adjustments(id,payment_id,actor_id,kind,amount_minor,journal_id,reason) VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'REFUND',1,gen_random_uuid(),'forged')")).getSQLState());assertEquals("42501",assertThrows(SQLException.class,()->s.execute("SELECT ledger._post(gen_random_uuid(),'REFUND',gen_random_uuid(),gen_random_uuid(),1,'CAD')")).getSQLState());}
    }
}
