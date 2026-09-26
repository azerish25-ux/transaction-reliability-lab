package lab.ledgerguard.admin;

import java.util.Map;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.messaging.FailedWorkRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/admin/failed-work")
public class FailedWorkController {
    private final FailedWorkRepository failed;
    public FailedWorkController(FailedWorkRepository failed){this.failed=failed;}

    @GetMapping
    public Page<FailedWorkRepository.FailedWork> list(@RequestParam(defaultValue="50") int limit,
            @RequestParam(defaultValue="0") int offset){return failed.list(limit,offset);}

    @GetMapping("/{id}")
    public FailedWorkRepository.FailedWork get(@PathVariable UUID id){return failed.get(id);}

    @PostMapping("/{id}/replay")
    public ResponseEntity<Map<String,Object>> replay(@AuthenticationPrincipal Identity identity,@PathVariable UUID id){
        failed.request(identity,id);
        return ResponseEntity.accepted().header("Cache-Control","no-store")
            .body(Map.of("id",id,"state","REPLAY_REQUESTED"));
    }
}
