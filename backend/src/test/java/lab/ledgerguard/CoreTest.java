package lab.ledgerguard;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import java.util.stream.Stream;

class CoreTest {
    @TestFactory Stream<DynamicTest> policies() {
        return CoreCases.all().stream().map(c -> DynamicTest.dynamicTest(c.id()+" ["+c.risk()+"]",c.run()::run));
    }
}
