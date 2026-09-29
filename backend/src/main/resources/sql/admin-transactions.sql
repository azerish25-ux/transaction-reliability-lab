WITH operations AS (
 SELECT t.id,'TRANSFER'::text AS kind,'SETTLED'::text AS state,t.source_id,t.destination_id,t.actor_id,
        t.amount_minor::numeric AS amount_minor,t.currency,t.journal_id,NULL::uuid AS parent_id,
        '1'::text AS version,'NONE'::text AS adjustment_state,t.created_at,t.created_at AS updated_at
 FROM ledger.transfers t
 UNION ALL
 SELECT p.id,'PAYMENT',p.state,p.source_id,p.destination_id,p.actor_id,p.amount_minor::numeric,p.currency,p.journal_id,
        NULL::uuid,p.version::text,
        CASE WHEN p.reversed THEN 'REVERSED' WHEN p.refunded_minor=p.amount_minor THEN 'FULLY_REFUNDED'
             WHEN p.refunded_minor>0 THEN 'PARTIALLY_REFUNDED' ELSE 'NONE' END,p.created_at,p.updated_at
 FROM ledger.payments p
 UNION ALL
 SELECT a.id,a.kind,'SETTLED',p.destination_id,p.source_id,a.actor_id,a.amount_minor::numeric,p.currency,a.journal_id,
        p.id,'1','NONE',a.created_at,a.created_at
 FROM ledger.adjustments a JOIN ledger.payments p ON p.id=a.payment_id
 UNION ALL
 SELECT j.operation_id,'FUNDING','SETTLED',e.source_id,e.destination_id,NULL::uuid,e.amount_minor,j.currency,j.id,
        NULL::uuid,'1','NONE',j.created_at,j.created_at
 FROM ledger.journals j LEFT JOIN LATERAL (
    SELECT (min(account_id::text) FILTER(WHERE side='DEBIT'))::uuid AS source_id,
           (min(account_id::text) FILTER(WHERE side='CREDIT'))::uuid AS destination_id,
           coalesce(sum(amount_minor::numeric) FILTER(WHERE side='CREDIT'),0) AS amount_minor
    FROM ledger.journal_entries WHERE journal_id=j.id
 ) e ON true WHERE j.kind='FUNDING'
), investigation AS (
 SELECT o.*,s.public_ref AS source_ref,s.owner_id AS source_user_id,
        d.public_ref AS destination_ref,d.owner_id AS destination_user_id
 FROM operations o
 LEFT JOIN ledger.accounts s ON s.id=o.source_id
 LEFT JOIN ledger.accounts d ON d.id=o.destination_id
)
