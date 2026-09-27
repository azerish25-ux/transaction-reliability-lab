package lab.ledgerguard.payments;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/payments")
public class PaymentController {
    private final PaymentService payments;
    public PaymentController(PaymentService payments) { this.payments = payments; }

    @PostMapping(consumes=MediaType.APPLICATION_JSON_VALUE,produces=MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> create(@AuthenticationPrincipal Identity identity,
            @RequestHeader(name="Idempotency-Key",required=false) String key,
            @RequestBody PaymentService.CreatePayment request) {
        PaymentService.CommandResult result = payments.create(identity, key, request);
        var response = ResponseEntity.status(result.status())
            .header("Idempotency-Replayed", Boolean.toString(result.replayed()))
            .header("Cache-Control", "no-store")
            .contentType(MediaType.APPLICATION_JSON);
        if (result.paymentId() != null) response.location(URI.create("/api/v1/payments/" + result.paymentId()));
        return response.body(result.body());
    }

    @GetMapping("/{id}")
    public PaymentService.Payment get(@AuthenticationPrincipal Identity identity,@PathVariable UUID id) {
        return payments.get(identity,id);
    }

    @GetMapping
    public Page<PaymentService.Payment> list(@AuthenticationPrincipal Identity identity,
            @RequestParam(defaultValue="50") int limit,@RequestParam(defaultValue="0") int offset) {
        return payments.list(identity,limit,offset);
    }
}
