package lab.ledgerguard.messaging;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.rabbitmq.client.Channel;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name="ledgerguard.payment-worker.enabled",havingValue="true")
public class ReliableEventConsumers {
    private static final Logger LOG=LoggerFactory.getLogger(ReliableEventConsumers.class);
    private final MessagingDatabase database;
    private final ConfirmedRabbitPublisher publisher;
    private final FailedWorkRepository failed;
    private final ObjectMapper json;
    private final WorkerFaults faults;
    private final int maxRetries;

    public ReliableEventConsumers(MessagingDatabase database,ConfirmedRabbitPublisher publisher,
            FailedWorkRepository failed,ObjectMapper json,WorkerFaults faults,
            @Value("${ledgerguard.worker.max-retries:6}") int maxRetries) {
        this.database=database;this.publisher=publisher;this.failed=failed;this.json=json;this.faults=faults;
        this.maxRetries=Math.max(1,Math.min(20,maxRetries));
    }

    @RabbitListener(id="payment-settler",queues=MessagingTopology.PAYMENT_QUEUE)
    public void settle(Message message,Channel channel) throws Exception {
        consume("payment-settler-v1",MessagingTopology.PAYMENT_RETRY_KEY,"payment.requested",message,channel,event->{
            if(!"payment.requested".equals(event.eventType())||!"PENDING".equals(event.paymentState()))
                throw new IllegalArgumentException("UNSUPPORTED_PAYMENT_EVENT");
            database.settle(event);
            faults.afterSettlementCommit();
        });
    }

    @RabbitListener(id="payment-projection",queues=MessagingTopology.PROJECTION_QUEUE)
    public void project(Message message,Channel channel) throws Exception {
        consume("payment-projection-v1",MessagingTopology.PROJECTION_RETRY_KEY,"payment.updated",message,channel,event->{
            if(!event.eventType().matches("payment\\.(requested|updated)"))
                throw new IllegalArgumentException("UNSUPPORTED_PROJECTION_EVENT");
            database.project(event);
        });
    }

    @RabbitListener(id="event-observer",queues=MessagingTopology.OBSERVATION_QUEUE)
    public void observe(Message message,Channel channel) throws Exception {
        consume("event-observer-v1",MessagingTopology.OBSERVATION_RETRY_KEY,"transfer.settled",message,channel,event->{
            if(!"transfer.settled".equals(event.eventType()))
                throw new IllegalArgumentException("UNSUPPORTED_OBSERVATION_EVENT");
            database.observe(event);
        });
    }

    private void consume(String consumer,String retryKey,String fallbackRouting,Message message,Channel channel,Processor processor) throws Exception {
        long delivery=message.getMessageProperties().getDeliveryTag();
        byte[] raw=message.getBody();
        UUID eventId=stableMessageId(message,raw);
        EventEnvelope envelope=null;
        try {
            if(raw.length>70000) throw new IllegalArgumentException("MESSAGE_TOO_LARGE");
            envelope=json.readValue(raw,EventEnvelope.class);
            if(!eventId.equals(envelope.eventId())) throw new IllegalArgumentException("MESSAGE_ID_MISMATCH");
            processor.process(envelope);
            channel.basicAck(delivery,false);
        } catch(Throwable failure) {
            if(failure instanceof Error error) throw error;
            if(failure instanceof InterruptedException) Thread.currentThread().interrupt();
            int prior=retry(message);
            if(permanent(failure)||prior>=maxRetries) {
                JsonNode evidence=envelope==null?rawEvidence(raw):json.valueToTree(envelope);
                try {
                    String eventRouting=envelope==null?receivedRouting(message,fallbackRouting):envelope.eventType();
                    failed.record(consumer,eventId,MessagingTopology.EVENTS_EXCHANGE,eventRouting,evidence,code(failure),prior+1);
                    channel.basicReject(delivery,false);
                    LOG.warn("message_failed consumer={} eventId={} attempts={} code={}",consumer,eventId,prior+1,code(failure));
                } catch(RuntimeException persistenceFailure) {
                    LOG.error("failed_work_persistence_failed consumer={} eventId={}",consumer,eventId,persistenceFailure);
                    channel.basicNack(delivery,false,true);
                }
                return;
            }
            try {
                publisher.publish(MessagingTopology.RETRY_EXCHANGE,retryKey,new String(raw,StandardCharsets.UTF_8),
                    eventId,prior+1,backoff(prior+1));
                channel.basicAck(delivery,false);
            } catch(Exception retryFailure) {
                if(retryFailure instanceof InterruptedException) Thread.currentThread().interrupt();
                LOG.warn("message_retry_publish_failed consumer={} eventId={}",consumer,eventId,retryFailure);
                try {
                    JsonNode evidence=envelope==null?rawEvidence(raw):json.valueToTree(envelope);
                    String eventRouting=envelope==null?receivedRouting(message,fallbackRouting):envelope.eventType();
                    failed.record(consumer,eventId,MessagingTopology.EVENTS_EXCHANGE,eventRouting,evidence,
                        "RETRY_PUBLISH:"+code(retryFailure),prior+1);
                    channel.basicReject(delivery,false);
                } catch(RuntimeException persistenceFailure) {
                    LOG.error("retry_failure_persistence_failed consumer={} eventId={}",consumer,eventId,persistenceFailure);
                    channel.basicNack(delivery,false,true);
                }
            }
        }
    }

    @FunctionalInterface private interface Processor { void process(EventEnvelope event) throws Exception; }
    private static String receivedRouting(Message message,String fallback){String routing=message.getMessageProperties().getReceivedRoutingKey();return routing!=null&&routing.matches("(payment\\.(requested|updated)|transfer\\.settled)")?routing:fallback;}
    private static int retry(Message message){Object value=message.getMessageProperties().getHeaders().get("x-ledger-retry");return value instanceof Number n?n.intValue():0;}
    private static Duration backoff(int attempt){return Duration.ofSeconds(Math.min(60,1L<<Math.min(6,Math.max(0,attempt-1))));}
    private static UUID stableMessageId(Message message,byte[] body){
        String value=message.getMessageProperties().getMessageId();
        try{return UUID.fromString(value);}catch(IllegalArgumentException|NullPointerException ignored){return UUID.nameUUIDFromBytes(body);}
    }
    private static boolean permanent(Throwable failure){
        for(Throwable current=failure;current!=null;current=current.getCause()) {
            if(current instanceof IllegalArgumentException || current instanceof JsonProcessingException) return true;
            if(current instanceof SQLException sql && sql.getSQLState()!=null
                && (sql.getSQLState().startsWith("22") || "P4000".equals(sql.getSQLState()))) return true;
        }
        return false;
    }
    private JsonNode rawEvidence(byte[] raw){
        ObjectNode result=json.createObjectNode();int length=Math.min(raw.length,32000);
        result.put("rawBase64",Base64.getEncoder().encodeToString(java.util.Arrays.copyOf(raw,length)));
        result.put("truncated",raw.length>length);return result;
    }
    private static String code(Throwable failure){
        String message=failure.getMessage();String result=failure.getClass().getSimpleName()+":"+(message==null?"UNKNOWN":message);
        return result.substring(0,Math.min(200,result.length())).replaceAll("[\\r\\n\\t]+"," ");
    }
}
