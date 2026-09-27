package lab.ledgerguard.webhooks;

import java.net.URI;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@ConditionalOnProperty(name = "ledgerguard.webhooks.api-enabled", havingValue = "true")
@RequestMapping("/api/v1")
public class WebhookController {
    private final WebhookService webhooks;

    public WebhookController(WebhookService webhooks) { this.webhooks = webhooks; }

    @PostMapping(value = "/webhook-endpoints", consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<WebhookService.EndpointSecret> create(@AuthenticationPrincipal Identity identity,
            @RequestBody WebhookService.CreateEndpoint request) {
        WebhookService.EndpointSecret result = webhooks.create(identity, request);
        return ResponseEntity.created(URI.create("/api/v1/webhook-endpoints/" + result.endpoint().id()))
            .header("Cache-Control", "no-store").body(result);
    }

    @GetMapping("/webhook-endpoints")
    public Page<WebhookRepository.Endpoint> list(@AuthenticationPrincipal Identity identity,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        return webhooks.list(identity, limit, offset);
    }

    @GetMapping("/webhook-endpoints/{id}")
    public WebhookRepository.Endpoint get(@AuthenticationPrincipal Identity identity, @PathVariable UUID id) {
        return webhooks.get(identity, id);
    }

    @PostMapping(value = "/webhook-endpoints/{id}/state", consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    public WebhookRepository.Endpoint state(@AuthenticationPrincipal Identity identity, @PathVariable UUID id,
            @RequestBody WebhookService.UpdateEndpoint request) {
        return webhooks.update(identity, id, request);
    }

    @PostMapping(value = "/webhook-endpoints/{id}/rotate-secret", consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<WebhookService.EndpointSecret> rotate(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id, @RequestBody WebhookService.RotateSecret request) {
        return ResponseEntity.ok().header("Cache-Control", "no-store")
            .body(webhooks.rotate(identity, id, request));
    }

    @GetMapping("/webhook-endpoints/{id}/deliveries")
    public Page<WebhookRepository.Delivery> deliveries(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id, @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        return webhooks.deliveries(identity, id, limit, offset);
    }

    @GetMapping("/webhook-deliveries/{id}")
    public WebhookService.DeliveryDetail delivery(@AuthenticationPrincipal Identity identity,
                                                   @PathVariable UUID id) {
        return webhooks.delivery(identity, id);
    }

    @PostMapping(value = "/webhook-deliveries/{id}/retry", consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    public WebhookService.DeliveryDetail retry(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id, @RequestBody WebhookService.RetryDelivery request) {
        return webhooks.retry(identity, id, request);
    }
}
