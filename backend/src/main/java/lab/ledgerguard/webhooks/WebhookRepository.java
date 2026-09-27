package lab.ledgerguard.webhooks;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@ConditionalOnProperty(name = "ledgerguard.webhooks.enabled", havingValue = "true")
public class WebhookRepository {
    public record Endpoint(UUID id, UUID ownerId, String destinationId, String destinationUrl,
                           boolean enabled, long version, Instant createdAt, Instant updatedAt,
                           Instant rotatedAt) { }
    public record Delivery(UUID id, UUID endpointId, UUID ownerId, String destinationId, UUID eventId,
                           String eventType, String state, int cycle, int attempts, int totalAttempts,
                           Instant nextAttemptAt, Instant createdAt, Instant updatedAt,
                           Instant deliveredAt, String lastError) { }
    public record Attempt(int cycle, int attempt, Instant attemptedAt, Long requestTimestamp,
                          Integer secretKeyVersion, Integer httpStatus, String outcome, int durationMs,
                          String errorCode, String responseSummary, Instant nextAttemptAt) { }
    public record Claimed(UUID deliveryId, UUID endpointId, UUID eventId, String eventType,
                          UUID correlationId, byte[] payload, int cycle, int attempt,
                          Instant cycleStartedAt, Instant maxAgeAt, String destinationUrl,
                          int secretKeyVersion, String encryptedSecret) { }

    private final JdbcTemplate jdbc;

    public WebhookRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public UUID createEndpoint(UUID actor, UUID endpoint, String destinationId, String destinationUrl,
                               String encryptedSecret, UUID correlation) {
        return jdbc.queryForObject("SELECT ledger.create_webhook_endpoint(?,?,?,?,?,?)", UUID.class,
            actor, endpoint, destinationId, destinationUrl, encryptedSecret, correlation);
    }

    public long setEndpoint(UUID actor, UUID endpoint, boolean enabled, long expectedVersion, UUID correlation) {
        Long version = jdbc.queryForObject("SELECT ledger.set_webhook_endpoint(?,?,?,?,?)", Long.class,
            actor, endpoint, enabled, expectedVersion, correlation);
        return version == null ? 0 : version;
    }

    public long rotateEndpoint(UUID actor, UUID endpoint, String encryptedSecret, long expectedVersion,
                               UUID correlation) {
        Long version = jdbc.queryForObject("SELECT ledger.rotate_webhook_endpoint(?,?,?,?,?)", Long.class,
            actor, endpoint, encryptedSecret, expectedVersion, correlation);
        return version == null ? 0 : version;
    }

