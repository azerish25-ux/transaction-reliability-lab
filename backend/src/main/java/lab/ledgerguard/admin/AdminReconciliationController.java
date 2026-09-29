package lab.ledgerguard.admin;

import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/admin/reconciliation")
public final class AdminReconciliationController {
    public record Run(String id) { }
    private final AdminReconciliationService service;
    public AdminReconciliationController(AdminReconciliationService service) { this.service=service; }
    @GetMapping
    public ResponseEntity<Page<AdminReconciliationService.Summary>> history(@AuthenticationPrincipal Identity admin,
            @RequestParam MultiValueMap<String,String> filters) {
        return AdminInvestigationController.noStore(service.history(admin,AdminFilters.paging(filters)));
    }
    @GetMapping("/{id}")
    public ResponseEntity<AdminReconciliationService.Report> get(@AuthenticationPrincipal Identity admin,@PathVariable String id) {
        return AdminInvestigationController.noStore(service.get(admin,AdminFilters.uuid(id)));
    }
    @PostMapping
    public ResponseEntity<AdminReconciliationService.Report> run(@AuthenticationPrincipal Identity admin,@RequestBody Run command) {
        var saved=service.run(admin,AdminFilters.uuid(command.id()));
        return ResponseEntity.status(saved.replayed()?200:201).header("Cache-Control","no-store")
            .header("Idempotency-Replayed",Boolean.toString(saved.replayed()))
            .header("Location","/api/v1/admin/reconciliation/"+saved.report().id()).body(saved.report());
    }
}
