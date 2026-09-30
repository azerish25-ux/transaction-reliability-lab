package lab.ledgerguard.messaging;

/** An optional verification-artifact SPI. Normal artifacts have no provider. */
public interface WorkerFaultActions {
    void configure(boolean sandbox, boolean publisherDeath, boolean workerDeath);
    void afterPublisherConfirm();
    void afterSettlementCommit();
}
