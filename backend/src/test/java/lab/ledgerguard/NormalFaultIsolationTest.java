package lab.ledgerguard;

import lab.ledgerguard.messaging.WorkerFaults;
import lab.ledgerguard.messaging.WorkerFaultActions;
import java.util.ServiceLoader;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class NormalFaultIsolationTest {
    @Test void normalArtifactHasNoVerificationProvider() {
        assertEquals(0, ServiceLoader.load(WorkerFaultActions.class).stream().count());
    }
    @Test void normalCallbacksHaveNoEffect() {
        for (boolean sandbox : new boolean[]{false, true}) {
            var normal = new WorkerFaults(sandbox, false, false);
            assertDoesNotThrow(normal::afterPublisherConfirm);
            assertDoesNotThrow(normal::afterSettlementCommit);
        }
    }
    @Test void normalArtifactRefusesEveryActiveFaultCombinationEvenInSandbox() {
        for (boolean sandbox : new boolean[]{false, true}) {
            for (boolean[] flags : new boolean[][]{{true,false},{false,true},{true,true}}) {
                var error = assertThrows(IllegalStateException.class,
                    () -> new WorkerFaults(sandbox, flags[0], flags[1]));
                assertEquals("FAULT_HOOK_NOT_PACKAGED_IN_NORMAL_ARTIFACT", error.getMessage());
            }
        }
    }
}
