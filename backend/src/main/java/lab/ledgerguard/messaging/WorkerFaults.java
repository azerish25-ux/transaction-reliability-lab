package lab.ledgerguard.messaging;

import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Explicit sandbox-only process-death hooks used to prove recovery across real JVM restarts. */
@Component
public class WorkerFaults {
    private final boolean sandbox;
    private final boolean publisherDeath;
    private final boolean workerDeath;
    private final AtomicBoolean publisherArmed=new AtomicBoolean(true);
    private final AtomicBoolean workerArmed=new AtomicBoolean(true);
    public WorkerFaults(@Value("${ledgerguard.sandbox-http:false}") boolean sandbox,
            @Value("${ledgerguard.test.crash-after-publish-confirm:false}") boolean publisherDeath,
            @Value("${ledgerguard.test.crash-after-settlement-commit:false}") boolean workerDeath) {
        if((publisherDeath||workerDeath)&&!sandbox) throw new IllegalStateException("FAULT_HOOK_REQUIRES_SANDBOX");
        this.sandbox=sandbox;this.publisherDeath=publisherDeath;this.workerDeath=workerDeath;
    }
    public void afterPublisherConfirm(){if(sandbox&&publisherDeath&&publisherArmed.compareAndSet(true,false))Runtime.getRuntime().halt(86);}
    public void afterSettlementCommit(){if(sandbox&&workerDeath&&workerArmed.compareAndSet(true,false))Runtime.getRuntime().halt(87);}
}
