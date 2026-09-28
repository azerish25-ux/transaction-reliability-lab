package lab.ledgerguard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import lab.ledgerguard.core.SecretBox;
import lab.ledgerguard.core.WebhookSignature;
import lab.ledgerguard.webhooks.WebhookRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** P07B real-PostgreSQL proofs for durable signed webhook delivery state. */
@Testcontainers
class WebhookDeliveryReliabilityIT {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:17.11-bookworm")
        .withDatabaseName("ledgerwebhooks")
        .withUsername("postgres")
        .withPassword(UUID.randomUUID().toString());

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String OWNER_PASSWORD = UUID.randomUUID().toString();
    private static final String RUNTIME_PASSWORD = UUID.randomUUID().toString();
    private static final byte[] BOX_KEY = HexFormat.of().parseHex(
        "1111111111111111111111111111111111111111111111111111111111111111");
    private static JdbcTemplate owner;
    private static JdbcTemplate runtime;
    private static WebhookRepository repository;
    private static SecretBox box;

    record Fixture(UUID customer, UUID outsider, UUID admin, UUID source, String recipientRef) { }
    record Event(UUID operationId, UUID eventId) { }
    record Endpoint(UUID id, byte[] secret) { }

    @BeforeAll
    static void migrate() throws Exception {
        try (Connection connection = DriverManager.getConnection(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword());
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE ROLE ledger_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"
                + OWNER_PASSWORD + "'");
            statement.execute("CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"
                + RUNTIME_PASSWORD + "'");
            statement.execute("GRANT CREATE ON DATABASE ledgerwebhooks TO ledger_owner");
            statement.execute("GRANT USAGE,CREATE ON SCHEMA public TO ledger_owner");
        }
        Flyway.configure()
            .dataSource(PG.getJdbcUrl(), "ledger_owner", OWNER_PASSWORD)
            .defaultSchema("public")
            .locations("classpath:db/migration", "classpath:db/p07", "classpath:db/p07b")
            .load().migrate();
        owner = new JdbcTemplate(new DriverManagerDataSource(PG.getJdbcUrl(), "ledger_owner", OWNER_PASSWORD));
        runtime = new JdbcTemplate(new DriverManagerDataSource(PG.getJdbcUrl(), "ledger_runtime", RUNTIME_PASSWORD));
        repository = new WebhookRepository(runtime);
        box = new SecretBox(BOX_KEY);
    }

    @BeforeEach
    void resetWebhookState() {
        owner.execute("TRUNCATE ledger.webhook_receiver_receipts,ledger.webhook_attempts,"
            + "ledger.webhook_audit,ledger.webhook_deliveries,ledger.webhook_endpoint_secrets,"
            + "ledger.webhook_endpoints RESTART IDENTITY CASCADE");
        owner.update("UPDATE ledger.webhook_receiver_control SET mode='NORMAL',updated_at=clock_timestamp() "
            + "WHERE singleton");
    }

    @Test
    void P07B01_endpointSecretsAreEncryptedOwnerScopedAndNotRuntimeReadable() throws Exception {
        Fixture fixture = fixture(10_000);
        Endpoint endpoint = endpoint(fixture.customer());
        WebhookRepository.Endpoint view = repository.endpoint(fixture.customer(), endpoint.id());
        assertNotNull(view);
        assertEquals("sandbox-receiver", view.destinationId());
        assertEquals(1, view.version());
        // P08E is additive: all ten historical migrations and exactly V11 must be present.
        assertEquals(10, scalar("SELECT count(*) FROM public.flyway_schema_history WHERE success AND version::integer BETWEEN 1 AND 10"));
        assertEquals(1, scalar("SELECT count(*) FROM public.flyway_schema_history WHERE success AND version='11'"));
        assertEquals(11, scalar("SELECT count(*) FROM public.flyway_schema_history WHERE success"));

        String encrypted = owner.queryForObject(
            "SELECT encrypted_secret FROM ledger.webhook_endpoint_secrets WHERE endpoint_id=? AND key_version=1",
            String.class, endpoint.id());
        assertNotNull(encrypted);
        assertNotEquals(java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(endpoint.secret()), encrypted);
        assertArrayEquals(endpoint.secret(), box.open(endpoint.id(), encrypted));
        assertEquals(null, repository.endpoint(fixture.outsider(), endpoint.id()));

        try (Connection connection = runtimeConnection(); Statement statement = connection.createStatement()) {
            SQLException secretDenied = assertThrows(SQLException.class,
                () -> statement.executeQuery("SELECT encrypted_secret FROM ledger.webhook_endpoints"));
            assertEquals("42501", secretDenied.getSQLState());
            SQLException historyDenied = assertThrows(SQLException.class,
                () -> statement.executeQuery("SELECT encrypted_secret FROM ledger.webhook_endpoint_secrets"));
            assertEquals("42501", historyDenied.getSQLState());
            SQLException mutationDenied = assertThrows(SQLException.class,
                () -> statement.executeUpdate("UPDATE ledger.webhook_endpoints SET enabled=false WHERE id='"
                    + endpoint.id() + "'"));
            assertEquals("42501", mutationDenied.getSQLState());
        }

        DataAccessException duplicate = assertThrows(DataAccessException.class,
            () -> repository.createEndpoint(fixture.customer(), UUID.randomUUID(), "sandbox-receiver",
                "http://receiver:8081/events", box.seal(UUID.randomUUID(), secret(2)), UUID.randomUUID()));
        assertEquals("P4090", sqlState(duplicate));
    }

    @Test
    void P07B02_duplicateFanoutAndCompetingDispatchersCommitOneLogicalDelivery() throws Exception {
        Fixture fixture = fixture(10_000);
        Endpoint endpoint = endpoint(fixture.customer());
        Event event = transferEvent(fixture, 1_250, "webhook-fanout-0702");

        assertEquals(1, repository.fanOut(20));
        assertEquals(0, repository.fanOut(20));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.webhook_deliveries WHERE endpoint_id=? AND event_id=?",
            endpoint.id(), event.eventId()));

        UUID leftOwner = UUID.randomUUID();
        UUID rightOwner = UUID.randomUUID();
        CyclicBarrier gate = new CyclicBarrier(2);
        List<WebhookRepository.Claimed> left;
        List<WebhookRepository.Claimed> right;
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<List<WebhookRepository.Claimed>> a = pool.submit(() -> {
                gate.await();
                return new WebhookRepository(runtime).claim(leftOwner, 10, Duration.ofSeconds(20));
            });
            Future<List<WebhookRepository.Claimed>> b = pool.submit(() -> {
                gate.await();
                return new WebhookRepository(runtime).claim(rightOwner, 10, Duration.ofSeconds(20));
            });
            left = a.get(15, TimeUnit.SECONDS);
            right = b.get(15, TimeUnit.SECONDS);
        }
        assertEquals(1, left.size() + right.size());
        WebhookRepository.Claimed claimed = left.isEmpty() ? right.getFirst() : left.getFirst();
        UUID leaseOwner = left.isEmpty() ? rightOwner : leftOwner;
        assertEquals(1, claimed.attempt());
        assertEquals(1, claimed.secretKeyVersion());
        assertArrayEquals(endpoint.secret(), box.open(endpoint.id(), claimed.encryptedSecret()));
        assertEquals(hex(claimed.payload()), owner.queryForObject(
            "SELECT payload_hash FROM ledger.webhook_deliveries WHERE id=?", String.class, claimed.deliveryId()));

        long timestamp = Instant.now().getEpochSecond();
        String signature = WebhookSignature.sign(endpoint.secret(), timestamp, event.eventId(), claimed.payload());
        repository.complete(claimed.deliveryId(), leaseOwner, "DELIVERED", 204, 12, timestamp,
            signature, "", "", null);
        WebhookRepository.Delivery delivered = repository.deliveryForOwner(fixture.customer(), claimed.deliveryId());
        assertEquals("DELIVERED", delivered.state());
        assertEquals(1, delivered.totalAttempts());
        assertEquals("DELIVERED", repository.attempts(claimed.deliveryId()).getFirst().outcome());

        try (Connection connection = runtimeConnection(); Statement statement = connection.createStatement()) {
            SQLException immutable = assertThrows(SQLException.class,
                () -> statement.executeUpdate("UPDATE ledger.webhook_attempts SET outcome='EXHAUSTED' WHERE delivery_id='"
                    + claimed.deliveryId() + "'"));
            assertEquals("42501", immutable.getSQLState());
        }
    }

    @Test
    void P07B03_attemptBudgetLeaseRecoveryAndManualRetrySurviveRestarts() {
        Fixture fixture = fixture(10_000);
        Endpoint endpoint = endpoint(fixture.customer());
        Event event = transferEvent(fixture, 500, "webhook-restart-0703");
        assertEquals(1, repository.fanOut(10));

        UUID firstOwner = UUID.randomUUID();
        WebhookRepository.Claimed first = repository.claim(firstOwner, 1, Duration.ofSeconds(5)).getFirst();
        owner.update("UPDATE ledger.webhook_deliveries SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",
            first.deliveryId());

        WebhookRepository restarted = new WebhookRepository(runtime);
        WebhookRepository.Claimed current = restarted.claim(UUID.randomUUID(), 1, Duration.ofSeconds(5)).getFirst();
        assertEquals(2, current.attempt());
        assertEquals("LEASE_EXPIRED", restarted.attempts(first.deliveryId()).getFirst().outcome());

        while (current.attempt() < 8) {
            UUID lease = owner.queryForObject("SELECT lease_owner FROM ledger.webhook_deliveries WHERE id=?",
                UUID.class, current.deliveryId());
            long timestamp = Instant.now().getEpochSecond();
            String signature = WebhookSignature.sign(endpoint.secret(), timestamp, event.eventId(), current.payload());
            restarted.complete(current.deliveryId(), lease, "RETRY_SCHEDULED", 503, 20, timestamp,
                signature, "temporary", "HTTP_503", Instant.now().plusSeconds(30));
            owner.update("UPDATE ledger.webhook_deliveries SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=?",
                current.deliveryId());
            current = new WebhookRepository(runtime).claim(UUID.randomUUID(), 1, Duration.ofSeconds(5)).getFirst();
        }
        UUID finalOwner = owner.queryForObject("SELECT lease_owner FROM ledger.webhook_deliveries WHERE id=?",
            UUID.class, current.deliveryId());
        long timestamp = Instant.now().getEpochSecond();
        String signature = WebhookSignature.sign(endpoint.secret(), timestamp, event.eventId(), current.payload());
        restarted.complete(current.deliveryId(), finalOwner, "EXHAUSTED", 503, 25, timestamp,
            signature, "temporary", "HTTP_503", null);

        WebhookRepository.Delivery failed = restarted.deliveryForOwner(fixture.customer(), current.deliveryId());
        assertEquals("FAILED", failed.state());
        assertEquals(8, failed.attempts());
        assertEquals(8, failed.totalAttempts());

        restarted.requestRetry(fixture.customer(), failed.id(), "Receiver recovered", UUID.randomUUID());
        WebhookRepository.Delivery reset = restarted.deliveryForOwner(fixture.customer(), failed.id());
        assertEquals("PENDING", reset.state());
        assertEquals(2, reset.cycle());
        assertEquals(0, reset.attempts());
        WebhookRepository.Claimed retried = new WebhookRepository(runtime)
            .claim(UUID.randomUUID(), 1, Duration.ofSeconds(5)).getFirst();
        assertEquals(2, retried.cycle());
        assertEquals(1, retried.attempt());
        assertEquals(8, repository.attempts(failed.id()).size());
    }

    @Test
    void P07B04_secretRotationKeepsEveryDeliveryVerifiableWithItsOriginalVersion() {
        Fixture fixture = fixture(20_000);
        Endpoint endpoint = endpoint(fixture.customer());
        Event oldEvent = transferEvent(fixture, 300, "webhook-old-secret-0704");
        assertEquals(1, repository.fanOut(10));

        byte[] rotatedSecret = secret(44);
        String protectedRotated = box.seal(endpoint.id(), rotatedSecret);
        assertEquals(2, repository.rotateEndpoint(fixture.customer(), endpoint.id(), protectedRotated,
            1, UUID.randomUUID()));
        Event newEvent = transferEvent(fixture, 400, "webhook-new-secret-0704");
        assertEquals(1, repository.fanOut(10));

        List<WebhookRepository.Claimed> claimed = repository.claim(UUID.randomUUID(), 10, Duration.ofSeconds(20));
        assertEquals(2, claimed.size());
        WebhookRepository.Claimed oldDelivery = claimed.stream()
            .filter(item -> item.eventId().equals(oldEvent.eventId())).findFirst().orElseThrow();
        WebhookRepository.Claimed newDelivery = claimed.stream()
            .filter(item -> item.eventId().equals(newEvent.eventId())).findFirst().orElseThrow();
        assertEquals(1, oldDelivery.secretKeyVersion());
        assertEquals(2, newDelivery.secretKeyVersion());
        assertArrayEquals(endpoint.secret(), box.open(endpoint.id(), oldDelivery.encryptedSecret()));
        assertArrayEquals(rotatedSecret, box.open(endpoint.id(), newDelivery.encryptedSecret()));
        assertArrayEquals(endpoint.secret(), box.open(endpoint.id(),
            repository.receiverSecret(endpoint.id(), oldEvent.eventId(), 1)));
        assertArrayEquals(rotatedSecret, box.open(endpoint.id(),
            repository.receiverSecret(endpoint.id(), newEvent.eventId(), 2)));
        assertThrows(DataAccessException.class,
            () -> repository.receiverSecret(endpoint.id(), oldEvent.eventId(), 2));
        Arrays.fill(rotatedSecret, (byte) 0);
    }

    @Test
    void P07B05_receiverReceiptIsIdempotentAndRejectsChangedBytes() {
        Fixture fixture = fixture(10_000);
        Endpoint endpoint = endpoint(fixture.customer());
        Event event = transferEvent(fixture, 250, "webhook-receipt-0705");
        assertEquals(1, repository.fanOut(10));
        WebhookRepository.Claimed claimed = repository.claim(UUID.randomUUID(), 1, Duration.ofSeconds(20)).getFirst();
        long timestamp = Instant.now().getEpochSecond();
        String signature = WebhookSignature.sign(endpoint.secret(), timestamp, event.eventId(), claimed.payload());
        String hash = hex(claimed.payload());
        assertTrue(repository.recordReceipt(endpoint.id(), event.eventId(), hash, signature, timestamp));
        assertFalse(repository.recordReceipt(endpoint.id(), event.eventId(), hash,
            WebhookSignature.sign(endpoint.secret(), timestamp + 1, event.eventId(), claimed.payload()), timestamp + 1));
        assertEquals(2, scalar("SELECT receive_count FROM ledger.webhook_receiver_receipts WHERE endpoint_id=? AND event_id=?",
            endpoint.id(), event.eventId()));
        DataAccessException conflict = assertThrows(DataAccessException.class,
            () -> repository.recordReceipt(endpoint.id(), event.eventId(), "0".repeat(64), signature, timestamp));
        assertEquals("P4090", sqlState(conflict));
    }

    private static Fixture fixture(long funding) {
        UUID customer = UUID.randomUUID();
        UUID outsider = UUID.randomUUID();
        UUID admin = UUID.randomUUID();
        owner.update("INSERT INTO ledger.app_users(id,email,password_hash,display_name,role) VALUES"
                + "(?,?,?,'Webhook customer','CUSTOMER'),(?,?,?,'Webhook outsider','CUSTOMER'),"
                + "(?,?,?,'Webhook admin','ADMIN')",
            customer, "webhook-" + customer + "@example.test", "x".repeat(60),
            outsider, "webhook-" + outsider + "@example.test", "x".repeat(60),
            admin, "webhook-" + admin + "@example.test", "x".repeat(60));
        UUID source = UUID.randomUUID();
        UUID destination = UUID.randomUUID();
        UUID fundingAsset = UUID.randomUUID();
        owner.update("INSERT INTO ledger.accounts(id,owner_id,label,currency) VALUES(?,?,?,'CAD'),(?,?,?,'CAD')",
            source, customer, "Webhook source", destination, outsider, "Webhook destination");
        owner.update("INSERT INTO ledger.accounts(id,label,currency,kind) VALUES(?,?,'CAD','SANDBOX_FUNDING_ASSET')",
            fundingAsset, "Webhook synthetic funding");
        owner.update("INSERT INTO ledger.account_balances(account_id) VALUES(?),(?),(?)",
            source, destination, fundingAsset);
        owner.query("SELECT ledger._post(?,'FUNDING',?,?,?,'CAD')", ignored -> null,
            UUID.randomUUID(), fundingAsset, source, funding);
        String recipient = owner.queryForObject("SELECT public_ref FROM ledger.accounts WHERE id=?",
            String.class, destination);
        return new Fixture(customer, outsider, admin, source, recipient);
    }

    private static Endpoint endpoint(UUID customer) {
        UUID id = UUID.randomUUID();
        byte[] secret = secret(7);
        repository.createEndpoint(customer, id, "sandbox-receiver", "http://receiver:8081/events",
            box.seal(id, secret), UUID.randomUUID());
        return new Endpoint(id, secret);
    }

    private static Event transferEvent(Fixture fixture, long amount, String keyPrefix) {
        ObjectNode payload = JSON.createObjectNode();
        payload.put("sourceId", fixture.source().toString());
        payload.put("recipientRef", fixture.recipientRef());
        payload.put("amountMinor", Long.toString(amount));
        payload.put("currency", "CAD");
        String key = keyPrefix + "-" + UUID.randomUUID().toString().replace("-", "");
        String body = runtime.query("SELECT body::text FROM ledger.execute_command(?, 'TRANSFER', NULL, ?, ?::jsonb, ?)",
            rows -> rows.next() ? rows.getString(1) : null, fixture.customer(), key, payload.toString(), UUID.randomUUID());
        try {
            JsonNode result = JSON.readTree(body);
            UUID operation = UUID.fromString(result.path("id").asText());
            UUID event = owner.queryForObject("SELECT id FROM ledger.outbox_events WHERE aggregate_id=? "
                + "AND event_type='transfer.settled'", UUID.class, operation);
            return new Event(operation, event);
        } catch (Exception invalid) {
            throw new AssertionError("Invalid durable transfer response", invalid);
        }
    }

    private static int scalar(String sql, Object... arguments) {
        Integer value = owner.queryForObject(sql, Integer.class, arguments);
        return value == null ? 0 : value;
    }

    private static Connection runtimeConnection() throws SQLException {
        return DriverManager.getConnection(PG.getJdbcUrl(), "ledger_runtime", RUNTIME_PASSWORD);
    }

    private static byte[] secret(int seed) {
        byte[] value = new byte[32];
        for (int index = 0; index < value.length; index++) value[index] = (byte) (seed + index);
        return value;
    }

    private static String hex(byte[] value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }

    private static String sqlState(Throwable failure) {
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current instanceof SQLException sql) return sql.getSQLState();
        }
        return null;
    }
}
