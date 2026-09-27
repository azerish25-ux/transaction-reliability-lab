-- P06 hardens cancellation/refund/reversal evidence without rewriting V1-V7 history.
SET search_path=ledger,pg_catalog;

CREATE INDEX adjustments_actor_created ON adjustments(actor_id,created_at DESC,id DESC);
CREATE INDEX adjustments_payment_created ON adjustments(payment_id,created_at DESC,id DESC);

CREATE FUNCTION validate_adjustment_posting() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,ledger AS $$
DECLARE
 target ledger.adjustments%ROWTYPE;
 payment ledger.payments%ROWTYPE;
 journal ledger.journals%ROWTYPE;
 actor_role text;
 recipient_owner uuid;
 debit_count bigint;
 credit_count bigint;
 debit_amount numeric;
 credit_amount numeric;
 debit_account uuid;
 credit_account uuid;
BEGIN
 SELECT * INTO target FROM ledger.adjustments WHERE id=NEW.id;
 IF target.id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MISSING_ADJUSTMENT';
 END IF;
 SELECT * INTO payment FROM ledger.payments WHERE id=target.payment_id;
 SELECT * INTO journal FROM ledger.journals WHERE id=target.journal_id;
 SELECT u.role,d.owner_id INTO actor_role,recipient_owner
 FROM ledger.app_users u JOIN ledger.accounts d ON d.id=payment.destination_id
 WHERE u.id=target.actor_id;

 IF payment.id IS NULL OR payment.state<>'SETTLED' OR journal.id IS NULL
 OR journal.operation_id<>target.id OR journal.kind<>target.kind OR journal.currency<>payment.currency
 OR target.reason<>btrim(target.reason) OR length(target.reason) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ADJUSTMENT_METADATA_INVARIANT';
 END IF;
 IF target.kind='REFUND' AND actor_role<>'ADMIN' AND target.actor_id<>recipient_owner THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_AUTHORITY_INVARIANT';
 END IF;
 IF target.kind='REVERSAL' AND actor_role<>'ADMIN' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REVERSAL_AUTHORITY_INVARIANT';
 END IF;
 IF target.kind='REVERSAL' AND target.amount_minor<>payment.amount_minor THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REVERSAL_AMOUNT_INVARIANT';
 END IF;

 SELECT count(*) FILTER(WHERE side='DEBIT'),count(*) FILTER(WHERE side='CREDIT'),
        coalesce(sum(amount_minor::numeric) FILTER(WHERE side='DEBIT'),0),
        coalesce(sum(amount_minor::numeric) FILTER(WHERE side='CREDIT'),0)
 INTO debit_count,credit_count,debit_amount,credit_amount
 FROM ledger.journal_entries WHERE journal_id=target.journal_id;
 SELECT account_id INTO debit_account FROM ledger.journal_entries
 WHERE journal_id=target.journal_id AND side='DEBIT' ORDER BY id LIMIT 1;
 SELECT account_id INTO credit_account FROM ledger.journal_entries
 WHERE journal_id=target.journal_id AND side='CREDIT' ORDER BY id LIMIT 1;

 IF debit_count<>1 OR credit_count<>1 OR debit_amount<>target.amount_minor
 OR credit_amount<>target.amount_minor OR debit_account<>payment.destination_id
 OR credit_account<>payment.source_id THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ADJUSTMENT_POSTING_INVARIANT';
 END IF;
 IF target.kind='REFUND' AND (payment.reversed OR payment.refunded_minor<target.amount_minor) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_STATE_INVARIANT';
 END IF;
 IF target.kind='REVERSAL' AND (NOT payment.reversed OR payment.refunded_minor<>0) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REVERSAL_STATE_INVARIANT';
 END IF;
 RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER adjustment_posting_consistent
AFTER INSERT ON adjustments DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_adjustment_posting();

REVOKE ALL ON FUNCTION validate_adjustment_posting() FROM PUBLIC;
