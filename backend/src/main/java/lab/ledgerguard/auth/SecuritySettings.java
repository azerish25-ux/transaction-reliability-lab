package lab.ledgerguard.auth;

import java.net.URI;
import java.time.Duration;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

@Component
public final class SecuritySettings {
    public final SecretKey key;
    public final Duration sessionTtl;
    public final String issuer;
    public final String audience;
    public final boolean sandboxHttp;
    public final String publicOrigin;
    public final int bcryptStrength;
    public final int ipLimit;
    public final int identityLimit;
    public SecuritySettings(Environment env) {
        String encoded = env.getProperty("ledgerguard.auth.key", env.getProperty("LEDGER_AUTH_KEY", ""));
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException failure) { throw new IllegalStateException("LEDGER_AUTH_KEY must be base64 encoded"); }
        if (bytes.length < 32) throw new IllegalStateException("A runtime-provisioned signing key of at least 32 bytes is required");
        key = new SecretKeySpec(bytes, "HmacSHA256");
        try { sessionTtl = Duration.parse(env.getProperty("ledgerguard.auth.session-ttl", "PT15M")); }
        catch (DateTimeParseException invalid) { throw new IllegalStateException("Session lifetime must be an ISO-8601 duration"); }
        if (sessionTtl.compareTo(Duration.ofMinutes(1)) < 0 || sessionTtl.compareTo(Duration.ofMinutes(30)) > 0 || sessionTtl.getNano() != 0)
            throw new IllegalStateException("Session lifetime must be whole seconds between one and thirty minutes");
        issuer = env.getProperty("ledgerguard.auth.issuer", "ledgerguard");
        audience = env.getProperty("ledgerguard.auth.audience", "ledgerguard-browser");
        if (issuer.isBlank() || audience.isBlank()) throw new IllegalStateException("Issuer and audience must not be blank");
        sandboxHttp = env.getProperty("ledgerguard.auth.sandbox-http", Boolean.class,
            env.getProperty("LEDGER_SANDBOX_HTTP", Boolean.class, false));
        if (sandboxHttp && !env.acceptsProfiles(Profiles.of("sandbox")))
            throw new IllegalStateException("Insecure HTTP cookies require the explicit sandbox profile");
        publicOrigin = env.getProperty("ledgerguard.auth.public-origin", env.getProperty("LEDGER_PUBLIC_ORIGIN", "https://localhost:8443"));
        URI origin = URI.create(publicOrigin);
        if (!"https".equals(origin.getScheme()) || origin.getHost() == null || origin.getUserInfo() != null
                || origin.getQuery() != null || origin.getFragment() != null || !origin.getPath().isEmpty())
            throw new IllegalStateException("Public origin must be a bare HTTPS origin");
        bcryptStrength = env.getProperty("ledgerguard.auth.bcrypt-strength", Integer.class, 12);
        if (bcryptStrength < 10 || bcryptStrength > 14) throw new IllegalStateException("BCrypt strength must be 10..14");
        ipLimit = env.getProperty("ledgerguard.auth.ip-limit", Integer.class, 60);
        identityLimit = env.getProperty("ledgerguard.auth.identity-limit", Integer.class, 10);
        if (ipLimit < 1 || ipLimit > 1000 || identityLimit < 1 || identityLimit > 1000)
            throw new IllegalStateException("Authentication budget limits must be 1..1000");
    }
    public String sessionCookie() { return sandboxHttp ? "LG-SESSION" : "__Host-LG-SESSION"; }
    public String csrfCookie() { return sandboxHttp ? "LG-CSRF" : "__Host-LG-CSRF"; }
}
