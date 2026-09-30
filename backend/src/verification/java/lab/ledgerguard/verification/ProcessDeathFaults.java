package lab.ledgerguard.verification;

import java.util.concurrent.atomic.AtomicBoolean;
import lab.ledgerguard.messaging.WorkerFaultActions;

/** LAB_ONLY_BUILD: compiled only by the explicitly selected verification profile. */
public final class ProcessDeathFaults implements WorkerFaultActions {
    private boolean publisherDeath;
    private boolean workerDeath;
    private final AtomicBoolean publisherArmed = new AtomicBoolean(true);
    private final AtomicBoolean workerArmed = new AtomicBoolean(true);
    public void configure(boolean sandbox, boolean publisherDeath, boolean workerDeath) {
        if (!sandbox) throw new IllegalStateException("VERIFICATION_ARTIFACT_REQUIRES_SANDBOX");
        this.publisherDeath = publisherDeath;
        this.workerDeath = workerDeath;
    }
    public void afterPublisherConfirm() {
        if (publisherDeath && publisherArmed.compareAndSet(true, false)) Runtime.getRuntime().halt(86);
    }
    public void afterSettlementCommit() {
        if (workerDeath && workerArmed.compareAndSet(true, false)) Runtime.getRuntime().halt(87);
    }
}
