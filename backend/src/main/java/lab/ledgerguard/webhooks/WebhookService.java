package lab.ledgerguard.webhooks;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.auth.SecurityEvents;
import lab.ledgerguard.core.WebhookDestination;
import lab.ledgerguard.http.ApiException;
import lab.ledgerguard.http.ApiProblems;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name = "ledgerguard.webhooks.api-enabled", havingValue = "true")
public class WebhookService {
    public record CreateEndpoint(String destinationId) { }
    public record UpdateEndpoint(Boolean enabled, long expectedVersion) { }
    public record RotateSecret(long expectedVersion) { }
    public record RetryDelivery(String reason) { }
    public record EndpointSecret(WebhookRepository.Endpoint endpoint, String signingSecret) { }
    public record DeliveryDetail(WebhookRepository.Delivery delivery,
                                 List<WebhookRepository.Attempt> attempts) { }

    private final WebhookRepository repository;
    private final WebhookSettings settings;
    private final SecurityEvents securityEvents;
    private final SecureRandom random = new SecureRandom();

    public WebhookService(WebhookRepository repository, WebhookSettings settings,
                          SecurityEvents securityEvents) {
        this.repository = repository;
        this.settings = settings;
        this.securityEvents = securityEvents;
    }

    public EndpointSecret create(Identity identity, CreateEndpoint request) {
        if (request == null || !"sandbox-receiver".equals(request.destinationId())) {
            throw new ApiException(400, "DESTINATION_DENIED");
        }
        WebhookDestination.validate(settings.destination(), settings.allowlist(), settings.sandbox());
        UUID endpoint = UUID.randomUUID();
        byte[] secret = secret();
        try {
            repository.createEndpoint(identity.userId(), endpoint, request.destinationId(),
                settings.destination().toString(), settings.secretBox().seal(endpoint, secret),
                ApiProblems.correlation());
            return new EndpointSecret(requireOwned(identity, endpoint), encode(secret));
        } catch (DataAccessException failure) {
            throw databaseFailure(failure);
        } finally {
            java.util.Arrays.fill(secret, (byte) 0);
        }
    }

    public WebhookRepository.Endpoint update(Identity identity, UUID endpoint, UpdateEndpoint request) {
        if (request == null || request.enabled() == null || request.expectedVersion() < 1) {
            throw new ApiException(400, "INVALID_WEBHOOK_VERSION");
        }
        try {
            repository.setEndpoint(identity.userId(), endpoint, request.enabled(), request.expectedVersion(),
                ApiProblems.correlation());
            return requireOwned(identity, endpoint);
        } catch (DataAccessException failure) {
            throw databaseFailure(failure);
        }
    }

    public EndpointSecret rotate(Identity identity, UUID endpoint, RotateSecret request) {
        if (request == null || request.expectedVersion() < 1) {
            throw new ApiException(400, "INVALID_WEBHOOK_VERSION");
        }
        byte[] secret = secret();
        try {
            repository.rotateEndpoint(identity.userId(), endpoint,
                settings.secretBox().seal(endpoint, secret), request.expectedVersion(), ApiProblems.correlation());
            return new EndpointSecret(requireOwned(identity, endpoint), encode(secret));
        } catch (DataAccessException failure) {
            throw databaseFailure(failure);
        } finally {
            java.util.Arrays.fill(secret, (byte) 0);
        }
    }

    public WebhookRepository.Endpoint get(Identity identity, UUID endpoint) {
        return requireOwned(identity, endpoint);
    }

    public Page<WebhookRepository.Endpoint> list(Identity identity, int limit, int offset) {
        return repository.endpoints(identity.userId(), limit, offset);
    }

    public Page<WebhookRepository.Delivery> deliveries(Identity identity, UUID endpoint,
                                                        int limit, int offset) {
        requireOwned(identity, endpoint);
        return repository.deliveriesForEndpoint(identity.userId(), endpoint, limit, offset);
    }

    public DeliveryDetail delivery(Identity identity, UUID delivery) {
        WebhookRepository.Delivery found = repository.deliveryForOwner(identity.userId(), delivery);
        if (found == null) return denied(identity);
        return new DeliveryDetail(found, repository.attempts(delivery));
    }

    public DeliveryDetail retry(Identity identity, UUID delivery, RetryDelivery request) {
        String reason = normalizeReason(request);
        try {
            repository.requestRetry(identity.userId(), delivery, reason, ApiProblems.correlation());
            return delivery(identity, delivery);
        } catch (DataAccessException failure) {
            throw databaseFailure(failure);
        }
    }

    public Page<WebhookRepository.Delivery> adminDeliveries(String state, int limit, int offset) {
        String normalized = normalizeState(state);
        return repository.deliveriesForAdmin(normalized, limit, offset);
    }

    public DeliveryDetail adminDelivery(UUID delivery) {
        WebhookRepository.Delivery found = repository.deliveryForAdmin(delivery);
        if (found == null) throw new ApiException(404, "NOT_FOUND");
        return new DeliveryDetail(found, repository.attempts(delivery));
    }

    public DeliveryDetail adminRetry(Identity identity, UUID delivery, RetryDelivery request) {
        String reason = normalizeReason(request);
        try {
            repository.requestRetry(identity.userId(), delivery, reason, ApiProblems.correlation());
            return adminDelivery(delivery);
        } catch (DataAccessException failure) {
            throw databaseFailure(failure);
        }
    }

    private WebhookRepository.Endpoint requireOwned(Identity identity, UUID endpoint) {
        WebhookRepository.Endpoint found = repository.endpoint(identity.userId(), endpoint);
        if (found == null) return denied(identity);
        return found;
    }

    private <T> T denied(Identity identity) {
        securityEvents.denied(identity.userId(), "WEBHOOK_ACCESS_DENIED");
        throw new ApiException(404, "NOT_FOUND");
    }

    private byte[] secret() {
        byte[] value = new byte[32];
        random.nextBytes(value);
        return value;
    }

    private static String encode(byte[] secret) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
    }

    private static String normalizeReason(RetryDelivery request) {
        String value = request == null ? null : request.reason();
        if (value == null || value.strip().isEmpty() || value.strip().length() > 500) {
            throw new ApiException(400, "INVALID_RETRY_REASON");
        }
        return value.strip();
    }

    private static String normalizeState(String value) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.strip().toUpperCase(Locale.ROOT);
        if (!normalized.matches("PENDING|IN_FLIGHT|DELIVERED|FAILED")) {
            throw new ApiException(400, "INVALID_DELIVERY_STATE");
        }
        return normalized;
    }

    private static ApiException databaseFailure(DataAccessException failure) {
        Throwable current = failure;
        while (current != null) {
            if (current instanceof java.sql.SQLException sql) {
                String state = sql.getSQLState();
                if ("P4030".equals(state)) return new ApiException(403, "FORBIDDEN");
                if ("P4040".equals(state)) return new ApiException(404, "NOT_FOUND");
                if ("P4090".equals(state) || "23505".equals(state)) {
                    return new ApiException(409, "WEBHOOK_CONFLICT");
                }
                if ("P4000".equals(state) || (state != null && state.startsWith("22"))) {
                    return new ApiException(400, "INVALID_WEBHOOK_COMMAND");
                }
            }
            current = current.getCause();
        }
        return new ApiException(503, "DEPENDENCY_UNAVAILABLE");
    }
}
