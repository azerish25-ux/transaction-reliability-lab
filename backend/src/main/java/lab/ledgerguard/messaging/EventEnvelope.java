package lab.ledgerguard.messaging;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/** Stable full-snapshot envelope. Event IDs and aggregate versions survive every redelivery/replay. */
public record EventEnvelope(UUID eventId, String eventType, int schemaVersion, UUID aggregateId,
                            long aggregateVersion, UUID correlationId, Instant occurredAt, JsonNode payload) {
    public EventEnvelope {
        if (eventId == null || aggregateId == null || correlationId == null || occurredAt == null || payload == null
            || !payload.isObject() || schemaVersion != 1 || aggregateVersion < 1 || eventType == null
            || !eventType.matches("[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*){1,3}")) {
            throw new IllegalArgumentException("INVALID_EVENT_ENVELOPE");
        }
    }

    public UUID paymentId() {
        String value = payload.path("paymentId").asText("");
        UUID parsed;
        try { parsed = UUID.fromString(value); }
        catch (IllegalArgumentException invalid) { throw new IllegalArgumentException("INVALID_PAYMENT_EVENT"); }
        if (!parsed.equals(aggregateId)) throw new IllegalArgumentException("INVALID_PAYMENT_EVENT");
        return parsed;
    }

    public String paymentState() {
        String state = payload.path("state").asText("");
        if (!state.matches("PENDING|SETTLED|FAILED|CANCELLED")) throw new IllegalArgumentException("INVALID_PAYMENT_EVENT");
        if (payload.path("version").asLong(-1) != aggregateVersion) throw new IllegalArgumentException("INVALID_PAYMENT_EVENT");
        return state;
    }
}
