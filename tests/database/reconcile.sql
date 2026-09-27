\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT transaction_timestamp() AS snapshot_at, txid_current_snapshot() AS snapshot_id;

WITH ledger_totals AS (
  SELECT a.id,
         coalesce(sum(
           CASE WHEN a.kind='WALLET_LIABILITY'
             THEN CASE WHEN e.side='CREDIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END
             ELSE CASE WHEN e.side='DEBIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END
           END
         ),0) AS expected_posted
  FROM ledger.accounts a
  LEFT JOIN ledger.journal_entries e ON e.account_id=a.id
  GROUP BY a.id
), hold_totals AS (
  SELECT account_id,sum(amount_minor::numeric) AS expected_reserved
  FROM ledger.holds WHERE state='ACTIVE' GROUP BY account_id
), balance_problems AS (
  SELECT 'BALANCE'::text AS kind,b.account_id::text AS identity
  FROM ledger.account_balances b
  JOIN ledger_totals l ON l.id=b.account_id
  LEFT JOIN hold_totals h ON h.account_id=b.account_id
  WHERE b.posted_minor::numeric<>l.expected_posted
     OR b.reserved_minor::numeric<>coalesce(h.expected_reserved,0)
     OR b.posted_minor<b.reserved_minor OR b.reserved_minor<0
), journal_problems AS (
  SELECT 'JOURNAL'::text AS kind,j.id::text AS identity
  FROM ledger.journals j LEFT JOIN ledger.journal_entries e ON e.journal_id=j.id
  GROUP BY j.id
  HAVING count(e.id)<2
     OR coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.side='DEBIT'),0)
        <>coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.side='CREDIT'),0)
), adjustment_totals AS (
  SELECT p.id,
         coalesce(sum(a.amount_minor::numeric) FILTER(WHERE a.kind='REFUND'),0) AS refunds,
         coalesce(sum(a.amount_minor::numeric) FILTER(WHERE a.kind='REVERSAL'),0) AS reversals,
         count(*) FILTER(WHERE a.kind='REVERSAL') AS reversal_count
  FROM ledger.payments p LEFT JOIN ledger.adjustments a ON a.payment_id=p.id
  GROUP BY p.id
), payment_problems AS (
  SELECT 'PAYMENT'::text AS kind,p.id::text AS identity
  FROM ledger.payments p
  LEFT JOIN ledger.holds h ON h.payment_id=p.id
  JOIN adjustment_totals totals ON totals.id=p.id
  WHERE h.payment_id IS NULL OR h.account_id<>p.source_id OR h.amount_minor<>p.amount_minor
     OR (p.state='PENDING' AND h.state<>'ACTIVE')
     OR (p.state='SETTLED' AND h.state<>'CONSUMED')
     OR (p.state IN ('FAILED','CANCELLED') AND h.state<>'RELEASED')
     OR p.refunded_minor::numeric<>totals.refunds
     OR totals.refunds+totals.reversals>p.amount_minor
     OR (p.reversed AND (totals.reversals<>p.amount_minor OR totals.reversal_count<>1 OR totals.refunds<>0))
     OR (NOT p.reversed AND totals.reversals<>0)
), adjustment_entry_totals AS (
  SELECT a.id,a.payment_id,a.kind,a.amount_minor,a.journal_id,p.source_id,p.destination_id,p.currency,
         j.operation_id,j.kind AS journal_kind,j.currency AS journal_currency,
         count(e.id) FILTER(WHERE e.side='DEBIT') AS debits,
         count(e.id) FILTER(WHERE e.side='CREDIT') AS credits,
         coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.side='DEBIT'),0) AS debit_minor,
         coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.side='CREDIT'),0) AS credit_minor,
         max(e.account_id::text) FILTER(WHERE e.side='DEBIT') AS debit_account,
         max(e.account_id::text) FILTER(WHERE e.side='CREDIT') AS credit_account
  FROM ledger.adjustments a
  JOIN ledger.payments p ON p.id=a.payment_id
  LEFT JOIN ledger.journals j ON j.id=a.journal_id
  LEFT JOIN ledger.journal_entries e ON e.journal_id=a.journal_id
  GROUP BY a.id,a.payment_id,a.kind,a.amount_minor,a.journal_id,p.source_id,p.destination_id,p.currency,
           j.operation_id,j.kind,j.currency
), adjustment_problems AS (
  SELECT 'ADJUSTMENT'::text AS kind,id::text AS identity
  FROM adjustment_entry_totals
  WHERE operation_id<>id OR journal_kind<>kind OR journal_currency<>currency
     OR debits<>1 OR credits<>1 OR debit_minor<>amount_minor OR credit_minor<>amount_minor
     OR debit_account<>destination_id::text OR credit_account<>source_id::text
), idempotency_problems AS (
  SELECT 'IDEMPOTENCY'::text AS kind,
         concat_ws(':',actor_id,operation_kind,parent_scope,key) AS identity
  FROM ledger.idempotency_records WHERE status IS NULL OR response IS NULL
), problems AS (
  SELECT * FROM balance_problems
  UNION ALL SELECT * FROM journal_problems
  UNION ALL SELECT * FROM payment_problems
  UNION ALL SELECT * FROM adjustment_problems
  UNION ALL SELECT * FROM idempotency_problems
)
SELECT (count(*) > 0) AS has_discrepancies,
       count(*) AS discrepancy_count,
       coalesce(jsonb_agg(jsonb_build_object('kind',kind,'identity',identity)), '[]'::jsonb)::text AS discrepancies
FROM problems \gset

\echo 'reconciliation_discrepancies=' :discrepancies
\if :has_discrepancies
  \echo 'RECONCILIATION_FAILED discrepancies=' :discrepancy_count
  \quit 3
\else
  \echo 'RECONCILIATION_PASS discrepancies=0'
\endif
COMMIT;
