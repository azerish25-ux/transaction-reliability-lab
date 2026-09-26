package lab.ledgerguard.transfers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigInteger;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
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
public class TransferService {
    private static final BigInteger MAX_AMOUNT = new BigInteger("1000000000000");
    private final FinancialCommands commands;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final SecurityEvents events;

    public TransferService(FinancialCommands commands, JdbcTemplate jdbc, ObjectMapper json, SecurityEvents events) {
        this.commands = commands;
        this.jdbc = jdbc;
        this.json = json;
        this.events = events;
    }

    public record CreateTransfer(String sourceId, String recipientRef, String amountMinor, String currency) { }
    public record Transfer(UUID id, UUID sourceId, String recipientRef, String amountMinor, String currency,
                           String state, UUID journalId, Instant createdAt) { }
    public record CommandResult(int status, JsonNode body, boolean replayed, UUID transferId) { }
    private record Normalized(UUID sourceId, String recipientRef, String amountMinor, String currency) { }

    public CommandResult create(Identity identity, String idempotencyKey, CreateTransfer request) {
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
            FinancialCommands.Result result = commands.execute(identity.userId(), "TRANSFER", null, key,
                json.writeValueAsString(payload), ApiProblems.correlation());
            JsonNode body = json.readTree(result.json());
            if (body == null || !body.isObject() || result.status() < 200 || result.status() > 599) {
                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
            }
            UUID transferId = null;
            if (result.status() < 300) {
                try {
                    transferId = UUID.fromString(body.path("id").asText());
                } catch (IllegalArgumentException invalid) {
                    throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
                }
                if (!"TRANSFER".equals(body.path("kind").asText()) || !"SETTLED".equals(body.path("state").asText())
                    || !intent.amountMinor().equals(body.path("amountMinor").asText())
                    || !intent.currency().equals(body.path("currency").asText())
                    || body.path("journalId").asText().isBlank()) {
                    throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
                }
            } else if (body.path("code").asText().isBlank()) {
                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
            }
            return new CommandResult(result.status(), body, result.replayed(), transferId);
        } catch (ApiException failure) {
            throw failure;
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            throw publicFailure(failure);
        }
    }

    public Transfer get(Identity identity, UUID id) {
        var rows = jdbc.query(selectTransfer() + " WHERE t.id=? AND t.actor_id=?", this::transferRow, id, identity.userId());
        if (rows.isEmpty()) {
            events.denied(identity.userId(), "ACCESS_DENIED");
            throw new ApiException(404, "NOT_FOUND");
        }
        return rows.getFirst();
    }

    public Page<Transfer> list(Identity identity, int limit, int offset) {
        Page.validate(limit, offset);
        return Page.from(jdbc.query(selectTransfer() + " WHERE t.actor_id=? ORDER BY t.created_at DESC,t.id DESC LIMIT ? OFFSET ?",
            this::transferRow, identity.userId(), limit + 1, offset), limit, offset);
    }

    private Transfer transferRow(ResultSet rs, int row) throws SQLException {
        return new Transfer(rs.getObject("id", UUID.class), rs.getObject("source_id", UUID.class),
            rs.getString("recipient_ref"), rs.getString("amount_minor"), rs.getString("currency"),
            "SETTLED", rs.getObject("journal_id", UUID.class), rs.getTimestamp("created_at").toInstant());
    }

    private static String selectTransfer() {
        return "SELECT t.id,t.source_id,d.public_ref AS recipient_ref,t.amount_minor::text,t.currency,t.journal_id,t.created_at "
            + "FROM ledger.transfers t JOIN ledger.accounts d ON d.id=t.destination_id";
    }

    private static Normalized normalize(CreateTransfer request) {
        if (request == null) throw new ApiException(400, "INVALID_TRANSFER");
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
        recipient = "LG-" + recipient.substring(3).toLowerCase(java.util.Locale.ROOT);
        String amount = request.amountMinor();
        if (amount == null || !amount.matches("[1-9][0-9]{0,12}") || new BigInteger(amount).compareTo(MAX_AMOUNT) > 0) {
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
            case "P4000" -> new ApiException(400, "INVALID_TRANSFER");
            case "P4030" -> new ApiException(403, "FORBIDDEN");
            case "P4040" -> new ApiException(404, "NOT_FOUND");
            case "P4090" -> new ApiException(409, "TRANSFER_CONFLICT");
            case "P4220" -> new ApiException(422, "TRANSFER_REJECTED");
            default -> new ApiException(503, "DEPENDENCY_UNAVAILABLE");
        };
    }
}
