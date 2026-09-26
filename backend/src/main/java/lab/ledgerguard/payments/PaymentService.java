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
    public record Payment(UUID id, String direction, UUID accountId, String counterpartyRef,
                          String amountMinor, String currency, String state, String version,
                          String adjustmentState, UUID journalId, String failureCode,
                          String projectionState, String projectionVersion,
                          Instant createdAt, Instant updatedAt) { }
    public record CommandResult(int status, JsonNode body, boolean replayed, UUID paymentId) { }
    private record Normalized(UUID sourceId, String recipientRef, String amountMinor, String currency) { }

    public CommandResult create(Identity identity, String idempotencyKey, CreatePayment request) {
        String key;
        try {
            key = Idempotency.key(idempotencyKey);
        } catch (DomainFailure failure) {
            throw new ApiException(failure.status(), failure.code());
        }
        Normalized intent = normalize(request);
        ObjectNode payload = json.createObjectNode();
        payload.put("sourceId", intent.sourceId().toString());
        payload.put("recipientRef", intent.recipientRef());
        payload.put("amountMinor", intent.amountMinor());
        payload.put("currency", intent.currency());
        try {
            FinancialCommands.Result result = commands.execute(identity.userId(), "PAYMENT", null, key,
                json.writeValueAsString(payload), ApiProblems.correlation());
            JsonNode body = json.readTree(result.json());
            if (body == null || !body.isObject() || result.status() < 200 || result.status() > 599) {
                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
            }
            UUID paymentId = null;
            if (result.status() < 300) {
                try {
                    paymentId = UUID.fromString(body.path("id").asText());
                } catch (IllegalArgumentException invalid) {
                    throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
                }
                if (result.status() != 202 || !"PAYMENT".equals(body.path("kind").asText())
                    || !"PENDING".equals(body.path("state").asText())
                    || !intent.amountMinor().equals(body.path("amountMinor").asText())
                    || !intent.currency().equals(body.path("currency").asText())) {
                    throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
                }
            } else if (body.path("code").asText().isBlank()) {
                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
            }
            return new CommandResult(result.status(), body, result.replayed(), paymentId);
        } catch (ApiException failure) {
            throw failure;
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            throw publicFailure(failure);
        }
    }

    public Payment get(Identity identity, UUID id) {
        var rows = jdbc.query(selectPayment() + " WHERE p.id=? AND (s.owner_id=? OR d.owner_id=?)",
            (rs, row) -> paymentRow(identity.userId(), rs), id, identity.userId(), identity.userId());
        if (rows.isEmpty()) {
            events.denied(identity.userId(), "ACCESS_DENIED");
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

    private static String selectPayment() {
        return "SELECT p.id,p.source_id,p.destination_id,p.amount_minor,p.currency,p.state,p.refunded_minor,"
            + "p.reversed,p.version,p.journal_id,p.failure_code,p.created_at,p.updated_at,"
            + "s.owner_id AS source_owner,d.owner_id AS destination_owner,s.public_ref AS source_ref,"
            + "d.public_ref AS destination_ref,pr.state AS projection_state,pr.aggregate_version AS projection_version "
            + "FROM ledger.payments p JOIN ledger.accounts s ON s.id=p.source_id "
            + "JOIN ledger.accounts d ON d.id=p.destination_id "
            + "LEFT JOIN ledger.payment_projection pr ON pr.payment_id=p.id";
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
        String amount = request.amountMinor();
        if (amount == null || !amount.matches("[1-9][0-9]{0,12}")
            || new BigInteger(amount).compareTo(MAX_AMOUNT) > 0) {
            throw new ApiException(400, "INVALID_AMOUNT");
        }
        return new Normalized(source, recipient, amount, Inputs.currency(request.currency()));
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
