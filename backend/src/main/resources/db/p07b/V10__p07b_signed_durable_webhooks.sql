-- P07B completes the previously reserved webhook schema without rewriting verified P01-P07A history.
SET search_path=ledger,pg_catalog;

ALTER TABLE webhook_endpoints
 ADD COLUMN destination_url text,
 ADD COLUMN version bigint NOT NULL DEFAULT 1,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ADD COLUMN rotated_at timestamptz,
 ADD COLUMN secret_key_version integer NOT NULL DEFAULT 1;
UPDATE webhook_endpoints SET destination_url='http://receiver:8081/events' WHERE destination_url IS NULL;
ALTER TABLE webhook_endpoints ALTER COLUMN destination_url SET NOT NULL;
ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoint_url_bounded
 CHECK(length(destination_url) BETWEEN 1 AND 2048);
ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoint_version_positive CHECK(version>0);
ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoint_key_version_positive CHECK(secret_key_version>0);
CREATE INDEX webhook_endpoints_owner ON webhook_endpoints(owner_id,created_at DESC,id DESC);

CREATE TABLE webhook_endpoint_secrets (
 endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id),
 key_version integer NOT NULL CHECK(key_version>0),
 encrypted_secret text NOT NULL CHECK(length(encrypted_secret) BETWEEN 40 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(endpoint_id,key_version)
);
INSERT INTO webhook_endpoint_secrets(endpoint_id,key_version,encrypted_secret,created_at)
SELECT id,secret_key_version,encrypted_secret,created_at FROM webhook_endpoints;
CREATE TRIGGER webhook_endpoint_secrets_append_only BEFORE UPDATE OR DELETE ON webhook_endpoint_secrets
 FOR EACH ROW EXECUTE FUNCTION immutable_record();

ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_state_check;
ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_attempts_check;
ALTER TABLE webhook_deliveries
 ADD COLUMN event_type text,
 ADD COLUMN schema_version integer,
 ADD COLUMN aggregate_id uuid,
 ADD COLUMN aggregate_version bigint,
 ADD COLUMN correlation_id uuid,
 ADD COLUMN cycle integer NOT NULL DEFAULT 1,
 ADD COLUMN cycle_started_at timestamptz,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ADD COLUMN max_age_at timestamptz,
 ADD COLUMN last_error text,
 ADD COLUMN payload_hash text,
 ADD COLUMN secret_key_version integer;
UPDATE webhook_deliveries d SET
 event_type=e.event_type,
 schema_version=e.schema_version,
 aggregate_id=e.aggregate_id,
 aggregate_version=e.aggregate_version,
 correlation_id=e.correlation_id,
 cycle_started_at=e.occurred_at,
 max_age_at=e.occurred_at+interval '24 hours',
 payload_hash=encode(extensions.digest(d.payload,'sha256'),'hex'),
 secret_key_version=ep.secret_key_version
