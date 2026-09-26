package lab.ledgerguard.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import lab.ledgerguard.http.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AuthBudgets {
    private final JdbcTemplate jdbc;
    private final SecuritySettings settings;
    private final SecurityEvents events;
    public AuthBudgets(JdbcTemplate jdbc, SecuritySettings settings, SecurityEvents events) {
        this.jdbc = jdbc; this.settings = settings; this.events = events;
    }
    public void check(String operation, String remoteAddress, String identity) {
        // Never trust X-Forwarded-For. The deployment must preserve/trust proxy identity explicitly.
        boolean ip = consume("ip:" + remoteAddress, settings.ipLimit);
        if (!ip || !consume(operation + ":identity:" + identity, settings.identityLimit)) {
            events.denied(null, "THROTTLED");
            throw new ApiException(429, "AUTH_THROTTLED");
        }
    }
    private boolean consume(String scope, int limit) {
        try {
            String key = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(scope.getBytes(StandardCharsets.UTF_8)));
            return Boolean.TRUE.equals(jdbc.queryForObject("SELECT ledger.consume_auth_budget(?,?,300)", Boolean.class, key, limit));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
