package lab.ledgerguard.payments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigInteger;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.auth.Inputs;
import lab.ledgerguard.auth.SecurityEvents;
import lab.ledgerguard.core.DomainFailure;
import lab.ledgerguard.core.Idempotency;
import lab.ledgerguard.db.FinancialCommands;
import lab.ledgerguard.http.ApiException;
import lab.ledgerguard.http.ApiProblems;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class PaymentService {
    private static final BigInteger MAX_AMOUNT = new BigInteger("1000000000000");
    private final FinancialCommands commands;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final SecurityEvents events;

    public PaymentService(FinancialCommands commands, JdbcTemplate jdbc, ObjectMapper json, SecurityEvents events) {
        this.commands = commands;
        this.jdbc = jdbc;
        this.json = json;
        this.events = events;
    }

    public record CreatePayment(String sourceId, String recipientRef, String amountMinor, String currency) { }
    public record CancelPayment(String reason) { }
    public record RefundPayment(String amountMinor, String reason) { }
    public record ReversePayment(String reason) { }
    public record Payment(UUID id, String direction, UUID accountId, String counterpartyRef,
                          String amountMinor, String currency, String state, String version,
                          String adjustmentState, UUID journalId, String failureCode,
                          String projectionState, String projectionVersion,
                          Instant createdAt, Instant updatedAt) { }
    public record Adjustment(UUID id, UUID paymentId, String kind, String amountMinor, String currency,
                             UUID journalId, String reason, Instant createdAt) { }
    public record CommandResult(int status, JsonNode body, boolean replayed, UUID resourceId) { }
    private record Normalized(UUID sourceId, String recipientRef, String amountMinor, String currency) { }
    private record Authority(UUID payerId, UUID recipientOwnerId) { }

    public CommandResult create(Identity identity, String idempotencyKey, CreatePayment request) {
        String key = key(idempotencyKey);
        Normalized intent = normalize(request);
        ObjectNode payload = json.createObjectNode();
        payload.put("sourceId", intent.sourceId().toString());
        payload.put("recipientRef", intent.recipientRef());
        payload.put("amountMinor", intent.amountMinor());
        payload.put("currency", intent.currency());
        FinancialCommands.Result result = execute(identity, "PAYMENT", null, key, payload);
        JsonNode body = body(result);
        UUID paymentId = null;
        if (result.status() < 300) {
            paymentId = uuid(body, "id");
            if (result.status() != 202 || !"PAYMENT".equals(body.path("kind").asText())
                || !"PENDING".equals(body.path("state").asText())
                || !intent.amountMinor().equals(body.path("amountMinor").asText())
                || !intent.currency().equals(body.path("currency").asText())) {
                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
            }
        } else {
            requireRejection(body);
        }
        return new CommandResult(result.status(), body, result.replayed(), paymentId);
    }

    public CommandResult cancel(Identity identity, UUID paymentId, String idempotencyKey, CancelPayment request) {
        authorize(identity, paymentId, "CANCEL");
        ObjectNode payload = json.createObjectNode();
        putOptionalReason(payload, request == null ? null : request.reason());
        FinancialCommands.Result result = execute(identity, "CANCEL", paymentId, key(idempotencyKey), payload);
        JsonNode body = body(result);
        if (result.status() < 300) {
            if (result.status() != 200 || !paymentId.equals(uuid(body, "id"))
                || !"CANCELLED".equals(body.path("state").asText())) {
                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
            }
        } else {
            requireRejection(body);
        }
        return new CommandResult(result.status(), body, result.replayed(), paymentId);
    }

    public CommandResult refund(Identity identity, UUID paymentId, String idempotencyKey, RefundPayment request) {
        authorize(identity, paymentId, "REFUND");
        if (request == null) throw new ApiException(400, "INVALID_REFUND");
        String amount = amount(request.amountMinor());
        ObjectNode payload = json.createObjectNode();
        payload.put("amountMinor", amount);
        putOptionalReason(payload, request.reason());
        FinancialCommands.Result result = execute(identity, "REFUND", paymentId, key(idempotencyKey), payload);
        JsonNode body = body(result);
        UUID adjustmentId = null;
        if (result.status() < 300) {
            adjustmentId = validateAdjustment(body, result.status(), paymentId, "REFUND", amount);
        } else {
            requireRejection(body);
        }
        return new CommandResult(result.status(), body, result.replayed(), adjustmentId);
    }

    public CommandResult reverse(Identity identity, UUID paymentId, String idempotencyKey, ReversePayment request) {
        authorize(identity, paymentId, "REVERSAL");
        if (request == null) throw new ApiException(400, "INVALID_REVERSAL");
        String reason = requiredReason(request.reason());
        ObjectNode payload = json.createObjectNode();
        payload.put("reason", reason);
        FinancialCommands.Result result = execute(identity, "REVERSAL", paymentId, key(idempotencyKey), payload);
        JsonNode body = body(result);
        UUID adjustmentId = null;
        if (result.status() < 300) {
            adjustmentId = validateAdjustment(body, result.status(), paymentId, "REVERSAL", null);
        } else {
            requireRejection(body);
        }
        return new CommandResult(result.status(), body, result.replayed(), adjustmentId);
    }

    public Payment get(Identity identity, UUID id) {
        var rows = jdbc.query(selectPayment() + " WHERE p.id=? AND (s.owner_id=? OR d.owner_id=?)",
            (rs, row) -> paymentRow(identity.userId(), rs), id, identity.userId(), identity.userId());
        if (rows.isEmpty()) {
            denied(identity);
            throw new ApiException(404, "NOT_FOUND");
        }
        return rows.getFirst();
    }

    public Page<Payment> list(Identity identity, int limit, int offset) {
        Page.validate(limit, offset);
        return Page.from(jdbc.query(selectPayment()
            + " WHERE s.owner_id=? OR d.owner_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?",
            (rs, row) -> paymentRow(identity.userId(), rs), identity.userId(), identity.userId(), limit + 1, offset),
            limit, offset);
    }

    public Adjustment getAdjustment(Identity identity, UUID paymentId, UUID adjustmentId) {
        ensureVisible(identity, paymentId, true);
        var rows = jdbc.query(selectAdjustment()
            + " WHERE a.payment_id=? AND a.id=?", this::adjustmentRow, paymentId, adjustmentId);
        if (rows.isEmpty()) throw new ApiException(404, "NOT_FOUND");
        return rows.getFirst();
    }

    public Page<Adjustment> listAdjustments(Identity identity, UUID paymentId, int limit, int offset) {
        Page.validate(limit, offset);
        ensureVisible(identity, paymentId, true);
        return Page.from(jdbc.query(selectAdjustment()
            + " WHERE a.payment_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?",
            this::adjustmentRow, paymentId, limit + 1, offset), limit, offset);
    }

    private FinancialCommands.Result execute(Identity identity, String operation, UUID parent,
                                               String key, ObjectNode payload) {
        try {
            return commands.execute(identity.userId(), operation, parent, key,
                json.writeValueAsString(payload), ApiProblems.correlation());
        } catch (ApiException failure) {
            throw failure;
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            throw publicFailure(failure);
        }
    }

    private JsonNode body(FinancialCommands.Result result) {
        try {
            JsonNode body = json.readTree(result.json());
            if (body == null || !body.isObject() || result.status() < 200 || result.status() > 599) {
                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
            }
            return body;
        } catch (ApiException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
        }
    }

    private static UUID validateAdjustment(JsonNode body, int status, UUID paymentId,
                                           String expectedKind, String expectedAmount) {
        UUID adjustmentId = uuid(body, "id");
        if (status != 201 || !paymentId.equals(uuid(body, "paymentId"))
            || !expectedKind.equals(body.path("kind").asText())
            || body.path("currency").asText().isBlank()
            || body.path("journalId").asText().isBlank()) {
            throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
        }
        uuid(body, "journalId");
        if (expectedAmount != null && !expectedAmount.equals(body.path("amountMinor").asText())) {
            throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
        }
        return adjustmentId;
    }

    private void authorize(Identity identity, UUID paymentId, String operation) {
        boolean admin = "ADMIN".equals(identity.role());
        if ("REVERSAL".equals(operation) && !admin) {
            denied(identity);
            throw new ApiException(403, "FORBIDDEN");
        }
        Authority authority = authority(paymentId);
        if (authority == null) throw new ApiException(404, "NOT_FOUND");
        if (admin) return;
        if ("CANCEL".equals(operation)) {
            if (!identity.userId().equals(authority.payerId())) {
                denied(identity);
                throw new ApiException(404, "NOT_FOUND");
            }
            return;
        }
        if ("REFUND".equals(operation)) {
            if (identity.userId().equals(authority.recipientOwnerId())) return;
            denied(identity);
            if (identity.userId().equals(authority.payerId())) throw new ApiException(403, "FORBIDDEN");
            throw new ApiException(404, "NOT_FOUND");
        }
    }

    private Authority authority(UUID paymentId) {
        var rows = jdbc.query("SELECT p.actor_id,d.owner_id FROM ledger.payments p "
                + "JOIN ledger.accounts d ON d.id=p.destination_id WHERE p.id=?",
            (rs, row) -> new Authority(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class)), paymentId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private void ensureVisible(Identity identity, UUID paymentId, boolean adminAllowed) {
        boolean admin = adminAllowed && "ADMIN".equals(identity.role());
        Integer found = jdbc.query("SELECT 1 FROM ledger.payments p "
                + "JOIN ledger.accounts s ON s.id=p.source_id JOIN ledger.accounts d ON d.id=p.destination_id "
                + "WHERE p.id=? AND (? OR s.owner_id=? OR d.owner_id=?)",
            rs -> rs.next() ? 1 : null, paymentId, admin, identity.userId(), identity.userId());
        if (found == null) {
            denied(identity);
            throw new ApiException(404, "NOT_FOUND");
        }
    }

    private Payment paymentRow(UUID actor, ResultSet rs) throws SQLException {
        boolean outgoing = actor.equals(rs.getObject("source_owner", UUID.class));
        long amount = rs.getLong("amount_minor");
        long refunded = rs.getLong("refunded_minor");
        boolean reversed = rs.getBoolean("reversed");
        String adjustment = reversed ? "REVERSED" : refunded == 0 ? "NONE"
            : refunded == amount ? "FULLY_REFUNDED" : "PARTIALLY_REFUNDED";
        Object projectionValue = rs.getObject("projection_version");
        return new Payment(rs.getObject("id", UUID.class), outgoing ? "OUTGOING" : "INCOMING",
            rs.getObject(outgoing ? "source_id" : "destination_id", UUID.class),
            rs.getString(outgoing ? "destination_ref" : "source_ref"), Long.toString(amount),
            rs.getString("currency"), rs.getString("state"), Long.toString(rs.getLong("version")),
            adjustment, rs.getObject("journal_id", UUID.class), rs.getString("failure_code"),
            rs.getString("projection_state"), projectionValue == null ? null : projectionValue.toString(),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
    }

    private Adjustment adjustmentRow(ResultSet rs, int row) throws SQLException {
        return new Adjustment(rs.getObject("id", UUID.class), rs.getObject("payment_id", UUID.class),
            rs.getString("kind"), rs.getString("amount_minor"), rs.getString("currency"),
            rs.getObject("journal_id", UUID.class), rs.getString("reason"),
            rs.getTimestamp("created_at").toInstant());
    }

    private static String selectPayment() {
        return "SELECT p.id,p.source_id,p.destination_id,p.amount_minor,p.currency,p.state,p.refunded_minor,"
            + "p.reversed,p.version,p.journal_id,p.failure_code,p.created_at,p.updated_at,"
            + "s.owner_id AS source_owner,d.owner_id AS destination_owner,s.public_ref AS source_ref,"
            + "d.public_ref AS destination_ref,pr.state AS projection_state,pr.aggregate_version AS projection_version "
            + "FROM ledger.payments p JOIN ledger.accounts s ON s.id=p.source_id "
            + "JOIN ledger.accounts d ON d.id=p.destination_id "
            + "LEFT JOIN ledger.payment_projection pr ON pr.payment_id=p.id";
    }

    private static String selectAdjustment() {
        return "SELECT a.id,a.payment_id,a.kind,a.amount_minor::text,p.currency,a.journal_id,a.reason,a.created_at "
            + "FROM ledger.adjustments a JOIN ledger.payments p ON p.id=a.payment_id";
    }

    private static Normalized normalize(CreatePayment request) {
        if (request == null) throw new ApiException(400, "INVALID_PAYMENT");
        UUID source;
        try {
            source = UUID.fromString(request.sourceId());
        } catch (IllegalArgumentException | NullPointerException invalid) {
            throw new ApiException(400, "INVALID_SOURCE_ACCOUNT");
        }
        String recipient = request.recipientRef();
        if (recipient == null) throw new ApiException(400, "INVALID_RECIPIENT");
        recipient = recipient.strip();
        if (!recipient.matches("LG-[a-fA-F0-9]{32}")) throw new ApiException(400, "INVALID_RECIPIENT");
        recipient = "LG-" + recipient.substring(3).toLowerCase(Locale.ROOT);
        return new Normalized(source, recipient, amount(request.amountMinor()), Inputs.currency(request.currency()));
    }

    private static String key(String value) {
        try {
            return Idempotency.key(value);
        } catch (DomainFailure failure) {
            throw new ApiException(failure.status(), failure.code());
        }
    }

    private static String amount(String value) {
        if (value == null || !value.matches("[1-9][0-9]{0,12}")
            || new BigInteger(value).compareTo(MAX_AMOUNT) > 0) {
            throw new ApiException(400, "INVALID_AMOUNT");
        }
        return value;
    }

    private static void putOptionalReason(ObjectNode payload, String value) {
        if (value == null) return;
        payload.put("reason", requiredReason(value));
    }

    private static String requiredReason(String value) {
        if (value == null) throw new ApiException(400, "INVALID_REASON");
        String normalized = value.strip();
        if (normalized.isEmpty() || normalized.length() > 500) throw new ApiException(400, "INVALID_REASON");
        return normalized;
    }

    private static UUID uuid(JsonNode body, String field) {
        try {
            return UUID.fromString(body.path(field).asText());
        } catch (IllegalArgumentException invalid) {
            throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
        }
    }

    private static void requireRejection(JsonNode body) {
        if (body.path("code").asText().isBlank()) throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
    }

    private void denied(Identity identity) {
        events.denied(identity.userId(), "ACCESS_DENIED");
    }

    private static ApiException publicFailure(Throwable failure) {
        SQLException sql = null;
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current instanceof SQLException candidate) { sql = candidate; break; }
            if (current instanceof DomainFailure domain) return new ApiException(domain.status(), domain.code());
        }
        if (sql == null) return new ApiException(503, "DEPENDENCY_UNAVAILABLE");
        String state = sql.getSQLState();
        if ("08007".equals(state)) return new ApiException(503, "OUTCOME_UNKNOWN");
        if (state == null || state.startsWith("08") || "40P01".equals(state) || "40001".equals(state)) {
            return new ApiException(503, "DEPENDENCY_UNAVAILABLE");
        }
        return switch (state) {
            case "P4000" -> new ApiException(400, "INVALID_PAYMENT");
            case "P4030" -> new ApiException(403, "FORBIDDEN");
            case "P4040" -> new ApiException(404, "NOT_FOUND");
            case "P4090" -> new ApiException(409, "PAYMENT_CONFLICT");
            case "P4220" -> new ApiException(422, "PAYMENT_REJECTED");
            default -> new ApiException(503, "DEPENDENCY_UNAVAILABLE");
        };
    }
}
