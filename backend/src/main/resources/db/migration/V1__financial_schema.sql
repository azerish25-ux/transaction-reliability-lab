-- Executed as ledger_owner. ledger_runtime never owns objects or receives financial table DML.
CREATE SCHEMA ledger;
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
REVOKE ALL ON SCHEMA ledger FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA ledger REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
SET search_path = ledger, pg_catalog;

CREATE TABLE app_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
 password_hash text NOT NULL CHECK (length(password_hash) BETWEEN 40 AND 255),
 display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
 role text NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER','ADMIN')),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE auth_sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 revoked_at timestamptz, CHECK (expires_at > created_at)
);
CREATE INDEX sessions_owner ON auth_sessions(user_id,expires_at);
CREATE TABLE accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid REFERENCES app_users(id),
 public_ref text NOT NULL UNIQUE DEFAULT ('LG-' || replace(gen_random_uuid()::text,'-','')),
 label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
 currency text NOT NULL CHECK (currency IN ('CAD','USD','JPY','KWD')),
 kind text NOT NULL DEFAULT 'WALLET_LIABILITY' CHECK (kind IN ('WALLET_LIABILITY','SANDBOX_FUNDING_ASSET')),
 status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(id,currency),
 CHECK ((kind = 'WALLET_LIABILITY' AND owner_id IS NOT NULL) OR (kind = 'SANDBOX_FUNDING_ASSET' AND owner_id IS NULL))
);
CREATE INDEX accounts_owner ON accounts(owner_id,created_at,id);
CREATE TABLE account_balances (
 account_id uuid PRIMARY KEY REFERENCES accounts(id), posted_minor bigint NOT NULL DEFAULT 0,
 reserved_minor bigint NOT NULL DEFAULT 0, version bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (posted_minor >= 0 AND reserved_minor >= 0 AND reserved_minor <= posted_minor), CHECK (version > 0)
);
CREATE TABLE journals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation_id uuid NOT NULL UNIQUE,
 kind text NOT NULL CHECK (kind IN ('FUNDING','TRANSFER','PAYMENT','REFUND','REVERSAL')),
 currency text NOT NULL CHECK (currency IN ('CAD','USD','JPY','KWD')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(id,currency)
);
CREATE TABLE journal_entries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 journal_id uuid NOT NULL, account_id uuid NOT NULL, currency text NOT NULL,
 side text NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
 amount_minor bigint NOT NULL CHECK (amount_minor > 0),
 FOREIGN KEY(journal_id,currency) REFERENCES journals(id,currency),
 FOREIGN KEY(account_id,currency) REFERENCES accounts(id,currency)
);
CREATE INDEX entries_account_history ON journal_entries(account_id,id DESC);
CREATE INDEX entries_journal ON journal_entries(journal_id);
CREATE TABLE transfers (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES app_users(id),
 source_id uuid NOT NULL REFERENCES accounts(id), destination_id uuid NOT NULL REFERENCES accounts(id),
 amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000), currency text NOT NULL,
 journal_id uuid NOT NULL UNIQUE REFERENCES journals(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK (source_id <> destination_id)
);
CREATE INDEX transfers_actor_created ON transfers(actor_id,created_at DESC,id DESC);
CREATE TABLE payments (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES app_users(id),
 source_id uuid NOT NULL REFERENCES accounts(id), destination_id uuid NOT NULL REFERENCES accounts(id),
 amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000), currency text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','SETTLED','FAILED','CANCELLED')),
 refunded_minor bigint NOT NULL DEFAULT 0, reversed boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1, journal_id uuid UNIQUE REFERENCES journals(id), failure_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (source_id <> destination_id), CHECK(refunded_minor BETWEEN 0 AND amount_minor), CHECK(version > 0),
 CHECK(NOT reversed OR refunded_minor=0),
 CHECK((state='SETTLED' AND journal_id IS NOT NULL) OR (state<>'SETTLED' AND journal_id IS NULL AND refunded_minor=0 AND NOT reversed)),
 FOREIGN KEY(source_id,currency) REFERENCES accounts(id,currency), FOREIGN KEY(destination_id,currency) REFERENCES accounts(id,currency)
);
CREATE INDEX payments_source_history ON payments(source_id,created_at DESC,id DESC);
CREATE INDEX payments_destination_history ON payments(destination_id,created_at DESC,id DESC);
CREATE INDEX payments_pending_age ON payments(created_at,id) WHERE state='PENDING';
CREATE TABLE holds (
 payment_id uuid PRIMARY KEY REFERENCES payments(id), account_id uuid NOT NULL REFERENCES accounts(id),
 amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000),
 state text NOT NULL CHECK (state IN ('ACTIVE','CONSUMED','RELEASED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX holds_active_account ON holds(account_id,created_at) WHERE state='ACTIVE';
CREATE TABLE adjustments (
 id uuid PRIMARY KEY, payment_id uuid NOT NULL REFERENCES payments(id), actor_id uuid NOT NULL REFERENCES app_users(id),
 kind text NOT NULL CHECK (kind IN ('REFUND','REVERSAL')),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),
 journal_id uuid NOT NULL UNIQUE REFERENCES journals(id), reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX adjustments_parent ON adjustments(payment_id,created_at,id);
CREATE UNIQUE INDEX one_reversal ON adjustments(payment_id) WHERE kind='REVERSAL';
CREATE TABLE idempotency_records (
 actor_id uuid NOT NULL REFERENCES app_users(id), operation_kind text NOT NULL, parent_scope text NOT NULL DEFAULT '',
 key text NOT NULL CHECK (key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'), fingerprint text NOT NULL,
 status integer, response jsonb, operation_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,operation_kind,parent_scope,key),
 CHECK((status IS NULL AND response IS NULL) OR (status BETWEEN 200 AND 599 AND response IS NOT NULL))
);
CREATE TABLE outbox_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aggregate_id uuid NOT NULL, aggregate_version bigint NOT NULL,
 event_type text NOT NULL, schema_version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
 payload jsonb NOT NULL CHECK(octet_length(payload::text) <= 65536),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), published_at timestamptz,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(), lease_owner uuid, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), last_error text,
 UNIQUE(aggregate_id,aggregate_version,event_type)
);
CREATE INDEX outbox_due ON outbox_events(available_at,id) WHERE published_at IS NULL;
CREATE TABLE consumer_inbox (
 consumer text NOT NULL, event_id uuid NOT NULL, processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(consumer,event_id)
);
CREATE TABLE payment_projection (
 payment_id uuid PRIMARY KEY REFERENCES payments(id), aggregate_version bigint NOT NULL,
 state text NOT NULL CHECK(state IN ('PENDING','SETTLED','FAILED','CANCELLED')), observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE audit_heads (aggregate_id uuid PRIMARY KEY, sequence bigint NOT NULL DEFAULT 0, hash text NOT NULL DEFAULT repeat('0',64));
CREATE TABLE audit_records (
 aggregate_id uuid NOT NULL, sequence bigint NOT NULL, actor_id uuid REFERENCES app_users(id), action text NOT NULL,
 operation_id uuid NOT NULL, correlation_id uuid NOT NULL, aggregate_version bigint NOT NULL,
 previous_hash text NOT NULL, hash text NOT NULL, canonical_body text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(aggregate_id,sequence)
);
CREATE INDEX audit_operation ON audit_records(operation_id);
CREATE INDEX audit_time ON audit_records(occurred_at,aggregate_id,sequence);
CREATE TABLE schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES app_users(id),
 source_id uuid NOT NULL REFERENCES accounts(id), destination_ref text NOT NULL REFERENCES accounts(public_ref),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000), currency text NOT NULL,
 intended_local timestamp without time zone NOT NULL, zone_id text NOT NULL,
 recurrence text NOT NULL CHECK(recurrence IN ('ONCE','DAILY','WEEKLY')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), next_instant timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED','CANCELLED','FINISHED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX schedules_due ON schedules(next_instant,id) WHERE status='ACTIVE';
