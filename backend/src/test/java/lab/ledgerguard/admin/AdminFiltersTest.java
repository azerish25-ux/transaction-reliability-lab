package lab.ledgerguard.admin;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.http.ApiException;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AdminFiltersTest {
    static AdminFilters filters(String key,String value) { return AdminFilters.transactions(Map.of(key,List.of(value))); }
    @Test void P08FUT01_defaultsAndPaginationBounds() {
        assertEquals(25,AdminFilters.transactions(Map.of()).limit());
        for(String value:List.of("0","101","1.5","-1","100000","+2")) assertThrows(ApiException.class,()->filters("limit",value));
        assertThrows(ApiException.class,()->filters("offset","10001"));
        assertEquals(10000,filters("offset","10000").offset());
    }
    @Test void P08FUT02_unknownAndDuplicateFiltersRejected() {
        assertThrows(ApiException.class,()->filters("sort","amount; DROP TABLE ledger.accounts"));
        assertThrows(ApiException.class,()->AdminFilters.transactions(Map.of("kind",List.of("PAYMENT","TRANSFER"))));
    }
    @Test void P08FUT03_identifiersRequireCanonicalUuidSyntax() {
        assertThrows(ApiException.class,()->filters("reference","1-1-1-1-1"));
        assertThrows(ApiException.class,()->filters("reference","../../audit"));
        assertEquals("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",filters("reference","AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA").values().get("reference"));
    }
    @Test void P08FUT04_allRequiredKindsStatesCurrenciesAccepted() {
        for(String kind:List.of("FUNDING","TRANSFER","PAYMENT","REFUND","REVERSAL")) assertEquals(kind,filters("kind",kind).values().get("kind"));
        for(String state:List.of("PENDING","SETTLED","FAILED","CANCELLED")) filters("status",state);
        for(String currency:List.of("CAD","USD","JPY","KWD")) filters("currency",currency);
        assertThrows(ApiException.class,()->filters("kind","ALL")); assertThrows(ApiException.class,()->filters("currency","EUR"));
    }
    @Test void P08FUT05_exactMoneyBoundsAndNoFloat() {
        assertEquals("9007199254740993",filters("minAmountMinor","9007199254740993").values().get("minAmountMinor"));
        assertEquals(Long.toString(Long.MAX_VALUE),filters("maxAmountMinor",Long.toString(Long.MAX_VALUE)).values().get("maxAmountMinor"));
        for(String value:List.of("-1","1e3","1.00","01","9223372036854775808")) assertThrows(ApiException.class,()->filters("minAmountMinor",value));
    }
    @Test void P08FUT06_invertedAmountRangeRejected() {
        assertThrows(ApiException.class,()->AdminFilters.transactions(Map.of("minAmountMinor",List.of("200"),"maxAmountMinor",List.of("100"))));
    }
    @Test void P08FUT07_utcOnlyTemporalBounds() {
        assertEquals(Instant.parse("2026-09-01T12:30:00Z"),AdminFilters.instant("2026-09-01T12:30:00Z"));
        for(String value:List.of("2026-09-01","2026-09-01T12:30:00-03:00","2026-09-01T12:30:00","not-a-date")) assertThrows(ApiException.class,()->filters("from",value));
    }
    @Test void P08FUT08_halfOpenRangeMustAdvance() {
        String time="2026-09-01T00:00:00Z";
        assertThrows(ApiException.class,()->AdminFilters.transactions(Map.of("from",List.of(time),"to",List.of(time))));
    }
    @Test void P08FUT09_accountAndUserNormalization() {
        assertEquals("LG-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",filters("account","lg-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").values().get("account"));
        assertEquals("alice@example.test",filters("user"," Alice@Example.Test ").values().get("user"));
        assertThrows(ApiException.class,()->filters("account","' OR 1=1 --")); assertThrows(ApiException.class,()->filters("user","everyone"));
    }
    @Test void P08FUT10_auditFiltersDoNotExposeArbitraryPredicates() {
        assertThrows(ApiException.class,()->AdminFilters.audit(Map.of("reason",List.of("password"))));
        assertThrows(ApiException.class,()->AdminFilters.audit(Map.of("action",List.of("TRANSFER'--"))));
        assertEquals("REFUND",AdminFilters.audit(Map.of("action",List.of("REFUND"))).values().get("action"));
    }
    @Test void P08FUT11_serviceDefenseRejectsMissingOrCustomerIdentity() {
        assertEquals(401,assertThrows(ApiException.class,()->AdminAccess.require(null)).status());
        Identity customer=new Identity(UUID.randomUUID(),UUID.randomUUID(),"fixture@example.test","Customer","CUSTOMER",Instant.now().plusSeconds(60));
        assertEquals(403,assertThrows(ApiException.class,()->AdminAccess.require(customer)).status());
        AdminAccess.require(new Identity(customer.userId(),customer.sessionId(),customer.email(),"Admin","ADMIN",customer.expiresAt()));
    }
    @Test void P08FUT12_filtersAreImmutableAndControlCharactersRejected() {
        assertThrows(UnsupportedOperationException.class,()->filters("kind","PAYMENT").values().put("sql","bad"));
        assertThrows(ApiException.class,()->filters("user","alice@exam\nple.test"));
        assertThrows(ApiException.class,()->filters("user","a".repeat(255)));
    }
}
