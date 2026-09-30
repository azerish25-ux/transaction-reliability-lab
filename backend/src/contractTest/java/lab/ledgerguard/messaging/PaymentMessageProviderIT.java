package lab.ledgerguard.messaging;

import au.com.dius.pact.provider.PactVerifyProvider;
import au.com.dius.pact.provider.junit5.*;
import au.com.dius.pact.provider.junitsupport.Provider;
import au.com.dius.pact.provider.junitsupport.loader.PactFolder;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import static org.mockito.Mockito.*;

/** Actual OutboxPublisher serialization is verified against the worker-generated Pact. */
@Provider("BadPennyOutbox")
@PactFolder("target/pacts")
class PaymentMessageProviderIT {
    @BeforeEach void target(PactVerificationContext context) { context.setTarget(new MessageTestTarget()); }
    @TestTemplate @ExtendWith(PactVerificationInvocationContextProvider.class)
    void verifyMessage(PactVerificationContext context) { context.verifyInteraction(); }
    @PactVerifyProvider("a pending payment request envelope")
    public String serializedMessage() throws Exception {
        var json = PaymentMessageConsumerTest.json();
        var input = json.readTree(PaymentMessageConsumerTest.BODY);
        var outbox = mock(OutboxRepository.class, withSettings().mockMaker(org.mockito.MockMakers.SUBCLASS));
        var transport = mock(ConfirmedRabbitPublisher.class, withSettings().mockMaker(org.mockito.MockMakers.SUBCLASS));
        UUID id = UUID.fromString(input.path("eventId").asText());
        var claimed = new OutboxRepository.Claimed(id, "payment.requested", 1,
            UUID.fromString(input.path("aggregateId").asText()), 1,
            UUID.fromString(input.path("correlationId").asText()), Instant.parse(input.path("occurredAt").asText()), input.path("payload"), 1);
        when(outbox.claim(any(), eq(32), any())).thenReturn(List.of(claimed));
        new OutboxPublisher(outbox, transport, json, new WorkerFaults(false, false, false), 32, 8, 120, 20).publishDue();
        var body = ArgumentCaptor.forClass(String.class);
        verify(transport).publish(eq(MessagingTopology.EVENTS_EXCHANGE), eq("payment.requested"), body.capture(), eq(id), eq(0), eq(Duration.ZERO));
        verify(outbox).markPublished(eq(id), any());
        return body.getValue();
    }
}
