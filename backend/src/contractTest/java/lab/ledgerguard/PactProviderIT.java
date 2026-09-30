package lab.ledgerguard;

import au.com.dius.pact.provider.junit5.*;
import au.com.dius.pact.provider.junitsupport.Provider;
import au.com.dius.pact.provider.junitsupport.State;
import au.com.dius.pact.provider.junitsupport.loader.PactFolder;
import java.net.ServerSocket;
import java.nio.file.*;
import java.security.SecureRandom;
import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.apache.hc.core5.http.HttpRequest;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import static org.junit.jupiter.api.Assertions.*;
import static io.restassured.RestAssured.given;

/** Normal application only: real PostgreSQL, real HTTP login and CSRF; no mocked controllers/security. */
@Provider("BadPennyApi")
@PactFolder("../.evidence/pact")
@Testcontainers
class PactProviderIT {
    @Container static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:17.11-bookworm")
        .withDatabaseName("ledgercontracts").withUsername("postgres").withPassword(UUID.randomUUID().toString());
    static final String OWNER = UUID.randomUUID().toString(), RUNTIME = UUID.randomUUID().toString();
    static Process api;
    static int port, customerIndex;
    final Map<String, String> cookies = new HashMap<>();
    String csrf;

    @BeforeAll static void start() throws Exception {
        try (Connection c = DriverManager.getConnection(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword()); Statement s = c.createStatement()) {
            s.execute("CREATE ROLE ledger_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" + OWNER + "'");
            s.execute("CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" + RUNTIME + "'");
            s.execute("GRANT CREATE ON DATABASE ledgercontracts TO ledger_owner");
            s.execute("GRANT USAGE,CREATE ON SCHEMA public TO ledger_owner");
        }
        try (ServerSocket socket = new ServerSocket(0)) { port = socket.getLocalPort(); }
        Path logs = Path.of("target/pact-evidence"); Files.createDirectories(logs);
        ProcessBuilder b = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
            "-Xmx256m", "-jar", "target/ledgerguard.jar", "--server.port=" + port, "--spring.profiles.active=sandbox");
        byte[] key = new byte[64]; new SecureRandom().nextBytes(key);
        b.environment().putAll(Map.of("LEDGER_DATABASE_URL", PG.getJdbcUrl(), "LEDGER_MIGRATION_URL", PG.getJdbcUrl(),
            "LEDGER_OWNER_PASSWORD", OWNER, "LEDGER_RUNTIME_PASSWORD", RUNTIME,
            "LEDGER_AUTH_KEY", Base64.getEncoder().encodeToString(key), "LEDGER_SANDBOX_HTTP", "true"));
        api = b.redirectErrorStream(true).redirectOutput(logs.resolve("api.log").toFile()).start();
        long deadline = System.nanoTime() + Duration.ofSeconds(90).toNanos();
        while (System.nanoTime() < deadline && api.isAlive()) {
            try { if (given().port(port).get("/api/v1/system").statusCode() == 200) return; }
            catch (Exception unavailable) { /* Bounded readiness polling only. */ }
            Thread.sleep(100);
        }
        stop(); throw new AssertionError("Normal contract API failed readiness; see target/pact-evidence/api.log");
    }
    @AfterAll static void stop() throws Exception {
        if (api != null) { api.destroy(); if (!api.waitFor(10, TimeUnit.SECONDS)) { api.destroyForcibly(); assertTrue(api.waitFor(10, TimeUnit.SECONDS)); } }
    }
    io.restassured.response.Response call(String method, String path, Object body) {
        var request = given().port(port).cookies(cookies).accept("application/json");
        if (csrf != null) request.header("X-XSRF-TOKEN", csrf);
        if (body != null) request.contentType("application/json").body(body);
        var response = request.request(method, "/api/v1" + path);
        response.detailedCookies().forEach(c -> { if (c.getMaxAge() == 0) cookies.remove(c.getName()); else cookies.put(c.getName(), c.getValue()); });
        return response;
    }
    void refreshCsrf() { var r = call("GET", "/auth/csrf", null); assertEquals(200, r.statusCode()); csrf = r.jsonPath().getString("token"); assertNotNull(csrf); }
    @State("authenticated customer with no accounts")
    void emptyCustomer() {
        cookies.clear(); csrf = null; refreshCsrf();
        String email = "contract" + (++customerIndex) + "@example.test", password = "P-" + UUID.randomUUID();
        assertEquals(201, call("POST", "/auth/register", Map.of("email", email, "password", password, "displayName", "Contract Customer")).statusCode());
        assertEquals(200, call("POST", "/auth/login", Map.of("email", email, "password", password)).statusCode());
        csrf = null; refreshCsrf();
        assertEquals(0, call("GET", "/accounts", null).jsonPath().getList("items").size());
    }
    @State("authenticated customer with a zero balance account")
    void zeroBalanceCustomer() {
        emptyCustomer();
        assertEquals(201, call("POST", "/accounts", Map.of("name", "Contract wallet", "currency", "CAD")).statusCode());
    }
    @BeforeEach void target(PactVerificationContext context) { context.setTarget(new HttpTestTarget("127.0.0.1", port)); }
    @TestTemplate
    @ExtendWith(PactVerificationInvocationContextProvider.class)
    void verify(PactVerificationContext context, HttpRequest request) {
        // Only ephemeral credentials are substituted. The path/body/status/schema remain Pact-owned.
        request.setHeader("Cookie", cookies.entrySet().stream().map(e -> e.getKey() + "=" + e.getValue()).collect(java.util.stream.Collectors.joining("; ")));
        if (request.containsHeader("X-XSRF-TOKEN")) request.setHeader("X-XSRF-TOKEN", csrf);
        context.verifyInteraction();
    }
}
