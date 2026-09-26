SET search_path=ledger,pg_catalog;

-- Immutable routing identity: changing owner/currency would reinterpret historic entries.
CREATE FUNCTION account_identity_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,ledger AS $$
BEGIN
 IF (NEW.id,NEW.owner_id,NEW.public_ref,NEW.currency,NEW.kind) IS DISTINCT FROM
    (OLD.id,OLD.owner_id,OLD.public_ref,OLD.currency,OLD.kind) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNT_IDENTITY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_identity_immutable BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION account_identity_immutable();

-- Claim and outcome may be temporarily incomplete INSIDE a command, never after commit.
CREATE FUNCTION idempotency_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,ledger AS $$
DECLARE recorded ledger.idempotency_records%ROWTYPE;
BEGIN
 SELECT * INTO STRICT recorded FROM ledger.idempotency_records WHERE actor_id=NEW.actor_id AND operation_kind=NEW.operation_kind
 AND parent_scope=NEW.parent_scope AND key=NEW.key;
 IF recorded.status IS NULL OR recorded.response IS NULL THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INCOMPLETE_IDEMPOTENCY_OUTCOME'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER idempotency_complete AFTER INSERT OR UPDATE ON idempotency_records
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION idempotency_complete();

-- Independent assertion of WHICH wallets and amounts a business journal actually moved.
CREATE FUNCTION business_journal_consistent() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,ledger AS $$
DECLARE j uuid; source uuid; destination uuid; amount bigint; unit text; operation uuid; expected_kind text;
 p ledger.payments%ROWTYPE; header ledger.journals%ROWTYPE; n bigint; matching bigint;
BEGIN
 IF TG_TABLE_NAME='payments' THEN
   SELECT * INTO STRICT p FROM ledger.payments WHERE id=NEW.id;
   IF p.state<>'SETTLED' THEN RETURN NULL; END IF;
   j:=p.journal_id; source:=p.source_id; destination:=p.destination_id; amount:=p.amount_minor;
   unit:=p.currency; operation:=p.id; expected_kind:='PAYMENT';
 ELSIF TG_TABLE_NAME='transfers' THEN
   j:=NEW.journal_id; source:=NEW.source_id; destination:=NEW.destination_id; amount:=NEW.amount_minor;
   unit:=NEW.currency; operation:=NEW.id; expected_kind:='TRANSFER';
 ELSE
   SELECT * INTO STRICT p FROM ledger.payments WHERE id=NEW.payment_id;
   j:=NEW.journal_id; source:=p.destination_id; destination:=p.source_id; amount:=NEW.amount_minor;
   unit:=p.currency; operation:=NEW.id; expected_kind:=NEW.kind;
 END IF;
 SELECT * INTO header FROM ledger.journals WHERE id=j;
 SELECT count(*),count(*) FILTER(WHERE currency=unit AND amount_minor=amount AND
  ((account_id=source AND side='DEBIT') OR (account_id=destination AND side='CREDIT')))
 INTO n,matching FROM ledger.journal_entries WHERE journal_id=j;
 IF header.id IS NULL OR header.operation_id<>operation OR header.kind<>expected_kind OR header.currency<>unit OR n<>2 OR matching<>2 THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='BUSINESS_JOURNAL_MISMATCH'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER transfer_journal_consistent AFTER INSERT ON transfers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION business_journal_consistent();
CREATE CONSTRAINT TRIGGER settled_journal_consistent AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION business_journal_consistent();
CREATE CONSTRAINT TRIGGER adjustment_journal_consistent AFTER INSERT ON adjustments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION business_journal_consistent();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ledger FROM PUBLIC;
