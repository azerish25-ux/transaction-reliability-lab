package lab.ledgerguard;

import au.com.dius.pact.core.matchers.ResponseMatching;
import au.com.dius.pact.core.model.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** In-memory Pact matcher sensitivity using the real client's generated contract, not provider acceptance. */
class PactSchemaSensitivityTest {
    @Test void numericMoneyBreaksTheConsumerContract() throws Exception {
        var pact = DefaultPactReader.INSTANCE.loadPact(Path.of("../.evidence/pact/BadPennyWeb-BadPennyApi.json").toFile());
        assertEquals(5, pact.getInteractions().size(), "Expected all five freshly generated client interactions");
        var interaction = pact.getInteractions().stream()
            .filter(i -> i.getDescription().equals("read a wallet page with money serialized as strings"))
            .findFirst().orElseThrow().asSynchronousRequestResponse();
        var expected = interaction.getResponse();
        assertTrue(ResponseMatching.responseMismatches(expected, expected.copyResponse()).isEmpty());
        var json = new ObjectMapper();
        var body = json.readTree(expected.getBody().getValue());
        ((ObjectNode) body.path("items").get(0)).put("postedMinor", 0);
        var incompatible = expected.copyResponse();
        incompatible.setBody(new OptionalBody(OptionalBody.State.PRESENT, json.writeValueAsBytes(body), expected.getBody().getContentType()));
        var mismatches = ResponseMatching.responseMismatches(expected, incompatible);
        assertFalse(mismatches.isEmpty(), "Pact must reject a number in place of decimal-string money");
        assertTrue(mismatches.stream().anyMatch(m -> m.toString().contains("postedMinor")), mismatches::toString);
    }
}
