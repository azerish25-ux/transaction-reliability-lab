package lab.ledgerguard.schedules;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigInteger;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Locale;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.auth.Inputs;
import lab.ledgerguard.auth.SecurityEvents;
import lab.ledgerguard.core.DomainFailure;
import lab.ledgerguard.core.Idempotency;
import lab.ledgerguard.core.SchedulePolicy;
import lab.ledgerguard.http.ApiException;
import lab.ledgerguard.http.ApiProblems;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name = "ledgerguard.schedules.enabled", havingValue = "true")
public class ScheduleService {
    private static final BigInteger MAX_AMOUNT = new BigInteger("1000000000000");
    private static final DateTimeFormatter LOCAL_FORMAT = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss");

    private final ScheduleCommands commands;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final SecurityEvents events;

    public ScheduleService(ScheduleCommands commands, JdbcTemplate jdbc, ObjectMapper json,
                           SecurityEvents events) {
        this.commands = commands;
        this.jdbc = jdbc;
        this.json = json;
        this.events = events;
    }

    public record CreateSchedule(String sourceId, String recipientRef, String amountMinor,
                                 String currency, String intendedLocal, String zoneId,
                                 String recurrence) { }

    public record EditSchedule(String sourceId, String recipientRef, String amountMinor,
                               String currency, String intendedLocal, String zoneId,
                               String recurrence, long expectedVersion) { }

    public record VersionCommand(long expectedVersion) { }

    public record ScheduleView(UUID id, UUID sourceId, String recipientRef, String amountMinor,
                               String currency, LocalDateTime intendedLocal, String zoneId,
                               String recurrence, long version, long eventVersion, Instant nextInstant,
                               String status, Instant createdAt, Instant updatedAt) { }

    public record OccurrenceView(UUID id, UUID scheduleId, long scheduleVersion,
                                 LocalDateTime intendedLocal, Instant dueAt, String outcome,
                                 UUID operationId, UUID journalId, String errorCode, Instant createdAt) { }

    public record CommandResult(int status, JsonNode body, boolean replayed, UUID scheduleId) { }

    private record Definition(UUID sourceId, String recipientRef, String amountMinor,
                              String currency, LocalDateTime intendedLocal, ZoneId zone,
                              SchedulePolicy.Recurrence recurrence, Instant nextInstant) { }

    public CommandResult create(Identity identity, String idempotencyKey, CreateSchedule request) {
        Definition definition = normalize(request);
        ObjectNode payload = definitionPayload(definition);
        return execute(identity, "CREATE", null, idempotencyKey, payload);
    }

    public CommandResult edit(Identity identity, UUID scheduleId, String idempotencyKey,
                              EditSchedule request) {
        if (request == null || request.expectedVersion() < 1) {
            throw new ApiException(400, "INVALID_SCHEDULE_VERSION");
        }
        Definition definition = normalize(new CreateSchedule(request.sourceId(), request.recipientRef(),
            request.amountMinor(), request.currency(), request.intendedLocal(), request.zoneId(),
            request.recurrence()));
        ObjectNode payload = definitionPayload(definition);
        payload.put("expectedVersion", request.expectedVersion());
        return execute(identity, "EDIT", scheduleId, idempotencyKey, payload);
    }

    public CommandResult pause(Identity identity, UUID scheduleId, String idempotencyKey,
                               VersionCommand request) {
        return stateCommand(identity, "PAUSE", scheduleId, idempotencyKey, request);
    }

    public CommandResult cancel(Identity identity, UUID scheduleId, String idempotencyKey,
                                VersionCommand request) {
        return stateCommand(identity, "CANCEL", scheduleId, idempotencyKey, request);
    }

    public CommandResult resume(Identity identity, UUID scheduleId, String idempotencyKey,
                                VersionCommand request) {
        return stateCommand(identity, "RESUME", scheduleId, idempotencyKey, request);
    }

    public ScheduleView get(Identity identity, UUID scheduleId) {
        var rows = jdbc.query(selectSchedule() + " WHERE s.id=? AND s.owner_id=?",
            this::scheduleRow, scheduleId, identity.userId());
        if (rows.isEmpty()) {
            events.denied(identity.userId(), "ACCESS_DENIED");
            throw new ApiException(404, "NOT_FOUND");
        }
        return rows.getFirst();
    }