    public Endpoint endpoint(UUID actor, UUID endpoint) {
        List<Endpoint> rows = jdbc.query(endpointSelect() + " WHERE e.id=? AND e.owner_id=?", this::endpointRow,
            endpoint, actor);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Page<Endpoint> endpoints(UUID actor, int limit, int offset) {
        Page.validate(limit, offset);
        return Page.from(jdbc.query(endpointSelect()
            + " WHERE e.owner_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?",
            this::endpointRow, actor, limit + 1, offset), limit, offset);
    }

    public Delivery deliveryForOwner(UUID actor, UUID delivery) {
        List<Delivery> rows = jdbc.query(deliverySelect()
            + " WHERE d.id=? AND e.owner_id=?", this::deliveryRow, delivery, actor);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Delivery deliveryForAdmin(UUID delivery) {
        List<Delivery> rows = jdbc.query(deliverySelect() + " WHERE d.id=?", this::deliveryRow, delivery);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Page<Delivery> deliveriesForEndpoint(UUID actor, UUID endpoint, int limit, int offset) {
        Page.validate(limit, offset);
        return Page.from(jdbc.query(deliverySelect()
            + " WHERE d.endpoint_id=? AND e.owner_id=? ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?",
            this::deliveryRow, endpoint, actor, limit + 1, offset), limit, offset);
    }

    public Page<Delivery> deliveriesForAdmin(String state, int limit, int offset) {
        Page.validate(limit, offset);
        String filter = state == null || state.isBlank() ? "" : " WHERE d.state=?";
        List<Delivery> rows = filter.isEmpty()
            ? jdbc.query(deliverySelect() + " ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?",
                this::deliveryRow, limit + 1, offset)
            : jdbc.query(deliverySelect() + filter + " ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?",
                this::deliveryRow, state, limit + 1, offset);
        return Page.from(rows, limit, offset);
    }

    public List<Attempt> attempts(UUID delivery) {
        return jdbc.query("SELECT cycle,attempt,attempted_at,request_timestamp,secret_key_version,http_status,"
            + "outcome,duration_ms,error_code,response_summary,next_attempt_at "
            + "FROM ledger.webhook_attempts WHERE delivery_id=? "
            + "ORDER BY cycle,attempt", this::attemptRow, delivery);
    }

    public void requestRetry(UUID actor, UUID delivery, String reason, UUID correlation) {
        jdbc.query("SELECT ledger.request_webhook_retry(?,?,?,?)", ignored -> null,
            actor, delivery, reason, correlation);
    }

    public int fanOut(int limit) {
        Integer created = jdbc.queryForObject("SELECT ledger.fanout_webhook_deliveries(?)", Integer.class, limit);
        return created == null ? 0 : created;
    }

    public List<Claimed> claim(UUID owner, int limit, Duration lease) {
        return jdbc.query("SELECT * FROM ledger.claim_webhook_deliveries(?,?,?)", this::claimedRow,
            owner, limit, Math.toIntExact(lease.toSeconds()));
    }

    public void complete(UUID delivery, UUID owner, String outcome, Integer httpStatus, int durationMs,
                         long requestTimestamp, String signature, String responseSummary,
                         String errorCode, Instant nextAttemptAt) {
        Timestamp nextAttempt = nextAttemptAt == null ? null : Timestamp.from(nextAttemptAt);
        jdbc.query("SELECT ledger.complete_webhook_delivery(?,?,?,?,?,?,?,?,?,?)", ignored -> null,
            delivery, owner, outcome, httpStatus, durationMs, requestTimestamp, signature,
            responseSummary, errorCode, nextAttempt);
    }

    public String receiverSecret(UUID endpoint, UUID event, int keyVersion) {
        return jdbc.queryForObject("SELECT ledger.get_webhook_receiver_secret(?,?,?)", String.class,
            endpoint, event, keyVersion);
    }

    public boolean recordReceipt(UUID endpoint, UUID event, String payloadHash, String signature,
                                 long requestTimestamp) {
        Boolean first = jdbc.queryForObject("SELECT ledger.record_webhook_receipt(?,?,?,?,?)", Boolean.class,
            endpoint, event, payloadHash, signature, requestTimestamp);
        return Boolean.TRUE.equals(first);
    }

    public String receiverMode() {
        String mode = jdbc.queryForObject("SELECT mode FROM ledger.webhook_receiver_control WHERE singleton",
            String.class);
        return mode == null ? "NORMAL" : mode;
    }

    private Endpoint endpointRow(ResultSet rows, int ignored) throws SQLException {
        return new Endpoint(rows.getObject("id", UUID.class), rows.getObject("owner_id", UUID.class),
            rows.getString("destination_id"), rows.getString("destination_url"), rows.getBoolean("enabled"),
            rows.getLong("version"), instant(rows, "created_at"), instant(rows, "updated_at"),
            instant(rows, "rotated_at"));
    }

    private Delivery deliveryRow(ResultSet rows, int ignored) throws SQLException {
        return new Delivery(rows.getObject("id", UUID.class), rows.getObject("endpoint_id", UUID.class),
            rows.getObject("owner_id", UUID.class), rows.getString("destination_id"),
            rows.getObject("event_id", UUID.class), rows.getString("event_type"), rows.getString("state"),
            rows.getInt("cycle"), rows.getInt("attempts"), rows.getInt("total_attempts"),
            instant(rows, "next_attempt_at"), instant(rows, "created_at"), instant(rows, "updated_at"),
            instant(rows, "delivered_at"), rows.getString("last_error"));
    }

    private Attempt attemptRow(ResultSet rows, int ignored) throws SQLException {
        Number timestamp = (Number) rows.getObject("request_timestamp");
        return new Attempt(rows.getInt("cycle"), rows.getInt("attempt"), instant(rows, "attempted_at"),
            timestamp == null ? null : timestamp.longValue(), (Integer) rows.getObject("secret_key_version"),
            (Integer) rows.getObject("http_status"), rows.getString("outcome"),
            rows.getInt("duration_ms"), rows.getString("error_code"),
            rows.getString("response_summary"), instant(rows, "next_attempt_at"));
    }

    private Claimed claimedRow(ResultSet rows, int ignored) throws SQLException {
        return new Claimed(rows.getObject("delivery_id", UUID.class), rows.getObject("endpoint_id", UUID.class),
            rows.getObject("event_id", UUID.class), rows.getString("event_type"),
            rows.getObject("correlation_id", UUID.class), rows.getBytes("payload"), rows.getInt("cycle"),
            rows.getInt("attempt"), instant(rows, "cycle_started_at"), instant(rows, "max_age_at"),
            rows.getString("destination_url"), rows.getInt("secret_key_version"),
            rows.getString("encrypted_secret"));
    }

    private static Instant instant(ResultSet rows, String column) throws SQLException {
        var value = rows.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static String endpointSelect() {
        return "SELECT e.id,e.owner_id,e.destination_id,e.destination_url,e.enabled,e.version,"
            + "e.created_at,e.updated_at,e.rotated_at FROM ledger.webhook_endpoints e";
    }

    private static String deliverySelect() {
        return "SELECT d.id,d.endpoint_id,e.owner_id,e.destination_id,d.event_id,d.event_type,d.state,"
            + "d.cycle,d.attempts,"
            + "(SELECT count(*) FROM ledger.webhook_attempts a WHERE a.delivery_id=d.id) AS total_attempts,"
            + "d.next_attempt_at,d.created_at,d.updated_at,d.delivered_at,d.last_error "
            + "FROM ledger.webhook_deliveries d JOIN ledger.webhook_endpoints e ON e.id=d.endpoint_id";
    }
}
