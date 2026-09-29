package lab.ledgerguard.admin;

import java.util.UUID;
import lab.ledgerguard.auth.Identity;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/admin")
public final class AdminInvestigationController {
    private final AdminInvestigationService service;
    public AdminInvestigationController(AdminInvestigationService service) { this.service=service; }
    @GetMapping("/transactions")
    public ResponseEntity<AdminInvestigationService.Search> search(@AuthenticationPrincipal Identity admin,
            @RequestParam MultiValueMap<String,String> filters) {
        return noStore(service.search(admin, AdminFilters.transactions(filters)));
    }
    @GetMapping("/transactions/{id}")
    public ResponseEntity<AdminInvestigationService.Detail> detail(@AuthenticationPrincipal Identity admin,@PathVariable String id) {
        return noStore(service.detail(admin, AdminFilters.uuid(id)));
    }
    @GetMapping("/audit")
    public ResponseEntity<AdminInvestigationService.AuditPage> audit(@AuthenticationPrincipal Identity admin,
            @RequestParam MultiValueMap<String,String> filters) {
        return noStore(service.audit(admin, AdminFilters.audit(filters)));
    }
    static <T> ResponseEntity<T> noStore(T body) { return ResponseEntity.ok().header("Cache-Control","no-store").body(body); }
}
