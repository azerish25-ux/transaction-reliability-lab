package lab.ledgerguard.messaging;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@ConditionalOnProperty(name="ledgerguard.outbox-publisher.enabled",havingValue="true")
public class OutboxRepository {
    public record Claimed(UUID id,String eventType,int schemaVersion,UUID aggregateId,long aggregateVersion,
                          UUID correlationId,Instant occurredAt,JsonNode payload,int attempts) {
        EventEnvelope envelope() {
            return new EventEnvelope(id,eventType,schemaVersion,aggregateId,aggregateVersion,correlationId,occurredAt,payload);
        }
        ObjectNode evidence(ObjectMapper json) {
            ObjectNode result=json.createObjectNode();
            result.put("eventId",id.toString());result.put("eventType",eventType);result.put("schemaVersion",schemaVersion);
            result.put("aggregateId",aggregateId.toString());result.put("aggregateVersion",aggregateVersion);
            result.put("correlationId",correlationId.toString());result.put("occurredAt",occurredAt.toString());
            result.set("payload",payload);return result;
        }
    }
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public OutboxRepository(JdbcTemplate jdbc,ObjectMapper json){this.jdbc=jdbc;this.json=json;}

    public List<Claimed> claim(UUID owner,int limit,Duration lease) {
        return jdbc.query("SELECT * FROM ledger.claim_outbox(?,?,?)",this::row,
            owner,limit,Math.toIntExact(lease.toSeconds()));
    }

    public void markPublished(UUID id,UUID owner) {
        jdbc.query("SELECT ledger.mark_outbox_published(?,?)",ignored->null,id,owner);
    }

    public void retry(UUID id,UUID owner,Duration delay,String error) {
        jdbc.query("SELECT ledger.retry_outbox(?,?,?,?)",ignored->null,
            id,owner,Math.toIntExact(delay.toSeconds()),bounded(error));
    }

    public UUID fail(Claimed claimed,UUID owner,String error) {
        return jdbc.queryForObject("SELECT ledger.fail_outbox(?,?,?::jsonb,?,?)",UUID.class,
            claimed.id(),owner,claimed.evidence(json).toString(),bounded(error),claimed.attempts());
    }

    public int recoverPending(int ageSeconds,int limit) {
        return jdbc.queryForObject("SELECT ledger.recover_pending_payments(?,?)",Integer.class,ageSeconds,limit);
    }

    private Claimed row(ResultSet rs,int ignored) throws SQLException {
        try {
            return new Claimed(rs.getObject("id",UUID.class),rs.getString("event_type"),rs.getInt("schema_version"),
                rs.getObject("aggregate_id",UUID.class),rs.getLong("aggregate_version"),
                rs.getObject("correlation_id",UUID.class),rs.getTimestamp("occurred_at").toInstant(),
                json.readTree(rs.getString("payload")),rs.getInt("attempts"));
        } catch (java.io.IOException invalid) {
            throw new SQLException("Invalid outbox payload","22023",invalid);
        }
    }
    private static String bounded(String value){
        String result=value==null?"UNKNOWN":value.replaceAll("[\\r\\n\\t]+"," ");
        return result.substring(0,Math.min(500,result.length()));
    }
}
