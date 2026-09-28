package lab.ledgerguard.webhooks;

import static org.junit.jupiter.api.Assertions.*;
import java.util.Map;
import java.util.UUID;
import lab.ledgerguard.http.ApiException;
import org.junit.jupiter.api.Test;

class WebhookCommandTest {
    private static final UUID ID = UUID.fromString("a0000000-0000-0000-0000-000000000001");
    private static WebhookCommandService.Command command(String kind, UUID endpoint, UUID delivery,
            Long version, Integer cycle, Boolean enabled, String reason) {
        return new WebhookCommandService.Command(kind, endpoint, delivery, version, cycle, enabled, reason);
    }
    @Test void P08EUT01_create_has_only_the_approved_implicit_destination() {
        assertEquals(Map.of("kind", "CREATE"), WebhookCommandService.normalize(command("CREATE",null,null,null,null,null,null)));
        assertThrows(ApiException.class, () -> WebhookCommandService.normalize(command("CREATE",ID,null,null,null,null,null)));
    }
    @Test void P08EUT02_state_preserves_exact_expected_version() {
        Map<String,Object> result = WebhookCommandService.normalize(command("STATE",ID,null,7L,null,false,null));
        assertEquals(7L,result.get("expectedVersion")); assertEquals(false,result.get("enabled")); assertEquals(ID.toString(),result.get("endpointId"));
    }
    @Test void P08EUT03_rotation_has_no_secret_or_state_in_its_request() {
        assertEquals(3,WebhookCommandService.normalize(command("ROTATE",ID,null,1L,null,null,null)).size());
        assertThrows(ApiException.class, () -> WebhookCommandService.normalize(command("ROTATE",ID,null,1L,null,true,null)));
    }
    @Test void P08EUT04_versions_reject_unsafe_or_missing_values() {
        for (Long version : new Long[]{null,0L,-1L,9_007_199_254_740_991L,Long.MAX_VALUE}) {
            assertThrows(ApiException.class, () -> WebhookCommandService.normalize(command("STATE",ID,null,version,null,true,null)));
        }
    }
    @Test void P08EUT05_retry_reason_and_cycle_are_normalized_and_preserved() {
        Map<String,Object> result = WebhookCommandService.normalize(command("RETRY",null,ID,null,4,null,"  receiver recovered  "));
        assertEquals(4,result.get("expectedCycle")); assertEquals("receiver recovered",result.get("reason"));
        for (String reason : new String[]{null," ","x".repeat(501),"secret\nline"}) {
            assertThrows(ApiException.class, () -> WebhookCommandService.normalize(command("RETRY",null,ID,null,1,null,reason)));
        }
    }
    @Test void P08EUT06_command_keys_require_complete_uuid_identities() {
        assertEquals(ID,WebhookCommandService.commandId(ID.toString().toUpperCase()));
        for (String key : new String[]{null,"","1-1-1-1-1","../private","not-a-key"}) assertThrows(ApiException.class, () -> WebhookCommandService.commandId(key));
    }
    @Test void P08EUT07_retry_cycle_cannot_overflow_and_irrelevant_fields_are_rejected() {
        for (Integer cycle : new Integer[]{null,0,-1,Integer.MAX_VALUE}) assertThrows(ApiException.class, () -> WebhookCommandService.normalize(command("RETRY",null,ID,null,cycle,null,"retry")));
        assertThrows(ApiException.class, () -> WebhookCommandService.normalize(command("RETRY",ID,ID,null,1,null,"retry")));
    }
    @Test void P08EUT08_unknown_or_incomplete_commands_fail_closed() {
        assertThrows(ApiException.class, () -> WebhookCommandService.normalize(null));
        assertThrows(ApiException.class, () -> WebhookCommandService.normalize(command("DELETE",ID,null,null,null,null,null)));
        assertThrows(ApiException.class, () -> WebhookCommandService.normalize(command("STATE",ID,null,1L,null,null,null)));
    }
}
