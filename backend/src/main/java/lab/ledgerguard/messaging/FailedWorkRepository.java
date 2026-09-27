package lab.ledgerguard.messaging;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.http.ApiException;
import lab.ledgerguard.http.ApiProblems;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class FailedWorkRepository {
    public record FailedWork(UUID id,String consumer,UUID eventId,String exchangeName,String routingKey,
                             JsonNode envelope,String failureCode,int attempts,String state,UUID replayRequestedBy,
                             Instant replayRequestedAt,Instant createdAt,Instant updatedAt,Instant republishedAt) { }
    public record Replay(UUID id,UUID eventId,String exchangeName,String routingKey,JsonNode envelope) { }
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public FailedWorkRepository(JdbcTemplate jdbc,ObjectMapper json){this.jdbc=jdbc;this.json=json;}

    public UUID record(String consumer,UUID eventId,String exchange,String routing,JsonNode envelope,String failure,int attempts) {
        return jdbc.queryForObject("SELECT ledger.record_failed_work(?,?,?,?,?::jsonb,?,?)",UUID.class,
            consumer,eventId,exchange,routing,envelope.toString(),bounded(failure),attempts);
    }

    public Page<FailedWork> list(int limit,int offset) {
        Page.validate(limit,offset);
        return Page.from(jdbc.query("SELECT id,consumer,event_id,exchange_name,routing_key,envelope::text,failure_code,attempts,state,"
            +"replay_requested_by,replay_requested_at,created_at,updated_at,republished_at FROM ledger.failed_work "
            +"ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?",this::row,limit+1,offset),limit,offset);
    }

    public FailedWork get(UUID id) {
        var rows=jdbc.query("SELECT id,consumer,event_id,exchange_name,routing_key,envelope::text,failure_code,attempts,state,"
            +"replay_requested_by,replay_requested_at,created_at,updated_at,republished_at FROM ledger.failed_work WHERE id=?",this::row,id);
        if(rows.isEmpty()) throw new ApiException(404,"NOT_FOUND");
        return rows.getFirst();
    }

    public void request(Identity admin,UUID id) {
        try { jdbc.query("SELECT ledger.request_failed_replay(?,?,?)",ignored->null,admin.userId(),id,ApiProblems.correlation()); }
        catch(org.springframework.dao.DataAccessException failure){
            String state=sqlState(failure);
            if("P4040".equals(state)) throw new ApiException(404,"NOT_FOUND");
            if("P4030".equals(state)) throw new ApiException(403,"FORBIDDEN");
            if("P4090".equals(state)) throw new ApiException(409,"REPLAY_ALREADY_PENDING");
            throw failure;
        }
    }

    public List<Replay> claim(UUID owner,int limit,int leaseSeconds) {
        return jdbc.query("SELECT * FROM ledger.claim_failed_replays(?,?,?)",(rs,row)->{
            try { return new Replay(rs.getObject("id",UUID.class),rs.getObject("event_id",UUID.class),
                rs.getString("exchange_name"),rs.getString("routing_key"),json.readTree(rs.getString("envelope"))); }
            catch(java.io.IOException invalid){throw new SQLException("Invalid failed-work envelope","22023",invalid);}
        },owner,limit,leaseSeconds);
    }

    public void complete(UUID work,UUID owner,boolean success,String error) {
        jdbc.query("SELECT ledger.complete_failed_replay(?,?,?,?,?)",ignored->null,
            work,owner,success,bounded(error),ApiProblems.correlation());
    }

    private FailedWork row(ResultSet rs,int ignored) throws SQLException {
        try {
            return new FailedWork(rs.getObject("id",UUID.class),rs.getString("consumer"),rs.getObject("event_id",UUID.class),
                rs.getString("exchange_name"),rs.getString("routing_key"),json.readTree(rs.getString("envelope")),
                rs.getString("failure_code"),rs.getInt("attempts"),rs.getString("state"),
                rs.getObject("replay_requested_by",UUID.class),instant(rs,"replay_requested_at"),
                rs.getTimestamp("created_at").toInstant(),rs.getTimestamp("updated_at").toInstant(),instant(rs,"republished_at"));
        } catch(java.io.IOException invalid) {
            throw new SQLException("Invalid failed-work envelope","22023",invalid);
        }
    }
    private static Instant instant(ResultSet rs,String column) throws SQLException {
        java.sql.Timestamp value=rs.getTimestamp(column);return value==null?null:value.toInstant();
    }
    private static String bounded(String value){String result=value==null?"UNKNOWN":value.replaceAll("[\\r\\n\\t]+"," ");return result.substring(0,Math.min(200,result.length()));}
    private static String sqlState(Throwable failure){for(Throwable t=failure;t!=null;t=t.getCause())if(t instanceof SQLException sql)return sql.getSQLState();return null;}
}
