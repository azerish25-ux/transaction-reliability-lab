-- P03 is additive: V1-V5 and their financial posting privileges remain unchanged.
-- V4 already enforces immutable account identity. Reuse that trigger and its 42501 contract.
-- The initial P03 candidate V6 rolled back in full because it redeclared that trigger.
SET search_path = ledger, pg_catalog;

CREATE FUNCTION immutable_session_identity() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,ledger,pg_temp AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='IMMUTABLE_SESSION_IDENTITY';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER session_identity_immutable BEFORE UPDATE ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION immutable_session_identity();
REVOKE UPDATE ON auth_sessions FROM ledger_runtime;
GRANT UPDATE(revoked_at) ON auth_sessions TO ledger_runtime;
CREATE INDEX sessions_active ON auth_sessions(id,user_id,expires_at) WHERE revoked_at IS NULL;

-- Deliberately separate from financial audit: a denied HTTP request is not a posting.
CREATE TABLE security_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid REFERENCES app_users(id),
 event_type text NOT NULL CHECK(event_type IN
 ('REGISTERED','REGISTRATION_REJECTED','LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','ACCESS_DENIED','TOKEN_REJECTED','THROTTLED','ACCOUNT_CREATED')),
 correlation_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX security_events_time ON security_events(occurred_at,id);
CREATE TRIGGER security_events_append_only BEFORE UPDATE OR DELETE ON security_events
FOR EACH ROW EXECUTE FUNCTION immutable_record();
GRANT SELECT,INSERT ON security_events TO ledger_runtime;
GRANT USAGE ON SEQUENCE security_events_id_seq TO ledger_runtime;

-- Shared fixed-window budgets: restarting or changing API instance cannot clear a budget.
-- Only one row per active IP/identity digest; stale rows are pruned in bounded batches.
CREATE TABLE auth_budgets (
 bucket text PRIMARY KEY CHECK(bucket ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,
 attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 1001)
);
CREATE INDEX auth_budgets_expiry ON auth_budgets(expires_at);
CREATE FUNCTION consume_auth_budget(p_bucket text,p_limit integer,p_window integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE used integer; now_at timestamptz:=clock_timestamp();
BEGIN
 IF p_limit NOT BETWEEN 1 AND 1000 OR p_window NOT BETWEEN 60 AND 3600 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_AUTH_BUDGET';
 END IF;
 DELETE FROM ledger.auth_budgets WHERE bucket IN
  (SELECT bucket FROM ledger.auth_budgets WHERE expires_at<now_at ORDER BY expires_at LIMIT 100);
 INSERT INTO ledger.auth_budgets AS b(bucket,expires_at,attempts)
 VALUES(p_bucket,now_at+make_interval(secs=>p_window),1)
 ON CONFLICT(bucket) DO UPDATE SET
  attempts=CASE WHEN b.expires_at<=now_at THEN 1 ELSE least(b.attempts+1,p_limit+1) END,
  expires_at=CASE WHEN b.expires_at<=now_at THEN EXCLUDED.expires_at ELSE b.expires_at END
 RETURNING attempts INTO used;
 RETURN used<=p_limit;
END $$;
REVOKE ALL ON auth_budgets FROM PUBLIC,ledger_runtime;
REVOKE ALL ON FUNCTION consume_auth_budget(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_auth_budget(text,integer,integer) TO ledger_runtime;
REVOKE ALL ON FUNCTION immutable_session_identity() FROM PUBLIC;
