package lab.ledgerguard.config;

import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import lab.ledgerguard.auth.*;
import lab.ledgerguard.http.ApiProblems;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.header.writers.StaticHeadersWriter;

@Configuration
public class FoundationSecurityConfiguration {
    @Bean PasswordEncoder passwordEncoder(SecuritySettings settings) { return new BCryptPasswordEncoder(settings.bcryptStrength); }
    @Bean UserDetailsService noDefaultUser() { return username->{throw new UsernameNotFoundException("Unsupported authentication mechanism");}; }
    @Bean CookieCsrfTokenRepository csrfRepository(SecuritySettings settings) {
        CookieCsrfTokenRepository repository=new CookieCsrfTokenRepository();
        repository.setCookieName(settings.csrfCookie());
        repository.setCookiePath("/");
        repository.setCookieCustomizer(cookie->cookie.httpOnly(true).secure(!settings.sandboxHttp).sameSite("Strict"));
        return repository;
    }
    @Bean Jackson2ObjectMapperBuilderCustomizer strictJson() {
        return builder->builder.featuresToEnable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
            DeserializationFeature.FAIL_ON_TRAILING_TOKENS).postConfigurer(mapper->mapper.getFactory().setStreamReadConstraints(
                StreamReadConstraints.builder().maxNestingDepth(20).maxStringLength(16384).maxNumberLength(32).build()));
    }
    @Bean SecurityFilterChain foundationSecurity(HttpSecurity http,SecuritySettings settings,JwtSessions sessions,
            SecurityEvents events,ObjectMapper json,CookieCsrfTokenRepository csrf) throws Exception {
        http.sessionManagement(session->session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .requestCache(AbstractHttpConfigurer::disable)
            .csrf(config->config.csrfTokenRepository(csrf))
            .authorizeHttpRequests(authorize->authorize
                .requestMatchers(HttpMethod.GET,"/actuator/health/**","/actuator/info","/api/v1/system","/api/v1/openapi.json","/api/v1/auth/csrf").permitAll()
                .requestMatchers(HttpMethod.POST,"/api/v1/auth/register","/api/v1/auth/login").permitAll()
                .requestMatchers("/api/v1/auth/me","/api/v1/auth/logout").authenticated()
                .requestMatchers("/api/v1/accounts","/api/v1/accounts/**","/api/v1/recipients/**").hasRole("CUSTOMER")
                .requestMatchers("/api/v1/admin/**","/actuator/metrics","/actuator/metrics/**").hasRole("ADMIN")
                .anyRequest().denyAll())
            .exceptionHandling(errors->errors
                .authenticationEntryPoint((request,response,failure)->ApiProblems.write(json,response,401,"AUTHENTICATION_REQUIRED"))
                .accessDeniedHandler((request,response,failure)->{
                    events.denied(null,"ACCESS_DENIED");
                    ApiProblems.write(json,response,403,failure instanceof org.springframework.security.web.csrf.CsrfException?"CSRF_INVALID":"FORBIDDEN");
                }))
            .headers(headers->headers.contentSecurityPolicy(csp->csp.policyDirectives("default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'"))
                .referrerPolicy(policy->policy.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER))
                .addHeaderWriter(new StaticHeadersWriter("Permissions-Policy","camera=(), microphone=(), geolocation=()")))
            .httpBasic(AbstractHttpConfigurer::disable).formLogin(AbstractHttpConfigurer::disable).logout(AbstractHttpConfigurer::disable);
        http.addFilterBefore(new SessionAuthenticationFilter(sessions,settings,events,json),CsrfFilter.class);
        http.addFilterBefore(new HttpRequestBoundary(settings,json,events),SessionAuthenticationFilter.class);
        return http.build();
    }
}
