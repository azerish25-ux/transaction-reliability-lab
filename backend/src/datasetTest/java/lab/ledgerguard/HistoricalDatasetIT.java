package lab.ledgerguard;

import java.nio.file.*;
import java.sql.*;
import java.util.UUID;
import java.util.Map;
import java.util.TreeMap;
import java.util.ArrayList;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.MountableFile;
import static org.junit.jupiter.api.Assertions.*;

/** Real protected fixture posting and independent SQL reconciliation; not a load benchmark. */
@Testcontainers
class HistoricalDatasetIT {
    @Container static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:17.11-bookworm")
        .withDatabaseName("ledgerguard_performance").withUsername("postgres").withPassword(UUID.randomUUID().toString())
        .withEnv("LEDGER_PERF_PASSWORD", "Synthetic-" + UUID.randomUUID());

    @Test void referenceMinimumPostsAndReconcilesOnFreshDatabase() throws Exception {
        Path input = Path.of("../.evidence/performance-history/history.sql");
        assertTrue(Files.isRegularFile(input), "Generate the reference dataset SQL first");
        String owner = UUID.randomUUID().toString(), runtime = UUID.randomUUID().toString();
        try (Connection c = DriverManager.getConnection(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword()); Statement s = c.createStatement()) {
            s.execute("CREATE ROLE ledger_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" + owner + "'");
            s.execute("CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" + runtime + "'");
            s.execute("GRANT CREATE ON DATABASE ledgerguard_performance TO ledger_owner");
            s.execute("GRANT USAGE,CREATE ON SCHEMA public TO ledger_owner");
        }
        Flyway.configure().dataSource(PG.getJdbcUrl(), "ledger_owner", owner).locations("classpath:db/migration").load().migrate();
        PG.copyFileToContainer(MountableFile.forHostPath(input), "/tmp/history.sql");
        PG.copyFileToContainer(MountableFile.forHostPath(Path.of("../tests/database/reconcile.sql")), "/tmp/reconcile.sql");
        var loaded = PG.execInContainer("psql", "-X", "-U", "ledger_owner", "-d", "ledgerguard_performance", "-v", "ON_ERROR_STOP=1", "-f", "/tmp/history.sql");
        assertEquals(0, loaded.getExitCode(), () -> "Fixture load failed: " + loaded.getStderr());
        var reconciled = PG.execInContainer("psql", "-X", "-U", "ledger_owner", "-d", "ledgerguard_performance", "-v", "ON_ERROR_STOP=1", "-f", "/tmp/reconcile.sql");
        assertEquals(0, reconciled.getExitCode(), () -> "Reconciliation failed: " + reconciled.getStderr());
        assertTrue(reconciled.getStdout().contains("RECONCILIATION_PASS discrepancies=0"));
        try (Connection c = DriverManager.getConnection(PG.getJdbcUrl(), "ledger_owner", owner); Statement s = c.createStatement()) {
            try (ResultSet r = s.executeQuery("SELECT (SELECT count(*) FROM ledger.app_users),(SELECT count(*) FROM ledger.accounts WHERE kind='WALLET_LIABILITY'),(SELECT count(*) FROM ledger.journals),(SELECT count(*) FROM ledger.idempotency_records)")) {
                assertTrue(r.next()); assertEquals(100, r.getLong(1)); assertEquals(200, r.getLong(2));
                assertEquals(100000, r.getLong(3)); assertEquals(99800, r.getLong(4));
            }
        }
        // A second application must fail before changing the existing dataset.
        var repeated = PG.execInContainer("psql", "-X", "-U", "ledger_owner", "-d", "ledgerguard_performance", "-v", "ON_ERROR_STOP=1", "-f", "/tmp/history.sql");
        assertNotEquals(0, repeated.getExitCode()); assertTrue(repeated.getStderr().contains("FRESH_DATABASE_REQUIRED"));
        // Disposable backup/restore: the archive never leaves this test container.
        Map<String, String> before = fingerprints(PG.getJdbcUrl(), owner);
        assertAuditChain(PG.getJdbcUrl(), owner);
        var backup = PG.execInContainer("pg_dump", "-U", "ledger_owner", "-d", "ledgerguard_performance", "-Fc", "-f", "/tmp/history.dump");
        assertEquals(0, backup.getExitCode(), "Disposable backup must succeed");
        var create = PG.execInContainer("createdb", "-U", "postgres", "-O", "ledger_owner", "ledgerguard_restore");
        assertEquals(0, create.getExitCode(), "Restore requires a fresh disposable database");
        var restore = PG.execInContainer("pg_restore", "-U", "postgres", "--exit-on-error", "-d", "ledgerguard_restore", "/tmp/history.dump");
        assertEquals(0, restore.getExitCode(), () -> "Restore failed: " + restore.getStderr());
        String restoredUrl = PG.getJdbcUrl().replace("/ledgerguard_performance", "/ledgerguard_restore");
        assertEquals(before, fingerprints(restoredUrl, owner), "Every ledger-table row must survive the restore unchanged");
        assertAuditChain(restoredUrl, owner);
        var restoredReconciliation = PG.execInContainer("psql", "-X", "-U", "ledger_owner", "-d", "ledgerguard_restore", "-v", "ON_ERROR_STOP=1", "-f", "/tmp/reconcile.sql");
        assertEquals(0, restoredReconciliation.getExitCode());
        assertTrue(restoredReconciliation.getStdout().contains("RECONCILIATION_PASS discrepancies=0"));
        try (Connection c = DriverManager.getConnection(restoredUrl, "ledger_owner", owner); Statement st = c.createStatement()) {
            try (ResultSet replay = st.executeQuery("SELECT * FROM ledger.execute_command((SELECT owner_id FROM ledger.accounts WHERE label='Synthetic wallet 0'),'TRANSFER',NULL,'perf-history-0000000000',jsonb_build_object('sourceId',(SELECT id FROM ledger.accounts WHERE label='Synthetic wallet 0'),'recipientRef',(SELECT public_ref FROM ledger.accounts WHERE label='Synthetic wallet 1'),'amountMinor','1','currency','CAD'),gen_random_uuid())")) {
                assertTrue(replay.next()); assertEquals(201, replay.getInt("http_status")); assertTrue(replay.getBoolean("replayed"));
            }
        }
        assertEquals(before, fingerprints(restoredUrl, owner), "Old-key replay must leave restored financial history unchanged");
        Path evidence = Path.of("target/dataset-evidence"); Files.createDirectories(evidence);
        Files.writeString(evidence.resolve("summary.json"), """
            {"scope":"reference-history fixture, not measured load performance","customers":100,"walletAccounts":200,
            "journals":100000,"protectedTransfers":99800,"reconciliation":"PASS","repeatLoad":"REJECTED","backupRestore":"PASS","allLedgerTableFingerprints":"UNCHANGED","auditChains":"PASS","oldKeyReplay":"PASS"}
            """);
    }
    static Map<String, String> fingerprints(String url, String password) throws Exception {
        Map<String, String> result = new TreeMap<>();
        try (Connection c = DriverManager.getConnection(url, "ledger_owner", password); Statement s = c.createStatement()) {
            var tables = new ArrayList<String>();
            try (ResultSet names = s.executeQuery("SELECT tablename FROM pg_tables WHERE schemaname='ledger' ORDER BY tablename")) {
                while (names.next()) tables.add(names.getString(1));
            }
            assertFalse(tables.isEmpty());
            for (String table : tables) {
                String quoted = "\"" + table.replace("\"", "\"\"") + "\"";
                try (ResultSet r = s.executeQuery("SELECT count(*)::text || ':' || coalesce(encode(extensions.digest(string_agg(row_text, E'\\n' ORDER BY row_text),'sha256'),'hex'),'empty') FROM (SELECT to_jsonb(t)::text AS row_text FROM ledger." + quoted + " t) rows")) {
                    assertTrue(r.next()); result.put(table, r.getString(1));
                }
            }
        }
        return result;
    }
    static void assertAuditChain(String url, String password) throws Exception {
        try (Connection c = DriverManager.getConnection(url, "ledger_owner", password); Statement s = c.createStatement(); ResultSet r = s.executeQuery("""
            SELECT count(*) FROM (
              SELECT *,lag(hash,1,repeat('0',64)) OVER (PARTITION BY aggregate_id ORDER BY sequence) AS preceding,
                row_number() OVER (PARTITION BY aggregate_id ORDER BY sequence) AS ordinal
              FROM ledger.audit_records
            ) a WHERE previous_hash<>preceding OR sequence<>ordinal OR
              hash<>encode(extensions.digest(decode(previous_hash,'hex')||convert_to(canonical_body,'UTF8'),'sha256'),'hex')
            """)) {
            assertTrue(r.next()); assertEquals(0, r.getLong(1), "Audit sequence and hash chains must reconcile");
        }
    }

}
