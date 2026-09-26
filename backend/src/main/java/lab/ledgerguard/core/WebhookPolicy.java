package lab.ledgerguard.core;

import java.time.*;
import java.util.Optional;
import java.util.random.RandomGenerator;

public final class WebhookPolicy {
    public static final int MAX_ATTEMPTS = 8;
    public static final Duration MAX_AGE = Duration.ofHours(24);
    private WebhookPolicy() { }
    public enum Outcome { DELIVERED, RETRY, FAILED }
    public static Outcome classify(int status) {
        if (status >= 200 && status < 300) return Outcome.DELIVERED;
        if (status == 0 || status == 408 || status == 429 || (status >= 500 && status < 600)) return Outcome.RETRY;
        return Outcome.FAILED; // includes redirects; never follow them
    }
    public static Optional<Instant> nextAttempt(int attemptsMade, Instant created, Clock clock,
                                               RandomGenerator random, Duration retryAfter) {
        DomainFailure.require(attemptsMade >= 1, "INVALID_ATTEMPT", 400);
        Instant now = clock.instant();
        if (attemptsMade >= MAX_ATTEMPTS || !now.isBefore(created.plus(MAX_AGE))) return Optional.empty();
        long baseMillis = Math.min(300_000L, 2_000L * (1L << Math.min(20, attemptsMade - 1)));
        long jittered = (long) (baseMillis * (0.8 + random.nextDouble() * 0.4));
        long hint = retryAfter == null ? 0 : Math.max(0, Math.min(300, retryAfter.getSeconds())) * 1000;
        Duration delay = Duration.ofMillis(Math.min(300_000, Math.max(jittered, hint)));
        Instant due = now.plus(delay);
        return due.isBefore(created.plus(MAX_AGE)) ? Optional.of(due) : Optional.empty();
    }
}