    public Page<ScheduleView> list(Identity identity, int limit, int offset) {
        Page.validate(limit, offset);
        return Page.from(jdbc.query(selectSchedule()
                + " WHERE s.owner_id=? ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?",
            this::scheduleRow, identity.userId(), limit + 1, offset), limit, offset);
    }

    public Page<OccurrenceView> occurrences(Identity identity, UUID scheduleId, int limit, int offset) {
        Page.validate(limit, offset);
        requireOwned(identity, scheduleId);
        String sql = "SELECT o.id,o.schedule_id,o.schedule_version,o.intended_local,o.due_at,o.outcome,"
            + "o.operation_id,o.error_code,o.created_at,t.journal_id "
            + "FROM ledger.schedule_occurrences o LEFT JOIN ledger.transfers t ON t.id=o.operation_id "
            + "WHERE o.schedule_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?";
        return Page.from(jdbc.query(sql, this::occurrenceRow, scheduleId, limit + 1, offset), limit, offset);
    }

    private CommandResult stateCommand(Identity identity, String command, UUID scheduleId,
                                       String idempotencyKey, VersionCommand request) {
        long expected = expectedVersion(request);
        ObjectNode payload = json.createObjectNode();
        payload.put("expectedVersion", expected);
        return execute(identity, command, scheduleId, idempotencyKey, payload);
    }

    private CommandResult execute(Identity identity, String command, UUID scheduleId,
                                  String idempotencyKey, ObjectNode payload) {
        String key;
        try {
            key = Idempotency.key(idempotencyKey);
        } catch (DomainFailure failure) {
            throw new ApiException(failure.status(), failure.code());
        }
        try {
            ScheduleCommands.Result result = commands.execute(identity.userId(), command, scheduleId, key,
                json.writeValueAsString(payload), ApiProblems.correlation());
            JsonNode body = json.readTree(result.json());
            if (body == null || !body.isObject() || result.status() < 200 || result.status() > 599) {
                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
            }
            UUID returnedId = scheduleId;
            if (result.status() < 300) {
                try {
                    returnedId = UUID.fromString(body.path("id").asText());
                } catch (IllegalArgumentException invalid) {
                    throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
                }
                if (body.path("version").asLong(0) < 1 || body.path("eventVersion").asLong(0) < 1
                        || body.path("status").asText().isBlank()) {
                    throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
                }
            } else if (body.path("code").asText().isBlank()) {
                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
            }
            return new CommandResult(result.status(), body, result.replayed(), returnedId);
        } catch (ApiException failure) {
            throw failure;
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            throw publicFailure(failure);
        }
    }

    private ObjectNode definitionPayload(Definition definition) {
        ObjectNode payload = json.createObjectNode();
        payload.put("sourceId", definition.sourceId().toString());
        payload.put("recipientRef", definition.recipientRef());
        payload.put("amountMinor", definition.amountMinor());
        payload.put("currency", definition.currency());
        payload.put("intendedLocal", formatLocal(definition.intendedLocal()));
        payload.put("zoneId", definition.zone().getId());
        payload.put("recurrence", definition.recurrence().name());
        payload.put("nextInstant", definition.nextInstant().toString());
        return payload;
    }

