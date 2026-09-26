package lab.ledgerguard.auth;

import java.time.Instant;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/admin/security-events")
public class SecurityEventController {
    private final JdbcTemplate jdbc;
    public SecurityEventController(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public record Event(String id,UUID actorId,String eventType,UUID correlationId,Instant occurredAt) { }
    @GetMapping
    public Page<Event> list(@RequestParam(defaultValue="50") int limit,@RequestParam(defaultValue="0") int offset) {
        Page.validate(limit,offset);
        return Page.from(jdbc.query("SELECT id::text,actor_id,event_type,correlation_id,occurred_at FROM ledger.security_events ORDER BY id DESC LIMIT ? OFFSET ?",
            (rs,n)->new Event(rs.getString("id"),rs.getObject("actor_id",UUID.class),rs.getString("event_type"),rs.getObject("correlation_id",UUID.class),
                rs.getTimestamp("occurred_at").toInstant()),limit+1,offset),limit,offset);
    }
}
