package lab.ledgerguard;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/** Verifies the durable boundary between detailed outbox diagnostics and bounded failed-work codes. */
@Testcontainers
class OutboxFailureBoundaryIT {
    private static final String OWNER_PASSWORD = UUID.randomUUID().toString();
    private static final String RUNTIME_PASSWORD = UUID.randomUUID().toString();

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.11-bookworm")
        .withDatabaseName("ledgerlab")
        .withUsername("postgres")
        .withPassword(UUID.randomUUID().toString());

    @BeforeAll
    static void migrate() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE ROLE ledger_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"
                + OWNER_PASSWORD + "'");
            statement.execute("CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"
                + RUNTIME_PASSWORD + "'");
            statement.execute("GRANT CREATE ON DATABASE ledgerlab TO ledger_owner");
            statement.execute("GRANT USAGE,CREATE ON SCHEMA public TO ledger_owner");
        }
        Flyway.configure()
            .dataSource(POSTGRES.getJdbcUrl(), "ledger_owner", OWNER_PASSWORD)
            .defaultSchema("public")
            .locations("classpath:db/migration")
            .load()
            .migrate();
    }

    @Test
    void P05_exhaustedOutboxFailureAlwaysFitsDurableFailedWorkBoundary() throws Exception {
        UUID eventId = UUID.randomUUID();
        UUID aggregateId = UUID.randomUUID();
        UUID correlationId = UUID.randomUUID();
        UUID leaseOwner = UUID.randomUUID();

        try (Connection owner = DriverManager.getConnection(POSTGRES.getJdbcUrl(), "ledger_owner", OWNER_PASSWORD);
             PreparedStatement insert = owner.prepareStatement(
                 "INSERT INTO ledger.outbox_events(id,aggregate_id,aggregate_version,event_type,correlation_id,payload) "
                     + "VALUES(?,?,1,'payment.requested',?,?::jsonb)")) {
            insert.setObject(1, eventId);
            insert.setObject(2, aggregateId);
            insert.setObject(3, correlationId);
            insert.setString(4, "{\"paymentId\":\"" + aggregateId + "\",\"version\":1,\"state\":\"PENDING\"}");
            assertEquals(1, insert.executeUpdate());
        }

        String detailedFailure = "x".repeat(500);
        UUID workId;
        try (Connection runtime = DriverManager.getConnection(POSTGRES.getJdbcUrl(), "ledger_runtime", RUNTIME_PASSWORD)) {
            runtime.setAutoCommit(false);
            try (PreparedStatement claim = runtime.prepareStatement(
                    "SELECT id FROM ledger.claim_outbox(?,1,30)")) {
                claim.setObject(1, leaseOwner);
                try (ResultSet rows = claim.executeQuery()) {
                    rows.next();
                    assertEquals(eventId, rows.getObject(1, UUID.class));
                }
            }
            try (PreparedStatement fail = runtime.prepareStatement(
                    "SELECT ledger.fail_outbox(?,?,?::jsonb,?,8)")) {
                fail.setObject(1, eventId);
                fail.setObject(2, leaseOwner);
                fail.setString(3, "{\"eventId\":\"" + eventId + "\",\"eventType\":\"payment.requested\"}");
                fail.setString(4, detailedFailure);
                try (ResultSet rows = fail.executeQuery()) {
                    rows.next();
                    workId = rows.getObject(1, UUID.class);
                }
            }
            runtime.commit();
        }

        assertNotNull(workId);
        try (Connection runtime = DriverManager.getConnection(POSTGRES.getJdbcUrl(), "ledger_runtime", RUNTIME_PASSWORD);
             PreparedStatement verify = runtime.prepareStatement(
                 "SELECT length(f.failure_code),f.attempts,f.state,length(e.last_error),e.failed_at IS NOT NULL "
                     + "FROM ledger.failed_work f JOIN ledger.outbox_events e ON e.id=f.event_id WHERE f.id=?")) {
            verify.setObject(1, workId);
            try (ResultSet rows = verify.executeQuery()) {
                rows.next();
                assertEquals(200, rows.getInt(1));
                assertEquals(8, rows.getInt(2));
                assertEquals("FAILED", rows.getString(3));
                assertEquals(500, rows.getInt(4));
                assertEquals(true, rows.getBoolean(5));
            }
        }
    }
}
