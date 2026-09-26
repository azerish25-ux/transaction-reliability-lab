package lab.ledgerguard.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.List;
import lab.ledgerguard.http.ApiProblems;
import org.springframework.dao.DataAccessException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.web.filter.OncePerRequestFilter;

public final class SessionAuthenticationFilter extends OncePerRequestFilter {
    private final JwtSessions sessions;
    private final SecuritySettings settings;
    private final SecurityEvents events;
    private final ObjectMapper json;
    public SessionAuthenticationFilter(JwtSessions sessions,SecuritySettings settings,SecurityEvents events,ObjectMapper json) {
        this.sessions=sessions; this.settings=settings; this.events=events; this.json=json;
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        String path=request.getRequestURI();
        return path.equals("/api/v1/auth/csrf") || path.equals("/api/v1/auth/login") || path.equals("/api/v1/auth/register")
            || path.startsWith("/actuator/health") || path.equals("/api/v1/system") || path.equals("/actuator/info");
    }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)
            throws IOException,ServletException {
        String value=null;
        boolean duplicate=false;
        if(request.getCookies()!=null) for(Cookie cookie:request.getCookies()) {
            if(settings.sessionCookie().equals(cookie.getName())) { duplicate=value!=null; value=cookie.getValue(); }
        }
        if(value!=null) {
            try {
                if(duplicate || value.length()>4096) throw new JwtException("Invalid session cookie");
                Identity identity=sessions.authenticate(value);
                var context=SecurityContextHolder.createEmptyContext();
                context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(identity,null,
                    List.of(new SimpleGrantedAuthority("ROLE_"+identity.role()))));
                SecurityContextHolder.setContext(context);
            } catch(JwtException | IllegalArgumentException failure) {
                events.denied(null,"TOKEN_REJECTED");
                ApiProblems.write(json,response,401,"SESSION_INVALID"); return;
            } catch(DataAccessException unavailable) {
                ApiProblems.write(json,response,503,"DEPENDENCY_UNAVAILABLE"); return;
            }
        }
        chain.doFilter(request,response);
    }
}
