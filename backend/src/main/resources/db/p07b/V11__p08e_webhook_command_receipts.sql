-- Additive P08E command receipts. No signing material belongs in this table.
SET search_path=ledger,pg_catalog;
CREATE TABLE webhook_commands (
 owner_id uuid NOT NULL REFERENCES app_users(id),
 command_id uuid NOT NULL,
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 receipt jsonb CHECK(receipt IS NULL OR jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,command_id)
);

CREATE FUNCTION guard_webhook_command_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,ledger,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.receipt IS NULL AND NEW.receipt IS NOT NULL
 AND NEW.owner_id=OLD.owner_id AND NEW.command_id=OLD.command_id
 AND NEW.request=OLD.request AND NEW.created_at=OLD.created_at THEN RETURN NEW; END IF;
 RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_WEBHOOK_COMMAND';
END $$;
CREATE TRIGGER webhook_command_immutable BEFORE UPDATE OR DELETE ON webhook_commands
 FOR EACH ROW EXECUTE FUNCTION guard_webhook_command_receipt();
CREATE FUNCTION require_webhook_command_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,ledger,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ledger.webhook_commands c WHERE c.owner_id=NEW.owner_id
 AND c.command_id=NEW.command_id AND c.receipt IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INCOMPLETE_WEBHOOK_COMMAND';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER webhook_command_complete AFTER INSERT OR UPDATE ON webhook_commands
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_webhook_command_receipt();

CREATE FUNCTION execute_webhook_command(p_actor uuid,p_key uuid,p_request jsonb,
 p_new_endpoint uuid,p_encrypted_secret text,p_destination_url text,p_correlation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE
 saved ledger.webhook_commands%ROWTYPE;
 operation text; expected jsonb; endpoint uuid; delivery uuid; target record;
 applied_version bigint; applied_cycle integer; result jsonb;
BEGIN
 IF p_actor IS NULL OR p_key IS NULL OR p_correlation IS NULL OR p_request IS NULL
 OR jsonb_typeof(p_request)<>'object' THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_COMMAND';
 END IF;
 PERFORM 1 FROM ledger.app_users WHERE id=p_actor AND enabled AND role='CUSTOMER' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='FORBIDDEN'; END IF;
 operation:=p_request->>'kind';
 CASE operation
 WHEN 'CREATE' THEN expected:=jsonb_build_object('kind','CREATE');
 WHEN 'STATE' THEN
  endpoint:=(p_request->>'endpointId')::uuid;
  IF endpoint IS NULL OR (p_request->>'expectedVersion')::bigint IS NULL
  OR (p_request->>'expectedVersion')::bigint<1 OR jsonb_typeof(p_request->'enabled') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_COMMAND';
  END IF;
  expected:=jsonb_build_object('kind',operation,'endpointId',endpoint,
   'enabled',(p_request->>'enabled')::boolean,'expectedVersion',(p_request->>'expectedVersion')::bigint);
 WHEN 'ROTATE' THEN
  endpoint:=(p_request->>'endpointId')::uuid;
  IF endpoint IS NULL OR (p_request->>'expectedVersion')::bigint IS NULL
  OR (p_request->>'expectedVersion')::bigint<1 THEN
   RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_COMMAND';
  END IF;
  expected:=jsonb_build_object('kind',operation,'endpointId',endpoint,
   'expectedVersion',(p_request->>'expectedVersion')::bigint);
 WHEN 'RETRY' THEN
  delivery:=(p_request->>'deliveryId')::uuid;
  IF delivery IS NULL OR (p_request->>'expectedCycle')::integer IS NULL
  OR (p_request->>'expectedCycle')::integer<1 OR p_request->>'reason' IS NULL
  OR length(btrim(p_request->>'reason')) NOT BETWEEN 1 AND 500 THEN
   RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_COMMAND';
  END IF;
  expected:=jsonb_build_object('kind',operation,'deliveryId',delivery,
   'expectedCycle',(p_request->>'expectedCycle')::integer,'reason',btrim(p_request->>'reason'));
 ELSE RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_COMMAND';
 END CASE;
 IF p_request<>expected THEN RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_WEBHOOK_COMMAND'; END IF;

 -- The unique insert waits for a competing transaction; the row lock also serializes replays.
 INSERT INTO ledger.webhook_commands(owner_id,command_id,request) VALUES(p_actor,p_key,p_request)
 ON CONFLICT(owner_id,command_id) DO NOTHING;
 SELECT * INTO STRICT saved FROM ledger.webhook_commands c
 WHERE c.owner_id=p_actor AND c.command_id=p_key FOR UPDATE;
 IF saved.request<>p_request THEN
  RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='WEBHOOK_COMMAND_CONFLICT';
 END IF;
 IF saved.receipt IS NOT NULL THEN RETURN saved.receipt||jsonb_build_object('replayed',true); END IF;

 CASE operation
 WHEN 'CREATE' THEN
  endpoint:=ledger.create_webhook_endpoint(p_actor,p_new_endpoint,'sandbox-receiver',
   p_destination_url,p_encrypted_secret,p_correlation);
  applied_version:=1;
 WHEN 'STATE' THEN
  applied_version:=ledger.set_webhook_endpoint(p_actor,endpoint,(p_request->>'enabled')::boolean,
   (p_request->>'expectedVersion')::bigint,p_correlation);
 WHEN 'ROTATE' THEN
  applied_version:=ledger.rotate_webhook_endpoint(p_actor,endpoint,p_encrypted_secret,
   (p_request->>'expectedVersion')::bigint,p_correlation);
 WHEN 'RETRY' THEN
  SELECT d.endpoint_id,d.cycle INTO target FROM ledger.webhook_deliveries d
   JOIN ledger.webhook_endpoints e ON e.id=d.endpoint_id
   WHERE d.id=delivery AND e.owner_id=p_actor FOR UPDATE OF d,e;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND'; END IF;
  IF target.cycle<>(p_request->>'expectedCycle')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='WEBHOOK_CYCLE_CONFLICT';
  END IF;
  endpoint:=target.endpoint_id;
  PERFORM ledger.request_webhook_retry(p_actor,delivery,p_request->>'reason',p_correlation);
  applied_cycle:=target.cycle+1;
 END CASE;
 result:=jsonb_build_object('commandId',p_key,'kind',operation,'endpointId',endpoint,
  'deliveryId',delivery,'appliedVersion',applied_version,'appliedCycle',applied_cycle,
  'completedAt',clock_timestamp());
 UPDATE ledger.webhook_commands c SET receipt=result WHERE c.owner_id=p_actor AND c.command_id=p_key;
 RETURN result||jsonb_build_object('replayed',false);
END $$;

REVOKE ALL ON webhook_commands FROM PUBLIC,ledger_runtime;
GRANT SELECT ON webhook_commands TO ledger_runtime;
REVOKE ALL ON FUNCTION guard_webhook_command_receipt(),require_webhook_command_receipt() FROM PUBLIC;
REVOKE ALL ON FUNCTION execute_webhook_command(uuid,uuid,jsonb,uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_webhook_command(uuid,uuid,jsonb,uuid,text,text,uuid) TO ledger_runtime;
