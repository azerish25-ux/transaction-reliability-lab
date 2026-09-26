package lab.ledgerguard.auth;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.nimbusds.jose.proc.SecurityContext;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.stereotype.Service;

@Service
public class JwtSessions {
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final SecuritySettings settings;
    private final JwtEncoder encoder;
    private final NimbusJwtDecoder decoder;
    public JwtSessions(JdbcTemplate jdbc, Clock clock, SecuritySettings settings) {
        this.jdbc = jdbc; this.clock = clock; this.settings = settings;
        encoder = new NimbusJwtEncoder(new ImmutableSecret<SecurityContext>(settings.key));
        decoder = NimbusJwtDecoder.withSecretKey(settings.key).macAlgorithm(MacAlgorithm.HS256).build();
        JwtTimestampValidator timestamps = new JwtTimestampValidator(Duration.ZERO);
        timestamps.setClock(clock);
        OAuth2TokenValidator<Jwt> required = jwt -> {
            Instant expires = jwt.getExpiresAt(), issued = jwt.getIssuedAt();
            boolean valid = expires != null && issued != null && expires.isAfter(clock.instant())
                && !issued.isAfter(clock.instant()) && expires.isAfter(issued)
                && Duration.between(issued, expires).compareTo(settings.sessionTtl) <= 0
                && jwt.getAudience() != null && jwt.getAudience().contains(settings.audience)
                && jwt.getId() != null && jwt.getSubject() != null;
            return valid ? OAuth2TokenValidatorResult.success() : OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", "Invalid session claims", null));
        };
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(timestamps, new JwtIssuerValidator(settings.issuer), required));
    }
    public record Issued(String token, Identity identity) { }
    public Issued issue(UUID userId) {
        Instant issued = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        Instant expires = issued.plus(settings.sessionTtl);
        UUID session = UUID.randomUUID();
        int inserted = jdbc.update("INSERT INTO ledger.auth_sessions(id,user_id,created_at,expires_at) "
            + "SELECT ?,id,?,? FROM ledger.app_users WHERE id=? AND enabled", session, Timestamp.from(issued), Timestamp.from(expires), userId);
        if (inserted != 1) throw new JwtException("Invalid session");
        JwtClaimsSet claims = JwtClaimsSet.builder().issuer(settings.issuer).audience(List.of(settings.audience))
            .subject(userId.toString()).id(session.toString()).issuedAt(issued).expiresAt(expires).build();
        String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        return new Issued(token, load(session, userId));
    }
    public Identity authenticate(String token) {
        Jwt jwt = decoder.decode(token);
        try {
            return load(UUID.fromString(jwt.getId()), UUID.fromString(jwt.getSubject()));
        } catch (IllegalArgumentException malformed) {
            throw new JwtException("Invalid session claims");
        }
    }
    private Identity load(UUID session, UUID user) {
        var rows = jdbc.query("SELECT u.id,u.email,u.display_name,u.role,s.expires_at FROM ledger.auth_sessions s "
            + "JOIN ledger.app_users u ON u.id=s.user_id WHERE s.id=? AND u.id=? AND u.enabled "
            + "AND s.revoked_at IS NULL AND s.expires_at>?", (rs, n) -> new Identity(rs.getObject("id",UUID.class), session,
                rs.getString("email"),rs.getString("display_name"),rs.getString("role"),rs.getTimestamp("expires_at").toInstant()),
            session, user, Timestamp.from(clock.instant()));
        if (rows.size() != 1) throw new JwtException("Invalid session");
        return rows.getFirst();
    }
    public void revoke(Identity identity) {
        jdbc.update("UPDATE ledger.auth_sessions SET revoked_at=clock_timestamp() WHERE id=? AND user_id=? AND revoked_at IS NULL",
            identity.sessionId(), identity.userId());
    }
}
