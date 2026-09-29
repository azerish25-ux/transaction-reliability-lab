package lab.ledgerguard.http;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OpenApiController {
    @GetMapping(value = "/api/v1/openapi.json", produces = "application/json")
    public Resource p03CompatibilitySpecification() {
        return new ClassPathResource("openapi/p03.json");
    }

    @GetMapping(value = "/api/v1/openapi/p04.json", produces = "application/json")
    public Resource p04Specification() {
        return new ClassPathResource("openapi/p04.json");
    }

    @GetMapping(value = "/api/v1/openapi/p05.json", produces = "application/json")
    public Resource p05Specification() {
        return new ClassPathResource("openapi/p05.json");
    }

    @GetMapping(value = "/api/v1/openapi/p06.json", produces = "application/json")
    public Resource p06Specification() {
        return new ClassPathResource("openapi/p06.json");
    }

    @GetMapping(value = "/api/v1/openapi/p07a-schedules.json", produces = "application/json")
    public Resource p07aScheduleSpecification() {
        return new ClassPathResource("openapi/p07a-schedules.json");
    }

    @GetMapping(value = "/api/v1/openapi/p07b-webhooks.json", produces = "application/json")
    public Resource p07bWebhookSpecification() {
        return new ClassPathResource("openapi/p07b-webhooks.json");
    }

    @GetMapping(value = "/api/v1/openapi/p08a-ui.json", produces = "application/json")
    public Resource p08aUserInterfaceSpecification() {
        return new ClassPathResource("openapi/p08a-ui.json");
    }

    @GetMapping(value = "/api/v1/openapi/p08b-ui.json", produces = "application/json")
    public Resource p08bUserInterfaceSpecification() {
        return new ClassPathResource("openapi/p08b-ui.json");
    }
    @GetMapping(value = "/api/v1/openapi/p08c-ui.json", produces = "application/json")
    public Resource p08cAdjustmentInterfaceSpecification() {
        return new ClassPathResource("openapi/p08c-ui.json");
    }
    @GetMapping(value = "/api/v1/openapi/p08e-ui.json", produces = "application/json")
    public Resource p08eWebhookInterfaceSpecification() {
        return new ClassPathResource("openapi/p08e-ui.json");
    }
    @GetMapping(value = "/api/v1/openapi/p08f-ui.json", produces = "application/json")
    public Resource p08fAdministratorSpecification() {
        return new ClassPathResource("openapi/p08f-ui.json");
    }
}
