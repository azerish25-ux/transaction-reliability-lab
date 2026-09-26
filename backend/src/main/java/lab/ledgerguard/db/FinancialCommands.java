package lab.ledgerguard.db;

import lab.ledgerguard.core.Idempotency;
import lab.ledgerguard.core.SqlRetry;
import javax.sql.DataSource;
import java.sql.*;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** JDBC adapter: every retry obtains a NEW connection/transaction. PostgreSQL remains spending authority. */
public final class FinancialCommands {
    private static final Logger LOG = LoggerFactory.getLogger(FinancialCommands.class);
    public record Result(int status, String json, boolean replayed) { }
    private final DataSource dataSource;
    public FinancialCommands(DataSource dataSource) { this.dataSource = dataSource; }
    public Result execute(UUID actor, String operation, UUID parent, String key, String normalizedJson, UUID correlation) throws Exception {
        Idempotency.key(key);
        return SqlRetry.wholeTransaction(() -> executeOnce(actor, operation, parent, key, normalizedJson, correlation),
            attempt -> LOG.warn("financial_transaction_retry operation={} attempt={}", operation, attempt));
    }
    private Result executeOnce(UUID actor, String operation, UUID parent, String key, String json, UUID correlation) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            boolean commitStarted = false;
            try {
                try (Statement statement = c.createStatement()) {
                    statement.execute("SET LOCAL lock_timeout='2s'");
                    statement.execute("SET LOCAL statement_timeout='5s'");
                }
                Result response;
                try (PreparedStatement statement = c.prepareStatement("SELECT http_status,body::text,replayed FROM ledger.execute_command(?,?,?,?,?::jsonb,?)")) {
                    statement.setObject(1,actor); statement.setString(2,operation); statement.setObject(3,parent);
                    statement.setString(4,key); statement.setString(5,json); statement.setObject(6,correlation);
                    try (ResultSet rows = statement.executeQuery()) {
                        if (!rows.next()) throw new SQLException("Missing durable command outcome", "XX000");
                        response = new Result(rows.getInt(1), rows.getString(2), rows.getBoolean(3));
                    }
                }
                commitStarted = true;
                c.commit();
                return response;
            } catch (SQLException e) {
                try { c.rollback(); } catch (SQLException rollback) { e.addSuppressed(rollback); }
                if (commitStarted && !SqlRetry.retryable(e) && e.getSQLState() != null && e.getSQLState().startsWith("08"))
                    throw new SQLException("Commit outcome unknown; resolve/replay the SAME idempotency key", "08007", e);
                throw e;
            }
        }
    }
    public String settle(UUID event, UUID payment, UUID correlation) throws Exception {
        return SqlRetry.wholeTransaction(() -> {
            try (Connection c = dataSource.getConnection()) {
                c.setAutoCommit(false);
                try {
                    String state;
                    try (Statement timeout = c.createStatement()) {
                        timeout.execute("SET LOCAL lock_timeout='2s'");
                        timeout.execute("SET LOCAL statement_timeout='5s'");
                    }
                    try (PreparedStatement statement = c.prepareStatement("SELECT ledger.settle_event(?,?,?)")) {
                        statement.setObject(1,event); statement.setObject(2,payment); statement.setObject(3,correlation);
                        try(ResultSet rows=statement.executeQuery()) { rows.next(); state=rows.getString(1); }
                    }
                    c.commit();
                    return state;
                } catch(SQLException e) {
                    try { c.rollback(); } catch(SQLException rollback) { e.addSuppressed(rollback); }
                    throw e;
                }
            }
        }, attempt -> LOG.warn("financial_transaction_retry operation=SETTLE attempt={}", attempt));
    }
}
