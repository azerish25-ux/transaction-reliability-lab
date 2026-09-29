package lab.ledgerguard.admin;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.http.ApiException;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Financial checks are read-only. Saving the finished report is a separate reporting-only insert. */
@Service
public final class AdminReconciliationService {
    public static final String SCOPE = "P08F-v1:all-financial-records";
    public static final Map<String,String> CHECKS;
    static {
        LinkedHashMap<String,String> checks = new LinkedHashMap<>();
        checks.put("BALANCES","Entries, posted balances and active reservations");
        checks.put("JOURNALS","Balanced same-currency journals");
        checks.put("POSTINGS","Business operation identities, amounts and posting direction");
        checks.put("PAYMENT_HOLDS","Payment states and holds");
        checks.put("ADJUSTMENTS","Refund/reversal totals and exclusivity");
        checks.put("IDEMPOTENCY","Complete durable command outcomes");
        checks.put("DURABLE_WORK","Payment/outbox/settler and failed-work consistency");
        checks.put("AUDIT_CHAIN","Canonical audit hash chains and current financial audit presence");
        CHECKS = java.util.Collections.unmodifiableMap(checks);
    }
    public record Sample(String identity, String detail) { }
    public record Check(String id, String title, String status, String discrepancyCount, List<Sample> samples, boolean hasMore) { }
    public record Report(UUID id, UUID actorId, AdminSnapshot.Snapshot snapshot, Instant completedAt, String scope,
        String status, String discrepancyCount, Map<String,String> totals, List<Check> checks, List<String> limitations) { }
    public record Summary(UUID id, UUID actorId, Instant snapshotAt, String scope, String status, String discrepancyCount, Instant createdAt) { }
    public record Saved(Report report, boolean replayed) { }
    private final JdbcTemplate jdbc;
    private final AdminSnapshot snapshots;
    private final ObjectMapper json;
    private final String sql;

