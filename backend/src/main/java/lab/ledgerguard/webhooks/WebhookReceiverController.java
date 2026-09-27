package lab.ledgerguard.webhooks;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.UUID;
import lab.ledgerguard.core.WebhookSignature;
import lab.ledgerguard.http.ApiException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
@ConditionalOnProperty(name = "ledgerguard.webhooks.receiver-enabled", havingValue = "true")
public class WebhookReceiverController {
    private final WebhookRepository repository;
    private final WebhookSettings settings;
    private final Clock clock;

    public WebhookReceiverController(WebhookRepository repository, WebhookSettings settings, Clock clock) {
        this.repository = repository;
        this.settings = settings;
        this.clock = clock;
    }

    @PostMapping(value = "/events", consumes = "application/json")
    public ResponseEntity<Void> receive(@RequestBody byte[] body,
            @RequestHeader("X-LedgerGuard-Endpoint-Id") String endpointHeader,
            @RequestHeader("X-LedgerGuard-Event-Id") String eventHeader,
            @RequestHeader("X-LedgerGuard-Timestamp") String timestampHeader,
            @RequestHeader("X-LedgerGuard-Key-Version") String keyVersionHeader,
            @RequestHeader("X-LedgerGuard-Signature") String signature) {
        if (body == null || body.length == 0 || body.length > 65_536) {
            throw new ApiException(400, "INVALID_WEBHOOK_BODY");
        }
        UUID endpoint = uuid(endpointHeader);
        UUID event = uuid(eventHeader);
        long timestamp;
        try { timestamp = Long.parseLong(timestampHeader); }
        catch (NumberFormatException invalid) { throw new ApiException(401, "WEBHOOK_SIGNATURE_INVALID"); }
        int keyVersion;
        try { keyVersion = Integer.parseInt(keyVersionHeader); }
        catch (NumberFormatException invalid) { throw new ApiException(401, "WEBHOOK_SIGNATURE_INVALID"); }
        if (keyVersion < 1) throw new ApiException(401, "WEBHOOK_SIGNATURE_INVALID");
        String protectedSecret;
        try { protectedSecret = repository.receiverSecret(endpoint, event, keyVersion); }
        catch (org.springframework.dao.DataAccessException absent) {
            throw new ApiException(401, "WEBHOOK_SIGNATURE_INVALID");
        }
        byte[] secret;
        try { secret = settings.secretBox().open(endpoint, protectedSecret); }
        catch (IllegalArgumentException invalid) { throw new ApiException(401, "WEBHOOK_SIGNATURE_INVALID"); }
        try {
            if (!WebhookSignature.verify(secret, timestamp, event, body, signature, clock)) {
                throw new ApiException(401, "WEBHOOK_SIGNATURE_INVALID");
            }
        } finally {
            Arrays.fill(secret, (byte) 0);
        }
        String mode = repository.receiverMode();
        if ("STATUS_429".equals(mode)) {
            return ResponseEntity.status(429).header("Retry-After", "1").build();
        }
        if ("STATUS_503".equals(mode)) return ResponseEntity.status(503).build();
        if ("STATUS_400".equals(mode)) return ResponseEntity.badRequest().build();
        if ("DELAY".equals(mode)) {
            try { Thread.sleep(4_000); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
        boolean first = repository.recordReceipt(endpoint, event, sha256(body), signature, timestamp);
        if ("ACCEPT_THEN_503".equals(mode) && first) return ResponseEntity.status(503).build();
        return ResponseEntity.noContent()
            .header("X-LedgerGuard-Duplicate", Boolean.toString(!first)).build();
    }

    private static UUID uuid(String value) {
        try { return UUID.fromString(value); }
        catch (IllegalArgumentException | NullPointerException invalid) {
            throw new ApiException(401, "WEBHOOK_SIGNATURE_INVALID");
        }
    }

    private static String sha256(byte[] value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
