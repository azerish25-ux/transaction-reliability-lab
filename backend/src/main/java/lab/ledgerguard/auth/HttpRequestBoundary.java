package lab.ledgerguard.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import lab.ledgerguard.http.ApiProblems;
import org.springframework.web.filter.OncePerRequestFilter;

/** Bounds even chunked bodies before deserialization; no permissive cross-origin browser API. */
public final class HttpRequestBoundary extends OncePerRequestFilter {
    private static final int MAX_BODY=16384;
    private final SecuritySettings settings;
    private final ObjectMapper json;
    private final SecurityEvents events;
    public HttpRequestBoundary(SecuritySettings settings,ObjectMapper json,SecurityEvents events) {
        this.settings=settings; this.json=json; this.events=events;
    }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)
            throws IOException,ServletException {
        response.setHeader("Cache-Control","no-store");
        boolean unsafe=!Set.of("GET","HEAD","OPTIONS").contains(request.getMethod());
        if(settings.sandboxHttp && !Set.of("localhost","127.0.0.1","[::1]","::1").contains(request.getServerName())) {
            ApiProblems.write(json,response,403,"SANDBOX_LOOPBACK_ONLY"); return;
        }
        if(unsafe && ("cross-site".equals(request.getHeader("Sec-Fetch-Site")) || !allowedOrigin(request))) {
            events.denied(null,"ACCESS_DENIED"); ApiProblems.write(json,response,403,"ORIGIN_FORBIDDEN"); return;
        }
        if(request.getRequestURI().startsWith("/api/") && unsafe) {
            if(request.getContentLengthLong()>MAX_BODY) { ApiProblems.write(json,response,413,"REQUEST_TOO_LARGE"); return; }
            byte[] body=request.getInputStream().readNBytes(MAX_BODY+1);
            if(body.length>MAX_BODY) { ApiProblems.write(json,response,413,"REQUEST_TOO_LARGE"); return; }
            HttpServletRequestWrapper buffered=new HttpServletRequestWrapper(request) {
                @Override public ServletInputStream getInputStream() {
                    ByteArrayInputStream source=new ByteArrayInputStream(body);
                    return new ServletInputStream() {
                        @Override public int read() { return source.read(); }
                        @Override public boolean isFinished() { return source.available()==0; }
                        @Override public boolean isReady() { return true; }
                        @Override public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException("Synchronous API"); }
                    };
                }
                @Override public BufferedReader getReader() { return new BufferedReader(new InputStreamReader(getInputStream(),StandardCharsets.UTF_8)); }
            };
            chain.doFilter(buffered,response); return;
        }
        chain.doFilter(request,response);
    }
    private boolean allowedOrigin(HttpServletRequest request) {
        String value=request.getHeader("Origin");
        if(value==null) return true; // Non-browser clients still need authentication and a CSRF token.
        if(!settings.sandboxHttp) return settings.publicOrigin.equals(value);
        try {
            URI origin=URI.create(value);
            int port=origin.getPort()==-1?80:origin.getPort();
            return "http".equals(origin.getScheme()) && request.getServerName().equalsIgnoreCase(origin.getHost())
                && port==request.getServerPort() && origin.getUserInfo()==null && origin.getPath().isEmpty()
                && origin.getQuery()==null && origin.getFragment()==null;
        } catch(IllegalArgumentException invalid) { return false; }
    }
}