    public AdminReconciliationService(JdbcTemplate jdbc, AdminSnapshot snapshots, ObjectMapper json) throws IOException {
        this.jdbc=jdbc; this.snapshots=snapshots; this.json=json;
        sql=new ClassPathResource("sql/admin-reconciliation.sql").getContentAsString(StandardCharsets.UTF_8);
    }
    public Saved run(Identity admin, UUID id) {
        AdminAccess.require(admin);
        if (id == null) throw new ApiException(400,"INVALID_RECONCILIATION_ID");
        Report previous=find(id);
        if (previous!=null) return sameActor(admin,previous,true);
        Report report=inspect(admin,id);
        String encoded;
        try { encoded=json.writeValueAsString(report); }
        catch (JsonProcessingException failure) { throw new IllegalStateException("Report serialization failed",failure); }
        // An explicit client run identity makes concurrent requests and lost-response replay insert-once.
        int inserted=jdbc.update("INSERT INTO ledger.reconciliation_runs(id,actor_id,snapshot_at,scope,discrepancies) "
            + "VALUES(?,?,?,?,?::jsonb) ON CONFLICT(id) DO NOTHING", id,admin.userId(),Timestamp.from(report.snapshot().capturedAt()),SCOPE,encoded);
        Report stored=find(id);
        if (stored==null) throw new ApiException(409,"RECONCILIATION_ID_CONFLICT");
        return sameActor(admin,stored,inserted==0);
    }
    private static Saved sameActor(Identity admin,Report report,boolean replayed) {
        if (!admin.userId().equals(report.actorId())) throw new ApiException(409,"RECONCILIATION_ID_CONFLICT");
        return new Saved(report,replayed);
    }
    public Report inspect(Identity admin,UUID id) {
        AdminAccess.require(admin);
        return snapshots.execute(snapshot -> {
            Map<String,String> totals=jdbc.queryForObject("""
                SELECT (SELECT count(*) FROM ledger.accounts)::text AS accounts,
                  (SELECT count(*) FROM ledger.journals)::text AS journals,
                  (SELECT count(*) FROM ledger.journal_entries)::text AS entries,
                  (SELECT count(*) FROM ledger.payments)::text AS payments,
                  (SELECT count(*) FROM ledger.transfers)::text AS transfers,
                  (SELECT count(*) FROM ledger.adjustments)::text AS adjustments,
                  (SELECT count(*) FROM ledger.audit_records)::text AS audit_records,
                  (SELECT count(*) FROM ledger.payments WHERE state='PENDING')::text AS pending_payments,
                  (SELECT count(*) FROM ledger.outbox_events WHERE published_at IS NULL AND failed_at IS NULL)::text AS pending_outbox,
                  (SELECT count(*) FROM ledger.failed_work WHERE state='FAILED')::text AS failed_work
                """, (rs,n) -> {
                    Map<String,String> result=new LinkedHashMap<>();
                    for(String key:List.of("accounts","journals","entries","payments","transfers","adjustments","audit_records","pending_payments","pending_outbox","failed_work"))
                        result.put(key,rs.getString(key));
                    return result;
                });
            Map<String,List<Sample>> samples=new LinkedHashMap<>(); Map<String,String> counts=new LinkedHashMap<>();
            jdbc.query(sql,rs -> {
                String check=rs.getString("check_id");
                if(!CHECKS.containsKey(check)) throw new IllegalStateException("Unmapped reconciliation check");
                counts.put(check,rs.getString("discrepancy_count"));
                samples.computeIfAbsent(check,ignored->new ArrayList<>()).add(new Sample(rs.getString("identity"),rs.getString("detail")));
            });
            List<Check> checks=new ArrayList<>(); BigInteger total=BigInteger.ZERO;
            for(var entry:CHECKS.entrySet()) {
                String count=counts.getOrDefault(entry.getKey(),"0"); BigInteger amount=new BigInteger(count); total=total.add(amount);
                List<Sample> selected=List.copyOf(samples.getOrDefault(entry.getKey(),List.of()));
                checks.add(new Check(entry.getKey(),entry.getValue(),amount.signum()==0?"PASS":"DISCREPANCIES",count,selected,
                    amount.compareTo(BigInteger.valueOf(selected.size()))>0));
            }
            Instant completed=jdbc.queryForObject("SELECT clock_timestamp()",(rs,n)->rs.getTimestamp(1).toInstant());
            return new Report(id,admin.userId(),snapshot,completed,SCOPE,total.signum()==0?"PASS":"DISCREPANCIES",total.toString(),
                totals,List.copyOf(checks),List.of(
                    "A saved report describes this snapshot, not the current live state or whole-product release readiness.",
                    "Pending payments, unpublished events and failed work are operational backlog, not by themselves accounting discrepancies.",
                    "Hash-chain verification is not protection against a database owner who can rewrite records and anchors.",
                    "At most ten sample identities per check are included; discrepancy totals are not truncated.",
                    "This scope does not certify external webhook receipt, scheduler timing, security, load or backup/restore behavior."));
        });
    }
    public Report get(Identity admin,UUID id) {
        AdminAccess.require(admin); Report report=find(id);
        if(report==null) throw new ApiException(404,"NOT_FOUND"); return report;
    }
    private Report find(UUID id) {
        var rows=jdbc.query("SELECT discrepancies::text FROM ledger.reconciliation_runs WHERE id=? AND scope=?",(rs,n)->{
            try { return json.readValue(rs.getString(1),Report.class); }
            catch(JsonProcessingException invalid) { throw new ApiException(503,"INVALID_RECONCILIATION_REPORT"); }
        },id,SCOPE);
        return rows.isEmpty()?null:rows.getFirst();
    }
    public Page<Summary> history(Identity admin,AdminFilters filters) {
        AdminAccess.require(admin);
        return Page.from(jdbc.query("SELECT id,actor_id,snapshot_at,scope,discrepancies->>'status' AS status, "
            + "discrepancies->>'discrepancyCount' AS discrepancy_count,created_at FROM ledger.reconciliation_runs "
            + "WHERE scope=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",(rs,n)->
                new Summary(rs.getObject("id",UUID.class),rs.getObject("actor_id",UUID.class),rs.getTimestamp("snapshot_at").toInstant(),
                    rs.getString("scope"),rs.getString("status"),rs.getString("discrepancy_count"),rs.getTimestamp("created_at").toInstant()),
            SCOPE,filters.limit()+1,filters.offset()),filters.limit(),filters.offset());
    }
}
