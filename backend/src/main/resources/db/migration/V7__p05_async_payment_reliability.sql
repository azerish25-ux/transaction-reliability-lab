-- P05 adds durable messaging/recovery controls without changing V1-V6 history.
SET search_path=ledger,pg_catalog;

ALTER TABLE outbox_events ADD COLUMN failed_at timestamptz;
DROP INDEX outbox_due;
CREATE INDEX outbox_due ON outbox_events(available_at,id)
 WHERE published_at IS NULL AND failed_at IS NULL;
CREATE INDEX outbox_lease_expiry ON outbox_events(lease_until,id)
 WHERE published_at IS NULL AND failed_at IS NULL AND lease_until IS NOT NULL;

CREATE TABLE failed_work (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 consumer text NOT NULL CHECK(length(consumer) BETWEEN 1 AND 80),
 event_id uuid NOT NULL,
 exchange_name text NOT NULL CHECK(length(exchange_name) BETWEEN 1 AND 120),
 routing_key text NOT NULL CHECK(length(routing_key) BETWEEN 1 AND 120),
 envelope jsonb NOT NULL CHECK(jsonb_typeof(envelope)='object' AND octet_length(envelope::text)<=131072),
 failure_code text NOT NULL CHECK(length(failure_code) BETWEEN 1 AND 200),
 attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 100),
 state text NOT NULL DEFAULT 'FAILED' CHECK(state IN ('FAILED','REPLAY_REQUESTED','REPUBLISHING','REPUBLISHED')),
 replay_requested_by uuid REFERENCES app_users(id),
 replay_requested_at timestamptz,
 lease_owner uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 republished_at timestamptz,
 UNIQUE(consumer,event_id)
);
CREATE INDEX failed_work_state ON failed_work(state,updated_at,id);
CREATE INDEX failed_work_lease ON failed_work(lease_until,id) WHERE state='REPUBLISHING';

CREATE TABLE failed_work_replay_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 work_id uuid NOT NULL REFERENCES failed_work(id),
 event_id uuid NOT NULL,
 actor_id uuid REFERENCES app_users(id),
 action text NOT NULL CHECK(action IN ('REPLAY_REQUESTED','REPUBLISHED','REPLAY_FAILED')),
 detail text NOT NULL DEFAULT '' CHECK(length(detail)<=500),
 correlation_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX failed_work_replay_time ON failed_work_replay_audit(occurred_at,id);
