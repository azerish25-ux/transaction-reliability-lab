package lab.ledgerguard.webhooks;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.auth.SecurityEvents;
import lab.ledgerguard.core.WebhookDestination;
import lab.ledgerguard.http.ApiException;
import lab.ledgerguard.http.ApiProblems;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** UI command receipts never contain encrypted or plaintext signing material. */
@Service
@ConditionalOnProperty(name = "ledgerguard.webhooks.api-enabled", havingValue = "true")
public class WebhookCommandService {
    public record Command(String kind, UUID endpointId, UUID deliveryId, Long expectedVersion,
                          Integer expectedCycle, Boolean enabled, String reason) { }
    public record Result(JsonNode command, String signingSecret) { }
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final WebhookSettings settings;
    private final SecurityEvents security;
    private final SecureRandom random = new SecureRandom();

    public WebhookCommandService(JdbcTemplate jdbc, ObjectMapper json, WebhookSettings settings,
                                 SecurityEvents security) {
        this.jdbc = jdbc; this.json = json; this.settings = settings; this.security = security;
    }

    public Result execute(Identity actor, String key, Command input) {
        Map<String, Object> request = normalize(input);
        UUID commandId = commandId(key);
        UUID endpoint = input.kind().equals("CREATE") ? UUID.randomUUID() : input.endpointId();
        boolean secretCommand = input.kind().equals("CREATE") || input.kind().equals("ROTATE");
        byte[] secret = secretCommand ? new byte[32] : null;
        try {
            String sealed = null;
            if (secretCommand) {
                WebhookDestination.validate(settings.destination(), settings.allowlist(), settings.sandbox());
                random.nextBytes(secret);
                sealed = settings.secretBox().seal(endpoint, secret);
            }
            // One PostgreSQL transaction records both the protected action and its receipt.
            String result = jdbc.queryForObject(
                "SELECT ledger.execute_webhook_command(?,?,CAST(? AS jsonb),?,?,?,?)::text",
                String.class, actor.userId(), commandId, json.writeValueAsString(request),
                endpoint, sealed, settings.destination().toString(), ApiProblems.correlation());
            JsonNode receipt = json.readTree(result);
            if (!receipt.path("replayed").isBoolean()) throw new ApiException(503, "DEPENDENCY_UNAVAILABLE");
            String disclosed = secretCommand && !receipt.path("replayed").booleanValue()
                ? Base64.getUrlEncoder().withoutPadding().encodeToString(secret) : null;
            return new Result(receipt, disclosed);
        } catch (DataAccessException failure) {
            throw databaseFailure(failure);
        } catch (JsonProcessingException failure) {
            throw new ApiException(503, "DEPENDENCY_UNAVAILABLE");
        } finally {
            if (secret != null) Arrays.fill(secret, (byte) 0);
        }
    }

    public Result get(Identity actor, UUID key) {
        try {
            List<String> rows = jdbc.query("SELECT (c.receipt || '{\"replayed\":true}'::jsonb)::text "
                + "FROM ledger.webhook_commands c JOIN ledger.app_users u ON u.id=c.owner_id "
                + "WHERE c.owner_id=? AND c.command_id=? AND c.receipt IS NOT NULL AND u.enabled AND u.role='CUSTOMER'",
                (row, index) -> row.getString(1), actor.userId(), key);
            if (rows.isEmpty()) {
                security.denied(actor.userId(), "WEBHOOK_COMMAND_ACCESS_DENIED");
                throw new ApiException(404, "NOT_FOUND");
            }
            return new Result(json.readTree(rows.getFirst()), null);
        } catch (DataAccessException failure) {
            throw databaseFailure(failure);
        } catch (JsonProcessingException failure) {
            throw new ApiException(503, "DEPENDENCY_UNAVAILABLE");
        }
    }

    static UUID commandId(String key) {
        if (key == null || !key.matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")) {
            throw new ApiException(400, "INVALID_IDEMPOTENCY_KEY");
        }
        return UUID.fromString(key);
    }

    static Map<String, Object> normalize(Command input) {
        if (input == null || input.kind() == null) throw invalid();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("kind", input.kind());
        switch (input.kind()) {
            case "CREATE" -> {
                if (input.endpointId()!=null || input.deliveryId()!=null || input.expectedVersion()!=null
                    || input.expectedCycle()!=null || input.enabled()!=null || input.reason()!=null) throw invalid();
            }
            case "STATE", "ROTATE" -> {
                if (input.endpointId()==null || input.expectedVersion()==null || input.expectedVersion()<1
                    || input.expectedVersion()>9_007_199_254_740_990L || input.deliveryId()!=null
                    || input.expectedCycle()!=null || input.reason()!=null
                    || (input.kind().equals("STATE") ? input.enabled()==null : input.enabled()!=null)) throw invalid();
                result.put("endpointId", input.endpointId().toString());
                result.put("expectedVersion", input.expectedVersion());
                if (input.kind().equals("STATE")) result.put("enabled", input.enabled());
            }
            case "RETRY" -> {
                if (input.deliveryId()==null || input.expectedCycle()==null || input.expectedCycle()<1
                    || input.expectedCycle()==Integer.MAX_VALUE || input.endpointId()!=null
                    || input.expectedVersion()!=null || input.enabled()!=null || input.reason()==null) throw invalid();
                String reason = input.reason().strip();
                if (reason.isEmpty() || reason.length()>500 || reason.chars().anyMatch(c -> c<32 || c==127)) throw invalid();
                result.put("deliveryId", input.deliveryId().toString());
                result.put("expectedCycle", input.expectedCycle()); result.put("reason", reason);
            }
            default -> throw invalid();
        }
        return result;
    }

    private static ApiException invalid() { return new ApiException(400, "INVALID_WEBHOOK_COMMAND"); }
    private static ApiException databaseFailure(DataAccessException failure) {
        for (Throwable current=failure; current!=null; current=current.getCause()) {
            if (current instanceof java.sql.SQLException sql) {
                String code=sql.getSQLState();
                if ("P4030".equals(code)) return new ApiException(403, "FORBIDDEN");
                if ("P4040".equals(code)) return new ApiException(404, "NOT_FOUND");
                if ("P4091".equals(code)) return new ApiException(409, "IDEMPOTENCY_CONFLICT");
                if ("P4090".equals(code) || "23505".equals(code)) return new ApiException(409, "WEBHOOK_CONFLICT");
                if ("P4000".equals(code) || (code!=null && code.startsWith("22"))) return invalid();
            }
        }
        return new ApiException(503, "DEPENDENCY_UNAVAILABLE");
    }
}
