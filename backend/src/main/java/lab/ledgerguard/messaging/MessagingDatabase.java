package lab.ledgerguard.messaging;

import java.util.UUID;
import lab.ledgerguard.db.FinancialCommands;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name="ledgerguard.payment-worker.enabled",havingValue="true")
public class MessagingDatabase {
    private final FinancialCommands commands;
    private final JdbcTemplate jdbc;
    public MessagingDatabase(FinancialCommands commands,JdbcTemplate jdbc){this.commands=commands;this.jdbc=jdbc;}
    public String settle(EventEnvelope event) throws Exception {
        return commands.settle(event.eventId(),event.paymentId(),event.correlationId());
    }
    public String project(EventEnvelope event) {
        return jdbc.queryForObject("SELECT ledger.apply_payment_projection(?,?,?,?)",String.class,
            event.eventId(),event.paymentId(),event.aggregateVersion(),event.paymentState());
    }
    public String observe(EventEnvelope event) {
        return jdbc.queryForObject("SELECT ledger.observe_event(?)",String.class,event.eventId());
    }
}
