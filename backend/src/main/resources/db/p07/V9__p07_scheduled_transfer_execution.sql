SET search_path=ledger,pg_catalog;

-- P07A activates the schedule tables preserved since V1 without weakening the
-- restricted runtime role. Definition version identifies economic intent;
-- event_version orders lifecycle and occurrence events.
ALTER TABLE schedules
  ADD COLUMN event_version bigint NOT NULL DEFAULT 1 CHECK(event_version > 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE INDEX schedule_owner_history ON schedules(owner_id,created_at DESC,id DESC);
CREATE INDEX schedule_occurrence_history ON schedule_occurrences(schedule_id,created_at DESC,id DESC);


CREATE FUNCTION _resolve_schedule_local(p_local timestamp without time zone,p_zone text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE candidate timestamptz; before_offset interval; after_offset interval; alternative timestamptz;
BEGIN
 IF p_local IS NULL OR p_zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_zone) THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_SCHEDULE_TIME';
 END IF;
 -- PostgreSQL resolves spring gaps by the pre-transition (standard) offset, which
 -- moves the wall time forward by the gap. For an autumn overlap it chooses the
 -- later standard-time instant; detect the offset change and select the earlier
 -- matching instant instead.
 candidate:=p_local AT TIME ZONE p_zone;
 before_offset:=((candidate-interval '36 hours') AT TIME ZONE p_zone)-
                ((candidate-interval '36 hours') AT TIME ZONE 'UTC');
 after_offset:=((candidate+interval '36 hours') AT TIME ZONE p_zone)-
               ((candidate+interval '36 hours') AT TIME ZONE 'UTC');
 alternative:=candidate-(before_offset-after_offset);
 IF alternative<candidate AND (alternative AT TIME ZONE p_zone)=p_local THEN RETURN alternative; END IF;
 RETURN candidate;
END $$;

CREATE FUNCTION _schedule_body(p_schedule uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
 SELECT jsonb_build_object(
   'id',s.id,
   'sourceId',s.source_id,
   'recipientRef',s.destination_ref,
   'amountMinor',s.amount_minor::text,
   'currency',s.currency,
   'intendedLocal',to_char(s.intended_local,'YYYY-MM-DD"T"HH24:MI:SS'),
   'zoneId',s.zone_id,
   'recurrence',s.recurrence,
   'version',s.version,
   'eventVersion',s.event_version,
   'nextInstant',to_char(s.next_instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'status',s.status,
   'createdAt',to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'updatedAt',to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 )
 FROM ledger.schedules s WHERE s.id=p_schedule
$$;

-- Durable, idempotent schedule lifecycle commands. Validation occurs before an
-- idempotency identity is claimed; deterministic business/state failures are
-- then stored and replayed exactly like the existing money commands.
CREATE FUNCTION execute_schedule_command(
 p_actor uuid,p_kind text,p_parent uuid,p_key text,p_payload jsonb,p_correlation uuid)
RETURNS TABLE(http_status integer,body jsonb,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
<<cmd>>
DECLARE
 scope text:=coalesce(p_parent::text,''); command_kind text:='SCHEDULE_'||coalesce(p_kind,'');
 fingerprint text; prior ledger.idempotency_records%ROWTYPE; actor ledger.app_users%ROWTYPE;
 current_schedule ledger.schedules%ROWTYPE; source ledger.accounts%ROWTYPE; destination ledger.accounts%ROWTYPE;
 operation uuid:=gen_random_uuid(); schedule_id uuid; status integer; result jsonb;
 source_id uuid; amount bigint; intended timestamp without time zone; next_at timestamptz;
 expected_version bigint; zone text; recurrence_value text; recipient text; currency_value text;
 action text; event_type text;
BEGIN
 SELECT * INTO actor FROM ledger.app_users WHERE id=p_actor AND enabled;
 IF actor.id IS NULL OR actor.role<>'CUSTOMER' THEN
  RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='FORBIDDEN';
 END IF;
 IF p_kind NOT IN ('CREATE','EDIT','PAUSE','RESUME','CANCEL') OR p_kind IS NULL
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>4096
 OR p_correlation IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_SCHEDULE_COMMAND';
 END IF;
 IF (p_kind='CREATE' AND p_parent IS NOT NULL) OR (p_kind<>'CREATE' AND p_parent IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_PARENT';
 END IF;
 IF p_kind='CREATE' AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k
      WHERE k NOT IN ('sourceId','recipientRef','amountMinor','currency','intendedLocal','zoneId','recurrence','nextInstant'))
 OR p_kind='EDIT' AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k
      WHERE k NOT IN ('sourceId','recipientRef','amountMinor','currency','intendedLocal','zoneId','recurrence','nextInstant','expectedVersion'))
 OR p_kind IN ('PAUSE','RESUME','CANCEL') AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k<>'expectedVersion') THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='UNKNOWN_FIELD';
 END IF;

 IF p_kind IN ('CREATE','EDIT') THEN
  IF NOT (p_payload ?& ARRAY['sourceId','recipientRef','amountMinor','currency','intendedLocal','zoneId','recurrence','nextInstant'])
  OR jsonb_typeof(p_payload->'sourceId') IS DISTINCT FROM 'string'
  OR (p_payload->>'sourceId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR jsonb_typeof(p_payload->'recipientRef') IS DISTINCT FROM 'string'
  OR btrim(p_payload->>'recipientRef') !~ '^LG-[0-9a-f]{32}$'
  OR jsonb_typeof(p_payload->'amountMinor') IS DISTINCT FROM 'string'
  OR (p_payload->>'amountMinor') !~ '^[1-9][0-9]{0,12}$'
  OR jsonb_typeof(p_payload->'currency') IS DISTINCT FROM 'string' OR p_payload->>'currency' NOT IN ('CAD','USD','JPY','KWD')
  OR jsonb_typeof(p_payload->'intendedLocal') IS DISTINCT FROM 'string'
  OR (p_payload->>'intendedLocal') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'
  OR jsonb_typeof(p_payload->'zoneId') IS DISTINCT FROM 'string'
  OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_payload->>'zoneId')
  OR jsonb_typeof(p_payload->'recurrence') IS DISTINCT FROM 'string' OR p_payload->>'recurrence' NOT IN ('ONCE','DAILY','WEEKLY')
  OR jsonb_typeof(p_payload->'nextInstant') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_SCHEDULE';
  END IF;
  BEGIN
   source_id:=(p_payload->>'sourceId')::uuid;
   amount:=(p_payload->>'amountMinor')::bigint;
   IF amount>1000000000000 THEN RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_SCHEDULE'; END IF;
   intended:=(p_payload->>'intendedLocal')::timestamp;
   next_at:=(p_payload->>'nextInstant')::timestamptz;
  EXCEPTION WHEN others THEN
   RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_SCHEDULE';
  END;
  recipient:=btrim(p_payload->>'recipientRef');
  currency_value:=p_payload->>'currency';zone:=p_payload->>'zoneId';recurrence_value:=p_payload->>'recurrence';
 END IF;
 IF p_kind<>'CREATE' THEN
  IF NOT (p_payload ? 'expectedVersion') OR jsonb_typeof(p_payload->'expectedVersion') IS DISTINCT FROM 'number'
  OR (p_payload->>'expectedVersion') !~ '^[1-9][0-9]{0,18}$' THEN
   RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_SCHEDULE_VERSION';
  END IF;
  BEGIN
   expected_version:=(p_payload->>'expectedVersion')::bigint;
  EXCEPTION WHEN others THEN
   RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_SCHEDULE_VERSION';
  END;
 END IF;
 -- Canonicalize incidental representation before fingerprinting.
 IF p_payload ? 'sourceId' THEN p_payload:=jsonb_set(p_payload,'{sourceId}',to_jsonb(lower(p_payload->>'sourceId'))); END IF;
 IF p_payload ? 'recipientRef' THEN p_payload:=jsonb_set(p_payload,'{recipientRef}',to_jsonb(btrim(p_payload->>'recipientRef'))); END IF;
 fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
   'v',1,'actor',p_actor,'kind',command_kind,'parent',scope,'intent',p_payload)::text,'UTF8'),'sha256'),'hex');
 INSERT INTO ledger.idempotency_records(actor_id,operation_kind,parent_scope,key,fingerprint)
 VALUES(p_actor,command_kind,scope,p_key,fingerprint) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN
  SELECT * INTO prior FROM ledger.idempotency_records r
   WHERE actor_id=p_actor AND r.operation_kind=command_kind AND parent_scope=scope AND key=p_key FOR UPDATE;
  IF prior.fingerprint<>fingerprint THEN
   RETURN QUERY SELECT 409,jsonb_build_object('code','IDEMPOTENCY_CONFLICT'),false;RETURN;
  END IF;
  IF prior.status IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INCOMPLETE_IDEMPOTENCY_RECORD'; END IF;
  RETURN QUERY SELECT prior.status,prior.response,true;RETURN;
 END IF;

 BEGIN
  IF p_kind IN ('CREATE','EDIT') THEN
   IF next_at<>ledger._resolve_schedule_local(intended,zone) THEN
    RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_SCHEDULE_TIME';
   END IF;
   IF next_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='SCHEDULE_NOT_FUTURE'; END IF;
   SELECT * INTO source FROM ledger.accounts WHERE id=source_id AND owner_id=p_actor AND kind='WALLET_LIABILITY';
   SELECT * INTO destination FROM ledger.accounts WHERE public_ref=recipient AND kind='WALLET_LIABILITY';
   IF source.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND'; END IF;
   IF source.status<>'OPEN' OR destination.id IS NULL OR destination.status<>'OPEN' OR source.id=destination.id
   OR source.currency<>currency_value OR destination.currency<>currency_value THEN
    RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='INVALID_ACCOUNT_OR_CURRENCY';
   END IF;
  END IF;
  IF p_kind='CREATE' THEN
   schedule_id:=operation;
   INSERT INTO ledger.schedules(id,owner_id,source_id,destination_ref,amount_minor,currency,
     intended_local,zone_id,recurrence,next_instant)
   VALUES(schedule_id,p_actor,source_id,recipient,amount,currency_value,intended,zone,recurrence_value,next_at);
   action:='SCHEDULE_CREATED';event_type:='schedule.created';status:=201;
  ELSE
   SELECT * INTO current_schedule FROM ledger.schedules WHERE id=p_parent AND owner_id=p_actor FOR UPDATE;
   IF current_schedule.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND'; END IF;
   IF current_schedule.version<>expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='SCHEDULE_VERSION_CONFLICT';
   END IF;
   schedule_id:=current_schedule.id;
   IF p_kind='EDIT' THEN
    IF current_schedule.status NOT IN ('ACTIVE','PAUSED') THEN
     RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='INVALID_SCHEDULE_STATE';
    END IF;
    UPDATE ledger.schedules SET source_id=(p_payload->>'sourceAccountId')::uuid,destination_ref=recipient,amount_minor=amount,
      currency=currency_value,intended_local=intended,zone_id=zone,recurrence=recurrence_value,
      next_instant=next_at,version=version+1,event_version=event_version+1,updated_at=clock_timestamp()
     WHERE id=schedule_id;
    action:='SCHEDULE_EDITED';event_type:='schedule.updated';status:=200;
   ELSIF p_kind='PAUSE' THEN
    IF current_schedule.status<>'ACTIVE' THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='INVALID_SCHEDULE_STATE'; END IF;
    UPDATE ledger.schedules SET status='PAUSED',event_version=event_version+1,updated_at=clock_timestamp() WHERE id=schedule_id;
    action:='SCHEDULE_PAUSED';event_type:='schedule.updated';status:=200;
   ELSIF p_kind='RESUME' THEN
    IF current_schedule.status<>'PAUSED' THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='INVALID_SCHEDULE_STATE'; END IF;
    intended:=current_schedule.intended_local;next_at:=current_schedule.next_instant;
    IF current_schedule.recurrence='ONCE' THEN
     IF next_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='SCHEDULE_FINISHED'; END IF;
    ELSIF current_schedule.recurrence='DAILY' THEN
     intended:=intended+make_interval(days=>greatest(0,(clock_timestamp() AT TIME ZONE current_schedule.zone_id)::date-intended::date));
     next_at:=ledger._resolve_schedule_local(intended,current_schedule.zone_id);
     IF next_at<=clock_timestamp() THEN intended:=intended+interval '1 day';next_at:=ledger._resolve_schedule_local(intended,current_schedule.zone_id); END IF;
    ELSE
     intended:=intended+make_interval(weeks=>greatest(0,((clock_timestamp() AT TIME ZONE current_schedule.zone_id)::date-intended::date)/7));
     next_at:=ledger._resolve_schedule_local(intended,current_schedule.zone_id);
     IF next_at<=clock_timestamp() THEN intended:=intended+interval '1 week';next_at:=ledger._resolve_schedule_local(intended,current_schedule.zone_id); END IF;
    END IF;
    UPDATE ledger.schedules SET status='ACTIVE',intended_local=intended,next_instant=next_at,
      event_version=event_version+1,updated_at=clock_timestamp() WHERE id=schedule_id;
    action:='SCHEDULE_RESUMED';event_type:='schedule.updated';status:=200;
   ELSE
    IF current_schedule.status NOT IN ('ACTIVE','PAUSED') THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='INVALID_SCHEDULE_STATE'; END IF;
    UPDATE ledger.schedules SET status='CANCELLED',event_version=event_version+1,updated_at=clock_timestamp() WHERE id=schedule_id;
    action:='SCHEDULE_CANCELLED';event_type:='schedule.updated';status:=200;
   END IF;
  END IF;
  SELECT ledger._schedule_body(schedule_id) INTO result;
  PERFORM ledger._audit(p_actor,action,schedule_id,operation,(result->>'eventVersion')::bigint,p_correlation,'');
  INSERT INTO ledger.outbox_events(aggregate_id,aggregate_version,event_type,correlation_id,payload)
  VALUES(schedule_id,(result->>'eventVersion')::bigint,event_type,p_correlation,result);
 EXCEPTION
  WHEN SQLSTATE 'P4220' THEN status:=422;result:=jsonb_build_object('code',SQLERRM);
  WHEN SQLSTATE 'P4090' THEN status:=409;result:=jsonb_build_object('code',SQLERRM);
  WHEN SQLSTATE 'P4040' THEN status:=404;result:=jsonb_build_object('code','NOT_FOUND');
  WHEN SQLSTATE 'P4030' THEN status:=403;result:=jsonb_build_object('code','FORBIDDEN');
 END;
 UPDATE ledger.idempotency_records r SET status=cmd.status,response=result,
  operation_id=CASE WHEN cmd.status<300 THEN operation ELSE NULL END
 WHERE r.actor_id=p_actor AND r.operation_kind=command_kind AND r.parent_scope=scope AND r.key=p_key;
 RETURN QUERY SELECT cmd.status,result,false;
