package lab.ledgerguard.config;

import java.time.Clock;
import javax.sql.DataSource;
import lab.ledgerguard.db.FinancialCommands;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FoundationConfiguration {
    @Bean
    Clock businessClock() {
        return Clock.systemUTC();
    }

    @Bean
    FinancialCommands financialCommands(DataSource dataSource) {
        return new FinancialCommands(dataSource);
    }
}
