package lab.ledgerguard.payments;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.UUID;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.auth.SecurityEvents;
import lab.ledgerguard.http.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Read-only adjustment review. A single statement supplies a consistent eligibility snapshot.
 * FinancialCommands still rechecks every rule under the parent/balance locks when posting. */
@Service
public class PaymentAdjustmentQueries {
    private final JdbcTemplate jdbc;
    private final SecurityEvents events;
    public PaymentAdjustmentQueries(JdbcTemplate jdbc, SecurityEvents events) {
        this.jdbc = jdbc;
        this.events = events;
    }
    public record Context(UUID paymentId, String state, String adjustmentState, String amountMinor,
        String refundedMinor, String remainingRefundableMinor, String currency, UUID journalId,
        String version, String payerRef, String recipientRef, String recipientAvailableMinor,
        String recipientBalanceVersion, boolean canRefund, boolean canReverse,
        String refundDisabledReason, String reversalDisabledReason) { }

    public Context customer(Identity identity, UUID id) {
        requireRole(identity, "CUSTOMER");
        return query(identity, id, false);
    }
    public Context administrator(Identity identity, UUID id) {
        requireRole(identity, "ADMIN");
        return query(identity, id, true);
    }
    private void requireRole(Identity identity, String role) {
        if (identity == null || !role.equals(identity.role())) {
            events.denied(identity == null ? null : identity.userId(), "ACCESS_DENIED");
            throw new ApiException(403, "FORBIDDEN");
        }
    }
    private Context query(Identity identity, UUID id, boolean admin) {
        var rows = jdbc.query("SELECT p.id,p.state,p.amount_minor,p.refunded_minor,p.reversed,p.currency,"
            + "p.journal_id,p.version,s.public_ref AS payer_ref,d.public_ref AS recipient_ref,"
            + "d.owner_id AS recipient_owner,b.posted_minor-b.reserved_minor AS available_minor,"
            + "b.version AS balance_version FROM ledger.payments p "
            + "JOIN ledger.accounts s ON s.id=p.source_id JOIN ledger.accounts d ON d.id=p.destination_id "
            + "JOIN ledger.account_balances b ON b.account_id=d.id "
            + "WHERE p.id=? AND (? OR s.owner_id=? OR d.owner_id=?)",
            (rs, row) -> map(identity, admin, rs), id, admin, identity.userId(), identity.userId());
        if (rows.isEmpty()) {
            events.denied(identity.userId(), "ACCESS_DENIED");
            throw new ApiException(404, "NOT_FOUND");
        }
        return rows.getFirst();
    }
    private Context map(Identity identity, boolean admin, ResultSet rs) throws SQLException {
        long amount = rs.getLong("amount_minor");
        long refunded = rs.getLong("refunded_minor");
        long available = rs.getLong("available_minor");
        boolean reversed = rs.getBoolean("reversed");
        boolean settled = "SETTLED".equals(rs.getString("state"));
        boolean recipient = identity.userId().equals(rs.getObject("recipient_owner", UUID.class));
        long remaining = settled && !reversed ? Math.subtractExact(amount, refunded) : 0;
        String state = reversed ? "REVERSED" : refunded == 0 ? "NONE"
            : refunded == amount ? "FULLY_REFUNDED" : "PARTIALLY_REFUNDED";
        String refundReason = !admin && !recipient ? "RECIPIENT_OWNER_REQUIRED" : !settled ? "NOT_SETTLED"
            : reversed ? "PAYMENT_REVERSED" : remaining == 0 ? "FULLY_REFUNDED"
            : available <= 0 ? "INSUFFICIENT_FUNDS" : null;
        String reversalReason = !admin ? "ADMIN_REQUIRED" : !settled ? "NOT_SETTLED"
            : reversed ? "PAYMENT_REVERSED" : refunded != 0 ? "PRIOR_REFUND"
            : available < amount ? "INSUFFICIENT_FUNDS" : null;
        // A payer's ability to inspect the payment never reveals the recipient's unrelated balance.
        return new Context(rs.getObject("id", UUID.class), rs.getString("state"), state,
            Long.toString(amount), Long.toString(refunded), Long.toString(remaining), rs.getString("currency"),
            rs.getObject("journal_id", UUID.class), Long.toString(rs.getLong("version")),
            rs.getString("payer_ref"), rs.getString("recipient_ref"),
            admin || recipient ? Long.toString(available) : null,
            admin || recipient ? Long.toString(rs.getLong("balance_version")) : null,
            refundReason == null, reversalReason == null, refundReason, reversalReason);
    }
}