END $$;

-- Exactly one database transaction records an occurrence, its financial effect
-- (when any), schedule advancement, audit and outbox events. A retry after an
-- unknown commit is harmless because the expected schedule tuple is no longer current.
CREATE FUNCTION execute_schedule_occurrence(
 p_schedule uuid,p_expected_version bigint,p_expected_local timestamp without time zone,
 p_expected_due timestamptz,p_now timestamptz,p_next_local timestamp without time zone,
 p_next_due timestamptz,p_correlation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE
 s ledger.schedules%ROWTYPE; source ledger.accounts%ROWTYPE; destination ledger.accounts%ROWTYPE;
 operation uuid; identity_hash text; journal uuid; occurrence_id uuid:=gen_random_uuid();
 outcome_value text; failure text; new_event_version bigint; result jsonb; expected_next_local timestamp without time zone;
BEGIN
 IF p_schedule IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_expected_local IS NULL
 OR p_expected_due IS NULL OR p_now IS NULL OR p_correlation IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_SCHEDULE_OCCURRENCE';
 END IF;
 SELECT * INTO s FROM ledger.schedules WHERE id=p_schedule FOR UPDATE;
 IF s.id IS NULL THEN RETURN jsonb_build_object('outcome','NOT_FOUND'); END IF;
 IF s.status<>'ACTIVE' OR s.version<>p_expected_version OR s.intended_local<>p_expected_local
 OR s.next_instant<>p_expected_due OR s.next_instant>p_now THEN
  RETURN jsonb_build_object('outcome','IGNORED');
 END IF;
 IF s.next_instant<>ledger._resolve_schedule_local(s.intended_local,s.zone_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SCHEDULE_TIME_INVARIANT';
 END IF;
 identity_hash:=md5(s.id::text||':'||s.version::text||':'||to_char(s.intended_local,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 operation:=(substr(identity_hash,1,8)||'-'||substr(identity_hash,9,4)||'-'||substr(identity_hash,13,4)||'-'||
             substr(identity_hash,17,4)||'-'||substr(identity_hash,21,12))::uuid;
 IF EXISTS(SELECT 1 FROM ledger.schedule_occurrences WHERE schedule_id=s.id AND schedule_version=s.version AND intended_local=s.intended_local) THEN
  RETURN jsonb_build_object('outcome','DUPLICATE','operationId',operation);
 END IF;

 IF s.next_instant < p_now-interval '24 hours' THEN
  outcome_value:='SKIPPED_LATE';failure:='MISSED_CATCH_UP_WINDOW';
 ELSE
  SELECT * INTO source FROM ledger.accounts WHERE id=s.source_id;
  SELECT * INTO destination FROM ledger.accounts WHERE public_ref=s.destination_ref;
  BEGIN
   IF source.id IS NULL OR source.owner_id IS DISTINCT FROM s.owner_id OR source.kind<>'WALLET_LIABILITY'
   OR source.status<>'OPEN' OR destination.id IS NULL OR destination.kind<>'WALLET_LIABILITY'
   OR destination.status<>'OPEN' OR source.id=destination.id OR source.currency<>s.currency OR destination.currency<>s.currency THEN
    RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='INVALID_ACCOUNT_OR_CURRENCY';
   END IF;
   journal:=ledger._post(operation,'TRANSFER',source.id,destination.id,s.amount_minor,s.currency);
   INSERT INTO ledger.transfers(id,actor_id,source_id,destination_id,amount_minor,currency,journal_id)
   VALUES(operation,s.owner_id,source.id,destination.id,s.amount_minor,s.currency,journal);
   PERFORM ledger._audit(s.owner_id,'SCHEDULE_TRANSFER',operation,operation,1,p_correlation,
     s.id::text||':'||s.version::text||':'||to_char(s.intended_local,'YYYY-MM-DD"T"HH24:MI:SS'));
   INSERT INTO ledger.outbox_events(aggregate_id,aggregate_version,event_type,correlation_id,payload)
   VALUES(operation,1,'transfer.settled',p_correlation,jsonb_build_object(
     'id',operation,'kind','TRANSFER','state','SETTLED','journalId',journal,
     'amountMinor',s.amount_minor::text,'currency',s.currency,'scheduleId',s.id,
     'scheduleVersion',s.version,'intendedLocal',to_char(s.intended_local,'YYYY-MM-DD"T"HH24:MI:SS')));
   outcome_value:='SUCCEEDED';
  EXCEPTION WHEN SQLSTATE 'P4220' THEN
   outcome_value:='REJECTED';failure:=SQLERRM;journal:=NULL;
  END;
 END IF;

 INSERT INTO ledger.schedule_occurrences(id,schedule_id,schedule_version,intended_local,due_at,outcome,operation_id,error_code)
 VALUES(occurrence_id,s.id,s.version,s.intended_local,s.next_instant,outcome_value,operation,failure);
 IF s.recurrence='ONCE' THEN
  UPDATE ledger.schedules SET status='FINISHED',event_version=event_version+1,updated_at=clock_timestamp() WHERE id=s.id
   RETURNING event_version INTO new_event_version;
 ELSE
  expected_next_local:=CASE s.recurrence WHEN 'DAILY' THEN s.intended_local+interval '1 day' ELSE s.intended_local+interval '1 week' END;
  IF p_next_local IS DISTINCT FROM expected_next_local OR p_next_due IS DISTINCT FROM ledger._resolve_schedule_local(expected_next_local,s.zone_id)
  OR p_next_due<=s.next_instant THEN
   RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_NEXT_OCCURRENCE';
  END IF;
  UPDATE ledger.schedules SET intended_local=p_next_local,next_instant=p_next_due,
    event_version=event_version+1,updated_at=clock_timestamp() WHERE id=s.id
   RETURNING event_version INTO new_event_version;
 END IF;
 PERFORM ledger._audit(s.owner_id,'SCHEDULE_OCCURRENCE',s.id,operation,new_event_version,p_correlation,outcome_value);
 result:=jsonb_build_object(
   'id',occurrence_id,'scheduleId',s.id,'scheduleVersion',s.version,
   'intendedLocal',to_char(s.intended_local,'YYYY-MM-DD"T"HH24:MI:SS'),
   'dueAt',to_char(s.next_instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'outcome',outcome_value,'operationId',operation,'journalId',journal,'errorCode',failure);
 INSERT INTO ledger.outbox_events(aggregate_id,aggregate_version,event_type,correlation_id,payload)
 VALUES(s.id,new_event_version,'schedule.occurrence',p_correlation,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION _resolve_schedule_local(timestamp without time zone,text),
 _schedule_body(uuid),
 execute_schedule_command(uuid,text,uuid,text,jsonb,uuid),
 execute_schedule_occurrence(uuid,bigint,timestamp without time zone,timestamptz,timestamptz,timestamp without time zone,timestamptz,uuid)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 execute_schedule_command(uuid,text,uuid,text,jsonb,uuid),
 execute_schedule_occurrence(uuid,bigint,timestamp without time zone,timestamptz,timestamptz,timestamp without time zone,timestamptz,uuid)
 TO ledger_runtime;
