package lab.ledgerguard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import lab.ledgerguard.core.SchedulePolicy;
import lab.ledgerguard.schedules.ScheduleCommands;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** P07A real-PostgreSQL proofs for durable scheduled-transfer execution. */
@Testcontainers
class ScheduledTransferReliabilityIT {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:17.11-bookworm")
        .withDatabaseName("ledgerschedules")
        .withUsername("postgres")
        .withPassword(UUID.randomUUID().toString());

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final DateTimeFormatter LOCAL = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss");
    private static final String OWNER_PASSWORD = UUID.randomUUID().toString();
    private static final String RUNTIME_PASSWORD = UUID.randomUUID().toString();
    private static ScheduleCommands commands;

    record Account(UUID id, String publicRef) { }
    record Fixture(UUID owner, UUID recipient, Account source, Account destination) { }
    record Created(UUID id, ScheduleCommands.Result result, LocalDateTime intended,
                   Instant due, String recurrence) { }

    @BeforeAll
    static void migrate() throws Exception {
        try (Connection connection = DriverManager.getConnection(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword());
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE ROLE ledger_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"
                + OWNER_PASSWORD + "'");
            statement.execute("CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"
                + RUNTIME_PASSWORD + "'");
            statement.execute("GRANT CREATE ON DATABASE ledgerschedules TO ledger_owner");
            statement.execute("GRANT USAGE,CREATE ON SCHEMA public TO ledger_owner");
        }
        Flyway.configure()
            .dataSource(PG.getJdbcUrl(), "ledger_owner", OWNER_PASSWORD)
            .defaultSchema("public")
            .locations("classpath:db/migration", "classpath:db/p07")
            .load().migrate();
        commands = new ScheduleCommands(new DriverManagerDataSource(
            PG.getJdbcUrl(), "ledger_runtime", RUNTIME_PASSWORD));
    }

    @Test
    void P07A01_createIsReplaySafeAndRuntimeCannotBypassBoundary() throws Exception {
        Fixture fixture = fixture(10_000);
        LocalDateTime intended = LocalDateTime.parse("2099-03-08T09:15:00");
        Instant due = SchedulePolicy.resolve(intended, ZoneId.of("America/Halifax"));
        ObjectNode payload = payload(fixture, 2_500, intended, due, "DAILY");
        String key = "schedule-create-0701";

        ScheduleCommands.Result created = commands.execute(fixture.owner(), "CREATE", null, key,
            JSON.writeValueAsString(payload), UUID.randomUUID());
        ScheduleCommands.Result replay = commands.execute(fixture.owner(), "CREATE", null, key,
            JSON.writeValueAsString(payload), UUID.randomUUID());
        assertEquals(201, created.status());
        assertEquals(201, replay.status());
        assertEquals(created.json(), replay.json());
        assertTrue(replay.replayed());

        ObjectNode changed = payload.deepCopy();
        changed.put("amountMinor", "2501");
        ScheduleCommands.Result conflict = commands.execute(fixture.owner(), "CREATE", null, key,
            JSON.writeValueAsString(changed), UUID.randomUUID());
        assertEquals(409, conflict.status());
        assertEquals("IDEMPOTENCY_CONFLICT", JSON.readTree(conflict.json()).path("code").asText());
        assertEquals(1, scalar("SELECT count(*) FROM ledger.schedules WHERE owner_id=?", fixture.owner()));
        assertEquals(9, scalar("SELECT count(*) FROM public.flyway_schema_history WHERE success"));
        assertEquals(Instant.parse("2026-03-08T06:30:00Z"), instant(
            "SELECT ledger._resolve_schedule_local(timestamp '2026-03-08 02:30:00','America/Halifax')"));
        assertEquals(Instant.parse("2026-11-01T04:30:00Z"), instant(
            "SELECT ledger._resolve_schedule_local(timestamp '2026-11-01 01:30:00','America/Halifax')"));

        LocalDateTime pastLocal = LocalDateTime.parse("2020-01-01T00:00:00");
        ObjectNode past = payload(fixture, 100, pastLocal, SchedulePolicy.resolve(pastLocal, ZoneId.of("UTC")), "ONCE");
        past.put("zoneId", "UTC");
        ScheduleCommands.Result pastRejected = commands.execute(fixture.owner(), "CREATE", null,
            "schedule-past-0701", JSON.writeValueAsString(past), UUID.randomUUID());
        ScheduleCommands.Result pastReplay = commands.execute(fixture.owner(), "CREATE", null,
            "schedule-past-0701", JSON.writeValueAsString(past), UUID.randomUUID());
        assertEquals(422, pastRejected.status());
        assertEquals(pastRejected.json(), pastReplay.json());
        assertTrue(pastReplay.replayed());

        try (Connection connection = runtime(); Statement statement = connection.createStatement()) {
            SQLException denied = assertThrows(SQLException.class,
                () -> statement.execute("INSERT INTO ledger.schedules(owner_id,source_id,destination_ref,"
                    + "amount_minor,currency,intended_local,zone_id,recurrence,next_instant) VALUES("
                    + "gen_random_uuid(),gen_random_uuid(),'LG-00000000000000000000000000000000',1,'CAD',"
                    + "timestamp '2099-01-01 00:00:00','UTC','ONCE',timestamptz '2099-01-01 00:00:00Z')"));
            assertEquals("42501", denied.getSQLState());
            SQLException internalDenied = assertThrows(SQLException.class,
                () -> statement.execute("SELECT ledger._schedule_body(gen_random_uuid())"));
            assertEquals("42501", internalDenied.getSQLState());
            SQLException timePolicyDenied = assertThrows(SQLException.class,
                () -> statement.execute("SELECT ledger._resolve_schedule_local(timestamp '2026-01-01 00:00:00','UTC')"));
            assertEquals("42501", timePolicyDenied.getSQLState());
        }
    }

    @Test
    void P07A02_twoSchedulersCommitExactlyOneOccurrenceAndTransfer() throws Exception {
        Fixture fixture = fixture(10_000);
        Created schedule = create(fixture, 2_500, LocalDateTime.parse("2099-04-01T09:00:00"),
            "America/Halifax", "DAILY", "schedule-race-0702");
        LocalDateTime nextLocal = schedule.intended().plusDays(1);
        Instant nextDue = SchedulePolicy.resolve(nextLocal, ZoneId.of("America/Halifax"));
        CyclicBarrier gate = new CyclicBarrier(2);
        List<String> outcomes;
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<String> left = pool.submit(() -> {
                gate.await();
                return outcome(commands.executeOccurrence(schedule.id(), 1, schedule.intended(), schedule.due(),
                    schedule.due().plusSeconds(1), nextLocal, nextDue, UUID.randomUUID()));
            });
            Future<String> right = pool.submit(() -> {
                gate.await();
                return outcome(commands.executeOccurrence(schedule.id(), 1, schedule.intended(), schedule.due(),
                    schedule.due().plusSeconds(1), nextLocal, nextDue, UUID.randomUUID()));
            });
            outcomes = List.of(left.get(15, TimeUnit.SECONDS), right.get(15, TimeUnit.SECONDS));
        }
        assertEquals(Set.of("SUCCEEDED", "IGNORED"), Set.copyOf(outcomes));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.schedule_occurrences WHERE schedule_id=?", schedule.id()));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.transfers WHERE actor_id=? AND amount_minor=2500", fixture.owner()));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.journals j JOIN ledger.transfers t ON t.journal_id=j.id "
            + "WHERE t.actor_id=? AND t.amount_minor=2500", fixture.owner()));
        assertEquals(7_500, scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?", fixture.source().id()));
        assertEquals(2_500, scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?", fixture.destination().id()));
        assertEquals(nextLocal, local("SELECT intended_local FROM ledger.schedules WHERE id=?", schedule.id()));
        assertEquals(0, discrepancies(fixture));
    }

    @Test
    void P07A03_businessRejectionIsRecordedOnceWithoutFinancialFragments() throws Exception {
        Fixture fixture = fixture(100);
        Created schedule = create(fixture, 1_000, LocalDateTime.parse("2099-05-01T10:00:00"),
            "UTC", "WEEKLY", "schedule-reject-0703");
        LocalDateTime nextLocal = schedule.intended().plusWeeks(1);
        Instant nextDue = SchedulePolicy.resolve(nextLocal, ZoneId.of("UTC"));

        JsonNode result = JSON.readTree(commands.executeOccurrence(schedule.id(), 1,
            schedule.intended(), schedule.due(), schedule.due().plusSeconds(1), nextLocal, nextDue,
            UUID.randomUUID()));
        assertEquals("REJECTED", result.path("outcome").asText());
        assertEquals("INSUFFICIENT_FUNDS", result.path("errorCode").asText());
        assertEquals(1, scalar("SELECT count(*) FROM ledger.schedule_occurrences WHERE schedule_id=? "
            + "AND outcome='REJECTED' AND error_code='INSUFFICIENT_FUNDS'", schedule.id()));
        assertEquals(0, scalar("SELECT count(*) FROM ledger.transfers WHERE actor_id=?", fixture.owner()));
        assertEquals(0, scalar("SELECT count(*) FROM ledger.journals j JOIN ledger.transfers t ON t.journal_id=j.id "
            + "WHERE t.actor_id=?", fixture.owner()));
        assertEquals(100, scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?", fixture.source().id()));
        assertEquals(0, scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?", fixture.destination().id()));
        assertEquals(nextLocal, local("SELECT intended_local FROM ledger.schedules WHERE id=?", schedule.id()));
        assertEquals(0, discrepancies(fixture));
    }

    @Test
    void P07A04_catchUpWindowSkipsOldOccurrencesWithoutCollapsingObligations() throws Exception {
        Fixture fixture = fixture(10_000);
        Created schedule = create(fixture, 700, LocalDateTime.parse("2099-06-01T08:30:00"),
            "America/Halifax", "DAILY", "schedule-late-0704");
        LocalDateTime nextLocal = schedule.intended().plusDays(1);
        Instant nextDue = SchedulePolicy.resolve(nextLocal, ZoneId.of("America/Halifax"));

        JsonNode skipped = JSON.readTree(commands.executeOccurrence(schedule.id(), 1,
            schedule.intended(), schedule.due(), schedule.due().plusSeconds(25 * 60 * 60),
            nextLocal, nextDue, UUID.randomUUID()));
        assertEquals("SKIPPED_LATE", skipped.path("outcome").asText());
        assertEquals("MISSED_CATCH_UP_WINDOW", skipped.path("errorCode").asText());
        assertEquals(1, scalar("SELECT count(*) FROM ledger.schedule_occurrences WHERE schedule_id=? "
            + "AND outcome='SKIPPED_LATE'", schedule.id()));
        assertEquals(0, scalar("SELECT count(*) FROM ledger.transfers WHERE actor_id=?", fixture.owner()));
        assertEquals(nextLocal, local("SELECT intended_local FROM ledger.schedules WHERE id=?", schedule.id()));
        assertEquals(nextDue, instant("SELECT next_instant FROM ledger.schedules WHERE id=?", schedule.id()));
        assertEquals(10_000, scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?", fixture.source().id()));
        assertEquals(0, discrepancies(fixture));
    }

    @Test
    void P07A05_editInvalidatesStaleTicksAndLifecycleCommandsPreserveVersionedHistory() throws Exception {
        Fixture fixture = fixture(10_000);
        Created original = create(fixture, 500, LocalDateTime.parse("2099-07-01T12:00:00"),
            "UTC", "DAILY", "schedule-edit-parent-0705");
        LocalDateTime editedLocal = original.intended().plusDays(3);
        Instant editedDue = SchedulePolicy.resolve(editedLocal, ZoneId.of("UTC"));
        ObjectNode edited = payload(fixture, 900, editedLocal, editedDue, "DAILY");
        edited.put("zoneId", "UTC");
        edited.put("expectedVersion", 1);
        ScheduleCommands.Result update = commands.execute(fixture.owner(), "EDIT", original.id(),
            "schedule-edit-0705", JSON.writeValueAsString(edited), UUID.randomUUID());
        assertEquals(200, update.status());
        JsonNode updated = JSON.readTree(update.json());
        assertEquals(2, updated.path("version").asLong());
        assertEquals("900", updated.path("amountMinor").asText());

        LocalDateTime oldNext = original.intended().plusDays(1);
        String stale = commands.executeOccurrence(original.id(), 1, original.intended(), original.due(),
            original.due().plusSeconds(1), oldNext, SchedulePolicy.resolve(oldNext, ZoneId.of("UTC")),
            UUID.randomUUID());
        assertEquals("IGNORED", outcome(stale));
        assertEquals(0, scalar("SELECT count(*) FROM ledger.schedule_occurrences WHERE schedule_id=?", original.id()));

        LocalDateTime newNext = editedLocal.plusDays(1);
        String committed = commands.executeOccurrence(original.id(), 2, editedLocal, editedDue,
            editedDue.plusSeconds(1), newNext, SchedulePolicy.resolve(newNext, ZoneId.of("UTC")),
            UUID.randomUUID());
        assertEquals("SUCCEEDED", outcome(committed));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.schedule_occurrences WHERE schedule_id=? "
            + "AND schedule_version=2", original.id()));

        ObjectNode version = JSON.createObjectNode().put("expectedVersion", 2);
        ScheduleCommands.Result paused = commands.execute(fixture.owner(), "PAUSE", original.id(),
            "schedule-pause-0705", JSON.writeValueAsString(version), UUID.randomUUID());
        assertEquals("PAUSED", JSON.readTree(paused.json()).path("status").asText());
        ObjectNode resume = JSON.createObjectNode().put("expectedVersion", 2);
        ScheduleCommands.Result resumed = commands.execute(fixture.owner(), "RESUME", original.id(),
            "schedule-resume-0705", JSON.writeValueAsString(resume), UUID.randomUUID());
        ScheduleCommands.Result resumeReplay = commands.execute(fixture.owner(), "RESUME", original.id(),
            "schedule-resume-0705", JSON.writeValueAsString(resume), UUID.randomUUID());
        assertEquals("ACTIVE", JSON.readTree(resumed.json()).path("status").asText());
        assertEquals(resumed.json(), resumeReplay.json());
        assertTrue(resumeReplay.replayed());
        ObjectNode changedResume = JSON.createObjectNode().put("expectedVersion", 3);
        assertEquals(409, commands.execute(fixture.owner(), "RESUME", original.id(),
            "schedule-resume-0705", JSON.writeValueAsString(changedResume), UUID.randomUUID()).status());
        ScheduleCommands.Result cancelled = commands.execute(fixture.owner(), "CANCEL", original.id(),
            "schedule-cancel-0705", JSON.writeValueAsString(version), UUID.randomUUID());
        assertEquals("CANCELLED", JSON.readTree(cancelled.json()).path("status").asText());
        assertEquals(2, scalar("SELECT version FROM ledger.schedules WHERE id=?", original.id()));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.schedule_occurrences WHERE schedule_id=?", original.id()));
        assertEquals(0, discrepancies(fixture));
    }

    private static Fixture fixture(long opening) throws Exception {
        UUID owner = user("schedule-owner");
        UUID recipient = user("schedule-recipient");
        Account source = account(owner, "Schedule source");
        Account destination = account(recipient, "Schedule destination");
        fund(source.id(), opening);
        return new Fixture(owner, recipient, source, destination);
    }

    private static Created create(Fixture fixture, long amount, LocalDateTime intended,
                                  String zoneName, String recurrence, String key) throws Exception {
        ZoneId zone = ZoneId.of(zoneName);
        Instant due = SchedulePolicy.resolve(intended, zone);
        ObjectNode payload = payload(fixture, amount, intended, due, recurrence);
        payload.put("zoneId", zoneName);
        ScheduleCommands.Result result = commands.execute(fixture.owner(), "CREATE", null, key,
            JSON.writeValueAsString(payload), UUID.randomUUID());
        assertEquals(201, result.status(), result.json());
        UUID id = UUID.fromString(JSON.readTree(result.json()).path("id").asText());
        return new Created(id, result, intended, due, recurrence);
    }

    private static ObjectNode payload(Fixture fixture, long amount, LocalDateTime intended,
                                      Instant due, String recurrence) {
        return JSON.createObjectNode()
            .put("sourceId", fixture.source().id().toString())
            .put("recipientRef", fixture.destination().publicRef())
            .put("amountMinor", Long.toString(amount))
            .put("currency", "CAD")
            .put("intendedLocal", LOCAL.format(intended))
            .put("zoneId", "America/Halifax")
            .put("recurrence", recurrence)
            .put("nextInstant", due.toString());
    }

    private static UUID user(String prefix) throws SQLException {
        try (Connection connection = owner(); PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO ledger.app_users(email,password_hash,display_name,role) "
                    + "VALUES(?,?,?,'CUSTOMER') RETURNING id")) {
            statement.setString(1, prefix + "-" + UUID.randomUUID() + "@example.test");
            byte[] random = new byte[24];
            new SecureRandom().nextBytes(random);
            statement.setString(2, "$2a$12$" + java.util.HexFormat.of().formatHex(random));
            statement.setString(3, prefix);
            try (ResultSet rows = statement.executeQuery()) {
                assertTrue(rows.next());
                return rows.getObject(1, UUID.class);
            }
        }
    }

    private static Account account(UUID owner, String label) throws SQLException {
        try (Connection connection = owner()) {
            connection.setAutoCommit(false);
            UUID id;
            String reference;
            try (PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO ledger.accounts(owner_id,label,currency) VALUES(?,?,'CAD') RETURNING id,public_ref")) {
                statement.setObject(1, owner);
                statement.setString(2, label);
                try (ResultSet rows = statement.executeQuery()) {
                    assertTrue(rows.next());
                    id = rows.getObject(1, UUID.class);
                    reference = rows.getString(2);
                }
            }
            try (PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO ledger.account_balances(account_id) VALUES(?)")) {
                statement.setObject(1, id);
                assertEquals(1, statement.executeUpdate());
            }
            connection.commit();
            return new Account(id, reference);
        }
    }

    private static void fund(UUID target, long amount) throws SQLException {
        try (Connection connection = owner()) {
            connection.setAutoCommit(false);
            UUID asset;
            try (PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO ledger.accounts(label,currency,kind) "
                        + "VALUES(?,'CAD','SANDBOX_FUNDING_ASSET') RETURNING id")) {
                statement.setString(1, "P07A asset " + UUID.randomUUID());
                try (ResultSet rows = statement.executeQuery()) {
                    assertTrue(rows.next());
                    asset = rows.getObject(1, UUID.class);
                }
            }
            try (PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO ledger.account_balances(account_id) VALUES(?)")) {
                statement.setObject(1, asset);
                statement.executeUpdate();
            }
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT ledger._post(?,'FUNDING',?,?,?,'CAD')")) {
                statement.setObject(1, UUID.randomUUID());
                statement.setObject(2, asset);
                statement.setObject(3, target);
                statement.setLong(4, amount);
                try (ResultSet rows = statement.executeQuery()) {
                    assertTrue(rows.next());
                }
            }
            connection.commit();
        }
    }

    private static String outcome(String encoded) throws Exception {
        return JSON.readTree(encoded).path("outcome").asText();
    }

    private static long scalar(String sql, Object... args) throws SQLException {
        try (Connection connection = owner(); PreparedStatement statement = connection.prepareStatement(sql)) {
            bind(statement, args);
            try (ResultSet rows = statement.executeQuery()) {
                assertTrue(rows.next());
                return rows.getLong(1);
            }
        }
    }

    private static LocalDateTime local(String sql, Object... args) throws SQLException {
        try (Connection connection = owner(); PreparedStatement statement = connection.prepareStatement(sql)) {
            bind(statement, args);
            try (ResultSet rows = statement.executeQuery()) {
                assertTrue(rows.next());
                return rows.getObject(1, LocalDateTime.class);
            }
        }
    }

    private static Instant instant(String sql, Object... args) throws SQLException {
        try (Connection connection = owner(); PreparedStatement statement = connection.prepareStatement(sql)) {
            bind(statement, args);
            try (ResultSet rows = statement.executeQuery()) {
                assertTrue(rows.next());
                return rows.getTimestamp(1).toInstant();
            }
        }
    }

    private static long discrepancies(Fixture fixture) throws SQLException {
        return scalar("SELECT count(*) FROM ledger.account_balances b JOIN ledger.accounts a ON a.id=b.account_id "
            + "WHERE a.id IN (?,?) AND (b.posted_minor<>(SELECT coalesce(sum(CASE WHEN side='CREDIT' "
            + "THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) FROM ledger.journal_entries e "
            + "WHERE e.account_id=a.id) OR b.reserved_minor<>(SELECT coalesce(sum(amount_minor),0) "
            + "FROM ledger.holds h WHERE h.account_id=a.id AND h.state='ACTIVE'))",
            fixture.source().id(), fixture.destination().id());
    }

    private static void bind(PreparedStatement statement, Object... args) throws SQLException {
        for (int index = 0; index < args.length; index++) statement.setObject(index + 1, args[index]);
    }

    private static Connection owner() throws SQLException {
        return DriverManager.getConnection(PG.getJdbcUrl(), "ledger_owner", OWNER_PASSWORD);
    }

    private static Connection runtime() throws SQLException {
        return DriverManager.getConnection(PG.getJdbcUrl(), "ledger_runtime", RUNTIME_PASSWORD);
    }
}