CREATE TABLE schedule_occurrences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id uuid NOT NULL REFERENCES schedules(id),
 schedule_version bigint NOT NULL, intended_local timestamp without time zone NOT NULL,
 due_at timestamptz NOT NULL, outcome text NOT NULL CHECK(outcome IN ('SUCCEEDED','REJECTED','SKIPPED_LATE')),
 operation_id uuid, error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(schedule_id,schedule_version,intended_local)
);
CREATE TABLE webhook_endpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES app_users(id),
 destination_id text NOT NULL CHECK(destination_id='sandbox-receiver'), encrypted_secret text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,destination_id)
);
CREATE TABLE webhook_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id),
 event_id uuid NOT NULL REFERENCES outbox_events(id), payload bytea NOT NULL CHECK(octet_length(payload)<=65536),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DELIVERED','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), lease_owner uuid, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), delivered_at timestamptz,
 UNIQUE(endpoint_id,event_id)
);
CREATE INDEX deliveries_due ON webhook_deliveries(next_attempt_at,id) WHERE state='PENDING';
CREATE TABLE webhook_attempts (
 delivery_id uuid NOT NULL REFERENCES webhook_deliveries(id), attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 8),
 attempted_at timestamptz NOT NULL DEFAULT clock_timestamp(), http_status integer, outcome text NOT NULL,
 duration_ms integer NOT NULL CHECK(duration_ms>=0), error_code text, PRIMARY KEY(delivery_id,attempt)
);
CREATE TABLE reconciliation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES app_users(id),
 snapshot_at timestamptz NOT NULL, scope text NOT NULL, discrepancies jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,ledger AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='APPEND_ONLY'; END $$;