FROM outbox_events e,webhook_endpoints ep
WHERE e.id=d.event_id AND ep.id=d.endpoint_id;
ALTER TABLE webhook_deliveries
 ALTER COLUMN event_type SET NOT NULL,
 ALTER COLUMN schema_version SET NOT NULL,
 ALTER COLUMN aggregate_id SET NOT NULL,
 ALTER COLUMN aggregate_version SET NOT NULL,
 ALTER COLUMN correlation_id SET NOT NULL,
 ALTER COLUMN cycle_started_at SET NOT NULL,
 ALTER COLUMN max_age_at SET NOT NULL,
 ALTER COLUMN payload_hash SET NOT NULL,
 ALTER COLUMN secret_key_version SET NOT NULL;
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_delivery_state
 CHECK(state IN ('PENDING','IN_FLIGHT','DELIVERED','FAILED'));
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_delivery_attempt_budget CHECK(attempts BETWEEN 0 AND 8);
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_delivery_cycle_positive CHECK(cycle>0);
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_delivery_schema_version CHECK(schema_version>0);
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_delivery_aggregate_version CHECK(aggregate_version>0);
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_delivery_payload_hash
 CHECK(payload_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_delivery_event_type
 CHECK(event_type ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,3}$');
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_delivery_age_window
 CHECK(max_age_at>cycle_started_at);
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_delivery_secret_version
 FOREIGN KEY(endpoint_id,secret_key_version) REFERENCES webhook_endpoint_secrets(endpoint_id,key_version);
DROP INDEX deliveries_due;
CREATE INDEX deliveries_due ON webhook_deliveries(next_attempt_at,id) WHERE state='PENDING';
CREATE INDEX deliveries_lease_expiry ON webhook_deliveries(lease_until,id) WHERE state='IN_FLIGHT';
CREATE INDEX deliveries_endpoint_history ON webhook_deliveries(endpoint_id,created_at DESC,id DESC);
CREATE INDEX deliveries_state_history ON webhook_deliveries(state,created_at DESC,id DESC);

ALTER TABLE webhook_attempts DROP CONSTRAINT webhook_attempts_pkey;
ALTER TABLE webhook_attempts
 ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY,
 ADD COLUMN cycle integer NOT NULL DEFAULT 1,
 ADD COLUMN request_timestamp bigint,
 ADD COLUMN secret_key_version integer,
 ADD COLUMN signature text,
 ADD COLUMN response_summary text,
 ADD COLUMN next_attempt_at timestamptz,
 ADD COLUMN correlation_id uuid;
ALTER TABLE webhook_attempts ADD PRIMARY KEY(id);
ALTER TABLE webhook_attempts ADD CONSTRAINT webhook_attempt_identity UNIQUE(delivery_id,cycle,attempt);
ALTER TABLE webhook_attempts ADD CONSTRAINT webhook_attempt_cycle_positive CHECK(cycle>0);
ALTER TABLE webhook_attempts ADD CONSTRAINT webhook_attempt_outcome
 CHECK(outcome IN ('DELIVERED','RETRY_SCHEDULED','PERMANENT_FAILURE','EXHAUSTED','LEASE_EXPIRED'));
ALTER TABLE webhook_attempts ADD CONSTRAINT webhook_attempt_signature
 CHECK(signature IS NULL OR signature ~ '^v1=[0-9a-f]{64}$');
ALTER TABLE webhook_attempts ADD CONSTRAINT webhook_attempt_response_bounded
 CHECK(response_summary IS NULL OR length(response_summary)<=1000);
ALTER TABLE webhook_attempts ADD CONSTRAINT webhook_attempt_error_bounded
 CHECK(error_code IS NULL OR length(error_code)<=200);
ALTER TABLE webhook_attempts ADD CONSTRAINT webhook_attempt_key_version_positive
 CHECK(secret_key_version IS NULL OR secret_key_version>0);
CREATE INDEX webhook_attempts_delivery ON webhook_attempts(delivery_id,cycle,attempt);
CREATE TRIGGER webhook_attempts_append_only BEFORE UPDATE OR DELETE ON webhook_attempts
 FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE TABLE webhook_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid REFERENCES app_users(id),
 endpoint_id uuid REFERENCES webhook_endpoints(id),
 delivery_id uuid REFERENCES webhook_deliveries(id),
 action text NOT NULL CHECK(action IN ('ENDPOINT_CREATED','ENDPOINT_ENABLED','ENDPOINT_DISABLED',
  'SECRET_ROTATED','MANUAL_RETRY_REQUESTED')),
 detail text NOT NULL DEFAULT '' CHECK(length(detail)<=500),
 correlation_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX webhook_audit_time ON webhook_audit(occurred_at DESC,id DESC);
CREATE TRIGGER webhook_audit_append_only BEFORE UPDATE OR DELETE ON webhook_audit
 FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE TABLE webhook_receiver_receipts (
 endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id),
 event_id uuid NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 first_signature text NOT NULL CHECK(first_signature ~ '^v1=[0-9a-f]{64}$'),
 last_signature text NOT NULL CHECK(last_signature ~ '^v1=[0-9a-f]{64}$'),
 first_request_timestamp bigint NOT NULL,
 last_request_timestamp bigint NOT NULL,
 receive_count integer NOT NULL DEFAULT 1 CHECK(receive_count>0),
 first_received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(endpoint_id,event_id)
);
CREATE INDEX webhook_receipts_time ON webhook_receiver_receipts(first_received_at DESC,endpoint_id,event_id);

