package lab.ledgerguard.verification;

import lab.ledgerguard.webhooks.ReceiverFaultBehavior;
import org.springframework.http.ResponseEntity;

/** Explicit verification artifact only. No normal release contains these modes. */
public final class ReceiverFaultBehaviorProvider implements ReceiverFaultBehavior {
    public void configure(boolean sandbox) {
        if (!sandbox) throw new IllegalStateException("VERIFICATION_RECEIVER_REQUIRES_SANDBOX");
    }
    public ResponseEntity<Void> beforeReceipt(String mode) {
        if ("STATUS_429".equals(mode)) return ResponseEntity.status(429).header("Retry-After", "1").build();
        if ("STATUS_503".equals(mode)) return ResponseEntity.status(503).build();
        if ("STATUS_400".equals(mode)) return ResponseEntity.badRequest().build();
        if ("DELAY".equals(mode)) {
            try { Thread.sleep(4_000); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
        return null;
    }
    public ResponseEntity<Void> afterReceipt(String mode, boolean first) {
        if ("ACCEPT_THEN_503".equals(mode) && first) return ResponseEntity.status(503).build();
        return null;
    }
}
