package lab.ledgerguard.payments;

import java.util.UUID;
import lab.ledgerguard.auth.Identity;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PaymentAdjustmentContextController {
    private final PaymentAdjustmentQueries queries;
    public PaymentAdjustmentContextController(PaymentAdjustmentQueries queries) { this.queries = queries; }
    @GetMapping("/api/v1/payments/{id}/adjustment-context")
    public ResponseEntity<PaymentAdjustmentQueries.Context> customer(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(queries.customer(identity, id));
    }
    @GetMapping("/api/v1/admin/payments/{id}/adjustment-context")
    public ResponseEntity<PaymentAdjustmentQueries.Context> administrator(@AuthenticationPrincipal Identity identity,
            @PathVariable UUID id) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(queries.administrator(identity, id));
    }
}
