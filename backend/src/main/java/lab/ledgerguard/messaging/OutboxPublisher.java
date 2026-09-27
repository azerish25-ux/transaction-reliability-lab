package lab.ledgerguard.messaging;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name="ledgerguard.outbox-publisher.enabled",havingValue="true")
public class OutboxPublisher {
    private static final Logger LOG=LoggerFactory.getLogger(OutboxPublisher.class);
    private final UUID owner=UUID.randomUUID();
    private final OutboxRepository outbox;
    private final ConfirmedRabbitPublisher publisher;
    private final ObjectMapper json;
    private final WorkerFaults faults;
    private final int batch;
    private final int maxAttempts;
    private final int recoveryAge;
    private final int leaseSeconds;

    public OutboxPublisher(OutboxRepository outbox,ConfirmedRabbitPublisher publisher,
            ObjectMapper json,WorkerFaults faults,@Value("${ledgerguard.outbox.batch-size:32}") int batch,
            @Value("${ledgerguard.outbox.max-attempts:8}") int maxAttempts,
            @Value("${ledgerguard.outbox.pending-recovery-age-seconds:120}") int recoveryAge,
            @Value("${ledgerguard.outbox.lease-seconds:20}") int leaseSeconds) {
        this.outbox=outbox;this.publisher=publisher;this.json=json;this.faults=faults;
        this.batch=Math.max(1,Math.min(100,batch));this.maxAttempts=Math.max(2,Math.min(20,maxAttempts));
        this.recoveryAge=Math.max(30,Math.min(86400,recoveryAge));this.leaseSeconds=Math.max(5,Math.min(300,leaseSeconds));
    }

    @Scheduled(fixedDelayString="${ledgerguard.outbox.poll-ms:250}")
    public void publishDue() {
        for(OutboxRepository.Claimed claimed:outbox.claim(owner,batch,Duration.ofSeconds(leaseSeconds))) {
            try {
                EventEnvelope event=claimed.envelope();
                String envelope=json.writeValueAsString(event);
                publisher.publish(MessagingTopology.EVENTS_EXCHANGE,event.eventType(),envelope,event.eventId(),0,Duration.ZERO);
                faults.afterPublisherConfirm();
                outbox.markPublished(event.eventId(),owner);
            } catch(Exception failure) {
                if(failure instanceof InterruptedException) Thread.currentThread().interrupt();
                String code=code(failure);
                try {
                    if(permanent(failure)||claimed.attempts()>=maxAttempts) outbox.fail(claimed,owner,code);
                    else outbox.retry(claimed.id(),owner,backoff(claimed.attempts()),code);
                } catch(RuntimeException persistenceFailure) {
                    LOG.error("outbox_failure_recording eventId={} attempt={}",claimed.id(),claimed.attempts(),persistenceFailure);
                }
                LOG.warn("outbox_publish_failed eventId={} eventType={} attempt={} code={}",
                    claimed.id(),claimed.eventType(),claimed.attempts(),code);
            }
        }
    }

    @Scheduled(fixedDelayString="${ledgerguard.outbox.recovery-ms:30000}")
    public void recoverPendingPayments() {
        try {
            int recovered=outbox.recoverPending(recoveryAge,batch);
            if(recovered>0) LOG.warn("pending_payment_recovery count={}",recovered);
        } catch(RuntimeException failure) {
            LOG.warn("pending_payment_recovery_failed",failure);
        }
    }

    private static Duration backoff(int attempt){return Duration.ofSeconds(Math.min(60,1L<<Math.min(6,Math.max(0,attempt-1))));}
    private static boolean permanent(Throwable failure){for(Throwable current=failure;current!=null;current=current.getCause())if(current instanceof IllegalArgumentException)return true;return false;}
    private static String code(Throwable failure){String message=failure.getMessage();return failure.getClass().getSimpleName()+":"+(message==null?"UNKNOWN":message);}
}
