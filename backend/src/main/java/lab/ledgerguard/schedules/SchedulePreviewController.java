package lab.ledgerguard.schedules;

import java.time.DateTimeException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import lab.ledgerguard.core.SchedulePolicy;
import lab.ledgerguard.http.ApiException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Pure temporal preview. It neither reserves funds nor creates a schedule/idempotency record. */
@RestController
@ConditionalOnProperty(name = "ledgerguard.schedules.enabled", havingValue = "true")
public class SchedulePreviewController {
    public record Request(String intendedLocal, String zoneId, String recurrence) { }
    public record Preview(String intendedLocal, String zoneId, String recurrence, String resolvedLocal,
                          String offset, String instant, String policy) { }
    private static final DateTimeFormatter LOCAL = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss");

    @PostMapping(value = "/api/v1/schedules/preview", consumes = "application/json", produces = "application/json")
    public Preview preview(@RequestBody Request request) {
        if (request == null) throw new ApiException(400, "INVALID_SCHEDULE");
        LocalDateTime local;
        try {
            local = LocalDateTime.parse(request.intendedLocal(), DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            if (local.getNano() != 0) throw new DateTimeException("Fractional wall time");
        } catch (DateTimeException | NullPointerException invalid) {
            throw new ApiException(400, "INVALID_LOCAL_TIME");
        }
        ZoneId zone;
        try {
            if (request.zoneId() == null || request.zoneId().length() > 100) throw new DateTimeException("Invalid zone");
            zone = ZoneId.of(request.zoneId());
        } catch (DateTimeException invalid) {
            throw new ApiException(400, "INVALID_TIME_ZONE");
        }
        SchedulePolicy.Recurrence recurrence;
        try { recurrence = SchedulePolicy.Recurrence.valueOf(request.recurrence()); }
        catch (IllegalArgumentException | NullPointerException invalid) { throw new ApiException(400, "INVALID_RECURRENCE"); }
        var instant = SchedulePolicy.resolve(local, zone);
        var resolved = instant.atZone(zone);
        int offsets = zone.getRules().getValidOffsets(local).size();
        return new Preview(LOCAL.format(local), zone.getId(), recurrence.name(), LOCAL.format(resolved.toLocalDateTime()),
            resolved.getOffset().getId(), instant.toString(), offsets == 0 ? "GAP_FORWARD" : offsets > 1 ? "OVERLAP_EARLIER" : "NORMAL");
    }

    @GetMapping(value = "/api/v1/openapi/p08d-ui.json", produces = "application/json")
    public Resource contract() { return new ClassPathResource("openapi/p08d-ui.json"); }
}
