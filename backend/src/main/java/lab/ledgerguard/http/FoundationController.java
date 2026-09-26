package lab.ledgerguard.http;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/system")
public class FoundationController {
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final String version;

    public FoundationController(
        JdbcTemplate jdbc,
        Clock clock,
        @Value("${info.app.version:unknown}") String version
    ) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.version = version;
    }

    @GetMapping
    public Map<String, Object> system() {
        String role = jdbc.queryForObject("select current_user", String.class);
        Boolean ledgerSchema = jdbc.queryForObject("select to_regnamespace('ledger') is not null", Boolean.class);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("application", "LedgerGuard");
        result.put("version", version);
        result.put("status", Boolean.TRUE.equals(ledgerSchema) ? "FOUNDATION_READY" : "MIGRATION_REQUIRED");
        result.put("databaseAuthority", "PostgreSQL");
        result.put("databaseRole", role);
        result.put("syntheticMoneyOnly", true);
        result.put("observedAt", Instant.now(clock).toString());
        return result;
    }
}
