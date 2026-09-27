package lab.ledgerguard.messaging;

import java.util.List;
import java.util.Map;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnProperty(name="ledgerguard.messaging.enabled",havingValue="true")
public class MessagingTopology {
    public static final String EVENTS_EXCHANGE="ledgerguard.events.v1";
    public static final String RETRY_EXCHANGE="ledgerguard.retry.v1";
    public static final String REDELIVERY_EXCHANGE="ledgerguard.redelivery.v1";
    public static final String DEAD_EXCHANGE="ledgerguard.dead.v1";
    public static final String PAYMENT_QUEUE="ledgerguard.payment-settler.v1";
    public static final String PROJECTION_QUEUE="ledgerguard.payment-projection.v1";
    public static final String OBSERVATION_QUEUE="ledgerguard.event-observer.v1";
    public static final String PAYMENT_RETRY_QUEUE="ledgerguard.payment-settler.retry.v1";
    public static final String PROJECTION_RETRY_QUEUE="ledgerguard.payment-projection.retry.v1";
    public static final String OBSERVATION_RETRY_QUEUE="ledgerguard.event-observer.retry.v1";
    public static final String DEAD_QUEUE="ledgerguard.failed-messages.v1";
    public static final String PAYMENT_RETRY_KEY="payment-settler";
    public static final String PROJECTION_RETRY_KEY="payment-projection";
    public static final String OBSERVATION_RETRY_KEY="event-observer";

    @Bean
    Declarables ledgerMessagingTopology() {
        DirectExchange events=ExchangeBuilder.directExchange(EVENTS_EXCHANGE).durable(true).build();
        DirectExchange retry=ExchangeBuilder.directExchange(RETRY_EXCHANGE).durable(true).build();
        DirectExchange redelivery=ExchangeBuilder.directExchange(REDELIVERY_EXCHANGE).durable(true).build();
        FanoutExchange dead=ExchangeBuilder.fanoutExchange(DEAD_EXCHANGE).durable(true).build();
        Queue payments=mainQueue(PAYMENT_QUEUE),projection=mainQueue(PROJECTION_QUEUE),observation=mainQueue(OBSERVATION_QUEUE);
        Queue paymentRetry=retryQueue(PAYMENT_RETRY_QUEUE),projectionRetry=retryQueue(PROJECTION_RETRY_QUEUE),
            observationRetry=retryQueue(OBSERVATION_RETRY_QUEUE),deadQueue=QueueBuilder.durable(DEAD_QUEUE)
                .withArguments(queueBounds()).build();
        return new Declarables(List.of(
            events,retry,redelivery,dead,payments,projection,observation,paymentRetry,projectionRetry,observationRetry,deadQueue,
            BindingBuilder.bind(payments).to(events).with("payment.requested"),
            BindingBuilder.bind(projection).to(events).with("payment.requested"),
            BindingBuilder.bind(projection).to(events).with("payment.updated"),
            BindingBuilder.bind(observation).to(events).with("transfer.settled"),
            BindingBuilder.bind(observation).to(events).with("schedule.created"),
            BindingBuilder.bind(observation).to(events).with("schedule.updated"),
            BindingBuilder.bind(observation).to(events).with("schedule.occurrence"),
            BindingBuilder.bind(paymentRetry).to(retry).with(PAYMENT_RETRY_KEY),
            BindingBuilder.bind(projectionRetry).to(retry).with(PROJECTION_RETRY_KEY),
            BindingBuilder.bind(observationRetry).to(retry).with(OBSERVATION_RETRY_KEY),
            BindingBuilder.bind(payments).to(redelivery).with(PAYMENT_RETRY_KEY),
            BindingBuilder.bind(projection).to(redelivery).with(PROJECTION_RETRY_KEY),
            BindingBuilder.bind(observation).to(redelivery).with(OBSERVATION_RETRY_KEY),
            BindingBuilder.bind(deadQueue).to(dead)
        ));
    }

    private static Queue mainQueue(String name) {
        var arguments=new java.util.HashMap<String,Object>(queueBounds());
        arguments.put("x-dead-letter-exchange",DEAD_EXCHANGE);
        return QueueBuilder.durable(name).withArguments(arguments).build();
    }
    private static Queue retryQueue(String name) {
        var arguments=new java.util.HashMap<String,Object>(queueBounds());
        arguments.put("x-dead-letter-exchange",REDELIVERY_EXCHANGE);
        return QueueBuilder.durable(name).withArguments(arguments).build();
    }
    private static Map<String,Object> queueBounds() {
        return Map.of("x-max-length",10000,"x-max-length-bytes",67108864,"x-overflow","reject-publish");
    }
}
