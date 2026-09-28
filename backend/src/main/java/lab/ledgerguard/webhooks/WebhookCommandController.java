package lab.ledgerguard.webhooks;

import java.util.UUID;
import lab.ledgerguard.auth.Identity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@ConditionalOnProperty(name = "ledgerguard.webhooks.api-enabled", havingValue = "true")
@RequestMapping("/api/v1/webhook-commands")
public class WebhookCommandController {
    private final WebhookCommandService commands;
    public WebhookCommandController(WebhookCommandService commands) { this.commands = commands; }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<WebhookCommandService.Result> execute(@AuthenticationPrincipal Identity actor,
            @RequestHeader("Idempotency-Key") String key, @RequestBody WebhookCommandService.Command body) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(commands.execute(actor, key, body));
    }

    @GetMapping(value = "/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<WebhookCommandService.Result> get(@AuthenticationPrincipal Identity actor, @PathVariable UUID id) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(commands.get(actor, id));
    }
}
