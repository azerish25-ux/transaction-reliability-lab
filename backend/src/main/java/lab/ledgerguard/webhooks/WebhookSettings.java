package lab.ledgerguard.webhooks;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.Base64;
import java.util.Set;
import lab.ledgerguard.core.SecretBox;
import lab.ledgerguard.core.WebhookDestination;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Runtime-only webhook boundary settings. No key material is logged or returned by ordinary reads. */
@Component
@ConditionalOnProperty(name = "ledgerguard.webhooks.enabled", havingValue = "true")
public final class WebhookSettings {
    private final SecretBox secretBox;
    private final URI destination;
    private final Set<URI> allowlist;
    private final boolean sandbox;
    private final int batchSize;
    private final int leaseSeconds;
    private final Duration connectTimeout;
    private final Duration requestTimeout;

    public WebhookSettings(Environment environment) {
        sandbox = environment.getProperty("ledgerguard.webhooks.sandbox", Boolean.class,
            environment.getProperty("LEDGER_SANDBOX_HTTP", Boolean.class, false));
        destination = parseDestination(environment.getProperty("ledgerguard.webhooks.destination-url",
            environment.getProperty("LEDGER_WEBHOOK_DESTINATION_URL", "http://receiver:8081/events")));
        allowlist = Set.of(destination);
        WebhookDestination.validate(destination, allowlist, sandbox);
        secretBox = new SecretBox(deriveEncryptionKey(environment));
        batchSize = bounded(environment.getProperty("ledgerguard.webhooks.batch-size", Integer.class, 32), 1, 100,
            "Webhook batch size");
        leaseSeconds = bounded(environment.getProperty("ledgerguard.webhooks.lease-seconds", Integer.class, 20), 5, 300,
            "Webhook lease seconds");
        connectTimeout = Duration.ofMillis(bounded(
            environment.getProperty("ledgerguard.webhooks.connect-timeout-ms", Integer.class, 1000), 100, 5000,
            "Webhook connection timeout"));
        requestTimeout = Duration.ofMillis(bounded(
            environment.getProperty("ledgerguard.webhooks.request-timeout-ms", Integer.class, 3000), 500, 5000,
            "Webhook request timeout"));
    }

    public SecretBox secretBox() { return secretBox; }
    public URI destination() { return destination; }
    public Set<URI> allowlist() { return allowlist; }
    public boolean sandbox() { return sandbox; }
    public int batchSize() { return batchSize; }
    public int leaseSeconds() { return leaseSeconds; }
    public Duration connectTimeout() { return connectTimeout; }
    public Duration requestTimeout() { return requestTimeout; }

    private static URI parseDestination(String value) {
        try { return URI.create(value); }
        catch (IllegalArgumentException invalid) { throw new IllegalStateException("Invalid webhook destination configuration"); }
    }

    private static byte[] deriveEncryptionKey(Environment environment) {
        String encoded = environment.getProperty("ledgerguard.webhooks.secret-key", "");
        if (encoded == null || encoded.isBlank()) {
            encoded = environment.getProperty("LEDGER_WEBHOOK_SECRET_KEY", "");
        }
        if (encoded == null || encoded.isBlank()) {
            encoded = environment.getProperty("LEDGER_AUTH_KEY", "");
        }
        byte[] root;
        try { root = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException invalid) {
            throw new IllegalStateException("Webhook encryption root must be base64 encoded");
        }
        if (root.length < 32) throw new IllegalStateException("A runtime webhook encryption root of at least 32 bytes is required");
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update("ledgerguard-webhook-encryption-v1\0".getBytes(StandardCharsets.US_ASCII));
            return digest.digest(root);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private static int bounded(int value, int minimum, int maximum, String label) {
        if (value < minimum || value > maximum) throw new IllegalStateException(label + " is outside its supported range");
        return value;
    }
}
