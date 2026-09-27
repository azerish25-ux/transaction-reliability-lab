package lab.ledgerguard.http;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OpenApiController {
    @GetMapping(value="/api/v1/openapi.json",produces="application/json")
    public Resource p03CompatibilitySpecification() { return new ClassPathResource("openapi/p03.json"); }

    @GetMapping(value="/api/v1/openapi/p04.json",produces="application/json")
    public Resource p04Specification() { return new ClassPathResource("openapi/p04.json"); }

    @GetMapping(value="/api/v1/openapi/p05.json",produces="application/json")
    public Resource p05Specification() { return new ClassPathResource("openapi/p05.json"); }

    @GetMapping(value="/api/v1/openapi/p06.json",produces="application/json")
    public Resource p06Specification() { return new ClassPathResource("openapi/p06.json"); }
}
