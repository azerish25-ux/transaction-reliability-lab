package lab.ledgerguard.messaging;

import java.time.Duration;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name="ledgerguard.outbox-publisher.enabled",havingValue="true")
public class FailedWorkReplayer {
    private static final Logger LOG=LoggerFactory.getLogger(FailedWorkReplayer.class);
    private final UUID owner=UUID.randomUUID();
    private final FailedWorkRepository failed;
    private final ConfirmedRabbitPublisher publisher;
    public FailedWorkReplayer(FailedWorkRepository failed,ConfirmedRabbitPublisher publisher){this.failed=failed;this.publisher=publisher;}

    @Scheduled(fixedDelayString="${ledgerguard.outbox.replay-ms:1000}")
    public void replayRequested() {
        for(FailedWorkRepository.Replay work:failed.claim(owner,16,30)) {
            try {
                publisher.publish(work.exchangeName(),work.routingKey(),work.envelope().toString(),work.eventId(),0,Duration.ZERO);
                failed.complete(work.id(),owner,true,"");
            } catch(Exception failure) {
                if(failure instanceof InterruptedException) Thread.currentThread().interrupt();
                String code=failure.getClass().getSimpleName()+":"+String.valueOf(failure.getMessage());
                try { failed.complete(work.id(),owner,false,code); }
                catch(RuntimeException persistenceFailure){LOG.error("failed_work_completion_failed workId={}",work.id(),persistenceFailure);}
                LOG.warn("failed_work_republish_failed workId={} eventId={}",work.id(),work.eventId());
            }
        }
    }
}
