package lab.ledgerguard.webhooks;

import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.SplittableRandom;
import java.util.UUID;
import lab.ledgerguard.core.WebhookDestination;
import lab.ledgerguard.core.WebhookPolicy;
import lab.ledgerguard.core.WebhookSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name = "ledgerguard.webhooks.dispatcher-enabled", havingValue = "true")
public class WebhookDispatcher {
    private static final Logger LOG = LoggerFactory.getLogger(WebhookDispatcher.class);
    private final UUID owner = UUID.randomUUID();
    private final WebhookRepository repository;
    private final WebhookSettings settings;
    private final Clock clock;
    private final HttpClient http;

    public WebhookDispatcher(WebhookRepository repository, WebhookSettings settings, Clock clock) {
        this.repository = repository;
        this.settings = settings;
        this.clock = clock;
        this.http = HttpClient.newBuilder().connectTimeout(settings.connectTimeout())
            .followRedirects(HttpClient.Redirect.NEVER).build();
    }

    @Scheduled(fixedDelayString = "${ledgerguard.webhooks.poll-ms:250}")
    public void dispatchDue() {
        try {
            repository.fanOut(settings.batchSize());
        } catch (RuntimeException failure) {
            LOG.warn("webhook_fanout_failed code={}", code(failure));
            return;
        }
        for (WebhookRepository.Claimed claimed : repository.claim(owner, settings.batchSize(),
                Duration.ofSeconds(settings.leaseSeconds()))) {
            deliver(claimed);
        }
    }

    private void deliver(WebhookRepository.Claimed claimed) {
        try (MDC.MDCCloseable ignored = MDC.putCloseable("correlationId", claimed.correlationId().toString())) {
            deliverAttempt(claimed);
        }
    }

