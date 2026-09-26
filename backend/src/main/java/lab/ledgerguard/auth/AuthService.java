package lab.ledgerguard.auth;

import java.util.UUID;
import lab.ledgerguard.http.ApiException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AuthService {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;
    private final JwtSessions sessions;
    private final SecurityEvents events;
    private final AuthBudgets budgets;
    private final TransactionTemplate transaction;
    private final String dummyHash;
    public AuthService(JdbcTemplate jdbc, PasswordEncoder passwords, JwtSessions sessions,
                       SecurityEvents events, AuthBudgets budgets, TransactionTemplate transaction) {
        this.jdbc=jdbc; this.passwords=passwords; this.sessions=sessions; this.events=events;
        this.budgets=budgets; this.transaction=transaction;
        dummyHash=passwords.encode(UUID.randomUUID().toString());
    }
    public record Registered(UUID id, String email, String displayName, String role) { }
    public Registered register(String email, String password, String displayName, String address) {
        String normalized=Inputs.email(email), name=Inputs.label(displayName);
        Inputs.password(password);
        budgets.check("register",address,normalized);
        String hash=passwords.encode(password);
        try {
            return transaction.execute(status -> {
                UUID id=jdbc.queryForObject("SELECT ledger.register_customer(?,?,?)",UUID.class,normalized,hash,name);
                events.record(id,"REGISTERED");
                return new Registered(id,normalized,name,"CUSTOMER");
            });
        } catch(DuplicateKeyException duplicate) {
            events.denied(null,"REGISTRATION_REJECTED");
            throw new ApiException(409,"REGISTRATION_REJECTED");
        }
    }
    private record LoginRow(UUID id,String hash,boolean enabled) { }
    public JwtSessions.Issued login(String email,String password,String address) {
        String normalized=Inputs.email(email);
        Inputs.password(password);
        budgets.check("login",address,normalized);
        var rows=jdbc.query("SELECT id,password_hash,enabled FROM ledger.app_users WHERE email=?",
            (rs,n)->new LoginRow(rs.getObject("id",UUID.class),rs.getString("password_hash"),rs.getBoolean("enabled")),normalized);
        LoginRow row=rows.isEmpty()?null:rows.getFirst();
        boolean matches=passwords.matches(password,row==null?dummyHash:row.hash());
        if(!matches || row==null || !row.enabled()) {
            events.denied(null,"LOGIN_FAILED");
            throw new ApiException(401,"INVALID_CREDENTIALS");
        }
        try {
            return transaction.execute(status->{
                JwtSessions.Issued issued=sessions.issue(row.id());
                events.record(row.id(),"LOGIN_SUCCEEDED");
                return issued;
            });
        } catch(JwtException invalid) { throw new ApiException(401,"INVALID_CREDENTIALS"); }
    }
    public void logout(Identity identity) {
        transaction.executeWithoutResult(status->{ sessions.revoke(identity); events.record(identity.userId(),"LOGOUT"); });
    }
}
