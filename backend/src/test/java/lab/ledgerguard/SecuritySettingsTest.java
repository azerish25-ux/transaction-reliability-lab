package lab.ledgerguard;

import java.security.SecureRandom;
import java.util.Base64;
import lab.ledgerguard.auth.Inputs;
import lab.ledgerguard.auth.SecuritySettings;
import lab.ledgerguard.http.ApiException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;

class SecuritySettingsTest {
    static MockEnvironment environment() {
        byte[] key=new byte[64];new SecureRandom().nextBytes(key);
        return new MockEnvironment().withProperty("ledgerguard.auth.key",Base64.getEncoder().encodeToString(key));
    }
    @Test void P03U01_keyMustBeProvisioned() { assertThrows(IllegalStateException.class,()->new SecuritySettings(new MockEnvironment())); }
    @Test void P03U02_weakKeyRejected() {
        var env=environment().withProperty("ledgerguard.auth.key",Base64.getEncoder().encodeToString(new byte[16]));
        assertThrows(IllegalStateException.class,()->new SecuritySettings(env));
    }
    @Test void P03U03_insecureCookiesRequireExplicitSandboxProfile() {
        var env=environment().withProperty("ledgerguard.auth.sandbox-http","true");assertThrows(IllegalStateException.class,()->new SecuritySettings(env));
        env.setActiveProfiles("sandbox");assertEquals("LG-SESSION",new SecuritySettings(env).sessionCookie());
    }
    @Test void P03U04_releaseDefaults() {
        var settings=new SecuritySettings(environment());assertFalse(settings.sandboxHttp);assertEquals("__Host-LG-SESSION",settings.sessionCookie());
        assertEquals("__Host-LG-CSRF",settings.csrfCookie());assertEquals(900,settings.sessionTtl.toSeconds());assertEquals(12,settings.bcryptStrength);
    }
    @ParameterizedTest @ValueSource(strings={"PT0S","PT31M","P1D"})
    void P03U05_sessionDurationBounds(String duration) {
        assertThrows(IllegalStateException.class,()->new SecuritySettings(environment().withProperty("ledgerguard.auth.session-ttl",duration)));
    }
    @ParameterizedTest @ValueSource(strings={"http://example.test","https://example.test/path","https://user@example.test","https://example.test?x=1"})
    void P03U06_originMustBeBareHttps(String origin) {
        assertThrows(IllegalStateException.class,()->new SecuritySettings(environment().withProperty("ledgerguard.auth.public-origin",origin)));
    }
    @Test void P03U07_passwordUtf8BoundaryNeverTruncates() {
        assertEquals("x".repeat(72),Inputs.password("x".repeat(72)));
        assertThrows(ApiException.class,()->Inputs.password("x".repeat(73)));
        assertThrows(ApiException.class,()->Inputs.password("é".repeat(37)));
        assertThrows(ApiException.class,()->Inputs.password("short"));
    }
    @Test void P03U08_currencyAndLabelsAreBounded() {
        assertThrows(ApiException.class,()->Inputs.currency("BTC"));assertThrows(ApiException.class,()->Inputs.currency("cad"));
        assertThrows(ApiException.class,()->Inputs.label("x".repeat(81)));assertThrows(ApiException.class,()->Inputs.label(" "));
    }
}
