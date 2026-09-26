-- Execute with REPEATABLE READ, READ ONLY; never change balances to make this query green.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT transaction_timestamp() AS snapshot_at, txid_current_snapshot() AS snapshot_id;
WITH ledger_totals AS (
 SELECT a.id,coalesce(sum(CASE WHEN a.kind='WALLET_LIABILITY' THEN
 CASE WHEN e.side='CREDIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END
 ELSE CASE WHEN e.side='DEBIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END END),0) AS expected_posted
 FROM ledger.accounts a LEFT JOIN ledger.journal_entries e ON e.account_id=a.id GROUP BY a.id
), hold_totals AS (
 SELECT account_id,sum(amount_minor::numeric) AS expected_reserved FROM ledger.holds WHERE state='ACTIVE' GROUP BY account_id
)
SELECT b.account_id,b.posted_minor::text,b.reserved_minor::text,l.expected_posted::text,
 coalesce(h.expected_reserved,0)::text AS expected_reserved
FROM ledger.account_balances b JOIN ledger_totals l ON l.id=b.account_id LEFT JOIN hold_totals h ON h.account_id=b.account_id
WHERE b.posted_minor::numeric<>l.expected_posted OR b.reserved_minor::numeric<>coalesce(h.expected_reserved,0)
 OR b.posted_minor<b.reserved_minor OR b.reserved_minor<0;
SELECT j.id,count(e.id) AS entries,
 coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.side='DEBIT'),0) AS debits,
 coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.side='CREDIT'),0) AS credits
FROM ledger.journals j LEFT JOIN ledger.journal_entries e ON e.journal_id=j.id GROUP BY j.id
HAVING count(e.id)<2 OR coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.side='DEBIT'),0)<>
 coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.side='CREDIT'),0);
SELECT p.id,p.state,p.refunded_minor::text,p.reversed FROM ledger.payments p LEFT JOIN ledger.holds h ON h.payment_id=p.id
WHERE h.payment_id IS NULL OR h.account_id<>p.source_id OR h.amount_minor<>p.amount_minor OR
 (p.state='PENDING' AND h.state<>'ACTIVE') OR (p.state='SETTLED' AND h.state<>'CONSUMED') OR
 (p.state IN ('FAILED','CANCELLED') AND h.state<>'RELEASED') OR
 p.refunded_minor::numeric<>(SELECT coalesce(sum(a.amount_minor::numeric),0) FROM ledger.adjustments a WHERE a.payment_id=p.id AND a.kind='REFUND');
SELECT actor_id,operation_kind,parent_scope,key FROM ledger.idempotency_records WHERE status IS NULL OR response IS NULL;
COMMIT;
