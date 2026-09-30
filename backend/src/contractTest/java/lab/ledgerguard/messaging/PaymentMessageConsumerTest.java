package lab.ledgerguard.messaging;

import au.com.dius.pact.consumer.MessagePactBuilder;
import au.com.dius.pact.consumer.junit5.*;
import au.com.dius.pact.core.model.PactSpecVersion;
import au.com.dius.pact.core.model.annotations.Pact;
import au.com.dius.pact.core.model.messaging.MessagePact;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.rabbitmq.client.Channel;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Message compatibility at the actual worker entry point; SQL and broker I/O are collaborators. */
@ExtendWith(PactConsumerTestExt.class)
@PactTestFor(providerName = "BadPennyOutbox", providerType = ProviderType.ASYNCH, pactVersion = PactSpecVersion.V3)
class PaymentMessageConsumerTest {
    static final String EVENT = "11111111-1111-4111-8111-111111111111";
    static final String PAYMENT = "22222222-2222-4222-8222-222222222222";
    static final String BODY = """
        {"eventId":"11111111-1111-4111-8111-111111111111","eventType":"payment.requested",
        "schemaVersion":1,"aggregateId":"22222222-2222-4222-8222-222222222222","aggregateVersion":1,
        "correlationId":"33333333-3333-4333-8333-333333333333","occurredAt":"2026-09-30T00:00:00Z",
        "payload":{"paymentId":"22222222-2222-4222-8222-222222222222","state":"PENDING","version":1,
        "amountMinor":"1250","currency":"CAD"}}
        """;
    static ObjectMapper json() { return new ObjectMapper().findAndRegisterModules().disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS); }
    @Pact(consumer = "BadPennyPaymentWorker")
    MessagePact pendingPayment(MessagePactBuilder builder) {
        return builder.expectsToReceive("a pending payment request envelope").withContent(BODY)
            .withMetadata(java.util.Map.of("contentType", "application/json")).toPact();
    }
    @Test @PactTestFor(pactMethod = "pendingPayment")
    void actualWorkerConsumesPactMessage(MessagePact pact) throws Exception {
        var database = mock(MessagingDatabase.class, withSettings().mockMaker(org.mockito.MockMakers.SUBCLASS));
        var publisher = mock(ConfirmedRabbitPublisher.class, withSettings().mockMaker(org.mockito.MockMakers.SUBCLASS));
        var failed = mock(FailedWorkRepository.class, withSettings().mockMaker(org.mockito.MockMakers.SUBCLASS));
        var channel = mock(Channel.class, withSettings().mockMaker(org.mockito.MockMakers.SUBCLASS));
        var worker = new ReliableEventConsumers(database, publisher, failed, json(), new WorkerFaults(false, false, false), 6);
        var properties = new MessageProperties(); properties.setMessageId(EVENT); properties.setDeliveryTag(7);
        worker.settle(new Message(pact.getMessages().getFirst().contentsAsBytes(), properties), channel);
        var envelope = ArgumentCaptor.forClass(EventEnvelope.class);
        verify(database).settle(envelope.capture());
        assertEquals(PAYMENT, envelope.getValue().paymentId().toString());
        assertEquals("PENDING", envelope.getValue().paymentState());
        verify(channel).basicAck(7, false);
        verifyNoMoreInteractions(channel); verifyNoInteractions(publisher, failed);
    }
}
