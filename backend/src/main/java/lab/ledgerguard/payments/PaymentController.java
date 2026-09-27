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
        URI location = result.resourceId() == null ? null : URI.create("/api/v1/payments/" + result.resourceId());
        return response(result, location);
    }

    @PostMapping(path="/{id}/cancel",consumes=MediaType.APPLICATION_JSON_VALUE,produces=MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> cancel(@AuthenticationPrincipal Identity identity,@PathVariable UUID id,
            @RequestHeader(name="Idempotency-Key",required=false) String key,
            @RequestBody(required=false) PaymentService.CancelPayment request) {
        PaymentService.CommandResult result = payments.cancel(identity, id, key, request);
        return response(result, URI.create("/api/v1/payments/" + id));
    }

    @PostMapping(path="/{id}/refunds",consumes=MediaType.APPLICATION_JSON_VALUE,produces=MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> refund(@AuthenticationPrincipal Identity identity,@PathVariable UUID id,
            @RequestHeader(name="Idempotency-Key",required=false) String key,
            @RequestBody PaymentService.RefundPayment request) {
        PaymentService.CommandResult result = payments.refund(identity, id, key, request);
        URI location = result.resourceId() == null ? null
            : URI.create("/api/v1/payments/" + id + "/adjustments/" + result.resourceId());
        return response(result, location);
    }

    @PostMapping(path="/{id}/reversal",consumes=MediaType.APPLICATION_JSON_VALUE,produces=MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> reverse(@AuthenticationPrincipal Identity identity,@PathVariable UUID id,
            @RequestHeader(name="Idempotency-Key",required=false) String key,
            @RequestBody PaymentService.ReversePayment request) {
        PaymentService.CommandResult result = payments.reverse(identity, id, key, request);
        URI location = result.resourceId() == null ? null
            : URI.create("/api/v1/payments/" + id + "/adjustments/" + result.resourceId());
        return response(result, location);
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

    @GetMapping("/{id}/adjustments")
    public Page<PaymentService.Adjustment> adjustments(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id,@RequestParam(defaultValue="50") int limit,
            @RequestParam(defaultValue="0") int offset) {
        return payments.listAdjustments(identity,id,limit,offset);
    }

    @GetMapping("/{id}/adjustments/{adjustmentId}")
    public PaymentService.Adjustment adjustment(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id,@PathVariable UUID adjustmentId) {
        return payments.getAdjustment(identity,id,adjustmentId);
    }

    private static ResponseEntity<JsonNode> response(PaymentService.CommandResult result, URI location) {
        var response = ResponseEntity.status(result.status())
            .header("Idempotency-Replayed", Boolean.toString(result.replayed()))
            .header("Cache-Control", "no-store")
            .contentType(MediaType.APPLICATION_JSON);
        if (location != null && result.status() < 300) response.location(location);
        return response.body(result.body());
    }
}
