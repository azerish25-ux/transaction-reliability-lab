package lab.ledgerguard.schedules;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.UUID;
import javax.sql.DataSource;
import lab.ledgerguard.core.Idempotency;
import lab.ledgerguard.core.SqlRetry;

/** Restricted JDBC adapter for the P07A security-definer schedule boundary. */
public final class ScheduleCommands {
    private static final System.Logger LOG = System.getLogger(ScheduleCommands.class.getName());

    public record Result(int status, String json, boolean replayed) { }

    private final DataSource dataSource;

    public ScheduleCommands(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public Result execute(UUID actor, String command, UUID parent, String key,
                          String normalizedJson, UUID correlation) throws Exception {
        Idempotency.key(key);
        return SqlRetry.wholeTransaction(
            () -> executeOnce(actor, command, parent, key, normalizedJson, correlation),
            attempt -> LOG.log(System.Logger.Level.WARNING,
                "schedule_transaction_retry command={0} attempt={1}", command, attempt));
    }

    public String executeOccurrence(UUID scheduleId, long expectedVersion,
                                    LocalDateTime expectedLocal, Instant expectedDue,
                                    Instant now, LocalDateTime nextLocal, Instant nextDue,
                                    UUID correlation) throws Exception {
        return SqlRetry.wholeTransaction(
            () -> executeOccurrenceOnce(scheduleId, expectedVersion, expectedLocal,
                expectedDue, now, nextLocal, nextDue, correlation),
            attempt -> LOG.log(System.Logger.Level.WARNING,
                "schedule_occurrence_retry scheduleId={0} attempt={1}", scheduleId, attempt));
    }

    private Result executeOnce(UUID actor, String command, UUID parent, String key,
                               String normalizedJson, UUID correlation) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            boolean commitStarted = false;
            try {
                configureTransaction(connection);
                Result response;
                try (PreparedStatement statement = connection.prepareStatement(
                        "SELECT http_status,body::text,replayed "
                            + "FROM ledger.execute_schedule_command(?,?,?,?,?::jsonb,?)")) {
                    statement.setObject(1, actor);
                    statement.setString(2, command);
                    statement.setObject(3, parent);
                    statement.setString(4, key);
                    statement.setString(5, normalizedJson);
                    statement.setObject(6, correlation);
                    try (ResultSet rows = statement.executeQuery()) {
                        if (!rows.next()) {
                            throw new SQLException("Missing durable schedule outcome", "XX000");
                        }
                        response = new Result(rows.getInt(1), rows.getString(2), rows.getBoolean(3));
                    }
                }
                commitStarted = true;
                connection.commit();
                return response;
            } catch (SQLException failure) {
                rollback(connection, failure);
                throw classifyUnknownCommit(commitStarted, failure);
            }
        }
    }

    private String executeOccurrenceOnce(UUID scheduleId, long expectedVersion,
                                         LocalDateTime expectedLocal, Instant expectedDue,
                                         Instant now, LocalDateTime nextLocal, Instant nextDue,
                                         UUID correlation) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            boolean commitStarted = false;
            try {
                configureTransaction(connection);
                String response;
                try (PreparedStatement statement = connection.prepareStatement(
                        "SELECT ledger.execute_schedule_occurrence(?,?,?,?,?,?,?,?)::text")) {
                    statement.setObject(1, scheduleId);
                    statement.setLong(2, expectedVersion);
                    statement.setObject(3, expectedLocal);
                    statement.setTimestamp(4, Timestamp.from(expectedDue));
                    statement.setTimestamp(5, Timestamp.from(now));
                    if (nextLocal == null) statement.setNull(6, Types.TIMESTAMP);
                    else statement.setObject(6, nextLocal);
                    if (nextDue == null) statement.setNull(7, Types.TIMESTAMP_WITH_TIMEZONE);
                    else statement.setTimestamp(7, Timestamp.from(nextDue));
                    statement.setObject(8, correlation);
                    try (ResultSet rows = statement.executeQuery()) {
                        if (!rows.next()) {
                            throw new SQLException("Missing schedule occurrence outcome", "XX000");
                        }
                        response = rows.getString(1);
                    }
                }
                commitStarted = true;
                connection.commit();
                return response;
            } catch (SQLException failure) {
                rollback(connection, failure);
                throw classifyUnknownCommit(commitStarted, failure);
            }
        }
    }

    private static void configureTransaction(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute("SET LOCAL lock_timeout='2s'");
            statement.execute("SET LOCAL statement_timeout='5s'");
        }
    }

    private static void rollback(Connection connection, SQLException failure) {
        try {
            connection.rollback();
        } catch (SQLException rollback) {
            failure.addSuppressed(rollback);
        }
    }

    private static SQLException classifyUnknownCommit(boolean commitStarted, SQLException failure) {
        if (commitStarted && !SqlRetry.retryable(failure)
                && failure.getSQLState() != null && failure.getSQLState().startsWith("08")) {
            return new SQLException(
                "Schedule commit outcome unknown; resolve through durable state before retrying",
                "08007", failure);
        }
        return failure;
    }
}
