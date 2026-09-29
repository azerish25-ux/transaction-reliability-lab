-- Independent read oracle: this never calls the financial posting/validation helpers.
-- Executed together with scope counts in a database-enforced READ ONLY REPEATABLE READ transaction.
WITH entry_totals AS (
 SELECT a.id,coalesce(sum(CASE WHEN a.kind='WALLET_LIABILITY'
   THEN CASE WHEN e.side='CREDIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END
   ELSE CASE WHEN e.side='DEBIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END END),0) AS posted
 FROM ledger.accounts a LEFT JOIN ledger.journal_entries e ON e.account_id=a.id GROUP BY a.id
), reserved_totals AS (
 SELECT account_id,sum(amount_minor::numeric) AS reserved FROM ledger.holds WHERE state='ACTIVE' GROUP BY account_id
), journal_totals AS (
 SELECT j.id,j.operation_id,j.kind,j.currency,count(e.id) AS entry_count,
   count(e.id) FILTER(WHERE e.side='DEBIT') AS debits,count(e.id) FILTER(WHERE e.side='CREDIT') AS credits,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.side='DEBIT'),0) AS debit_minor,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.side='CREDIT'),0) AS credit_minor,
   min(e.account_id::text) FILTER(WHERE e.side='DEBIT') AS debit_account,
   min(e.account_id::text) FILTER(WHERE e.side='CREDIT') AS credit_account,
   coalesce(bool_or(e.currency<>j.currency OR e.amount_minor<=0),false) AS bad_entry
 FROM ledger.journals j LEFT JOIN ledger.journal_entries e ON e.journal_id=j.id
 GROUP BY j.id,j.operation_id,j.kind,j.currency
), expected_postings AS (
 SELECT t.id,t.journal_id,'TRANSFER'::text AS kind,t.currency,t.source_id,t.destination_id,t.amount_minor FROM ledger.transfers t
 UNION ALL
 SELECT p.id,p.journal_id,'PAYMENT',p.currency,p.source_id,p.destination_id,p.amount_minor FROM ledger.payments p WHERE p.state='SETTLED'
 UNION ALL
 SELECT a.id,a.journal_id,a.kind,p.currency,p.destination_id,p.source_id,a.amount_minor
 FROM ledger.adjustments a JOIN ledger.payments p ON p.id=a.payment_id
), adjustment_totals AS (
 SELECT p.id,coalesce(sum(a.amount_minor::numeric) FILTER(WHERE a.kind='REFUND'),0) AS refunds,
   coalesce(sum(a.amount_minor::numeric) FILTER(WHERE a.kind='REVERSAL'),0) AS reversals,
   count(a.id) FILTER(WHERE a.kind='REVERSAL') AS reversal_count
 FROM ledger.payments p LEFT JOIN ledger.adjustments a ON a.payment_id=p.id GROUP BY p.id
), audit_order AS (
 SELECT a.*,row_number() OVER(PARTITION BY aggregate_id ORDER BY sequence) AS expected_sequence,
   lag(hash,1,repeat('0',64)) OVER(PARTITION BY aggregate_id ORDER BY sequence) AS expected_previous,
   CASE WHEN canonical_body IS JSON OBJECT THEN canonical_body::jsonb ELSE '{}'::jsonb END AS body
 FROM ledger.audit_records a
), audit_latest AS (
 SELECT DISTINCT ON (aggregate_id) aggregate_id,sequence,hash FROM ledger.audit_records ORDER BY aggregate_id,sequence DESC
), problems AS (
 SELECT 'BALANCES'::text AS check_id,a.id::text AS identity,'Posted balance differs from entries, reservation totals, or a balance row is absent.'::text AS detail
 FROM ledger.accounts a JOIN entry_totals e ON e.id=a.id
 LEFT JOIN ledger.account_balances b ON b.account_id=a.id LEFT JOIN reserved_totals h ON h.account_id=a.id
 WHERE b.account_id IS NULL OR b.posted_minor::numeric<>e.posted OR b.reserved_minor::numeric<>coalesce(h.reserved,0)
   OR b.posted_minor<0 OR b.reserved_minor<0 OR b.posted_minor<b.reserved_minor
 UNION ALL
 SELECT 'JOURNALS',id::text,'Journal has invalid, missing, cross-currency, or unbalanced entries.' FROM journal_totals
 WHERE entry_count<2 OR debit_minor<>credit_minor OR bad_entry
 UNION ALL
 SELECT 'POSTINGS',e.id::text,'Business posting reference, direction, currency, or exact amount disagrees with its journal.'
 FROM expected_postings e LEFT JOIN journal_totals j ON j.id=e.journal_id
 WHERE j.id IS NULL OR j.operation_id<>e.id OR j.kind<>e.kind OR j.currency<>e.currency
   OR j.debits<>1 OR j.credits<>1 OR j.debit_minor<>e.amount_minor OR j.credit_minor<>e.amount_minor
   OR j.debit_account IS DISTINCT FROM e.source_id::text OR j.credit_account IS DISTINCT FROM e.destination_id::text
 UNION ALL
 SELECT 'POSTINGS',j.operation_id::text,'Non-funding journal has no matching business operation.'
 FROM journal_totals j LEFT JOIN expected_postings e ON e.journal_id=j.id WHERE j.kind<>'FUNDING' AND e.id IS NULL
 UNION ALL
 SELECT 'PAYMENT_HOLDS',p.id::text,'Payment state, hold, reservation identity, or settlement presence disagrees.'
 FROM ledger.payments p LEFT JOIN ledger.holds h ON h.payment_id=p.id
 WHERE h.payment_id IS NULL OR h.account_id<>p.source_id OR h.amount_minor<>p.amount_minor
   OR (p.state='PENDING' AND h.state<>'ACTIVE') OR (p.state='SETTLED' AND h.state<>'CONSUMED')
   OR (p.state IN ('FAILED','CANCELLED') AND h.state<>'RELEASED')
   OR (p.state='SETTLED')<>(p.journal_id IS NOT NULL)
 UNION ALL
 SELECT 'ADJUSTMENTS',p.id::text,'Refund/reversal totals, settlement state, or mutual exclusion disagrees.'
 FROM ledger.payments p JOIN adjustment_totals a ON a.id=p.id
 WHERE p.refunded_minor::numeric<>a.refunds OR a.refunds+a.reversals>p.amount_minor
   OR (p.state<>'SETTLED' AND (a.refunds<>0 OR a.reversals<>0))
   OR (p.reversed AND (a.reversals<>p.amount_minor OR a.reversal_count<>1 OR a.refunds<>0))
   OR (NOT p.reversed AND a.reversals<>0)
 UNION ALL
 SELECT 'IDEMPOTENCY',coalesce(operation_id::text,actor_id::text),'A durable command has an incomplete outcome record.'
 FROM ledger.idempotency_records WHERE status IS NULL OR response IS NULL
 UNION ALL
 SELECT 'DURABLE_WORK',p.id::text,'Payment is missing its durable accepted or current-version event.'
 FROM ledger.payments p
 WHERE NOT EXISTS(SELECT 1 FROM ledger.outbox_events e WHERE e.aggregate_id=p.id AND e.event_type='payment.requested')
   OR NOT EXISTS(SELECT 1 FROM ledger.outbox_events e WHERE e.aggregate_id=p.id AND e.aggregate_version=p.version
     AND e.event_type=CASE WHEN p.state='PENDING' THEN 'payment.requested' ELSE 'payment.updated' END
     AND e.payload->>'state'=p.state)
 UNION ALL
 SELECT 'DURABLE_WORK',p.id::text,'Settler acknowledged the accepted event while the payment is still pending.'
 FROM ledger.payments p WHERE p.state='PENDING' AND EXISTS(
   SELECT 1 FROM ledger.outbox_events e JOIN ledger.consumer_inbox i ON i.event_id=e.id
   WHERE e.aggregate_id=p.id AND e.event_type='payment.requested' AND i.consumer='payment-settler-v1')
 UNION ALL
 SELECT 'DURABLE_WORK',e.id::text,'Failed outbox work is missing its durable failure record.'
 FROM ledger.outbox_events e WHERE e.failed_at IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM ledger.failed_work f WHERE f.event_id=e.id AND f.consumer='outbox-publisher-v1')
 UNION ALL
 SELECT 'AUDIT_CHAIN',concat(aggregate_id,':',sequence),'Canonical audit bytes, identities, hash, or chain sequence disagree.'
 FROM audit_order
 WHERE sequence<>expected_sequence OR previous_hash IS DISTINCT FROM expected_previous
   OR hash !~ '^[0-9a-f]{64}$' OR previous_hash !~ '^[0-9a-f]{64}$'
   OR hash IS DISTINCT FROM CASE WHEN previous_hash ~ '^[0-9a-f]{64}$'
      THEN encode(sha256(decode(previous_hash,'hex')||convert_to(canonical_body,'UTF8')),'hex') ELSE NULL END
   OR body->>'aggregate' IS DISTINCT FROM aggregate_id::text OR body->>'operation' IS DISTINCT FROM operation_id::text
   OR body->>'actor' IS DISTINCT FROM actor_id::text OR body->>'action' IS DISTINCT FROM action
   OR body->>'version' IS DISTINCT FROM aggregate_version::text OR body->>'sequence' IS DISTINCT FROM sequence::text
   OR body->>'correlation' IS DISTINCT FROM correlation_id::text
 UNION ALL
 SELECT 'AUDIT_CHAIN',coalesce(a.aggregate_id,h.aggregate_id)::text,'Audit chain head is missing or differs from its final record.'
 FROM audit_latest a FULL JOIN ledger.audit_heads h ON h.aggregate_id=a.aggregate_id
 WHERE a.aggregate_id IS NULL OR h.aggregate_id IS NULL OR a.sequence IS DISTINCT FROM h.sequence OR a.hash IS DISTINCT FROM h.hash
 UNION ALL
 SELECT 'AUDIT_CHAIN',p.id::text,'Current payment version has no financial audit record.' FROM ledger.payments p
 WHERE NOT EXISTS(SELECT 1 FROM ledger.audit_records a WHERE a.aggregate_id=p.id AND a.aggregate_version=p.version)
 UNION ALL
 SELECT 'AUDIT_CHAIN',t.id::text,'Transfer has no financial audit record.' FROM ledger.transfers t
 WHERE NOT EXISTS(SELECT 1 FROM ledger.audit_records a WHERE a.aggregate_id=t.id AND a.operation_id=t.id AND a.action IN ('TRANSFER','SCHEDULE_TRANSFER'))
), ranked AS (
 SELECT *,count(*) OVER(PARTITION BY check_id)::text AS discrepancy_count,
   row_number() OVER(PARTITION BY check_id ORDER BY identity,detail) AS position FROM problems
)
SELECT check_id,identity,detail,discrepancy_count FROM ranked WHERE position<=10 ORDER BY check_id,position