    private Definition normalize(CreateSchedule request) {
        if (request == null) throw new ApiException(400, "INVALID_SCHEDULE");
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
        String currency = Inputs.currency(request.currency());
        LocalDateTime intended;
        try {
            intended = LocalDateTime.parse(request.intendedLocal(), DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        } catch (DateTimeParseException | NullPointerException invalid) {
            throw new ApiException(400, "INVALID_LOCAL_TIME");
        }
        if (intended.getNano() != 0) throw new ApiException(400, "INVALID_LOCAL_TIME");
        ZoneId zone;
        try {
            if (request.zoneId() == null || request.zoneId().length() > 100) {
                throw new DateTimeException("invalid zone");
            }
            zone = ZoneId.of(request.zoneId());
        } catch (DateTimeException invalid) {
            throw new ApiException(400, "INVALID_TIME_ZONE");
        }
        SchedulePolicy.Recurrence recurrence;
        try {
            recurrence = SchedulePolicy.Recurrence.valueOf(request.recurrence());
        } catch (IllegalArgumentException | NullPointerException invalid) {
            throw new ApiException(400, "INVALID_RECURRENCE");
        }
        Instant nextInstant = SchedulePolicy.resolve(intended, zone);
        return new Definition(source, recipient, amount, currency, intended, zone, recurrence, nextInstant);
    }

    private static long expectedVersion(VersionCommand request) {
        if (request == null || request.expectedVersion() < 1) {
            throw new ApiException(400, "INVALID_SCHEDULE_VERSION");
        }
        return request.expectedVersion();
    }

    private void requireOwned(Identity identity, UUID scheduleId) {
        Integer found = jdbc.query("SELECT 1 FROM ledger.schedules WHERE id=? AND owner_id=?",
            rows -> rows.next() ? 1 : null, scheduleId, identity.userId());
        if (found == null) {
            events.denied(identity.userId(), "ACCESS_DENIED");
            throw new ApiException(404, "NOT_FOUND");
        }
    }

    private ScheduleView scheduleRow(ResultSet rows, int row) throws SQLException {
        return new ScheduleView(rows.getObject("id", UUID.class), rows.getObject("source_id", UUID.class),
            rows.getString("destination_ref"), rows.getString("amount_minor"), rows.getString("currency"),
            rows.getObject("intended_local", LocalDateTime.class), rows.getString("zone_id"),
            rows.getString("recurrence"), rows.getLong("version"), rows.getLong("event_version"),
            rows.getTimestamp("next_instant").toInstant(), rows.getString("status"),
            rows.getTimestamp("created_at").toInstant(), rows.getTimestamp("updated_at").toInstant());
    }

    private OccurrenceView occurrenceRow(ResultSet rows, int row) throws SQLException {
        return new OccurrenceView(rows.getObject("id", UUID.class), rows.getObject("schedule_id", UUID.class),
            rows.getLong("schedule_version"), rows.getObject("intended_local", LocalDateTime.class),
            rows.getTimestamp("due_at").toInstant(), rows.getString("outcome"),
            rows.getObject("operation_id", UUID.class), rows.getObject("journal_id", UUID.class),
            rows.getString("error_code"), rows.getTimestamp("created_at").toInstant());
    }

    private static String selectSchedule() {
        return "SELECT s.id,s.source_id,s.destination_ref,s.amount_minor::text,s.currency,s.intended_local,"
            + "s.zone_id,s.recurrence,s.version,s.event_version,s.next_instant,s.status,s.created_at,s.updated_at "
            + "FROM ledger.schedules s";
    }

    private static String formatLocal(LocalDateTime value) {
        return LOCAL_FORMAT.format(value);
    }

    private static ApiException publicFailure(Throwable failure) {
        SQLException sql = null;
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current instanceof SQLException candidate) {
                sql = candidate;
                break;
            }
            if (current instanceof DomainFailure domain) {
                return new ApiException(domain.status(), domain.code());
            }
        }
        if (sql == null) return new ApiException(503, "DEPENDENCY_UNAVAILABLE");
        String state = sql.getSQLState();
        if ("08007".equals(state)) return new ApiException(503, "OUTCOME_UNKNOWN");
        if (state == null || state.startsWith("08") || "40P01".equals(state) || "40001".equals(state)) {
            return new ApiException(503, "DEPENDENCY_UNAVAILABLE");
        }
        return switch (state) {
            case "P4000" -> new ApiException(400, "INVALID_SCHEDULE");
            case "P4030" -> new ApiException(403, "FORBIDDEN");
            case "P4040" -> new ApiException(404, "NOT_FOUND");
            case "P4090" -> new ApiException(409, "SCHEDULE_CONFLICT");
            case "P4220" -> new ApiException(422, "SCHEDULE_REJECTED");
            default -> new ApiException(503, "DEPENDENCY_UNAVAILABLE");
        };
    }
}
