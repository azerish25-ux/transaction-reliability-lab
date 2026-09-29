package lab.ledgerguard.admin;

import java.time.Instant;
import java.util.Objects;
import java.util.function.Function;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** A separate bounded, database-enforced READ ONLY snapshot, never a money-changing transaction. */
@Component
public final class AdminSnapshot {
    public record Snapshot(Instant capturedAt, String snapshotId, String isolation, boolean readOnly) { }
    private final JdbcTemplate jdbc;
    private final TransactionTemplate read;
    public AdminSnapshot(JdbcTemplate jdbc, PlatformTransactionManager manager) {
        this.jdbc = jdbc;
        read = new TransactionTemplate(manager);
        read.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        read.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        read.setReadOnly(true);
        read.setTimeout(12);
    }
    public <T> T execute(Function<Snapshot, T> work) {
        return Objects.requireNonNull(read.execute(status -> {
            jdbc.execute("SET TRANSACTION READ ONLY");
            jdbc.execute("SET LOCAL statement_timeout = '8s'");
            jdbc.execute("SET LOCAL lock_timeout = '2s'");
            Snapshot snapshot = jdbc.queryForObject("SELECT clock_timestamp(), txid_current_snapshot()::text, "
                + "current_setting('transaction_isolation'), current_setting('transaction_read_only')", (rs, n) ->
                new Snapshot(rs.getTimestamp(1).toInstant(), rs.getString(2), rs.getString(3), "on".equals(rs.getString(4))));
            if (snapshot == null || !snapshot.readOnly() || !"repeatable read".equals(snapshot.isolation()))
                throw new IllegalStateException("Administrator snapshot contract not active");
            return work.apply(snapshot);
        }));
    }
}