CREATE TABLE webhook_receiver_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 mode text NOT NULL DEFAULT 'NORMAL' CHECK(mode IN
  ('NORMAL','STATUS_429','STATUS_503','STATUS_400','ACCEPT_THEN_503','DELAY')),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO webhook_receiver_control(singleton) VALUES(true);

CREATE FUNCTION create_webhook_endpoint(p_actor uuid,p_endpoint uuid,p_destination_id text,
 p_destination_url text,p_encrypted_secret text,p_correlation uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE actor ledger.app_users%ROWTYPE;
BEGIN
 SELECT * INTO actor FROM ledger.app_users WHERE id=p_actor AND enabled FOR SHARE;
 IF actor.id IS NULL OR actor.role<>'CUSTOMER' THEN
  RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='FORBIDDEN';
 END IF;
 IF p_endpoint IS NULL OR p_destination_id<>'sandbox-receiver'
 OR p_destination_url<>'http://receiver:8081/events'
 OR p_encrypted_secret IS NULL OR length(p_encrypted_secret) NOT BETWEEN 40 AND 500
 OR p_correlation IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_ENDPOINT';
 END IF;
 BEGIN
  INSERT INTO ledger.webhook_endpoints(id,owner_id,destination_id,destination_url,encrypted_secret)
  VALUES(p_endpoint,p_actor,p_destination_id,p_destination_url,p_encrypted_secret);
  INSERT INTO ledger.webhook_endpoint_secrets(endpoint_id,key_version,encrypted_secret)
  VALUES(p_endpoint,1,p_encrypted_secret);
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='WEBHOOK_ENDPOINT_EXISTS';
 END;
 INSERT INTO ledger.webhook_audit(actor_id,endpoint_id,action,correlation_id)
 VALUES(p_actor,p_endpoint,'ENDPOINT_CREATED',p_correlation);
 RETURN p_endpoint;
END $$;

CREATE FUNCTION set_webhook_endpoint(p_actor uuid,p_endpoint uuid,p_enabled boolean,
 p_expected_version bigint,p_correlation uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE target ledger.webhook_endpoints%ROWTYPE; next_version bigint;
BEGIN
 IF p_actor IS NULL OR p_endpoint IS NULL OR p_enabled IS NULL OR p_expected_version<1 OR p_correlation IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_COMMAND';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger.app_users WHERE id=p_actor AND enabled AND role='CUSTOMER') THEN
  RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='FORBIDDEN';
 END IF;
 SELECT * INTO target FROM ledger.webhook_endpoints WHERE id=p_endpoint AND owner_id=p_actor FOR UPDATE;
 IF target.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND'; END IF;
 IF target.version<>p_expected_version THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='WEBHOOK_VERSION_CONFLICT'; END IF;
 next_version:=target.version+1;
 UPDATE ledger.webhook_endpoints SET enabled=p_enabled,version=next_version,updated_at=clock_timestamp()
 WHERE id=p_endpoint;
 INSERT INTO ledger.webhook_audit(actor_id,endpoint_id,action,correlation_id)
 VALUES(p_actor,p_endpoint,CASE WHEN p_enabled THEN 'ENDPOINT_ENABLED' ELSE 'ENDPOINT_DISABLED' END,p_correlation);
 RETURN next_version;
END $$;

CREATE FUNCTION rotate_webhook_endpoint(p_actor uuid,p_endpoint uuid,p_encrypted_secret text,
 p_expected_version bigint,p_correlation uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE target ledger.webhook_endpoints%ROWTYPE; next_version bigint; next_key integer;
BEGIN
 IF p_actor IS NULL OR p_endpoint IS NULL OR p_encrypted_secret IS NULL
 OR length(p_encrypted_secret) NOT BETWEEN 40 AND 500 OR p_expected_version<1 OR p_correlation IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_COMMAND';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger.app_users WHERE id=p_actor AND enabled AND role='CUSTOMER') THEN
  RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='FORBIDDEN';
 END IF;
 SELECT * INTO target FROM ledger.webhook_endpoints WHERE id=p_endpoint AND owner_id=p_actor FOR UPDATE;
 IF target.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND'; END IF;
 IF target.version<>p_expected_version THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='WEBHOOK_VERSION_CONFLICT'; END IF;
 next_version:=target.version+1;
 next_key:=target.secret_key_version+1;
 INSERT INTO ledger.webhook_endpoint_secrets(endpoint_id,key_version,encrypted_secret)
 VALUES(p_endpoint,next_key,p_encrypted_secret);
 UPDATE ledger.webhook_endpoints SET encrypted_secret=p_encrypted_secret,secret_key_version=next_key,
  version=next_version,rotated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_endpoint;
 INSERT INTO ledger.webhook_audit(actor_id,endpoint_id,action,correlation_id)
 VALUES(p_actor,p_endpoint,'SECRET_ROTATED',p_correlation);
 RETURN next_version;
END $$;

CREATE FUNCTION request_webhook_retry(p_actor uuid,p_delivery uuid,p_reason text,p_correlation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE actor ledger.app_users%ROWTYPE; target record; started timestamptz:=clock_timestamp();
BEGIN
 IF p_actor IS NULL OR p_delivery IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500
 OR p_correlation IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_RETRY'; END IF;
 SELECT * INTO actor FROM ledger.app_users WHERE id=p_actor AND enabled;
 IF actor.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='FORBIDDEN'; END IF;
 SELECT d.*,e.owner_id,e.enabled INTO target FROM ledger.webhook_deliveries d
 JOIN ledger.webhook_endpoints e ON e.id=d.endpoint_id WHERE d.id=p_delivery FOR UPDATE OF d,e;
 IF target.id IS NULL OR (actor.role<>'ADMIN' AND target.owner_id<>p_actor) THEN
  RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND';
 END IF;
 IF target.state<>'FAILED' OR NOT target.enabled THEN
  RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='DELIVERY_NOT_RETRYABLE';
 END IF;
 UPDATE ledger.webhook_deliveries SET state='PENDING',cycle=cycle+1,attempts=0,
  cycle_started_at=started,max_age_at=started+interval '24 hours',
  next_attempt_at=started,lease_owner=NULL,lease_until=NULL,last_error=NULL,updated_at=started
 WHERE id=p_delivery;
 INSERT INTO ledger.webhook_audit(actor_id,endpoint_id,delivery_id,action,detail,correlation_id)
 VALUES(p_actor,target.endpoint_id,p_delivery,'MANUAL_RETRY_REQUESTED',btrim(p_reason),p_correlation);
END $$;

CREATE FUNCTION fanout_webhook_deliveries(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE created integer;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FANOUT_LIMIT'; END IF;
 WITH event_owners AS (
  SELECT e.id,e.event_type,e.schema_version,e.aggregate_id,e.aggregate_version,e.correlation_id,
   e.occurred_at,e.payload,
   CASE
    WHEN e.event_type LIKE 'payment.%' THEN (SELECT p.actor_id FROM ledger.payments p WHERE p.id=e.aggregate_id)
    WHEN e.event_type='transfer.settled' THEN (SELECT t.actor_id FROM ledger.transfers t WHERE t.id=e.aggregate_id)
    WHEN e.event_type LIKE 'schedule.%' THEN (SELECT s.owner_id FROM ledger.schedules s WHERE s.id=e.aggregate_id)
   END AS owner_id
  FROM ledger.outbox_events e
 ), due AS (
  SELECT o.* FROM event_owners o
  WHERE o.owner_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM ledger.webhook_endpoints ep
   WHERE ep.owner_id=o.owner_id AND ep.enabled AND ep.created_at<=o.occurred_at
    AND NOT EXISTS(SELECT 1 FROM ledger.webhook_deliveries d WHERE d.endpoint_id=ep.id AND d.event_id=o.id)
  )
  ORDER BY o.occurred_at,o.id LIMIT p_limit
 ), prepared AS (
  SELECT d.*,convert_to(jsonb_build_object('eventId',d.id,'eventType',d.event_type,
   'schemaVersion',d.schema_version,'aggregateId',d.aggregate_id,'aggregateVersion',d.aggregate_version,
   'correlationId',d.correlation_id,'occurredAt',to_char(d.occurred_at AT TIME ZONE 'UTC',
   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'payload',d.payload)::text,'UTF8') AS body
  FROM due d
 ), inserted AS (
  INSERT INTO ledger.webhook_deliveries(endpoint_id,event_id,event_type,schema_version,aggregate_id,
   aggregate_version,correlation_id,payload,state,attempts,next_attempt_at,created_at,cycle_started_at,
   updated_at,max_age_at,payload_hash,secret_key_version)
  SELECT ep.id,d.id,d.event_type,d.schema_version,d.aggregate_id,d.aggregate_version,d.correlation_id,
   d.body,'PENDING',0,clock_timestamp(),d.occurred_at,d.occurred_at,clock_timestamp(),
   d.occurred_at+interval '24 hours',encode(extensions.digest(d.body,'sha256'),'hex'),ep.secret_key_version
  FROM prepared d JOIN ledger.webhook_endpoints ep ON ep.owner_id=d.owner_id AND ep.enabled
   AND ep.created_at<=d.occurred_at
  ON CONFLICT(endpoint_id,event_id) DO NOTHING RETURNING 1
 ) SELECT count(*) INTO created FROM inserted;
 RETURN created;
END $$;

CREATE FUNCTION claim_webhook_deliveries(p_owner uuid,p_limit integer,p_lease_seconds integer)
RETURNS TABLE(delivery_id uuid,endpoint_id uuid,event_id uuid,event_type text,correlation_id uuid,
 payload bytea,cycle integer,attempt integer,cycle_started_at timestamptz,max_age_at timestamptz,
 destination_url text,secret_key_version integer,encrypted_secret text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
BEGIN
 IF p_owner IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_WEBHOOK_CLAIM';
 END IF;
 INSERT INTO ledger.webhook_attempts(delivery_id,cycle,attempt,attempted_at,secret_key_version,outcome,
  duration_ms,error_code,correlation_id,next_attempt_at)
 SELECT d.id,d.cycle,d.attempts,d.updated_at,d.secret_key_version,
  'LEASE_EXPIRED',0,'DISPATCHER_LEASE_EXPIRED',d.correlation_id,clock_timestamp()
 FROM ledger.webhook_deliveries d
 WHERE d.state='IN_FLIGHT' AND d.lease_until<clock_timestamp()
 ON CONFLICT ON CONSTRAINT webhook_attempt_identity DO NOTHING;
 UPDATE ledger.webhook_deliveries d SET
  state=CASE WHEN d.attempts>=8 OR clock_timestamp()>=d.max_age_at THEN 'FAILED' ELSE 'PENDING' END,
  next_attempt_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,
  last_error='DISPATCHER_LEASE_EXPIRED',updated_at=clock_timestamp()
 WHERE d.state='IN_FLIGHT' AND d.lease_until<clock_timestamp();
 UPDATE ledger.webhook_deliveries d SET state='FAILED',last_error='DELIVERY_AGE_EXHAUSTED',updated_at=clock_timestamp()
 WHERE d.state='PENDING' AND clock_timestamp()>=d.max_age_at;
 RETURN QUERY
 WITH due AS (
  SELECT d.id FROM ledger.webhook_deliveries d
  JOIN ledger.webhook_endpoints e ON e.id=d.endpoint_id
  WHERE d.state='PENDING' AND d.next_attempt_at<=clock_timestamp() AND d.attempts<8
   AND clock_timestamp()<d.max_age_at AND e.enabled
  ORDER BY d.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT p_limit
 ), claimed AS (
  UPDATE ledger.webhook_deliveries d SET state='IN_FLIGHT',attempts=d.attempts+1,
   lease_owner=p_owner,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp()
  FROM due WHERE d.id=due.id
  RETURNING d.id,d.endpoint_id,d.event_id,d.event_type,d.correlation_id,d.payload,d.cycle,d.attempts,
   d.cycle_started_at,d.max_age_at,d.secret_key_version
 )
 SELECT c.id,c.endpoint_id,c.event_id,c.event_type,c.correlation_id,c.payload,c.cycle,c.attempts,
  c.cycle_started_at,c.max_age_at,e.destination_url,c.secret_key_version,s.encrypted_secret
 FROM claimed c JOIN ledger.webhook_endpoints e ON e.id=c.endpoint_id
 JOIN ledger.webhook_endpoint_secrets s ON s.endpoint_id=c.endpoint_id AND s.key_version=c.secret_key_version;
END $$;

CREATE FUNCTION complete_webhook_delivery(p_delivery uuid,p_owner uuid,p_outcome text,p_http_status integer,
 p_duration_ms integer,p_request_timestamp bigint,p_signature text,p_response_summary text,p_error_code text,
 p_next_attempt timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE target ledger.webhook_deliveries%ROWTYPE; final_state text;
BEGIN
 IF p_delivery IS NULL OR p_owner IS NULL
 OR p_outcome NOT IN ('DELIVERED','RETRY_SCHEDULED','PERMANENT_FAILURE','EXHAUSTED')
 OR p_duration_ms<0 OR p_duration_ms>300000 OR p_request_timestamp IS NULL OR p_request_timestamp<=0
 OR (p_signature IS NOT NULL AND p_signature<>'' AND p_signature !~ '^v1=[0-9a-f]{64}$')
 OR length(coalesce(p_response_summary,''))>1000 OR length(coalesce(p_error_code,''))>200 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_WEBHOOK_COMPLETION';
 END IF;
 SELECT * INTO target FROM ledger.webhook_deliveries
 WHERE id=p_delivery AND state='IN_FLIGHT' AND lease_owner=p_owner FOR UPDATE;
 IF target.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='WEBHOOK_LEASE_LOST'; END IF;
 IF p_outcome='RETRY_SCHEDULED' AND (p_next_attempt IS NULL OR p_next_attempt<=clock_timestamp()
  OR p_next_attempt>=target.max_age_at OR target.attempts>=8) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_WEBHOOK_RETRY';
 END IF;
 INSERT INTO ledger.webhook_attempts(delivery_id,cycle,attempt,request_timestamp,secret_key_version,signature,
  http_status,outcome,duration_ms,error_code,response_summary,next_attempt_at,correlation_id)
 VALUES(target.id,target.cycle,target.attempts,p_request_timestamp,target.secret_key_version,
  nullif(p_signature,''),p_http_status,p_outcome,p_duration_ms,nullif(p_error_code,''),
  nullif(p_response_summary,''),p_next_attempt,target.correlation_id);
 final_state:=CASE WHEN p_outcome='DELIVERED' THEN 'DELIVERED'
  WHEN p_outcome='RETRY_SCHEDULED' THEN 'PENDING' ELSE 'FAILED' END;
 UPDATE ledger.webhook_deliveries SET state=final_state,
  next_attempt_at=CASE WHEN final_state='PENDING' THEN p_next_attempt ELSE next_attempt_at END,
  lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp(),
  delivered_at=CASE WHEN final_state='DELIVERED' THEN clock_timestamp() ELSE delivered_at END,
  last_error=CASE WHEN final_state='DELIVERED' THEN NULL ELSE nullif(p_error_code,'') END
 WHERE id=target.id;
END $$;

CREATE FUNCTION get_webhook_receiver_secret(p_endpoint uuid,p_event uuid,p_key_version integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE protected text;
BEGIN
 IF p_endpoint IS NULL OR p_event IS NULL OR p_key_version<1 THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_RECEIVER_IDENTITY';
 END IF;
 SELECT s.encrypted_secret INTO protected
 FROM ledger.webhook_deliveries d
 JOIN ledger.webhook_endpoints e ON e.id=d.endpoint_id AND e.enabled
 JOIN ledger.webhook_endpoint_secrets s ON s.endpoint_id=d.endpoint_id AND s.key_version=p_key_version
 WHERE d.endpoint_id=p_endpoint AND d.event_id=p_event AND d.secret_key_version=p_key_version;
 IF protected IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND'; END IF;
 RETURN protected;
END $$;

CREATE FUNCTION record_webhook_receipt(p_endpoint uuid,p_event uuid,p_payload_hash text,p_signature text,
 p_request_timestamp bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE existing ledger.webhook_receiver_receipts%ROWTYPE;
BEGIN
 IF p_endpoint IS NULL OR p_event IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$'
 OR p_signature !~ '^v1=[0-9a-f]{64}$' OR p_request_timestamp IS NULL
 OR NOT EXISTS(SELECT 1 FROM ledger.webhook_deliveries d JOIN ledger.webhook_endpoints e
  ON e.id=d.endpoint_id WHERE d.endpoint_id=p_endpoint AND d.event_id=p_event AND e.enabled) THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_RECEIPT';
 END IF;
 SELECT * INTO existing FROM ledger.webhook_receiver_receipts
 WHERE endpoint_id=p_endpoint AND event_id=p_event FOR UPDATE;
 IF existing.endpoint_id IS NULL THEN
  INSERT INTO ledger.webhook_receiver_receipts(endpoint_id,event_id,payload_hash,first_signature,last_signature,
   first_request_timestamp,last_request_timestamp)
  VALUES(p_endpoint,p_event,p_payload_hash,p_signature,p_signature,p_request_timestamp,p_request_timestamp);
  RETURN true;
 END IF;
 IF existing.payload_hash<>p_payload_hash THEN
  RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='WEBHOOK_EVENT_BODY_CONFLICT';
 END IF;
 UPDATE ledger.webhook_receiver_receipts SET receive_count=receive_count+1,last_received_at=clock_timestamp(),
  last_signature=p_signature,last_request_timestamp=p_request_timestamp
 WHERE endpoint_id=p_endpoint AND event_id=p_event;
 RETURN false;
END $$;

REVOKE INSERT,UPDATE,DELETE ON webhook_endpoints,webhook_deliveries,webhook_attempts,webhook_audit,
 webhook_endpoint_secrets,webhook_receiver_receipts,webhook_receiver_control FROM ledger_runtime;
REVOKE SELECT ON webhook_endpoints FROM ledger_runtime;
GRANT SELECT(id,owner_id,destination_id,destination_url,enabled,created_at,version,updated_at,rotated_at,
 secret_key_version) ON webhook_endpoints TO ledger_runtime;
GRANT SELECT ON webhook_deliveries,webhook_attempts,webhook_audit,
 webhook_receiver_receipts,webhook_receiver_control TO ledger_runtime;
REVOKE ALL ON FUNCTION create_webhook_endpoint(uuid,uuid,text,text,text,uuid),
 set_webhook_endpoint(uuid,uuid,boolean,bigint,uuid),rotate_webhook_endpoint(uuid,uuid,text,bigint,uuid),
 request_webhook_retry(uuid,uuid,text,uuid),fanout_webhook_deliveries(integer),
 claim_webhook_deliveries(uuid,integer,integer),
 complete_webhook_delivery(uuid,uuid,text,integer,integer,bigint,text,text,text,timestamptz),
 get_webhook_receiver_secret(uuid,uuid,integer),record_webhook_receipt(uuid,uuid,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_webhook_endpoint(uuid,uuid,text,text,text,uuid),
 set_webhook_endpoint(uuid,uuid,boolean,bigint,uuid),rotate_webhook_endpoint(uuid,uuid,text,bigint,uuid),
 request_webhook_retry(uuid,uuid,text,uuid),fanout_webhook_deliveries(integer),
 claim_webhook_deliveries(uuid,integer,integer),
 complete_webhook_delivery(uuid,uuid,text,integer,integer,bigint,text,text,text,timestamptz),
 get_webhook_receiver_secret(uuid,uuid,integer),record_webhook_receipt(uuid,uuid,text,text,bigint) TO ledger_runtime;
