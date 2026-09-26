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
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/** Real P04 HTTP through two JVMs and PostgreSQL. No mocked security, H2, or rollback fixture. */
@Testcontainers
class TransferReliabilityIT {
    @Container static final PostgreSQLContainer<?> PG=new PostgreSQLContainer<>("postgres:17.11-bookworm")
        .withDatabaseName("ledgertransfer").withUsername("postgres").withPassword(UUID.randomUUID().toString());
    static final ObjectMapper JSON=new ObjectMapper();
    static final String OWNER=UUID.randomUUID().toString(),RUNTIME=UUID.randomUUID().toString();
    static final byte[] KEY=new byte[64];
    static final Path EVIDENCE=Path.of("target/transfer-http-evidence");
    static App first,second;
    record App(Process process,int port,Path log) { }
    record User(UUID id,String email,String password,Browser browser) { }

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
        Browser copy(int port){Browser b=new Browser(port);b.cookies.putAll(cookies);b.csrf=csrf;return b;}
        String cookieHeader(){return cookies.entrySet().stream().map(e->e.getKey()+"="+e.getValue()).collect(java.util.stream.Collectors.joining("; "));}
    }

    /** Test-only proxy: consumes complete post-commit upstream response, then resets the client connection. */
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
            s.execute("GRANT CREATE ON DATABASE ledgertransfer TO ledger_owner");s.execute("GRANT USAGE,CREATE ON SCHEMA public TO ledger_owner");
        }
        Flyway.configure().dataSource(PG.getJdbcUrl(),"ledger_owner",OWNER).defaultSchema("public").locations("classpath:db/migration").load().migrate();
        first=launch("transfer-one");second=launch("transfer-two");
    }
    static App launch(String name) throws Exception {
        int port;try(ServerSocket socket=new ServerSocket(0)){port=socket.getLocalPort();}Path log=EVIDENCE.resolve(name+"-"+port+".log");
        ProcessBuilder builder=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","java").toString(),"-Xmx256m","-jar","target/ledgerguard.jar",
            "--server.port="+port,"--spring.profiles.active=sandbox","--ledgerguard.auth.bcrypt-strength=10","--ledgerguard.auth.ip-limit=1000","--ledgerguard.auth.identity-limit=1000",
            "--management.health.rabbit.enabled=false","--management.endpoint.health.group.readiness.include=readinessState,ledgerDatabase","--spring.datasource.hikari.maximum-pool-size=12");
        var env=builder.environment();env.put("LEDGER_DATABASE_URL",PG.getJdbcUrl());env.put("LEDGER_MIGRATION_URL",PG.getJdbcUrl());env.put("LEDGER_OWNER_PASSWORD",OWNER);env.put("LEDGER_RUNTIME_PASSWORD",RUNTIME);env.put("LEDGER_AUTH_KEY",Base64.getEncoder().encodeToString(KEY));env.put("LEDGER_SANDBOX_HTTP","true");env.put("LEDGER_RABBIT_PASSWORD",UUID.randomUUID().toString());
        builder.redirectErrorStream(true).redirectOutput(log.toFile());App app=new App(builder.start(),port,log);
        try{HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build();long deadline=System.nanoTime()+Duration.ofSeconds(70).toNanos();while(System.nanoTime()<deadline&&app.process.isAlive()){try{var response=client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/system")).timeout(Duration.ofSeconds(2)).build(),HttpResponse.BodyHandlers.ofString());if(response.statusCode()==200&&JSON.readTree(response.body()).path("databaseRole").asText().equals("ledger_runtime"))return app;}catch(IOException ignored){}Thread.sleep(100);}throw new AssertionError("API failed readiness: "+Files.readString(log));}catch(Throwable failure){stop(app);throw failure;}
    }
    static void stop(App app) throws InterruptedException {if(app==null)return;app.process.destroy();if(!app.process.waitFor(10,TimeUnit.SECONDS)){app.process.destroyForcibly();assertTrue(app.process.waitFor(10,TimeUnit.SECONDS));}}
    @AfterAll static void cleanup() throws Exception {try{stop(first);}finally{stop(second);}}

    static Connection owner() throws SQLException{return DriverManager.getConnection(PG.getJdbcUrl(),"ledger_owner",OWNER);} static Connection runtime() throws SQLException{return DriverManager.getConnection(PG.getJdbcUrl(),"ledger_runtime",RUNTIME);}
    static UUID uuid(Connection c,String sql,Object...args) throws SQLException{try(PreparedStatement p=c.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet r=p.executeQuery()){assertTrue(r.next());return r.getObject(1,UUID.class);}}}
    static long scalar(String sql,Object...args) throws SQLException{try(Connection c=owner();PreparedStatement p=c.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet r=p.executeQuery()){r.next();return r.getLong(1);}}}
    static String text(String sql,Object...args) throws SQLException{try(Connection c=owner();PreparedStatement p=c.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet r=p.executeQuery()){r.next();return r.getString(1);}}}
    static void status(int expected,Response response){assertEquals(expected,response.statusCode(),()->response.asString());}
    static User user(){String email=UUID.randomUUID()+"@example.test",password="P-"+UUID.randomUUID();Browser b=new Browser(first.port);b.csrf();Response register=b.call("POST","/auth/register",Map.of("email",email,"password",password,"displayName","Transfer customer"));status(201,register);UUID id=UUID.fromString(register.jsonPath().getString("id"));status(200,b.call("POST","/auth/login",Map.of("email",email,"password",password)));b.csrf=null;b.csrf();return new User(id,email,password,b);}
    static String account(User user,String name,String currency){Response r=user.browser.call("POST","/accounts",Map.of("name",name,"currency",currency));status(201,r);return r.jsonPath().getString("id");}
    static String ref(String account) throws SQLException{return text("SELECT public_ref FROM ledger.accounts WHERE id=?",UUID.fromString(account));}
    static void fund(String target,long amount,String currency) throws Exception{try(Connection c=owner()){c.setAutoCommit(false);UUID asset=uuid(c,"INSERT INTO ledger.accounts(label,currency,kind) VALUES(?,?,'SANDBOX_FUNDING_ASSET') RETURNING id","P04 asset "+UUID.randomUUID(),currency);try(PreparedStatement p=c.prepareStatement("INSERT INTO ledger.account_balances(account_id) VALUES(?)")){p.setObject(1,asset);p.executeUpdate();}uuid(c,"SELECT ledger._post(?,'FUNDING',?,?,?,?)",UUID.randomUUID(),asset,UUID.fromString(target),amount,currency);c.commit();}}
    static Map<String,String> intent(String source,String recipient,String amount,String currency){return new LinkedHashMap<>(Map.of("sourceId",source,"recipientRef",recipient,"amountMinor",amount,"currency",currency));}
    static Response transfer(Browser browser,String key,Object body){return browser.call("POST","/transfers",body,Map.of("Idempotency-Key",key));}
    static void reconciled(String account) throws SQLException{assertEquals(0,scalar("SELECT count(*) FROM ledger.account_balances b JOIN ledger.accounts a ON a.id=b.account_id WHERE a.id=? AND b.posted_minor<>(SELECT coalesce(sum(CASE WHEN side='CREDIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) FROM ledger.journal_entries e WHERE e.account_id=a.id)",UUID.fromString(account)));}

    @Test void P0401_createReplayReadAndPrivacy() throws Exception {
        User alice=user(),bob=user();String source=account(alice,"Source","CAD"),destination=account(bob,"Private destination","CAD");fund(source,10000,"CAD");String key="transfer-key-0401";Map<String,String> body=intent(source,ref(destination),"2500","CAD");
        Response created=transfer(alice.browser,key,body),replay=transfer(alice.browser,key,body);status(201,created);status(201,replay);assertEquals(created.asString(),replay.asString());assertEquals("false",created.header("Idempotency-Replayed"));assertEquals("true",replay.header("Idempotency-Replayed"));String id=created.jsonPath().getString("id");assertEquals("/api/v1/transfers/"+id,created.header("Location"));
        Response read=alice.browser.call("GET","/transfers/"+id,null);status(200,read);assertEquals(source,read.jsonPath().getString("sourceId"));assertEquals(ref(destination),read.jsonPath().getString("recipientRef"));assertFalse(read.asString().contains(destination));assertFalse(read.asString().contains(bob.email));status(404,bob.browser.call("GET","/transfers/"+id,null));
        UUID transfer=UUID.fromString(id);assertEquals(1,scalar("SELECT count(*) FROM ledger.transfers WHERE id=?",transfer));assertEquals(1,scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?",transfer));assertEquals(2,scalar("SELECT count(*) FROM ledger.journal_entries e JOIN ledger.journals j ON j.id=e.journal_id WHERE j.operation_id=?",transfer));assertEquals(1,scalar("SELECT count(*) FROM ledger.audit_records WHERE aggregate_id=?",transfer));assertEquals(1,scalar("SELECT count(*) FROM ledger.outbox_events WHERE aggregate_id=?",transfer));assertEquals(7500,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));reconciled(source);reconciled(destination);
    }

    @ParameterizedTest @ValueSource(strings={"amount","recipient","currency","source"})
    void P0402_changedIntentConflicts(String field) throws Exception {
        User alice=user(),bob=user(),other=user();String source=account(alice,"Source","CAD"),second=account(alice,"Second","CAD"),destination=account(bob,"Target","CAD"),otherTarget=account(other,"Other","CAD");fund(source,10000,"CAD");String key="conflict-key-"+field;Map<String,String> original=intent(source,ref(destination),"1000","CAD");status(201,transfer(alice.browser,key,original));Map<String,String> changed=new LinkedHashMap<>(original);switch(field){case "amount"->changed.put("amountMinor","1001");case "recipient"->changed.put("recipientRef",ref(otherTarget));case "currency"->changed.put("currency","USD");case "source"->changed.put("sourceId",second);default->throw new AssertionError();}Response conflict=transfer(alice.browser,key,changed);status(409,conflict);assertEquals("IDEMPOTENCY_CONFLICT",conflict.jsonPath().getString("code"));assertEquals(1,scalar("SELECT count(*) FROM ledger.transfers WHERE actor_id=?",alice.id));
    }

    @Test void P0403_concurrentSameKeyAcrossProcesses() throws Exception {
        User alice=user(),bob=user();String source=account(alice,"Source","CAD"),destination=account(bob,"Target","CAD");fund(source,10000,"CAD");String key="same-key-0403";Map<String,String> body=intent(source,ref(destination),"4000","CAD");CyclicBarrier barrier=new CyclicBarrier(2);
        try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> a=pool.submit(()->{barrier.await();return transfer(alice.browser.copy(first.port),key,body);});Future<Response> b=pool.submit(()->{barrier.await();return transfer(alice.browser.copy(second.port),key,body);});Response left=a.get(15,TimeUnit.SECONDS),right=b.get(15,TimeUnit.SECONDS);status(201,left);status(201,right);assertEquals(left.asString(),right.asString());assertEquals(Set.of("true","false"),Set.of(left.header("Idempotency-Replayed"),right.header("Idempotency-Replayed")));}
        assertEquals(1,scalar("SELECT count(*) FROM ledger.transfers WHERE source_id=?",UUID.fromString(source)));assertEquals(6000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));
    }

    @Test void P0404_twoProcessOverspendExactlyOneWins() throws Exception {
        User alice=user(),bob=user();String source=account(alice,"Source","CAD"),destination=account(bob,"Target","CAD");fund(source,10000,"CAD");Map<String,String> body=intent(source,ref(destination),"8000","CAD");CyclicBarrier barrier=new CyclicBarrier(2);List<Response> responses;
        try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> a=pool.submit(()->{barrier.await();return transfer(alice.browser.copy(first.port),"overspend-a",body);});Future<Response> b=pool.submit(()->{barrier.await();return transfer(alice.browser.copy(second.port),"overspend-b",body);});responses=List.of(a.get(15,TimeUnit.SECONDS),b.get(15,TimeUnit.SECONDS));}
        assertEquals(List.of(201,422),responses.stream().map(Response::statusCode).sorted().toList());assertEquals("INSUFFICIENT_FUNDS",responses.stream().filter(r->r.statusCode()==422).findFirst().orElseThrow().jsonPath().getString("code"));assertEquals(1,scalar("SELECT count(*) FROM ledger.transfers WHERE source_id=?",UUID.fromString(source)));assertEquals(2000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(0,scalar("SELECT reserved_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(0,scalar("SELECT count(*) FROM ledger.holds WHERE account_id=?",UUID.fromString(source)));reconciled(source);reconciled(destination);
    }

    @Test void P0405_lostResponseAfterCommitReplaysOriginal() throws Exception {
        User alice=user(),bob=user();String source=account(alice,"Source","CAD"),destination=account(bob,"Target","CAD");fund(source,10000,"CAD");String key="lost-response-0405",body=JSON.writeValueAsString(intent(source,ref(destination),"1750","CAD"));
        try(DropAfterCommitProxy proxy=new DropAfterCommitProxy(first.port)){HttpRequest request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+proxy.port()+"/api/v1/transfers")).timeout(Duration.ofSeconds(10)).header("Accept","application/json").header("Content-Type","application/json").header("Cookie",alice.browser.cookieHeader()).header("X-XSRF-TOKEN",alice.browser.csrf).header("Idempotency-Key",key).POST(HttpRequest.BodyPublishers.ofString(body)).build();HttpClient client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();assertThrows(IOException.class,()->client.send(request,HttpResponse.BodyHandlers.ofString()));assertEquals(201,proxy.status());}
        String committed=text("SELECT id::text FROM ledger.transfers WHERE actor_id=? AND source_id=?",alice.id,UUID.fromString(source));Response replay=transfer(alice.browser,key,body);status(201,replay);assertEquals("true",replay.header("Idempotency-Replayed"));assertEquals(committed,replay.jsonPath().getString("id"));assertEquals(1,scalar("SELECT count(*) FROM ledger.transfers WHERE id=?",UUID.fromString(committed)));
    }

    @ParameterizedTest @ValueSource(strings={"amount","currency","source","recipient"})
    void P0406_invalidIntentRejectedBeforeClaim(String field) throws Exception {
        User alice=user(),bob=user();String source=account(alice,"Source","CAD"),destination=account(bob,"Target","CAD"),key="invalid-"+field+"-0406";Map<String,String> body=intent(source,ref(destination),"10","CAD");switch(field){case "amount"->body.put("amountMinor","01");case "currency"->body.put("currency","EUR");case "source"->body.put("sourceId","bad");case "recipient"->body.put("recipientRef","bad");default->throw new AssertionError();}status(400,transfer(alice.browser,key,body));assertEquals(0,scalar("SELECT count(*) FROM ledger.idempotency_records WHERE actor_id=? AND key=?",alice.id,key));
    }

    @ParameterizedTest @ValueSource(strings={"funds","self","cross-currency","closed"})
    void P0407_businessRejectionAtomicAndReplayable(String scenario) throws Exception {
        User alice=user(),bob=user();String source=account(alice,"Source","CAD"),destination=scenario.equals("cross-currency")?account(bob,"USD","USD"):account(bob,"Target","CAD");if(!scenario.equals("funds"))fund(source,1000,"CAD");if(scenario.equals("self"))destination=source;if(scenario.equals("closed"))try(Connection c=owner();PreparedStatement p=c.prepareStatement("UPDATE ledger.accounts SET status='CLOSED' WHERE id=?")){p.setObject(1,UUID.fromString(destination));p.executeUpdate();}String key="business-"+scenario+"-0407";Map<String,String> body=intent(source,ref(destination),"100","CAD");Response firstTry=transfer(alice.browser,key,body),again=transfer(alice.browser,key,body);status(422,firstTry);status(422,again);assertEquals(firstTry.asString(),again.asString());assertEquals("true",again.header("Idempotency-Replayed"));assertEquals(0,scalar("SELECT count(*) FROM ledger.transfers WHERE actor_id=?",alice.id));reconciled(source);
    }

    @Test void P0408_scopeOrderingAndOwnerBoundaries() throws Exception {
        User alice=user(),carol=user(),recipient=user();String a=account(alice,"A","CAD"),c=account(carol,"C","CAD"),target=account(recipient,"Target","CAD");fund(a,1000,"CAD");fund(c,1000,"CAD");String key="shared-actor-key-0408";Response one=transfer(alice.browser,key,intent(a,ref(target),"100","CAD")),two=transfer(carol.browser,key,intent(c,ref(target),"100","CAD"));status(201,one);status(201,two);assertNotEquals(one.jsonPath().getString("id"),two.jsonPath().getString("id"));String reordered="{\"currency\":\"CAD\",\"amountMinor\":\"100\",\"recipientRef\":\""+ref(target)+"\",\"sourceId\":\""+a+"\"}";Response replay=transfer(alice.browser,key,reordered);status(201,replay);assertEquals(one.asString(),replay.asString());Response foreign=transfer(alice.browser,"foreign-source-0408",intent(c,ref(target),"100","CAD"));status(404,foreign);assertEquals(0,scalar("SELECT count(*) FROM ledger.idempotency_records WHERE actor_id=? AND key='foreign-source-0408'",alice.id));
    }

    @Test void P0409_lockOrderAndManyClientPressure() throws Exception {
        User alice=user(),bob=user();String a=account(alice,"A","CAD"),b=account(bob,"B","CAD");fund(a,10000,"CAD");fund(b,10000,"CAD");CyclicBarrier opposite=new CyclicBarrier(2);
        try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> x=pool.submit(()->{opposite.await();return transfer(alice.browser.copy(first.port),"opposite-a",intent(a,ref(b),"1000","CAD"));});Future<Response> y=pool.submit(()->{opposite.await();return transfer(bob.browser.copy(second.port),"opposite-b",intent(b,ref(a),"1000","CAD"));});status(201,x.get(15,TimeUnit.SECONDS));status(201,y.get(15,TimeUnit.SECONDS));}
        assertEquals(10000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(a)));assertEquals(10000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(b)));
        String source=account(alice,"Pressure","CAD"),target=account(bob,"Pressure target","CAD");fund(source,10000,"CAD");String recipient=ref(target);int clients=8;CyclicBarrier barrier=new CyclicBarrier(clients);List<Future<Response>> futures=new ArrayList<>();try(ExecutorService pool=Executors.newFixedThreadPool(clients)){for(int i=0;i<clients;i++){int n=i;Browser browser=alice.browser.copy(i%2==0?first.port:second.port);futures.add(pool.submit(()->{barrier.await();return transfer(browser,"pressure-"+n,intent(source,recipient,"1800","CAD"));}));}List<Response> results=new ArrayList<>();for(Future<Response> f:futures)results.add(f.get(20,TimeUnit.SECONDS));assertEquals(5,results.stream().filter(r->r.statusCode()==201).count());assertEquals(3,results.stream().filter(r->r.statusCode()==422).count());}assertEquals(1000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));reconciled(source);reconciled(target);
    }

    @Test void P0410_independentAccountsProceedConcurrently() throws Exception {
        User alice=user(),recipient=user();String left=account(alice,"Left","CAD"),right=account(alice,"Right","CAD"),targetA=account(recipient,"TA","CAD"),targetB=account(recipient,"TB","CAD");fund(left,5000,"CAD");fund(right,5000,"CAD");CyclicBarrier barrier=new CyclicBarrier(2);try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> a=pool.submit(()->{barrier.await();return transfer(alice.browser.copy(first.port),"distinct-a",intent(left,ref(targetA),"2000","CAD"));});Future<Response> b=pool.submit(()->{barrier.await();return transfer(alice.browser.copy(second.port),"distinct-b",intent(right,ref(targetB),"2000","CAD"));});status(201,a.get(15,TimeUnit.SECONDS));status(201,b.get(15,TimeUnit.SECONDS));}assertEquals(3000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(left)));assertEquals(3000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(right)));
    }

    @Test void P0411_httpContractPermissionsAndPagination() throws Exception {
        Browser anonymous=new Browser(first.port);status(401,anonymous.call("GET","/transfers",null));User alice=user(),bob=user();String source=account(alice,"Source","CAD"),target=account(bob,"Private target","CAD");fund(source,1000,"CAD");Map<String,String> body=intent(source,ref(target),"100","CAD");status(400,alice.browser.call("POST","/transfers",body));status(400,transfer(alice.browser,"bad",body));Map<String,Object> injected=new HashMap<>(body);injected.put("ownerId",alice.id.toString());status(400,transfer(alice.browser,"unknown-field-0411",injected));alice.browser.csrf=null;status(403,transfer(alice.browser,"missing-csrf-0411",body));alice.browser.csrf();for(int i=0;i<3;i++)status(201,transfer(alice.browser,"list-key-"+i,body));Response page=alice.browser.call("GET","/transfers?limit=2&offset=0",null),last=alice.browser.call("GET","/transfers?limit=2&offset=2",null);status(200,page);status(200,last);assertTrue(page.jsonPath().getBoolean("hasMore"));assertFalse(last.jsonPath().getBoolean("hasMore"));assertFalse(page.asString().contains(target));
        Response specResponse=anonymous.call("GET","/openapi/p04.json",null);status(200,specResponse);var spec=JSON.readTree(specResponse.asString());assertTrue(spec.path("paths").has("/api/v1/transfers"));assertTrue(spec.path("paths").has("/api/v1/transfers/{id}"));assertFalse(spec.path("paths").has("/api/v1/payments"));try(Connection c=runtime();Statement s=c.createStatement()){assertEquals("42501",assertThrows(SQLException.class,()->s.execute("INSERT INTO ledger.transfers(id,actor_id,source_id,destination_id,amount_minor,currency,journal_id) VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,'CAD',gen_random_uuid())")).getSQLState());}
        try(Connection c=owner();PreparedStatement p=c.prepareStatement("UPDATE ledger.app_users SET role='ADMIN' WHERE id=?")){p.setObject(1,alice.id);p.executeUpdate();}status(403,transfer(alice.browser,"admin-spend-0411",body));
    }
}
