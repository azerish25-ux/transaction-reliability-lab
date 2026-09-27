package lab.ledgerguard.schedules;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import lab.ledgerguard.core.SchedulePolicy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name = "ledgerguard.scheduler.enabled", havingValue = "true")
public class ScheduleWorker {
    private static final Logger LOG = LoggerFactory.getLogger(ScheduleWorker.class);

    private final ScheduleCommands commands;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final Clock clock;
    private final int batchSize;

    private record DueSchedule(UUID id, long version, LocalDateTime intendedLocal,
                               ZoneId zone, SchedulePolicy.Recurrence recurrence,
                               Instant dueAt) { }

    public ScheduleWorker(ScheduleCommands commands, JdbcTemplate jdbc, ObjectMapper json,
                          Clock clock,
                          @Value("${ledgerguard.scheduler.batch-size:32}") int batchSize) {
        this.commands = commands;
        this.jdbc = jdbc;
        this.json = json;
        this.clock = clock;
        this.batchSize = Math.max(1, Math.min(100, batchSize));
    }

    @Scheduled(fixedDelayString = "${ledgerguard.scheduler.poll-ms:500}")
    public void executeDue() {
        Instant observed = clock.instant();
        List<DueSchedule> due;
        try {
            due = jdbc.query("SELECT id,version,intended_local,zone_id,recurrence,next_instant "
                    + "FROM ledger.schedules WHERE status='ACTIVE' AND next_instant<=? "
                    + "ORDER BY next_instant,id LIMIT ?",
                (rows, row) -> new DueSchedule(rows.getObject("id", UUID.class),
                    rows.getLong("version"), rows.getObject("intended_local", LocalDateTime.class),
                    ZoneId.of(rows.getString("zone_id")),
                    SchedulePolicy.Recurrence.valueOf(rows.getString("recurrence")),
                    rows.getTimestamp("next_instant").toInstant()),
                java.sql.Timestamp.from(observed), batchSize);
        } catch (RuntimeException failure) {
            LOG.warn("schedule_poll_failed", failure);
            return;
        }

        for (DueSchedule schedule : due) {
            Instant now = clock.instant();
            LocalDateTime nextLocal = null;
            Instant nextDue = null;
            if (schedule.recurrence() != SchedulePolicy.Recurrence.ONCE) {
                nextLocal = SchedulePolicy.next(schedule.intendedLocal(), schedule.recurrence());
                nextDue = SchedulePolicy.resolve(nextLocal, schedule.zone());
            }
            try {
                String encoded = commands.executeOccurrence(schedule.id(), schedule.version(),
                    schedule.intendedLocal(), schedule.dueAt(), now, nextLocal, nextDue,
                    UUID.randomUUID());
                JsonNode result = json.readTree(encoded);
                String outcome = result.path("outcome").asText("INVALID");
                if ("REJECTED".equals(outcome) || "SKIPPED_LATE".equals(outcome)) {
                    LOG.warn("schedule_occurrence_result scheduleId={} version={} intendedLocal={} outcome={} code={}",
                        schedule.id(), schedule.version(), schedule.intendedLocal(), outcome,
                        result.path("errorCode").asText("none"));
                } else if (!"IGNORED".equals(outcome) && !"DUPLICATE".equals(outcome)) {
                    LOG.info("schedule_occurrence_result scheduleId={} version={} intendedLocal={} outcome={}",
                        schedule.id(), schedule.version(), schedule.intendedLocal(), outcome);
                }
            } catch (Exception failure) {
                if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
                LOG.warn("schedule_occurrence_failed scheduleId={} version={} intendedLocal={}",
                    schedule.id(), schedule.version(), schedule.intendedLocal(), failure);
            }
        }
    }
}
