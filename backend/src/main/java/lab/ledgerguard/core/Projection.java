package lab.ledgerguard.core;

import java.util.UUID;

/** Full snapshots only. A projection must never be used to authorize a spend. */
public record Projection(UUID aggregate, long version, PaymentRules.State state) {
    public Projection {
        DomainFailure.require(aggregate != null && state != null && version > 0, "INVALID_EVENT", 400);
    }
    public Projection apply(Projection incoming) {
        DomainFailure.require(aggregate.equals(incoming.aggregate), "WRONG_AGGREGATE", 400);
        if (incoming.version <= version) return this;
        DomainFailure.require(state == PaymentRules.State.PENDING || incoming.state == state,
            "INVALID_EVENT_TRANSITION", 409);
        return incoming;
    }
}
