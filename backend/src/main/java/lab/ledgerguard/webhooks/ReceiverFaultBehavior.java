package lab.ledgerguard.webhooks;

import org.springframework.http.ResponseEntity;

/** Optional verification-only receiver behavior. Normal artifacts have no provider. */
public interface ReceiverFaultBehavior {
    void configure(boolean sandbox);
    ResponseEntity<Void> beforeReceipt(String mode);
    ResponseEntity<Void> afterReceipt(String mode, boolean first);
}
