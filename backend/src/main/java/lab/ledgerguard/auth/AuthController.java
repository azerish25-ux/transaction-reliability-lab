package lab.ledgerguard.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthService auth;
    private final SecuritySettings settings;
    private final CookieCsrfTokenRepository csrf;
    public AuthController(AuthService auth,SecuritySettings settings,CookieCsrfTokenRepository csrf) {
        this.auth=auth; this.settings=settings; this.csrf=csrf;
    }
    public record Register(String email,String password,String displayName) { }
    public record Login(String email,String password) { }
    public record CsrfView(String headerName,String token) { }
    @GetMapping("/csrf")
    public CsrfView csrf(CsrfToken token) { return new CsrfView(token.getHeaderName(),token.getToken()); }
    @PostMapping(value="/register",consumes="application/json")
    public ResponseEntity<AuthService.Registered> register(@RequestBody Register body,HttpServletRequest request) {
        return ResponseEntity.status(201).body(auth.register(body.email(),body.password(),body.displayName(),request.getRemoteAddr()));
    }
    @PostMapping(value="/login",consumes="application/json")
    public Identity.UserView login(@RequestBody Login body,HttpServletRequest request,HttpServletResponse response) {
        JwtSessions.Issued issued=auth.login(body.email(),body.password(),request.getRemoteAddr());
        response.addHeader("Set-Cookie",ResponseCookie.from(settings.sessionCookie(),issued.token()).httpOnly(true)
            .secure(!settings.sandboxHttp).sameSite("Strict").path("/").maxAge(settings.sessionTtl).build().toString());
        // Authentication is performed by our JSON controller, so explicitly rotate CSRF here.
        csrf.saveToken(null,request,response);
        return issued.identity().view();
    }
    @GetMapping("/me")
    public Identity.UserView me(@AuthenticationPrincipal Identity identity) { return identity.view(); }
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal Identity identity,HttpServletRequest request,HttpServletResponse response) {
        auth.logout(identity);
        response.addHeader("Set-Cookie",ResponseCookie.from(settings.sessionCookie(),"").httpOnly(true)
            .secure(!settings.sandboxHttp).sameSite("Strict").path("/").maxAge(0).build().toString());
        csrf.saveToken(null,request,response);
        return ResponseEntity.noContent().build();
    }
}
