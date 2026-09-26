package lab.ledgerguard.http;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OpenApiController {
    @GetMapping(value="/api/v1/openapi.json",produces="application/json")
    public Resource specification() { return new ClassPathResource("openapi/p03.json"); }
}
