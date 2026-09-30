package lab.ledgerguard.webhooks;

import java.util.ServiceLoader;
import lab.ledgerguard.http.ApiException;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ReceiverFaultIsolationTest {
    @Test void noProviderExistsInNormalArtifact() {
        assertEquals(0, ServiceLoader.load(ReceiverFaultBehavior.class).stream().count());
    }
    @Test void normalReceiverHasNoInjectedResponse() {
        var receiver = new ReceiverFaults(true);
        assertNull(receiver.beforeReceipt("NORMAL"));
        assertNull(receiver.afterReceipt("NORMAL", true));
        assertNull(receiver.afterReceipt("NORMAL", false));
    }
    @Test void allFaultModesAreDeniedEvenWithSandboxEnabled() {
        for (boolean sandbox : new boolean[]{false, true}) {
            var receiver = new ReceiverFaults(sandbox);
            for (String mode : new String[]{"STATUS_429", "STATUS_503", "STATUS_400", "DELAY", "ACCEPT_THEN_503", "unknown"}) {
                var before = assertThrows(ApiException.class, () -> receiver.beforeReceipt(mode));
                assertEquals(403, before.status()); assertEquals("RECEIVER_FAULT_NOT_PACKAGED", before.getMessage());
                assertThrows(ApiException.class, () -> receiver.afterReceipt(mode, true));
            }
        }
    }
}
