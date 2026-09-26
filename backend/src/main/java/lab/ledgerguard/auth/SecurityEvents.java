package lab.ledgerguard.auth;

import java.util.UUID;
import lab.ledgerguard.http.ApiProblems;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class SecurityEvents {
    private final JdbcTemplate jdbc;
    public SecurityEvents(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public void record(UUID actor, String event) {
        jdbc.update("INSERT INTO ledger.security_events(actor_id,event_type,correlation_id) VALUES(?,?,?)",
            actor, event, ApiProblems.correlation());
    }
    public void denied(UUID actor, String event) {
        try { record(actor, event); }
        catch (DataAccessException unavailable) {
            // Operational fallback: no request contents, cookies, identity strings or SQL in logs.
            LoggerFactory.getLogger(SecurityEvents.class).warn("security_event={} persistence=unavailable", event);
        }
    }
}
