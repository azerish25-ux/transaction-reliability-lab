package lab.ledgerguard.accounts;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.UUID;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.auth.Inputs;
import lab.ledgerguard.auth.SecurityEvents;
import lab.ledgerguard.http.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AccountService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final SecurityEvents events;
    public AccountService(JdbcTemplate jdbc,TransactionTemplate transaction,SecurityEvents events) {
        this.jdbc=jdbc; this.transaction=transaction; this.events=events;
    }
    public record Account(UUID id,String publicRef,String name,String currency,String postedMinor,String reservedMinor,
                          String availableMinor,String version,Instant updatedAt) { }
    public record Entry(String id,UUID journalId,UUID operationId,String kind,String side,String amountMinor,String currency,Instant createdAt) { }
    public record Transaction(UUID journalId,UUID operationId,String kind,String effectMinor,String currency,Instant createdAt) { }
    public record Recipient(String publicRef,String currency) { }
    private static final String SELECT_ACCOUNT="SELECT a.id,a.public_ref,a.label,a.currency,b.posted_minor::text,b.reserved_minor::text,"
        + "(b.posted_minor-b.reserved_minor)::text AS available_minor,b.version::text,b.updated_at "
        + "FROM ledger.accounts a JOIN ledger.account_balances b ON b.account_id=a.id ";
    private Account accountRow(ResultSet rs,int number) throws SQLException {
        return new Account(rs.getObject("id",UUID.class),rs.getString("public_ref"),rs.getString("label"),rs.getString("currency"),
            rs.getString("posted_minor"),rs.getString("reserved_minor"),rs.getString("available_minor"),rs.getString("version"),rs.getTimestamp("updated_at").toInstant());
    }
    public Account create(Identity identity,String name,String currency) {
        String label=Inputs.label(name), unit=Inputs.currency(currency);
        return transaction.execute(status->{
            UUID id=jdbc.queryForObject("SELECT ledger.create_account(?,?,?)",UUID.class,identity.userId(),label,unit);
            events.record(identity.userId(),"ACCOUNT_CREATED");
            return get(identity,id);
        });
    }
    public Page<Account> list(Identity identity,int limit,int offset) {
        Page.validate(limit,offset);
        return Page.from(jdbc.query(SELECT_ACCOUNT+"WHERE a.owner_id=? AND a.kind='WALLET_LIABILITY' ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?",
            this::accountRow,identity.userId(),limit+1,offset),limit,offset);
    }
    public Account get(Identity identity,UUID id) {
        var rows=jdbc.query(SELECT_ACCOUNT+"WHERE a.id=? AND a.owner_id=? AND a.kind='WALLET_LIABILITY'",this::accountRow,id,identity.userId());
        if(rows.isEmpty()) { events.denied(identity.userId(),"ACCESS_DENIED"); throw new ApiException(404,"NOT_FOUND"); }
        return rows.getFirst();
    }
    private static final String HISTORY=" FROM ledger.journal_entries e JOIN ledger.journals j ON j.id=e.journal_id "
        + "JOIN ledger.accounts a ON a.id=e.account_id WHERE a.id=? AND a.owner_id=? ";
    public Page<Entry> entries(Identity identity,UUID id,int limit,int offset) {
        Page.validate(limit,offset); get(identity,id);
        return Page.from(jdbc.query("SELECT e.id::text,e.journal_id,j.operation_id,j.kind,e.side,e.amount_minor::text,e.currency,j.created_at"
            + HISTORY+"ORDER BY e.id DESC LIMIT ? OFFSET ?",(rs,n)->new Entry(rs.getString("id"),rs.getObject("journal_id",UUID.class),
            rs.getObject("operation_id",UUID.class),rs.getString("kind"),rs.getString("side"),rs.getString("amount_minor"),
            rs.getString("currency"),rs.getTimestamp("created_at").toInstant()),id,identity.userId(),limit+1,offset),limit,offset);
    }
    public Page<Transaction> transactions(Identity identity,UUID id,int limit,int offset) {
        Page.validate(limit,offset); get(identity,id);
        // Aggregate only THIS owner's entries. Never return the counterparty's journal lines.
        return Page.from(jdbc.query("SELECT j.id,j.operation_id,j.kind,e.currency,j.created_at,"
            + "sum(CASE WHEN e.side='CREDIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END)::text AS effect"
            + HISTORY+"GROUP BY j.id,j.operation_id,j.kind,e.currency,j.created_at ORDER BY j.created_at DESC,j.id DESC LIMIT ? OFFSET ?",
            (rs,n)->new Transaction(rs.getObject("id",UUID.class),rs.getObject("operation_id",UUID.class),rs.getString("kind"),rs.getString("effect"),
            rs.getString("currency"),rs.getTimestamp("created_at").toInstant()),id,identity.userId(),limit+1,offset),limit,offset);
    }
    public Recipient recipient(String reference) {
        if(!reference.matches("LG-[a-fA-F0-9]{32}")) throw new ApiException(404,"NOT_FOUND");
        var rows=jdbc.query("SELECT a.public_ref,a.currency FROM ledger.accounts a JOIN ledger.app_users u ON u.id=a.owner_id "
            + "WHERE a.public_ref=? AND a.status='OPEN' AND a.kind='WALLET_LIABILITY' AND u.enabled",
            (rs,n)->new Recipient(rs.getString(1),rs.getString(2)),reference);
        if(rows.isEmpty()) throw new ApiException(404,"NOT_FOUND");
        return rows.getFirst();
    }
}