CREATE TRIGGER immutable_journals BEFORE UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_entries BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_records FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_adjustments BEFORE UPDATE OR DELETE ON adjustments FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_transfers BEFORE UPDATE OR DELETE ON transfers FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_occurrences BEFORE UPDATE OR DELETE ON schedule_occurrences FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE FUNCTION validate_journal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,ledger AS $$
DECLARE target uuid; n bigint; debits numeric; credits numeric;
BEGIN
 IF TG_TABLE_NAME='journals' THEN target:=NEW.id; ELSE target:=NEW.journal_id; END IF;
 SELECT count(*),coalesce(sum(amount_minor::numeric) FILTER(WHERE side='DEBIT'),0),
 coalesce(sum(amount_minor::numeric) FILTER(WHERE side='CREDIT'),0) INTO n,debits,credits FROM ledger.journal_entries WHERE journal_id=target;
 IF n<2 OR debits<>credits THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNBALANCED_OR_INCOMPLETE_JOURNAL'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER complete_journal AFTER INSERT ON journals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_journal();
CREATE CONSTRAINT TRIGGER balanced_entries AFTER INSERT ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_journal();

CREATE FUNCTION validate_balance() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,ledger AS $$
DECLARE target uuid; posted numeric; reserved numeric; expected numeric; held numeric; kind text;
BEGIN
 target:=NEW.account_id;
 SELECT b.posted_minor,b.reserved_minor,a.kind INTO posted,reserved,kind FROM ledger.account_balances b JOIN ledger.accounts a ON a.id=b.account_id WHERE b.account_id=target;
 SELECT coalesce(sum(CASE WHEN side='CREDIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) INTO expected FROM ledger.journal_entries WHERE account_id=target;
 IF kind='SANDBOX_FUNDING_ASSET' THEN expected:=-expected; END IF;
 SELECT coalesce(sum(amount_minor::numeric),0) INTO held FROM ledger.holds WHERE account_id=target AND state='ACTIVE';
 IF posted IS NULL OR posted<>expected OR reserved<>held THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='BALANCE_HOLD_RECONCILIATION_FAILED'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER balances_reconcile AFTER INSERT OR UPDATE ON account_balances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_balance();
CREATE CONSTRAINT TRIGGER entries_reconcile AFTER INSERT ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_balance();
CREATE CONSTRAINT TRIGGER holds_reconcile AFTER INSERT OR UPDATE ON holds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_balance();

CREATE FUNCTION validate_payment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,ledger AS $$
DECLARE target uuid; p ledger.payments%ROWTYPE; h ledger.holds%ROWTYPE; refunds numeric; reversals numeric;
BEGIN
 IF TG_TABLE_NAME='payments' THEN target:=NEW.id; ELSE target:=NEW.payment_id; END IF;
 SELECT * INTO p FROM ledger.payments WHERE id=target; SELECT * INTO h FROM ledger.holds WHERE payment_id=target;
 IF h.payment_id IS NULL OR h.account_id<>p.source_id OR h.amount_minor<>p.amount_minor
 OR (p.state='PENDING' AND h.state<>'ACTIVE') OR (p.state='SETTLED' AND h.state<>'CONSUMED')
 OR (p.state IN ('CANCELLED','FAILED') AND h.state<>'RELEASED') THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAYMENT_HOLD_INVARIANT'; END IF;
 SELECT coalesce(sum(amount_minor::numeric) FILTER(WHERE kind='REFUND'),0),coalesce(sum(amount_minor::numeric) FILTER(WHERE kind='REVERSAL'),0)
 INTO refunds,reversals FROM ledger.adjustments WHERE payment_id=target;
 IF refunds<>p.refunded_minor OR (p.reversed AND reversals<>p.amount_minor) OR (NOT p.reversed AND reversals<>0)
 OR refunds+reversals>p.amount_minor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAYMENT_ADJUSTMENT_INVARIANT'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payment_consistent AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payment();
CREATE CONSTRAINT TRIGGER hold_payment_consistent AFTER INSERT OR UPDATE ON holds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payment();
CREATE CONSTRAINT TRIGGER adjustment_consistent AFTER INSERT ON adjustments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payment();
