package lab.ledgerguard.health;

import java.util.Map;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component("ledgerDatabase")
public class LedgerDatabaseHealthIndicator implements HealthIndicator {
    private final JdbcTemplate jdbc;

    public LedgerDatabaseHealthIndicator(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Health health() {
        try {
            Map<String, Object> row = jdbc.queryForMap(
                "select current_user as role, to_regnamespace('ledger') is not null as migrated"
            );
            boolean migrated = Boolean.TRUE.equals(row.get("migrated"));
            boolean restricted = "ledger_runtime".equals(row.get("role"));
            if (!migrated || !restricted) {
                return Health.down()
                    .withDetail("migrated", migrated)
                    .withDetail("restrictedRuntimeRole", restricted)
                    .build();
            }
            return Health.up()
                .withDetail("authority", "PostgreSQL")
                .withDetail("restrictedRuntimeRole", true)
                .build();
        } catch (RuntimeException failure) {
            return Health.down(failure).build();
        }
    }
}
