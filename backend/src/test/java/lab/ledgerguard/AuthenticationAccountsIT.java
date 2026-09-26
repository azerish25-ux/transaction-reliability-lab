package lab.ledgerguard;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.*;
import io.restassured.response.Response;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.Date;
import java.util.concurrent.*;
import lab.ledgerguard.db.FinancialCommands;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/** P03: real HTTP, two independently restartable JVMs, actual PostgreSQL commits, no mock security. */
@Testcontainers
class AuthenticationAccountsIT {
    @Container static final PostgreSQLContainer<?> PG=new PostgreSQLContainer<>("postgres:17.11-bookworm")
        .withDatabaseName("ledgerauth").withUsername("postgres").withPassword(UUID.randomUUID().toString());
    static final ObjectMapper JSON=new ObjectMapper();
    static final String OWNER=UUID.randomUUID().toString(),RUNTIME=UUID.randomUUID().toString();
    static final byte[] KEY=new byte[64];
    static final Path EVIDENCE=Path.of("target/auth-http-evidence");
    static App first,second;
    static UUID historicalUser,historicalAccount;
    record App(Process process,int port,Path log) { }
    static class Browser {
        final int port;
        final Map<String,String> cookies=new HashMap<>();
        String csrf;
        Browser(int port) { this.port=port; }
        Response call(String method,String path,Object body) { return call(method,path,body,Map.of()); }
        Response call(String method,String path,Object body,Map<String,String> headers) {
            var request=given().baseUri("http://127.0.0.1").port(port).redirects().follow(false)
                .cookies(cookies).headers(headers).accept("application/json");
            if(csrf!=null) request.header("X-XSRF-TOKEN",csrf);
            if(body!=null) request.contentType("application/json").body(body);
            Response response=request.request(method,"/api/v1"+path);
            response.detailedCookies().forEach(cookie->{
                if(cookie.getMaxAge()==0) cookies.remove(cookie.getName());
                else cookies.put(cookie.getName(),cookie.getValue());
            });
            return response;
        }
        void csrf() {
            Response r=call("GET","/auth/csrf",null); status(200,r);
            assertEquals("X-XSRF-TOKEN",r.jsonPath().getString("headerName"));
            csrf=r.jsonPath().getString("token"); assertNotNull(csrf);
        }
        String token() { return cookies.get("LG-SESSION"); }
        Browser copy(int newPort) { Browser b=new Browser(newPort); b.cookies.putAll(cookies); b.csrf=csrf; return b; }
    }
    record User(UUID id,String email,String password,Browser browser) { }
    static void status(int expected,Response response) {
        assertEquals(expected,response.statusCode(),()->"HTTP response: "+response.asString());
    }
    static Connection owner() throws SQLException { return DriverManager.getConnection(PG.getJdbcUrl(),"ledger_owner",OWNER); }
    static Connection runtime() throws SQLException { return DriverManager.getConnection(PG.getJdbcUrl(),"ledger_runtime",RUNTIME); }
    static UUID uuid(Connection c,String sql,Object... args) throws SQLException {
        try(PreparedStatement p=c.prepareStatement(sql)) { for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);
            try(ResultSet rs=p.executeQuery()){assertTrue(rs.next());return rs.getObject(1,UUID.class);} }
    }
    static long count(String sql,Object...args) throws SQLException {
        try(Connection c=owner();PreparedStatement p=c.prepareStatement(sql)) {
            for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet rs=p.executeQuery()){rs.next();return rs.getLong(1);}
        }
    }
    @BeforeAll static void start() throws Exception {
        new SecureRandom().nextBytes(KEY);Files.createDirectories(EVIDENCE);
        try(Connection c=DriverManager.getConnection(PG.getJdbcUrl(),PG.getUsername(),PG.getPassword());Statement s=c.createStatement()) {
            s.execute("CREATE ROLE ledger_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+OWNER+"'");
            s.execute("CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+RUNTIME+"'");
            s.execute("GRANT CREATE ON DATABASE ledgerauth TO ledger_owner");s.execute("GRANT USAGE,CREATE ON SCHEMA public TO ledger_owner");
        }
        // Exercise a real V5->V6 upgrade rather than only a fresh install.
        Flyway.configure().dataSource(PG.getJdbcUrl(),"ledger_owner",OWNER).target("5").locations("classpath:db/migration").load().migrate();
        try(Connection c=owner()) {
            historicalUser=uuid(c,"SELECT ledger.register_customer(?,'historical-disabled-password-hash-0000000000000','History')",UUID.randomUUID()+"@example.test");
            historicalAccount=uuid(c,"SELECT ledger.create_account(?,'Historical CAD','CAD')",historicalUser);
        }
        first=launch("api-one",true);second=launch("api-two",true);
    }
    static App launch(String name,boolean sandbox) throws Exception {
        int port;try(ServerSocket socket=new ServerSocket(0)){port=socket.getLocalPort();}
        Path log=EVIDENCE.resolve(name+"-"+port+".log");
        ProcessBuilder builder=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","java").toString(),"-Xmx256m","-jar","target/ledgerguard.jar",
            "--server.port="+port,"--spring.profiles.active="+(sandbox?"sandbox":"production"),
            "--ledgerguard.auth.bcrypt-strength=10","--ledgerguard.auth.ip-limit=1000",
            "--management.health.rabbit.enabled=false","--management.endpoint.health.group.readiness.include=readinessState,ledgerDatabase",
            "--spring.datasource.hikari.maximum-pool-size=4");
        var env=builder.environment();
        env.put("LEDGER_DATABASE_URL",PG.getJdbcUrl());env.put("LEDGER_MIGRATION_URL",PG.getJdbcUrl());
        env.put("LEDGER_OWNER_PASSWORD",OWNER);env.put("LEDGER_RUNTIME_PASSWORD",RUNTIME);
        env.put("LEDGER_AUTH_KEY",Base64.getEncoder().encodeToString(KEY));env.put("LEDGER_SANDBOX_HTTP",Boolean.toString(sandbox));
        env.put("LEDGER_RABBIT_PASSWORD",UUID.randomUUID().toString());
        builder.redirectErrorStream(true).redirectOutput(log.toFile());
        App app=new App(builder.start(),port,log);
        try {
            HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build();
            long deadline=System.nanoTime()+Duration.ofSeconds(70).toNanos();
            while(System.nanoTime()<deadline && app.process.isAlive()) {
                try {
                    var r=client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/system")).timeout(Duration.ofSeconds(2)).build(),HttpResponse.BodyHandlers.ofString());
                    if(r.statusCode()==200 && JSON.readTree(r.body()).path("databaseRole").asText().equals("ledger_runtime")) return app;
                } catch(IOException unavailable) { /* bounded readiness polling, not a business-time sleep */ }
                Thread.sleep(100);
            }
            throw new AssertionError("API failed readiness: "+Files.readString(log));
        } catch(Throwable failure) { stop(app);throw failure; }
    }
    static void stop(App app) throws InterruptedException {
        if(app==null)return;app.process.destroy();if(!app.process.waitFor(10,TimeUnit.SECONDS)){app.process.destroyForcibly();assertTrue(app.process.waitFor(10,TimeUnit.SECONDS));}
    }
    @AfterAll static void cleanup() throws Exception { try{stop(first);}finally{stop(second);} }
    static User registered() {
        String email=UUID.randomUUID()+"@example.test",password="P-"+UUID.randomUUID();
        Browser b=new Browser(first.port);b.csrf();
        Response r=b.call("POST","/auth/register",Map.of("email",email,"password",password,"displayName","Test customer"));status(201,r);
        return new User(UUID.fromString(r.jsonPath().getString("id")),email,password,b);
    }
    static User user() {
        User u=registered();status(200,u.browser.call("POST","/auth/login",Map.of("email",u.email,"password",u.password)));
        u.browser.csrf=null;u.browser.csrf();return u;
    }
    static String account(User u,String name,String currency) {
        Response r=u.browser.call("POST","/accounts",Map.of("name",name,"currency",currency));status(201,r);
        String id=r.jsonPath().getString("id");assertEquals("/api/v1/accounts/"+id,r.header("Location"));return id;
    }
    static void fund(String target,long amount) throws Exception {
        try(Connection c=owner()) { c.setAutoCommit(false);
            UUID asset=uuid(c,"INSERT INTO ledger.accounts(label,currency,kind) VALUES('Isolated synthetic asset','CAD','SANDBOX_FUNDING_ASSET') RETURNING id");
            try(PreparedStatement p=c.prepareStatement("INSERT INTO ledger.account_balances(account_id) VALUES(?)")){p.setObject(1,asset);p.executeUpdate();}
            uuid(c,"SELECT ledger._post(?,'FUNDING',?,?,?,'CAD')",UUID.randomUUID(),asset,UUID.fromString(target),amount);c.commit();
        }
    }
    @Test void P0301_normalizationPasswordHashAndZeroNewUser() throws Exception {
        Browser b=new Browser(first.port);b.csrf();String email=UUID.randomUUID()+"@example.test",pass="P-"+UUID.randomUUID();
        Response r=b.call("POST","/auth/register",Map.of("email","  "+email.toUpperCase(Locale.ROOT)+"  ","password",pass,"displayName"," Alice "));
        status(201,r);assertEquals(email,r.jsonPath().getString("email"));assertEquals("Alice",r.jsonPath().getString("displayName"));assertEquals("CUSTOMER",r.jsonPath().getString("role"));
        assertNull(b.token());assertFalse(r.asString().contains(pass));
        UUID id=UUID.fromString(r.jsonPath().getString("id"));
        assertEquals(0,count("SELECT count(*) FROM ledger.accounts WHERE owner_id=?",id));
        try(Connection c=owner();PreparedStatement p=c.prepareStatement("SELECT password_hash FROM ledger.app_users WHERE id=?")){
            p.setObject(1,id);try(ResultSet rs=p.executeQuery()){rs.next();assertTrue(rs.getString(1).startsWith("$2"));assertFalse(pass.equals(rs.getString(1)));}
        }
    }
    @Test void P0302_concurrentNormalizedDuplicateRegistration() throws Exception {
        String email=UUID.randomUUID()+"@example.test",pass="P-"+UUID.randomUUID();
        Browser a=new Browser(first.port),b=new Browser(second.port);a.csrf();b.csrf();CyclicBarrier barrier=new CyclicBarrier(2);
        try(ExecutorService pool=Executors.newFixedThreadPool(2)) {
            Future<Integer> one=pool.submit(()->{barrier.await(5,TimeUnit.SECONDS);return a.call("POST","/auth/register",Map.of("email",email,"password",pass,"displayName","One")).statusCode();});
            Future<Integer> two=pool.submit(()->{barrier.await(5,TimeUnit.SECONDS);return b.call("POST","/auth/register",Map.of("email",email.toUpperCase(Locale.ROOT),"password",pass,"displayName","Two")).statusCode();});
            assertEquals(Set.of(201,409),Set.of(one.get(15,TimeUnit.SECONDS),two.get(15,TimeUnit.SECONDS)));
        }
        assertEquals(1,count("SELECT count(*) FROM ledger.app_users WHERE email=?",email));
    }
    @ParameterizedTest @ValueSource(strings={"role","ownerId","enabled","id","passwordHash"})
    void P0303_registrationMassAssignmentRejected(String field) {
        Browser b=new Browser(first.port);b.csrf();Map<String,Object> body=new HashMap<>(Map.of("email",UUID.randomUUID()+"@example.test","password","P-"+UUID.randomUUID(),"displayName","Injection"));
        body.put(field,"ADMIN");status(400,b.call("POST","/auth/register",body));
    }
    @Test void P0304_wrongAndUnknownCredentialsHaveSamePublicFailure() {
        User u=registered();Response known=u.browser.call("POST","/auth/login",Map.of("email",u.email,"password","incorrect-password-value"));
        Response unknown=u.browser.call("POST","/auth/login",Map.of("email",UUID.randomUUID()+"@example.test","password","incorrect-password-value"));
        status(401,known);status(401,unknown);assertEquals(known.jsonPath().getString("code"),unknown.jsonPath().getString("code"));
    }
    @Test void P0305_cookieAndSessionLifetime() throws Exception {
        User u=registered();Response r=u.browser.call("POST","/auth/login",Map.of("email",u.email,"password",u.password));status(200,r);
        String header=r.headers().getValues("Set-Cookie").stream().filter(v->v.startsWith("LG-SESSION=")).findFirst().orElseThrow();
        assertTrue(header.contains("HttpOnly"));assertTrue(header.contains("SameSite=Strict"));assertTrue(header.contains("Path=/"));assertFalse(header.contains("Secure"));
        assertFalse(r.asString().contains(u.browser.token()));assertFalse(u.browser.cookies.containsKey("JSESSIONID"));
        JWTClaimsSet claims=SignedJWT.parse(u.browser.token()).getJWTClaimsSet();
        assertEquals(900,Duration.between(claims.getIssueTime().toInstant(),claims.getExpirationTime().toInstant()).getSeconds());
        assertEquals(1,count("SELECT count(*) FROM ledger.auth_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL",UUID.fromString(claims.getJWTID()),u.id));
        status(200,u.browser.call("GET","/auth/me",null));
    }
    @ParameterizedTest @ValueSource(strings={"expired","issuer","audience","noexp","nosub","nojti","future","algorithm","signature","wrongsubject"})
    void P0306_invalidSignedClaimsRejectedThroughHttp(String variant) throws Exception {
        User u=user();JWTClaimsSet original=SignedJWT.parse(u.browser.token()).getJWTClaimsSet();JWTClaimsSet.Builder claims=new JWTClaimsSet.Builder(original);
        switch(variant) {
            case "expired"->claims.issueTime(Date.from(Instant.now().minusSeconds(1000))).expirationTime(Date.from(Instant.now().minusSeconds(10)));
            case "issuer"->claims.issuer("other-issuer");case "audience"->claims.audience("other-audience");case "noexp"->claims.expirationTime(null);
            case "nosub"->claims.subject(null);case "nojti"->claims.jwtID(null);case "future"->claims.notBeforeTime(Date.from(Instant.now().plusSeconds(60)));
            case "wrongsubject"->claims.subject(UUID.randomUUID().toString());default->{ }
        }
        SignedJWT token=new SignedJWT(new JWSHeader(variant.equals("algorithm")?JWSAlgorithm.HS384:JWSAlgorithm.HS256),claims.build());
        byte[] key=KEY.clone();if(variant.equals("signature"))key[0]^=1;token.sign(new MACSigner(key));
        u.browser.cookies.put("LG-SESSION",token.serialize());status(401,u.browser.call("GET","/auth/me",null));
    }
    @Test void P0307_alteredRoleAndUnsignedTokensRejected() throws Exception {
        User u=user();String[] parts=u.browser.token().split("\\.");
        var payload=JSON.readTree(Base64.getUrlDecoder().decode(parts[1]));((com.fasterxml.jackson.databind.node.ObjectNode)payload).put("role","ADMIN");
        String changed=Base64.getUrlEncoder().withoutPadding().encodeToString(JSON.writeValueAsBytes(payload));
        u.browser.cookies.put("LG-SESSION",parts[0]+"."+changed+"."+parts[2]);status(401,u.browser.call("GET","/admin/security-events",null));
        String none=Base64.getUrlEncoder().withoutPadding().encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8));
        u.browser.cookies.put("LG-SESSION",none+"."+changed+".");status(401,u.browser.call("GET","/auth/me",null));
    }
    @Test void P0308_persistedExpiryIsCheckedIndependentlyOfJwt() throws Exception {
        User u=user();UUID expired=UUID.randomUUID();
        try(Connection c=owner();PreparedStatement p=c.prepareStatement("INSERT INTO ledger.auth_sessions(id,user_id,created_at,expires_at) VALUES(?,?,clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '1 minute')")){
            p.setObject(1,expired);p.setObject(2,u.id);p.executeUpdate();
        }
        JWTClaimsSet claims=new JWTClaimsSet.Builder(SignedJWT.parse(u.browser.token()).getJWTClaimsSet()).jwtID(expired.toString()).build();
        SignedJWT token=new SignedJWT(new JWSHeader(JWSAlgorithm.HS256),claims);token.sign(new MACSigner(KEY));u.browser.cookies.put("LG-SESSION",token.serialize());
        status(401,u.browser.call("GET","/auth/me",null));
    }
    @Test void P0309_logoutRevokesCopiedCookieAcrossProcessesAndRestart() throws Exception {
        User u=user();Browser saved=u.browser.copy(second.port);status(200,saved.call("GET","/auth/me",null));
        status(204,u.browser.call("POST","/auth/logout",null));assertNull(u.browser.token());status(401,saved.call("GET","/auth/me",null));
        stop(second);second=launch("api-two-restarted",true);Browser after=saved.copy(second.port);status(401,after.call("GET","/auth/me",null));
        u.browser.csrf=null;u.browser.csrf();status(200,u.browser.call("POST","/auth/login",Map.of("email",u.email,"password",u.password)));
        status(200,u.browser.copy(second.port).call("GET","/auth/me",null));
    }
    @Test void P0310_disabledUserLosesExistingSession() throws Exception {
        User u=user();try(Connection c=owner();PreparedStatement p=c.prepareStatement("UPDATE ledger.app_users SET enabled=false WHERE id=?")){p.setObject(1,u.id);p.executeUpdate();}
        status(401,u.browser.call("GET","/accounts",null));
        u.browser.csrf();status(401,u.browser.call("POST","/auth/login",Map.of("email",u.email,"password",u.password)));
    }
    @Test void P0311_csrfRequiredOnAuthenticationAndLogout() {
        Browser b=new Browser(first.port);status(403,b.call("POST","/auth/register",Map.of("email","nobody@example.test")));
        status(403,b.call("POST","/auth/login",Map.of("email","nobody@example.test")));
        User u=user();u.browser.csrf=null;status(403,u.browser.call("POST","/auth/logout",null));
        u.browser.csrf="incorrect";status(403,u.browser.call("POST","/accounts",Map.of("name","Denied","currency","CAD")));
        status(200,u.browser.call("GET","/auth/me",null));
    }
    @Test void P0312_csrfRotatesAfterLoginAndLogout() {
        User u=registered();String old=u.browser.csrf;
        status(200,u.browser.call("POST","/auth/login",Map.of("email",u.email,"password",u.password)));u.browser.csrf=null;u.browser.csrf();String current=u.browser.csrf;
        u.browser.csrf=old;status(403,u.browser.call("POST","/accounts",Map.of("name","Old token","currency","CAD")));
        u.browser.csrf=current;status(204,u.browser.call("POST","/auth/logout",null));u.browser.csrf=null;u.browser.csrf();
        u.browser.csrf=current;status(403,u.browser.call("POST","/auth/login",Map.of("email",u.email,"password",u.password)));
        u.browser.csrf=null;u.browser.csrf();status(200,u.browser.call("POST","/auth/login",Map.of("email",u.email,"password",u.password)));
    }
    @Test void P0313_foreignOriginAndCrossSiteRejected() {
        User u=user();Map<String,String> body=Map.of("name","Forbidden","currency","CAD");
        status(403,u.browser.call("POST","/accounts",body,Map.of("Origin","https://outside.invalid")));
        status(403,u.browser.call("POST","/accounts",body,Map.of("Sec-Fetch-Site","cross-site")));
        status(201,u.browser.call("POST","/accounts",body,Map.of("Origin","http://127.0.0.1:"+first.port)));
    }
    @ParameterizedTest @ValueSource(strings={"CAD","USD","JPY","KWD"})
    void P0314_multipleCurrenciesStartAtZeroAndSerializeStrings(String currency) throws Exception {
        User u=user();String id=account(u,"Wallet",currency);Response r=u.browser.call("GET","/accounts/"+id,null);status(200,r);
        var body=JSON.readTree(r.asString());for(String key:List.of("postedMinor","reservedMinor","availableMinor","version")) assertTrue(body.get(key).isTextual());
        assertEquals("0",body.get("postedMinor").asText());assertEquals(currency,body.get("currency").asText());
        assertEquals(0,count("SELECT count(*) FROM ledger.journal_entries WHERE account_id=?",UUID.fromString(id)));
        status(200,u.browser.call("GET","/accounts/"+id+"/entries",null));
    }
    @ParameterizedTest @ValueSource(strings={"","/entries","/transactions"})
    void P0315_crossCustomerResourceAndNestedHistoryReturn404(String suffix) {
        User alice=user(),bob=user();String id=account(bob,"Bob only","CAD");
        status(404,alice.browser.call("GET","/accounts/"+id+suffix,null));status(404,alice.browser.call("GET","/accounts/"+UUID.randomUUID()+suffix,null));
    }
    @Test void P0316_recipientLookupDoesNotGrantReadAccess() throws Exception {
        User alice=user(),bob=user();String id=account(bob,"Private name","CAD");String ref=bob.browser.call("GET","/accounts/"+id,null).jsonPath().getString("publicRef");
        Response r=alice.browser.call("GET","/recipients/"+ref,null);status(200,r);
        assertEquals(Set.of("publicRef","currency"),r.jsonPath().getMap("").keySet());status(404,alice.browser.call("GET","/accounts/"+id,null));
        try(Connection c=owner();PreparedStatement p=c.prepareStatement("UPDATE ledger.accounts SET status='CLOSED' WHERE id=?")){p.setObject(1,UUID.fromString(id));p.executeUpdate();}
        status(404,alice.browser.call("GET","/recipients/"+ref,null));
    }
    @Test void P0317_historiesContainOnlyOwnersEconomicEffect() throws Exception {
        User alice=user(),bob=user();String a=account(alice,"Alice","CAD"),b=account(bob,"Bob","CAD");fund(a,10000);
        String ref=bob.browser.call("GET","/accounts/"+b,null).jsonPath().getString("publicRef");
        var commands=new FinancialCommands(new DriverManagerDataSource(PG.getJdbcUrl(),"ledger_runtime",RUNTIME));
        var result=commands.execute(alice.id,"TRANSFER",null,UUID.randomUUID().toString(),JSON.writeValueAsString(Map.of("sourceId",a,"recipientRef",ref,"amountMinor","1234","currency","CAD")),UUID.randomUUID());assertEquals(201,result.status());
        Response entries=alice.browser.call("GET","/accounts/"+a+"/entries",null),transactions=alice.browser.call("GET","/accounts/"+a+"/transactions",null);
        status(200,entries);status(200,transactions);assertEquals(2,entries.jsonPath().getList("items").size());
        assertTrue(transactions.jsonPath().getList("items.effectMinor").contains("-1234"));assertFalse(entries.asString().contains(b));assertFalse(transactions.asString().contains(bob.email));
        assertEquals("8766",alice.browser.call("GET","/accounts/"+a,null).jsonPath().getString("availableMinor"));
        assertEquals(0,count("SELECT count(*) FROM ledger.account_balances b JOIN ledger.accounts a ON a.id=b.account_id WHERE a.kind='WALLET_LIABILITY' AND b.posted_minor<>(SELECT coalesce(sum(CASE WHEN side='CREDIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) FROM ledger.journal_entries e WHERE e.account_id=a.id)"));
    }
    @ParameterizedTest @ValueSource(strings={"ownerId","postedMinor","reservedMinor","kind","publicRef","id","status"})
    void P0318_accountMassAssignmentRejected(String field) throws Exception {
        User u=user();Map<String,Object> body=new HashMap<>(Map.of("name","Injection","currency","CAD"));body.put(field,"forged");
        status(400,u.browser.call("POST","/accounts",body));assertEquals(0,count("SELECT count(*) FROM ledger.accounts WHERE owner_id=?",u.id));
    }
    @ParameterizedTest @ValueSource(strings={"limit=0","limit=101","offset=-1","offset=10001","limit=oops","offset=99999999999999"})
    void P0319_paginationBounds(String query) { User u=user();status(400,u.browser.call("GET","/accounts?"+query,null)); }
    @Test void P0320_paginationIsStableAndOwnerScoped() {
        User u=user();for(int i=0;i<3;i++)account(u,"Wallet "+i,"CAD");
        Response a=u.browser.call("GET","/accounts?limit=2",null),again=u.browser.call("GET","/accounts?limit=2",null),b=u.browser.call("GET","/accounts?limit=2&offset=2",null);
        assertEquals(a.jsonPath().getList("items.id"),again.jsonPath().getList("items.id"));assertTrue(a.jsonPath().getBoolean("hasMore"));assertFalse(b.jsonPath().getBoolean("hasMore"));
        Set<String> ids=new HashSet<>(a.jsonPath().getList("items.id"));ids.addAll(b.jsonPath().getList("items.id"));assertEquals(3,ids.size());
    }
    @Test void P0321_adminAuthorityIsCurrentAndDoesNotGrantSpending() throws Exception {
        User u=user();status(403,u.browser.call("GET","/admin/security-events",null));
        try(Connection c=owner();PreparedStatement p=c.prepareStatement("UPDATE ledger.app_users SET role='ADMIN' WHERE id=?")){p.setObject(1,u.id);p.executeUpdate();}
        Response events=u.browser.call("GET","/admin/security-events?limit=2",null);status(200,events);assertFalse(events.asString().contains("password"));assertFalse(events.asString().contains("LG-SESSION"));
        status(403,u.browser.call("POST","/accounts",Map.of("name","Admin spend","currency","CAD")));
        assertEquals("ADMIN",u.browser.call("GET","/auth/me",null).jsonPath().getString("role"));
    }
    @Test void P0322_authenticationRequiredAndNoBearerFallback() {
        Browser b=new Browser(first.port);status(401,b.call("GET","/accounts",null));status(401,b.call("GET","/auth/me",null,Map.of("Authorization","Bearer ignored")));
    }
    @Test void P0323_throttlingPersistsAcrossInstances() {
        User u=registered();for(int i=0;i<10;i++)status(401,u.browser.call("POST","/auth/login",Map.of("email",u.email,"password","incorrect-password-value")));
        Browser other=u.browser.copy(second.port);Response denied=other.call("POST","/auth/login",Map.of("email",u.email,"password",u.password),Map.of("X-Forwarded-For","192.0.2.123"));
        status(429,denied);assertEquals("AUTH_THROTTLED",denied.jsonPath().getString("code"));assertEquals("300",denied.header("Retry-After"));
    }
    @Test void P0324_databasePermissionsAndIrreversibleRevocation() throws Exception {
        User u=user();UUID session=UUID.fromString(SignedJWT.parse(u.browser.token()).getJWTClaimsSet().getJWTID());status(204,u.browser.call("POST","/auth/logout",null));
        for(String sql:List.of("UPDATE ledger.app_users SET role='ADMIN'","UPDATE ledger.auth_sessions SET expires_at=clock_timestamp()+interval '1 day'","DELETE FROM ledger.security_events","UPDATE ledger.account_balances SET posted_minor=1")) {
            try(Connection c=runtime();Statement s=c.createStatement()){assertEquals("42501",assertThrows(SQLException.class,()->s.execute(sql)).getSQLState());}
        }
        try(Connection c=runtime();PreparedStatement p=c.prepareStatement("UPDATE ledger.auth_sessions SET revoked_at=NULL WHERE id=?")){
            p.setObject(1,session);assertEquals("23514",assertThrows(SQLException.class,p::executeUpdate).getSQLState());
        }
    }
    @Test void P0325_accountIdentityImmutableEvenToOwner() throws Exception {
        User u=user();String id=account(u,"Immutable","CAD");
        for(String update:List.of("currency='USD'","owner_id='"+historicalUser+"'","kind='SANDBOX_FUNDING_ASSET'","public_ref='changed'")){
            try(Connection c=owner();Statement s=c.createStatement()){assertEquals("23514",assertThrows(SQLException.class,()->s.execute("UPDATE ledger.accounts SET "+update+" WHERE id='"+id+"'")).getSQLState());}
        }
    }
    @Test void P0326_largeChunkedBodyAndMalformedJsonRejected() throws Exception {
        User u=user();status(400,u.browser.call("POST","/accounts","{invalid"));
        String cookie=u.browser.cookies.entrySet().stream().map(e->e.getKey()+"="+e.getValue()).collect(java.util.stream.Collectors.joining("; "));
        byte[] body=("{\"name\":\""+"x".repeat(17000)+"\",\"currency\":\"CAD\"}").getBytes(StandardCharsets.UTF_8);
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+first.port+"/api/v1/accounts")).timeout(Duration.ofSeconds(5))
            .header("Content-Type","application/json").header("Cookie",cookie).header("X-XSRF-TOKEN",u.browser.csrf)
            .POST(HttpRequest.BodyPublishers.ofInputStream(()->new ByteArrayInputStream(body))).build();
        assertEquals(413,HttpClient.newHttpClient().send(request,HttpResponse.BodyHandlers.ofString()).statusCode());
    }
    @Test void P0327_v5UpgradePreservesHistoricalAccounts() throws Exception {
        assertEquals(1,count("SELECT count(*) FROM ledger.accounts a JOIN ledger.account_balances b ON b.account_id=a.id WHERE a.id=? AND a.owner_id=? AND a.currency='CAD' AND b.posted_minor=0 AND b.reserved_minor=0",historicalAccount,historicalUser));
        assertEquals(6,count("SELECT count(*) FROM public.flyway_schema_history WHERE success AND version IS NOT NULL"));
    }
    @Test void P0328_openApiMatchesAccountWireFieldsAndContainsOnlyImplementedProductGroups() throws Exception {
        Browser b=new Browser(first.port);Response response=b.call("GET","/openapi.json",null);status(200,response);var spec=JSON.readTree(response.asString());
        assertEquals("3.0.3",spec.path("openapi").asText());assertFalse(spec.path("paths").has("/api/v1/transfers"));
        User u=user();String id=account(u,"Schema","CAD");var account=JSON.readTree(u.browser.call("GET","/accounts/"+id,null).asString());
        Set<String> actual=new HashSet<>(),declared=new HashSet<>();account.fieldNames().forEachRemaining(actual::add);
        spec.path("components").path("schemas").path("Account").path("properties").fieldNames().forEachRemaining(declared::add);assertEquals(declared,actual);
    }
    @Test void P0329_releaseCookieAttributesAndSecurityHeaders() throws Exception {
        App secure=launch("api-secure-cookie-policy",false);
        try {
            User u=registered();Browser b=new Browser(secure.port);Response csrf=b.call("GET","/auth/csrf",null);status(200,csrf);
            String header=csrf.headers().getValues("Set-Cookie").stream().filter(v->v.startsWith("__Host-LG-CSRF=")).findFirst().orElseThrow();assertTrue(header.contains("Secure"));assertTrue(header.contains("HttpOnly"));
            b.csrf=csrf.jsonPath().getString("token");Response login=b.call("POST","/auth/login",Map.of("email",u.email,"password",u.password));status(200,login);
            String auth=login.headers().getValues("Set-Cookie").stream().filter(v->v.startsWith("__Host-LG-SESSION=")).findFirst().orElseThrow();
            assertTrue(auth.contains("Secure"));assertTrue(auth.contains("HttpOnly"));assertTrue(auth.contains("SameSite=Strict"));assertFalse(auth.contains("Domain="));
            assertEquals("nosniff",login.header("X-Content-Type-Options"));assertEquals("DENY",login.header("X-Frame-Options"));assertNotNull(login.header("Content-Security-Policy"));
            assertEquals("no-store",login.header("Cache-Control"));assertNull(login.header("Access-Control-Allow-Origin"));
        } finally { stop(secure); }
    }
}
