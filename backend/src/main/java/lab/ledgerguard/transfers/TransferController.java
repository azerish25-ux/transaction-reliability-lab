package lab.ledgerguard.transfers;

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
@RequestMapping("/api/v1/transfers")
public class TransferController {
    private final TransferService transfers;
    public TransferController(TransferService transfers) { this.transfers = transfers; }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> create(@AuthenticationPrincipal Identity identity,
            @RequestHeader(name = "Idempotency-Key", required = false) String key,
            @RequestBody TransferService.CreateTransfer request) {
        TransferService.CommandResult result = transfers.create(identity, key, request);
        var response = ResponseEntity.status(result.status())
            .header("Idempotency-Replayed", Boolean.toString(result.replayed()))
            .header("Cache-Control", "no-store")
            .contentType(MediaType.APPLICATION_JSON);
        if (result.transferId() != null) response.location(URI.create("/api/v1/transfers/" + result.transferId()));
        return response.body(result.body());
    }

    @GetMapping("/{id}")
    public TransferService.Transfer get(@AuthenticationPrincipal Identity identity, @PathVariable UUID id) {
        return transfers.get(identity, id);
    }

    @GetMapping
    public Page<TransferService.Transfer> list(@AuthenticationPrincipal Identity identity,
            @RequestParam(defaultValue = "50") int limit, @RequestParam(defaultValue = "0") int offset) {
        return transfers.list(identity, limit, offset);
    }
}
