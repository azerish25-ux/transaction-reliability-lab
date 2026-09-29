package lab.ledgerguard.admin;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.http.ApiException;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public final class AdminInvestigationService {
    public record TransactionRecord(UUID id, String kind, String state, UUID sourceId, String sourceRef, UUID sourceUserId,
        UUID destinationId, String destinationRef, UUID destinationUserId, UUID actorId, String amountMinor, String currency,
        UUID journalId, UUID parentId, String version, String adjustmentState, Instant createdAt, Instant updatedAt) { }
    public record JournalEntry(String id, UUID journalId, UUID accountId, String accountRef, String accountKind,
        UUID ownerId, String side, String amountMinor, String currency) { }
    public record EventLink(UUID id, String eventType, String aggregateVersion, UUID correlationId, Instant occurredAt,
        Instant publishedAt, Instant failedAt, int attempts) { }
    public record WorkLink(UUID id, UUID eventId, String consumer, String state, String failureCode, Instant updatedAt) { }
    public record PaymentContext(String refundedMinor, boolean reversed, String holdState, String projectionState,
        String projectionVersion, String failureCode) { }
    public record Detail(AdminSnapshot.Snapshot snapshot, TransactionRecord transaction, List<JournalEntry> entries,
        Page<TransactionRecord> adjustments, Page<EventLink> events, Page<WorkLink> failedWork,
        PaymentContext payment, String auditIntegrity) { }
    public record Search(AdminSnapshot.Snapshot snapshot, Page<TransactionRecord> results) { }
    public record AuditRecord(UUID aggregateId, String sequence, UUID actorId, String action, UUID operationId,
        UUID correlationId, String aggregateVersion, Instant occurredAt) { }
    public record AuditPage(AdminSnapshot.Snapshot snapshot, Page<AuditRecord> results, String integrity) { }

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    private final AdminSnapshot snapshots;
    private final String base;
    public AdminInvestigationService(JdbcTemplate jdbc, AdminSnapshot snapshots) throws IOException {
        this.jdbc = jdbc; this.named = new NamedParameterJdbcTemplate(jdbc); this.snapshots = snapshots;
        base = new ClassPathResource("sql/admin-transactions.sql").getContentAsString(StandardCharsets.UTF_8);
    }

    public Search search(Identity admin, AdminFilters filters) {
        AdminAccess.require(admin);
        return snapshots.execute(snapshot -> new Search(snapshot, transactions(filters)));
    }
    private Page<TransactionRecord> transactions(AdminFilters filter) {
        StringBuilder where = new StringBuilder(" WHERE true");
        Map<String, String> values = filter.values();
        if (values.containsKey("reference")) where.append(" AND (i.id=:reference OR i.journal_id=:reference)");
        if (values.containsKey("parentId")) where.append(" AND i.parent_id=:parentId");
        if (values.containsKey("kind")) where.append(" AND i.kind=:kind");
        if (values.containsKey("status")) where.append(" AND i.state=:status");
        if (values.containsKey("currency")) where.append(" AND i.currency=:currency");
        if (values.containsKey("account")) where.append(" AND (i.source_id::text=:account OR i.destination_id::text=:account OR i.source_ref=:account OR i.destination_ref=:account)");
        if (values.containsKey("user")) where.append(" AND EXISTS (SELECT 1 FROM ledger.app_users u WHERE (u.id=i.actor_id OR u.id=i.source_user_id OR u.id=i.destination_user_id) AND (u.id::text=:user OR u.email=:user))");
        if (values.containsKey("minAmountMinor")) where.append(" AND i.amount_minor>=:minAmountMinor");
        if (values.containsKey("maxAmountMinor")) where.append(" AND i.amount_minor<=:maxAmountMinor");
        if (values.containsKey("from")) where.append(" AND i.created_at>=:from");
        if (values.containsKey("to")) where.append(" AND i.created_at<:to");
        return Page.from(named.query(base + "SELECT i.* FROM investigation i" + where
            + " ORDER BY i.created_at DESC,i.id DESC,i.kind DESC LIMIT :limit OFFSET :offset", filter.parameters(), this::transaction),
            filter.limit(), filter.offset());
    }
    public Detail detail(Identity admin, UUID id) {
        AdminAccess.require(admin);
        return snapshots.execute(snapshot -> {
            var rows = jdbc.query(base + "SELECT * FROM investigation WHERE id=? ORDER BY kind", this::transaction, id);
            if (rows.isEmpty()) throw new ApiException(404, "NOT_FOUND");
            if (rows.size() != 1) throw new ApiException(409, "AMBIGUOUS_OPERATION_ID");
            TransactionRecord operation = rows.getFirst();
            var entries = operation.journalId() == null ? List.<JournalEntry>of() : jdbc.query("""
                SELECT e.id::text,e.journal_id,e.account_id,a.public_ref,a.kind,a.owner_id,e.side,e.amount_minor::text,e.currency
                FROM ledger.journal_entries e JOIN ledger.accounts a ON a.id=e.account_id
                WHERE e.journal_id=? ORDER BY e.id LIMIT 101
                """, (rs, n) -> new JournalEntry(rs.getString("id"), uuid(rs,"journal_id"), uuid(rs,"account_id"),
                    rs.getString("public_ref"), rs.getString("kind"), uuid(rs,"owner_id"), rs.getString("side"),
                    rs.getString("amount_minor"), rs.getString("currency")), operation.journalId());
            // Normal protected postings have exactly two entries. Never silently show a partial journal.
            if (entries.size() > 100) throw new ApiException(409, "JOURNAL_ENTRY_LIMIT");
            Page<TransactionRecord> adjustments = transactions(new AdminFilters(Map.of("parentId", id.toString()), 25, 0));
            UUID aggregate = operation.parentId() == null ? id : operation.parentId();
            var events = jdbc.query("""
                SELECT id,event_type,aggregate_version::text,correlation_id,occurred_at,published_at,failed_at,attempts
                FROM ledger.outbox_events WHERE aggregate_id=? ORDER BY aggregate_version DESC,occurred_at DESC,id DESC LIMIT 26
                """, (rs,n) -> new EventLink(uuid(rs,"id"),rs.getString("event_type"),rs.getString("aggregate_version"),
                    uuid(rs,"correlation_id"),instant(rs,"occurred_at"),instant(rs,"published_at"),instant(rs,"failed_at"),rs.getInt("attempts")), aggregate);
            var failed = jdbc.query("""
                SELECT f.id,f.event_id,f.consumer,f.state,f.failure_code,f.updated_at FROM ledger.failed_work f
                JOIN ledger.outbox_events e ON e.id=f.event_id WHERE e.aggregate_id=?
                ORDER BY f.updated_at DESC,f.id DESC LIMIT 26
                """, (rs,n) -> new WorkLink(uuid(rs,"id"),uuid(rs,"event_id"),rs.getString("consumer"),rs.getString("state"),
                    rs.getString("failure_code"),instant(rs,"updated_at")), aggregate);
            var payments = jdbc.query("""
                SELECT p.refunded_minor::text,p.reversed,h.state AS hold_state,x.state AS projection_state,
                       x.aggregate_version::text AS projection_version,p.failure_code
                FROM ledger.payments p LEFT JOIN ledger.holds h ON h.payment_id=p.id
                LEFT JOIN ledger.payment_projection x ON x.payment_id=p.id WHERE p.id=?
                """, (rs,n) -> new PaymentContext(rs.getString("refunded_minor"),rs.getBoolean("reversed"),rs.getString("hold_state"),
                    rs.getString("projection_state"),rs.getString("projection_version"),rs.getString("failure_code")), aggregate);
            return new Detail(snapshot, operation, entries, adjustments, Page.from(events,25,0), Page.from(failed,25,0),
                payments.isEmpty() ? null : payments.getFirst(), "NOT_CHECKED");
        });
    }
    public AuditPage audit(Identity admin, AdminFilters filters) {
        AdminAccess.require(admin);
        return snapshots.execute(snapshot -> {
            StringBuilder where = new StringBuilder(" WHERE true");
            Map<String,String> columns = Map.of("aggregateId","aggregate_id", "operationId","operation_id", "actorId","actor_id",
                "correlationId","correlation_id", "action","action");
            columns.forEach((key,column) -> { if (filters.values().containsKey(key)) where.append(" AND ").append(column).append("=:").append(key); });
            if (filters.values().containsKey("from")) where.append(" AND occurred_at>=:from");
            if (filters.values().containsKey("to")) where.append(" AND occurred_at<:to");
            // Explicit columns: never serialize canonical_body, credentials, free-form metadata or security-event payloads.
            var rows = named.query("SELECT aggregate_id,sequence::text,actor_id,action,operation_id,correlation_id,aggregate_version::text,occurred_at "
                + "FROM ledger.audit_records" + where + " ORDER BY occurred_at DESC,aggregate_id DESC,sequence DESC LIMIT :limit OFFSET :offset",
                filters.parameters(), (rs,n) -> new AuditRecord(uuid(rs,"aggregate_id"),rs.getString("sequence"),uuid(rs,"actor_id"),
                    rs.getString("action"),uuid(rs,"operation_id"),uuid(rs,"correlation_id"),rs.getString("aggregate_version"),instant(rs,"occurred_at")));
            return new AuditPage(snapshot, Page.from(rows,filters.limit(),filters.offset()), "NOT_CHECKED");
        });
    }
    private TransactionRecord transaction(ResultSet rs, int n) throws SQLException {
        return new TransactionRecord(uuid(rs,"id"),rs.getString("kind"),rs.getString("state"),uuid(rs,"source_id"),
            rs.getString("source_ref"),uuid(rs,"source_user_id"),uuid(rs,"destination_id"),rs.getString("destination_ref"),
            uuid(rs,"destination_user_id"),uuid(rs,"actor_id"),rs.getBigDecimal("amount_minor").toPlainString(),rs.getString("currency"),
            uuid(rs,"journal_id"),uuid(rs,"parent_id"),rs.getString("version"),rs.getString("adjustment_state"),instant(rs,"created_at"),instant(rs,"updated_at"));
    }
    static UUID uuid(ResultSet rs, String name) throws SQLException { return rs.getObject(name,UUID.class); }
    static Instant instant(ResultSet rs, String name) throws SQLException { var value=rs.getTimestamp(name); return value==null?null:value.toInstant(); }
}
