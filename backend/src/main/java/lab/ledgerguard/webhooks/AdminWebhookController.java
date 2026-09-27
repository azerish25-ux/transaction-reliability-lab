package lab.ledgerguard.webhooks;

import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
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
@RequestMapping("/api/v1/admin/webhook-deliveries")
public class AdminWebhookController {
    private final WebhookService webhooks;

    public AdminWebhookController(WebhookService webhooks) { this.webhooks = webhooks; }

    @GetMapping
    public Page<WebhookRepository.Delivery> list(@RequestParam(required = false) String state,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        return webhooks.adminDeliveries(state, limit, offset);
    }

    @GetMapping("/{id}")
    public WebhookService.DeliveryDetail get(@PathVariable UUID id) {
        return webhooks.adminDelivery(id);
    }

    @PostMapping(value = "/{id}/retry", consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    public WebhookService.DeliveryDetail retry(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id, @RequestBody WebhookService.RetryDelivery request) {
        return webhooks.adminRetry(identity, id, request);
    }
}
