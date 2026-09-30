package lab.ledgerguard.messaging;

import java.util.ServiceLoader;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Normal builds cannot activate process-death behavior, even in sandbox mode. */
@Component
public class WorkerFaults {
    private final WorkerFaultActions actions;
    public WorkerFaults(@Value("${ledgerguard.sandbox-http:false}") boolean sandbox,
            @Value("${ledgerguard.test.crash-after-publish-confirm:false}") boolean publisherDeath,
            @Value("${ledgerguard.test.crash-after-settlement-commit:false}") boolean workerDeath) {
        var providers = ServiceLoader.load(WorkerFaultActions.class).stream().toList();
        if (providers.size() > 1) throw new IllegalStateException("AMBIGUOUS_VERIFICATION_PROVIDER");
        actions = providers.isEmpty() ? null : providers.get(0).get();
        if (actions == null && (publisherDeath || workerDeath)) {
            throw new IllegalStateException("FAULT_HOOK_NOT_PACKAGED_IN_NORMAL_ARTIFACT");
        }
        if (actions != null) actions.configure(sandbox, publisherDeath, workerDeath);
    }
    public void afterPublisherConfirm() { if (actions != null) actions.afterPublisherConfirm(); }
    public void afterSettlementCommit() { if (actions != null) actions.afterSettlementCommit(); }
}
