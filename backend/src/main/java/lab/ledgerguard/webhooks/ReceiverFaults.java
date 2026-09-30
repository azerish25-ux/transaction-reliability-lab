package lab.ledgerguard.webhooks;

import java.util.ServiceLoader;
import lab.ledgerguard.http.ApiException;
import org.springframework.http.ResponseEntity;

/** A fail-closed adapter, never an implementation of destructive receiver modes. */
public final class ReceiverFaults {
    private final ReceiverFaultBehavior behavior;
    public ReceiverFaults(boolean sandbox) {
        var providers = ServiceLoader.load(ReceiverFaultBehavior.class).stream().toList();
        if (providers.size() > 1) throw new IllegalStateException("AMBIGUOUS_RECEIVER_VERIFICATION_PROVIDER");
        behavior = providers.isEmpty() ? null : providers.get(0).get();
        if (behavior != null) behavior.configure(sandbox);
    }
    public ResponseEntity<Void> beforeReceipt(String mode) {
        if (behavior != null) return behavior.beforeReceipt(mode);
        if (!"NORMAL".equals(mode)) throw new ApiException(403, "RECEIVER_FAULT_NOT_PACKAGED");
        return null;
    }
    public ResponseEntity<Void> afterReceipt(String mode, boolean first) {
        if (behavior != null) return behavior.afterReceipt(mode, first);
        if (!"NORMAL".equals(mode)) throw new ApiException(403, "RECEIVER_FAULT_NOT_PACKAGED");
        return null;
    }
}
