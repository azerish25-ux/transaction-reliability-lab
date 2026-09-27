package lab.ledgerguard.messaging;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name="ledgerguard.messaging.enabled",havingValue="true")
public class ConfirmedRabbitPublisher {
    private final RabbitTemplate rabbit;
    public ConfirmedRabbitPublisher(RabbitTemplate rabbit) { this.rabbit=rabbit; }

    public void publish(String exchange,String routingKey,String json,UUID eventId,int retry,Duration delay) throws Exception {
        MessageProperties properties=new MessageProperties();
        properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
        properties.setContentEncoding(StandardCharsets.UTF_8.name());
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        properties.setMessageId(eventId.toString());
        properties.setHeader("x-ledger-event-id",eventId.toString());
        properties.setHeader("x-ledger-retry",retry);
        if(delay != null && !delay.isZero() && !delay.isNegative()) properties.setExpiration(Long.toString(delay.toMillis()));
        Message message=new Message(json.getBytes(StandardCharsets.UTF_8),properties);
        CorrelationData correlation=new CorrelationData(eventId+":"+UUID.randomUUID());
        rabbit.send(exchange,routingKey,message,correlation);
        CorrelationData.Confirm confirm=correlation.getFuture().get(8,TimeUnit.SECONDS);
        if(!confirm.isAck()) throw new IllegalStateException("BROKER_NACK");
        if(correlation.getReturned()!=null) throw new IllegalStateException("UNROUTABLE_MESSAGE");
    }
}
