package lab.ledgerguard.webhooks;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpRequest;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Real sender wire builder to real receiver validation; no network, mutation mode, or security bypass. */
class WebhookWireContractTest {
    @Test void realSenderPayloadAndHeadersAreAcceptedByRealReceiver() throws Exception {
        UUID endpoint = UUID.fromString("11111111-1111-4111-8111-111111111111");
        UUID event = UUID.fromString("22222222-2222-4222-8222-222222222222");
        UUID correlation = UUID.fromString("33333333-3333-4333-8333-333333333333");
        Clock clock = Clock.fixed(Instant.parse("2026-09-30T00:00:00Z"), ZoneOffset.UTC);
        byte[] root = new byte[32], secret = new byte[32]; Arrays.fill(root, (byte) 11); Arrays.fill(secret, (byte) 29);
        var environment = new MockEnvironment().withProperty("ledgerguard.webhooks.sandbox", "true")
            .withProperty("ledgerguard.webhooks.secret-key", Base64.getEncoder().encodeToString(root));
        var settings = new WebhookSettings(environment);
        byte[] payload = "{\"eventType\":\"payment.updated\",\"amountMinor\":\"1250\",\"currency\":\"CAD\",\"state\":\"SETTLED\"}".getBytes(StandardCharsets.UTF_8);
        String encrypted = settings.secretBox().seal(endpoint, secret);
        var claimed = new WebhookRepository.Claimed(UUID.randomUUID(), endpoint, event, "payment.updated", correlation,
            payload, 1, 1, clock.instant(), clock.instant().plusSeconds(3600), "http://receiver:8081/events", 1, encrypted);
        HttpRequest request = WebhookDispatcher.signedRequest(claimed, secret, clock.instant().getEpochSecond(), Duration.ofSeconds(3));
        byte[] actualBody = bytes(request);
        assertArrayEquals(payload, actualBody, "Sender must sign and transmit identical bytes");
        assertEquals("POST", request.method());
        assertEquals("application/json", header(request, "Content-Type"));
        assertEquals(correlation.toString(), header(request, "X-LedgerGuard-Correlation-Id"));
        var repository = mock(WebhookRepository.class, withSettings().mockMaker(org.mockito.MockMakers.SUBCLASS));
        when(repository.receiverSecret(endpoint, event, 1)).thenReturn(encrypted);
        when(repository.receiverMode()).thenReturn("NORMAL");
        when(repository.recordReceipt(eq(endpoint), eq(event), anyString(), anyString(), eq(clock.instant().getEpochSecond()))).thenReturn(true);
        var response = new WebhookReceiverController(repository, settings, clock).receive(actualBody,
            header(request, "X-LedgerGuard-Endpoint-Id"), header(request, "X-LedgerGuard-Event-Id"),
            header(request, "X-LedgerGuard-Timestamp"), header(request, "X-LedgerGuard-Key-Version"), header(request, "X-LedgerGuard-Signature"));
        assertEquals(204, response.getStatusCode().value());
        assertEquals("false", response.getHeaders().getFirst("X-LedgerGuard-Duplicate"));
        verify(repository).recordReceipt(eq(endpoint), eq(event), eq(java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(payload))),
            eq(header(request, "X-LedgerGuard-Signature")), eq(clock.instant().getEpochSecond()));
    }
    static String header(HttpRequest request, String name) { return request.headers().firstValue(name).orElseThrow(); }
    static byte[] bytes(HttpRequest request) throws Exception {
        var result = new CompletableFuture<byte[]>(); var output = new ByteArrayOutputStream();
        request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<ByteBuffer>() {
            public void onSubscribe(Flow.Subscription subscription) { subscription.request(Long.MAX_VALUE); }
            public void onNext(ByteBuffer buffer) { byte[] chunk = new byte[buffer.remaining()]; buffer.get(chunk); output.writeBytes(chunk); }
            public void onError(Throwable error) { result.completeExceptionally(error); }
            public void onComplete() { result.complete(output.toByteArray()); }
        });
        return result.get(5, TimeUnit.SECONDS);
    }
}
