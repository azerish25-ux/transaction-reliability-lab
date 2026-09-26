package lab.ledgerguard.accounts;

import java.net.URI;
import java.util.UUID;
import lab.ledgerguard.auth.Identity;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class AccountController {
    private final AccountService accounts;
    public AccountController(AccountService accounts) { this.accounts=accounts; }
    public record CreateAccount(String name,String currency) { }
    @PostMapping(value="/accounts",consumes="application/json")
    public ResponseEntity<AccountService.Account> create(@AuthenticationPrincipal Identity identity,@RequestBody CreateAccount body) {
        var account=accounts.create(identity,body.name(),body.currency());
        return ResponseEntity.created(URI.create("/api/v1/accounts/"+account.id())).body(account);
    }
    @GetMapping("/accounts")
    public Page<AccountService.Account> list(@AuthenticationPrincipal Identity identity,
            @RequestParam(defaultValue="50") int limit,@RequestParam(defaultValue="0") int offset) {
        return accounts.list(identity,limit,offset);
    }
    @GetMapping("/accounts/{id}")
    public AccountService.Account get(@AuthenticationPrincipal Identity identity,@PathVariable UUID id) { return accounts.get(identity,id); }
    @GetMapping("/accounts/{id}/entries")
    public Page<AccountService.Entry> entries(@AuthenticationPrincipal Identity identity,@PathVariable UUID id,
            @RequestParam(defaultValue="50") int limit,@RequestParam(defaultValue="0") int offset) { return accounts.entries(identity,id,limit,offset); }
    @GetMapping("/accounts/{id}/transactions")
    public Page<AccountService.Transaction> transactions(@AuthenticationPrincipal Identity identity,@PathVariable UUID id,
            @RequestParam(defaultValue="50") int limit,@RequestParam(defaultValue="0") int offset) { return accounts.transactions(identity,id,limit,offset); }
    @GetMapping("/recipients/{publicRef}")
    public AccountService.Recipient recipient(@PathVariable String publicRef) { return accounts.recipient(publicRef); }
}