CREATE TRIGGER failed_work_replay_append_only BEFORE UPDATE OR DELETE ON failed_work_replay_audit
 FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE FUNCTION apply_payment_projection(p_event uuid,p_payment uuid,p_version bigint,p_state text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE current ledger.payment_projection%ROWTYPE; authority ledger.payments%ROWTYPE;
BEGIN
 IF p_event IS NULL OR p_payment IS NULL OR p_version<1 OR p_state NOT IN ('PENDING','SETTLED','FAILED','CANCELLED') THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_PAYMENT_EVENT';
 END IF;
 INSERT INTO ledger.consumer_inbox(consumer,event_id) VALUES('payment-projection-v1',p_event)
 ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN 'DUPLICATE'; END IF;
 SELECT * INTO authority FROM ledger.payments WHERE id=p_payment;
 IF authority.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='UNKNOWN_PAYMENT'; END IF;
 SELECT * INTO current FROM ledger.payment_projection WHERE payment_id=p_payment FOR UPDATE;
 IF current.payment_id IS NULL THEN
  IF p_version>authority.version THEN RETURN 'FUTURE'; END IF;
  IF p_version=authority.version AND p_state<>authority.state THEN RETURN 'AUTHORITY_MISMATCH'; END IF;
  INSERT INTO ledger.payment_projection(payment_id,aggregate_version,state)
  VALUES(p_payment,p_version,p_state);
  RETURN 'APPLIED';
 END IF;
 IF p_version<=current.aggregate_version THEN RETURN 'STALE'; END IF;
 IF current.state<>'PENDING' AND current.state<>p_state THEN RETURN 'INVALID_TRANSITION'; END IF;
 IF p_version>authority.version THEN RETURN 'FUTURE'; END IF;
 IF p_version=authority.version AND p_state<>authority.state THEN RETURN 'AUTHORITY_MISMATCH'; END IF;
 UPDATE ledger.payment_projection SET aggregate_version=p_version,state=p_state,observed_at=clock_timestamp()
 WHERE payment_id=p_payment;
 RETURN 'APPLIED';
END $$;

CREATE FUNCTION observe_event(p_event uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ledger,pg_temp AS $$
BEGIN
 IF p_event IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_EVENT'; END IF;
 INSERT INTO ledger.consumer_inbox(consumer,event_id) VALUES('event-observer-v1',p_event)
 ON CONFLICT DO NOTHING;
 RETURN CASE WHEN FOUND THEN 'OBSERVED' ELSE 'DUPLICATE' END;
END $$;

CREATE FUNCTION record_failed_work(p_consumer text,p_event uuid,p_exchange text,p_routing text,
 p_envelope jsonb,p_failure text,p_attempts integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE result uuid;
BEGIN
 IF p_event IS NULL OR p_attempts NOT BETWEEN 1 AND 100 OR length(p_consumer) NOT BETWEEN 1 AND 80
 OR length(p_exchange) NOT BETWEEN 1 AND 120 OR length(p_routing) NOT BETWEEN 1 AND 120
 OR jsonb_typeof(p_envelope)<>'object' OR octet_length(p_envelope::text)>131072
 OR length(p_failure) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FAILED_WORK';
 END IF;
 INSERT INTO ledger.failed_work AS current(consumer,event_id,exchange_name,routing_key,envelope,failure_code,attempts)
 VALUES(p_consumer,p_event,p_exchange,p_routing,p_envelope,p_failure,p_attempts)
 ON CONFLICT(consumer,event_id) DO UPDATE SET
  failure_code=EXCLUDED.failure_code,attempts=greatest(current.attempts,EXCLUDED.attempts),
  envelope=EXCLUDED.envelope,exchange_name=EXCLUDED.exchange_name,routing_key=EXCLUDED.routing_key,
  state='FAILED',
  lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp()
 RETURNING id INTO result;
 RETURN result;
END $$;

CREATE FUNCTION request_failed_replay(p_actor uuid,p_work uuid,p_correlation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE target ledger.failed_work%ROWTYPE;
BEGIN
 IF p_actor IS NULL OR p_work IS NULL OR p_correlation IS NULL
 OR NOT EXISTS(SELECT 1 FROM ledger.app_users WHERE id=p_actor AND enabled AND role='ADMIN') THEN
  RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='FORBIDDEN';
 END IF;
 SELECT * INTO target FROM ledger.failed_work WHERE id=p_work FOR UPDATE;
 IF target.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND'; END IF;
 IF target.state NOT IN ('FAILED','REPUBLISHED') THEN
  RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='REPLAY_ALREADY_PENDING';
 END IF;
 UPDATE ledger.failed_work SET state='REPLAY_REQUESTED',replay_requested_by=p_actor,
  replay_requested_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE id=p_work;
 INSERT INTO ledger.failed_work_replay_audit(work_id,event_id,actor_id,action,correlation_id)
 VALUES(p_work,target.event_id,p_actor,'REPLAY_REQUESTED',p_correlation);
END $$;

CREATE FUNCTION claim_failed_replays(p_owner uuid,p_limit integer,p_lease_seconds integer)
RETURNS TABLE(id uuid,event_id uuid,exchange_name text,routing_key text,envelope jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
BEGIN
 IF p_owner IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REPLAY_CLAIM';
 END IF;
 RETURN QUERY
 WITH due AS (
  SELECT f.id FROM ledger.failed_work f
  WHERE f.state='REPLAY_REQUESTED' OR (f.state='REPUBLISHING' AND f.lease_until<clock_timestamp())
  ORDER BY f.updated_at,f.id FOR UPDATE SKIP LOCKED LIMIT p_limit
 )
 UPDATE ledger.failed_work f SET state='REPUBLISHING',lease_owner=p_owner,
  lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp()
 FROM due WHERE f.id=due.id
 RETURNING f.id,f.event_id,f.exchange_name,f.routing_key,f.envelope;
END $$;

CREATE FUNCTION complete_failed_replay(p_work uuid,p_owner uuid,p_success boolean,p_error text,p_correlation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE target ledger.failed_work%ROWTYPE; detail text:=left(coalesce(p_error,''),500);
BEGIN
 IF p_work IS NULL OR p_owner IS NULL OR p_success IS NULL OR p_correlation IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REPLAY_COMPLETION';
 END IF;
 SELECT * INTO target FROM ledger.failed_work WHERE id=p_work AND state='REPUBLISHING' AND lease_owner=p_owner FOR UPDATE;
 IF target.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='REPLAY_LEASE_LOST'; END IF;
 UPDATE ledger.failed_work SET state=CASE WHEN p_success THEN 'REPUBLISHED' ELSE 'FAILED' END,
  lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp(),
  republished_at=CASE WHEN p_success THEN clock_timestamp() ELSE republished_at END,
  failure_code=CASE WHEN p_success THEN failure_code ELSE left('REPLAY:'||detail,200) END
 WHERE id=p_work;
 INSERT INTO ledger.failed_work_replay_audit(work_id,event_id,actor_id,action,detail,correlation_id)
 VALUES(p_work,target.event_id,NULL,CASE WHEN p_success THEN 'REPUBLISHED' ELSE 'REPLAY_FAILED' END,detail,p_correlation);
END $$;

CREATE FUNCTION claim_outbox(p_owner uuid,p_limit integer,p_lease_seconds integer)
RETURNS TABLE(id uuid,event_type text,schema_version integer,aggregate_id uuid,aggregate_version bigint,
 correlation_id uuid,occurred_at timestamptz,payload jsonb,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
BEGIN
 IF p_owner IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_OUTBOX_CLAIM';
 END IF;
 RETURN QUERY
 WITH due AS (
  SELECT e.id FROM ledger.outbox_events e
  WHERE e.published_at IS NULL AND e.failed_at IS NULL AND e.available_at<=clock_timestamp()
   AND (e.lease_until IS NULL OR e.lease_until<clock_timestamp())
  ORDER BY e.available_at,e.id FOR UPDATE SKIP LOCKED LIMIT p_limit
 )
 UPDATE ledger.outbox_events e SET lease_owner=p_owner,
  lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempts=e.attempts+1,last_error=NULL
 FROM due WHERE e.id=due.id
 RETURNING e.id,e.event_type,e.schema_version,e.aggregate_id,e.aggregate_version,e.correlation_id,
  e.occurred_at,e.payload,e.attempts;
END $$;

CREATE FUNCTION mark_outbox_published(p_event uuid,p_owner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE changed integer;
BEGIN
 IF p_event IS NULL OR p_owner IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_OUTBOX_COMPLETION'; END IF;
 UPDATE ledger.outbox_events SET published_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,last_error=NULL
 WHERE id=p_event AND lease_owner=p_owner AND published_at IS NULL AND failed_at IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='OUTBOX_LEASE_LOST'; END IF;
END $$;

CREATE FUNCTION retry_outbox(p_event uuid,p_owner uuid,p_delay_seconds integer,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE changed integer;
BEGIN
 IF p_event IS NULL OR p_owner IS NULL OR p_delay_seconds NOT BETWEEN 1 AND 3600
 OR p_error IS NULL OR length(p_error) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_OUTBOX_RETRY';
 END IF;
 UPDATE ledger.outbox_events SET available_at=clock_timestamp()+make_interval(secs=>p_delay_seconds),
  lease_owner=NULL,lease_until=NULL,last_error=p_error
 WHERE id=p_event AND lease_owner=p_owner AND published_at IS NULL AND failed_at IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='OUTBOX_LEASE_LOST'; END IF;
END $$;

CREATE FUNCTION fail_outbox(p_event uuid,p_owner uuid,p_envelope jsonb,p_error text,p_attempts integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE target ledger.outbox_events%ROWTYPE; work uuid;
BEGIN
 IF p_event IS NULL OR p_owner IS NULL OR jsonb_typeof(p_envelope)<>'object'
 OR p_error IS NULL OR length(p_error) NOT BETWEEN 1 AND 500 OR p_attempts NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_OUTBOX_FAILURE';
 END IF;
 SELECT * INTO target FROM ledger.outbox_events WHERE id=p_event AND lease_owner=p_owner
  AND published_at IS NULL AND failed_at IS NULL FOR UPDATE;
 IF target.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='OUTBOX_LEASE_LOST'; END IF;
 work:=ledger.record_failed_work('outbox-publisher-v1',target.id,'ledgerguard.events.v1',target.event_type,
  p_envelope,p_error,p_attempts);
 UPDATE ledger.outbox_events SET failed_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,last_error=p_error
 WHERE id=p_event;
 RETURN work;
END $$;

CREATE FUNCTION recover_pending_payments(p_age_seconds integer,p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE target record; recovered integer:=0;
BEGIN
 IF p_age_seconds NOT BETWEEN 30 AND 86400 OR p_limit NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_RECOVERY_WINDOW';
 END IF;
 FOR target IN
  SELECT p.* FROM ledger.payments p
  WHERE p.state='PENDING' AND p.updated_at<clock_timestamp()-make_interval(secs=>p_age_seconds)
  ORDER BY p.updated_at,p.id FOR UPDATE SKIP LOCKED LIMIT p_limit
 LOOP
  UPDATE ledger.outbox_events SET published_at=NULL,failed_at=NULL,available_at=clock_timestamp(),
   lease_owner=NULL,lease_until=NULL,last_error='PENDING_PAYMENT_RECOVERY'
  WHERE aggregate_id=target.id AND aggregate_version=target.version AND event_type='payment.requested';
  IF NOT FOUND THEN
   INSERT INTO ledger.outbox_events(aggregate_id,aggregate_version,event_type,correlation_id,payload)
   VALUES(target.id,target.version,'payment.requested',gen_random_uuid(),
    jsonb_build_object('paymentId',target.id,'version',target.version,'state',target.state,
     'amountMinor',target.amount_minor::text,'currency',target.currency,'refundedMinor',target.refunded_minor::text,
     'reversed',target.reversed,'journalId',target.journal_id));
  END IF;
  recovered:=recovered+1;
 END LOOP;
 RETURN recovered;
END $$;

REVOKE ALL ON failed_work,failed_work_replay_audit FROM PUBLIC;
GRANT SELECT ON failed_work,failed_work_replay_audit TO ledger_runtime;
GRANT USAGE ON SEQUENCE failed_work_replay_audit_id_seq TO ledger_runtime;
REVOKE INSERT,UPDATE,DELETE ON outbox_events,payment_projection FROM ledger_runtime;
REVOKE ALL ON FUNCTION apply_payment_projection(uuid,uuid,bigint,text),observe_event(uuid),
 record_failed_work(text,uuid,text,text,jsonb,text,integer),request_failed_replay(uuid,uuid,uuid),
 claim_failed_replays(uuid,integer,integer),complete_failed_replay(uuid,uuid,boolean,text,uuid),
 claim_outbox(uuid,integer,integer),mark_outbox_published(uuid,uuid),retry_outbox(uuid,uuid,integer,text),
 fail_outbox(uuid,uuid,jsonb,text,integer),recover_pending_payments(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_payment_projection(uuid,uuid,bigint,text),observe_event(uuid),
 record_failed_work(text,uuid,text,text,jsonb,text,integer),request_failed_replay(uuid,uuid,uuid),
 claim_failed_replays(uuid,integer,integer),complete_failed_replay(uuid,uuid,boolean,text,uuid),
 claim_outbox(uuid,integer,integer),mark_outbox_published(uuid,uuid),retry_outbox(uuid,uuid,integer,text),
 fail_outbox(uuid,uuid,jsonb,text,integer),recover_pending_payments(integer,integer) TO ledger_runtime;
