package lab.ledgerguard.schedules;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@ConditionalOnProperty(name = "ledgerguard.schedules.enabled", havingValue = "true")
@RequestMapping("/api/v1/schedules")
public class ScheduleController {
    private final ScheduleService schedules;

    public ScheduleController(ScheduleService schedules) {
        this.schedules = schedules;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> create(@AuthenticationPrincipal Identity identity,
            @RequestHeader(name = "Idempotency-Key", required = false) String key,
            @RequestBody ScheduleService.CreateSchedule request) {
        return response(schedules.create(identity, key, request));
    }

    @PutMapping(value = "/{id}", consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> edit(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id,
            @RequestHeader(name = "Idempotency-Key", required = false) String key,
            @RequestBody ScheduleService.EditSchedule request) {
        return response(schedules.edit(identity, id, key, request));
    }

    @PostMapping(value = "/{id}/pause", consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> pause(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id,
            @RequestHeader(name = "Idempotency-Key", required = false) String key,
            @RequestBody ScheduleService.VersionCommand request) {
        return response(schedules.pause(identity, id, key, request));
    }

    @PostMapping(value = "/{id}/resume", consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> resume(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id,
            @RequestHeader(name = "Idempotency-Key", required = false) String key,
            @RequestBody ScheduleService.VersionCommand request) {
        return response(schedules.resume(identity, id, key, request));
    }

    @PostMapping(value = "/{id}/cancel", consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> cancel(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id,
            @RequestHeader(name = "Idempotency-Key", required = false) String key,
            @RequestBody ScheduleService.VersionCommand request) {
        return response(schedules.cancel(identity, id, key, request));
    }

    @GetMapping("/{id}")
    public ScheduleService.ScheduleView get(@AuthenticationPrincipal Identity identity,
                                             @PathVariable UUID id) {
        return schedules.get(identity, id);
    }

    @GetMapping
    public Page<ScheduleService.ScheduleView> list(@AuthenticationPrincipal Identity identity,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        return schedules.list(identity, limit, offset);
    }

    @GetMapping("/{id}/occurrences")
    public Page<ScheduleService.OccurrenceView> occurrences(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        return schedules.occurrences(identity, id, limit, offset);
    }

    private static ResponseEntity<JsonNode> response(ScheduleService.CommandResult result) {
        var response = ResponseEntity.status(result.status())
            .header("Idempotency-Replayed", Boolean.toString(result.replayed()))
            .header("Cache-Control", "no-store")
            .contentType(MediaType.APPLICATION_JSON);
        if (result.scheduleId() != null) {
            response.location(URI.create("/api/v1/schedules/" + result.scheduleId()));
        }
        return response.body(result.body());
    }
}