    private void deliverAttempt(WebhookRepository.Claimed claimed) {
        long started = System.nanoTime();
        long timestamp = clock.instant().getEpochSecond();
        String signature = null;
        byte[] secret = null;
        try {
            URI destination = URI.create(claimed.destinationUrl());
            WebhookDestination.validate(destination, settings.allowlist(), settings.sandbox());
            WebhookDestination.validateResolved(destination,
                InetAddress.getAllByName(destination.getHost()), settings.sandbox());
            secret = settings.secretBox().open(claimed.endpointId(), claimed.encryptedSecret());
            signature = WebhookSignature.sign(secret, timestamp, claimed.eventId(), claimed.payload());
            HttpRequest request = HttpRequest.newBuilder(destination)
                .timeout(settings.requestTimeout())
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("User-Agent", "LedgerGuard-Webhook/1")
                .header("X-LedgerGuard-Endpoint-Id", claimed.endpointId().toString())
                .header("X-LedgerGuard-Event-Id", claimed.eventId().toString())
                .header("X-LedgerGuard-Correlation-Id", claimed.correlationId().toString())
                .header("X-LedgerGuard-Timestamp", Long.toString(timestamp))
                .header("X-LedgerGuard-Key-Version", Integer.toString(claimed.secretKeyVersion()))
                .header("X-LedgerGuard-Signature", signature)
                .POST(HttpRequest.BodyPublishers.ofByteArray(claimed.payload()))
                .build();
            HttpResponse<byte[]> response = http.send(request, HttpResponse.BodyHandlers.ofByteArray());
            int status = response.statusCode();
            WebhookPolicy.Outcome policy = WebhookPolicy.classify(status);
            String summary = responseSummary(response.body());
            if (policy == WebhookPolicy.Outcome.DELIVERED) {
                complete(claimed, "DELIVERED", status, started, timestamp, signature, summary, null, null);
            } else if (policy == WebhookPolicy.Outcome.FAILED) {
                complete(claimed, "PERMANENT_FAILURE", status, started, timestamp, signature, summary,
                    "HTTP_" + status, null);
            } else {
                retry(claimed, status, started, timestamp, signature, summary,
                    "HTTP_" + status, retryAfter(response));
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            retry(claimed, null, started, timestamp, signature, "", "INTERRUPTED", null);
        } catch (java.net.http.HttpTimeoutException timeout) {
            retry(claimed, null, started, timestamp, signature, "", "TIMEOUT", null);
        } catch (java.io.IOException transientFailure) {
            retry(claimed, null, started, timestamp, signature, "", "CONNECTION_ERROR", null);
        } catch (IllegalArgumentException permanentFailure) {
            complete(claimed, "PERMANENT_FAILURE", null, started, timestamp, signature, "",
                code(permanentFailure), null);
        } catch (RuntimeException failure) {
            retry(claimed, null, started, timestamp, signature, "", code(failure), null);
        } finally {
            if (secret != null) Arrays.fill(secret, (byte) 0);
        }
    }

    private void retry(WebhookRepository.Claimed claimed, Integer status, long started, long timestamp,
                       String signature, String response, String error, Duration retryAfter) {
        var next = WebhookPolicy.nextAttempt(claimed.attempt(), claimed.cycleStartedAt(), clock,
            new SplittableRandom(seed(claimed.deliveryId(), claimed.cycle(), claimed.attempt())), retryAfter);
        if (next.isEmpty() || !next.get().isBefore(claimed.maxAgeAt())) {
            complete(claimed, "EXHAUSTED", status, started, timestamp, signature, response, error, null);
        } else {
            complete(claimed, "RETRY_SCHEDULED", status, started, timestamp, signature, response, error,
                next.get());
        }
    }

    private void complete(WebhookRepository.Claimed claimed, String outcome, Integer status, long started,
                          long timestamp, String signature, String response, String error, Instant next) {
        try {
            repository.complete(claimed.deliveryId(), owner, outcome, status,
                Math.toIntExact(Math.min(Integer.MAX_VALUE,
                    Duration.ofNanos(System.nanoTime() - started).toMillis())), timestamp,
                signature == null ? "" : signature, bounded(response, 1000), bounded(error, 200), next);
            LOG.info("webhook_attempt_completed deliveryId={} eventId={} cycle={} attempt={} outcome={} status={}",
                claimed.deliveryId(), claimed.eventId(), claimed.cycle(), claimed.attempt(), outcome, status);
        } catch (RuntimeException persistenceFailure) {
            LOG.error("webhook_completion_failed deliveryId={} eventId={} attempt={}",
                claimed.deliveryId(), claimed.eventId(), claimed.attempt(), persistenceFailure);
        }
    }

    private Duration retryAfter(HttpResponse<?> response) {
        String value = response.headers().firstValue("Retry-After").orElse(null);
        if (value == null) return null;
        try { return Duration.ofSeconds(Math.max(0, Math.min(300, Long.parseLong(value.strip())))); }
        catch (NumberFormatException ignored) {
            try {
                long seconds = Duration.between(clock.instant(),
                    ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant()).getSeconds();
                return Duration.ofSeconds(Math.max(0, Math.min(300, seconds)));
            } catch (DateTimeParseException invalid) { return null; }
        }
    }

    private static String responseSummary(byte[] body) {
        if (body == null || body.length == 0) return "";
        int length = Math.min(1000, body.length);
        return bounded(new String(body, 0, length, StandardCharsets.UTF_8), 1000);
    }

    private static long seed(UUID delivery, int cycle, int attempt) {
        return delivery.getMostSignificantBits() ^ delivery.getLeastSignificantBits()
            ^ ((long) cycle << 32) ^ attempt;
    }

    private static String bounded(String value, int maximum) {
        if (value == null) return "";
        String cleaned = value.replaceAll("[\\r\\n\\t]+", " ");
        return cleaned.substring(0, Math.min(maximum, cleaned.length()));
    }

    private static String code(Throwable failure) {
        String message = failure.getMessage();
        return bounded(failure.getClass().getSimpleName() + ":" + (message == null ? "UNKNOWN" : message), 200);
    }
}
