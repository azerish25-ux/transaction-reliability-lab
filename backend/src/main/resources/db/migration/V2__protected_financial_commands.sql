SET search_path=ledger,pg_catalog;
CREATE FUNCTION _audit(p_actor uuid,p_action text,p_aggregate uuid,p_operation uuid,p_version bigint,p_correlation uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE head ledger.audit_heads%ROWTYPE; content text; hashed text;
BEGIN
 INSERT INTO ledger.audit_heads(aggregate_id) VALUES(p_aggregate) ON CONFLICT DO NOTHING;
 SELECT * INTO head FROM ledger.audit_heads WHERE aggregate_id=p_aggregate FOR UPDATE;
 content:=jsonb_build_object('actor',p_actor,'action',p_action,'aggregate',p_aggregate,'operation',p_operation,
 'version',p_version,'correlation',p_correlation,'reason',p_reason,'sequence',head.sequence+1,
 'occurredAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text;
 hashed:=encode(extensions.digest(decode(head.hash,'hex')||convert_to(content,'UTF8'),'sha256'),'hex');
 INSERT INTO ledger.audit_records(aggregate_id,sequence,actor_id,action,operation_id,correlation_id,aggregate_version,previous_hash,hash,canonical_body)
 VALUES(p_aggregate,head.sequence+1,p_actor,p_action,p_operation,p_correlation,p_version,head.hash,hashed,content);
 UPDATE ledger.audit_heads SET sequence=head.sequence+1,hash=hashed WHERE aggregate_id=p_aggregate;
END $$;

-- Internal only. Aggregate rows are locked BEFORE this function; balance rows always sorted by UUID.
CREATE FUNCTION _post(p_operation uuid,p_kind text,p_source uuid,p_destination uuid,p_amount bigint,p_currency text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE source ledger.accounts%ROWTYPE; destination ledger.accounts%ROWTYPE; from_balance ledger.account_balances%ROWTYPE;
 to_balance ledger.account_balances%ROWTYPE; journal uuid:=gen_random_uuid();
BEGIN
 IF p_amount NOT BETWEEN 1 AND 1000000000000 OR p_amount IS NULL OR p_source=p_destination THEN
 RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='INVALID_AMOUNT_OR_ACCOUNTS'; END IF;
 SELECT * INTO source FROM ledger.accounts WHERE id=p_source;
 SELECT * INTO destination FROM ledger.accounts WHERE id=p_destination;
 IF source.id IS NULL OR destination.id IS NULL OR source.status<>'OPEN' OR destination.status<>'OPEN'
 OR source.currency<>p_currency OR destination.currency<>p_currency OR destination.kind<>'WALLET_LIABILITY'
 OR (source.kind='SANDBOX_FUNDING_ASSET' AND p_kind<>'FUNDING')
 OR (p_kind='FUNDING' AND source.kind<>'SANDBOX_FUNDING_ASSET') THEN
 RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='INVALID_ACCOUNT_OR_CURRENCY'; END IF;
 PERFORM 1 FROM ledger.account_balances WHERE account_id IN (p_source,p_destination) ORDER BY account_id FOR UPDATE;
 SELECT * INTO from_balance FROM ledger.account_balances WHERE account_id=p_source;
 SELECT * INTO to_balance FROM ledger.account_balances WHERE account_id=p_destination;
 IF from_balance.account_id IS NULL OR to_balance.account_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MISSING_BALANCE'; END IF;
 IF source.kind='WALLET_LIABILITY' AND from_balance.posted_minor-from_balance.reserved_minor<p_amount THEN
 RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='INSUFFICIENT_FUNDS'; END IF;
 IF to_balance.posted_minor::numeric+p_amount>9223372036854775807 OR
 (source.kind='SANDBOX_FUNDING_ASSET' AND from_balance.posted_minor::numeric+p_amount>9223372036854775807) THEN
 RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='BALANCE_OVERFLOW'; END IF;
 INSERT INTO ledger.journals(id,operation_id,kind,currency) VALUES(journal,p_operation,p_kind,p_currency);
 INSERT INTO ledger.journal_entries(journal_id,account_id,currency,side,amount_minor)
 VALUES(journal,p_source,p_currency,'DEBIT',p_amount),(journal,p_destination,p_currency,'CREDIT',p_amount);
 UPDATE ledger.account_balances SET posted_minor=posted_minor + CASE WHEN source.kind='SANDBOX_FUNDING_ASSET' THEN p_amount ELSE -p_amount END,
 version=version+1,updated_at=clock_timestamp() WHERE account_id=p_source;
 UPDATE ledger.account_balances SET posted_minor=posted_minor+p_amount,version=version+1,updated_at=clock_timestamp() WHERE account_id=p_destination;
 RETURN journal;
END $$;

CREATE FUNCTION _payment_event(p_payment uuid,p_type text,p_correlation uuid) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE p ledger.payments%ROWTYPE;
BEGIN
 SELECT * INTO STRICT p FROM ledger.payments WHERE id=p_payment;
 INSERT INTO ledger.outbox_events(aggregate_id,aggregate_version,event_type,correlation_id,payload)
 VALUES(p.id,p.version,p_type,p_correlation,jsonb_build_object('paymentId',p.id,'version',p.version,
 'state',p.state,'amountMinor',p.amount_minor::text,'currency',p.currency,'refundedMinor',p.refunded_minor::text,
 'reversed',p.reversed,'journalId',p.journal_id));
END $$;

-- No money-affecting runtime API can call _post directly. Deterministic rejections commit the replay outcome.
CREATE FUNCTION execute_command(p_actor uuid,p_kind text,p_parent uuid,p_key text,p_payload jsonb,p_correlation uuid)
RETURNS TABLE(http_status integer,body jsonb,replayed boolean) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ledger,pg_temp AS $$
<<cmd>>
DECLARE scope text:=coalesce(p_parent::text,''); fingerprint text; prior ledger.idempotency_records%ROWTYPE;
 actor ledger.app_users%ROWTYPE; source ledger.accounts%ROWTYPE; destination ledger.accounts%ROWTYPE;
 p ledger.payments%ROWTYPE; held ledger.holds%ROWTYPE; amount bigint; operation uuid:=gen_random_uuid();
 journal uuid; status integer; result jsonb; balance ledger.account_balances%ROWTYPE; reason text;
BEGIN
 SELECT * INTO actor FROM ledger.app_users WHERE id=p_actor AND enabled;
 IF actor.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='FORBIDDEN'; END IF;
 IF p_kind NOT IN ('TRANSFER','PAYMENT','CANCEL','REFUND','REVERSAL') OR p_kind IS NULL
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
 OR octet_length(p_payload::text)>4096 OR p_correlation IS NULL THEN
 RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_COMMAND'; END IF;
 IF (p_kind IN ('TRANSFER','PAYMENT') AND p_parent IS NOT NULL) OR (p_kind IN ('CANCEL','REFUND','REVERSAL') AND p_parent IS NULL) THEN
 RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_PARENT'; END IF;
 -- Reject unknown fields before claiming an idempotency identity. JSONB property order is incidental.
 IF (p_kind IN ('TRANSFER','PAYMENT') AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('sourceId','recipientRef','amountMinor','currency')))
 OR (p_kind='REFUND' AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('amountMinor','reason')))
 OR (p_kind IN ('CANCEL','REVERSAL') AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k<>'reason')) THEN
 RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='UNKNOWN_FIELD'; END IF;
 IF p_payload ? 'reason' THEN
  IF jsonb_typeof(p_payload->'reason')<>'string' OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_REASON'; END IF;
  p_payload:=jsonb_set(p_payload,'{reason}',to_jsonb(btrim(p_payload->>'reason')));
 END IF;
 IF p_kind IN ('TRANSFER','PAYMENT','REFUND') THEN
 IF p_payload->>'amountMinor' IS NULL OR jsonb_typeof(p_payload->'amountMinor')<>'string' OR (p_payload->>'amountMinor') !~ '^[1-9][0-9]{0,12}$'
 OR (p_payload->>'amountMinor')::numeric>1000000000000 THEN RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_AMOUNT'; END IF;
 amount:=(p_payload->>'amountMinor')::bigint;
 END IF;
 IF p_kind IN ('TRANSFER','PAYMENT') THEN
 IF p_payload->>'currency' IS NULL OR p_payload->>'currency' NOT IN ('CAD','USD','JPY','KWD')
 OR p_payload->>'sourceId' IS NULL OR p_payload->>'recipientRef' IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_INTENT'; END IF;
 -- Validate UUID before key claim, and verify ownership without granting recipient inspection.
 IF jsonb_typeof(p_payload->'sourceId')<>'string' OR (p_payload->>'sourceId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR jsonb_typeof(p_payload->'recipientRef')<>'string' OR btrim(p_payload->>'recipientRef') !~ '^LG-[0-9a-f]{32}$'
 OR jsonb_typeof(p_payload->'currency')<>'string' THEN
 RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_INTENT'; END IF;
 p_payload:=jsonb_set(jsonb_set(p_payload,'{sourceId}',to_jsonb(lower(p_payload->>'sourceId'))),'{recipientRef}',to_jsonb(btrim(p_payload->>'recipientRef')));
 SELECT * INTO source FROM ledger.accounts WHERE id=(p_payload->>'sourceId')::uuid AND owner_id=p_actor AND kind='WALLET_LIABILITY';
 IF source.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND'; END IF;
 IF actor.role<>'CUSTOMER' THEN RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='ADMIN_CANNOT_SPEND'; END IF;
 END IF;
 IF p_kind='REVERSAL' AND (actor.role<>'ADMIN' OR coalesce(length(btrim(p_payload->>'reason')),0) NOT BETWEEN 1 AND 500) THEN
 RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='REVERSAL_AUTHORITY_REQUIRED'; END IF;
 IF p_kind='REFUND' AND NOT p_payload ? 'reason' THEN p_payload:=p_payload||jsonb_build_object('reason','Recipient refund'); END IF;
 fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('v',1,'actor',p_actor,'kind',p_kind,'parent',scope,'intent',p_payload)::text,'UTF8'),'sha256'),'hex');
 INSERT INTO ledger.idempotency_records(actor_id,operation_kind,parent_scope,key,fingerprint)
 VALUES(p_actor,p_kind,scope,p_key,fingerprint) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN
 SELECT * INTO prior FROM ledger.idempotency_records WHERE actor_id=p_actor AND operation_kind=p_kind AND parent_scope=scope AND key=p_key FOR UPDATE;
 IF prior.fingerprint<>fingerprint THEN RETURN QUERY SELECT 409,jsonb_build_object('code','IDEMPOTENCY_CONFLICT'),false;RETURN; END IF;
 IF prior.status IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INCOMPLETE_IDEMPOTENCY_RECORD'; END IF;
 RETURN QUERY SELECT prior.status,prior.response,true;RETURN;
 END IF;
 BEGIN
  IF p_kind IN ('TRANSFER','PAYMENT') THEN
   SELECT * INTO destination FROM ledger.accounts WHERE public_ref=p_payload->>'recipientRef' AND kind='WALLET_LIABILITY' AND status='OPEN';
   IF destination.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='INVALID_RECIPIENT'; END IF;
   IF source.status<>'OPEN' OR source.id=destination.id OR source.currency<>destination.currency OR source.currency<>p_payload->>'currency' THEN
    RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='INVALID_ACCOUNT_OR_CURRENCY'; END IF;
   IF p_kind='TRANSFER' THEN
    journal:=ledger._post(operation,'TRANSFER',source.id,destination.id,amount,source.currency);
    INSERT INTO ledger.transfers(id,actor_id,source_id,destination_id,amount_minor,currency,journal_id)
    VALUES(operation,p_actor,source.id,destination.id,amount,source.currency,journal);
    PERFORM ledger._audit(p_actor,'TRANSFER',operation,operation,1,p_correlation,'');
    result:=jsonb_build_object('id',operation,'kind','TRANSFER','state','SETTLED','journalId',journal,'amountMinor',amount::text,'currency',source.currency);
    INSERT INTO ledger.outbox_events(aggregate_id,aggregate_version,event_type,correlation_id,payload)
    VALUES(operation,1,'transfer.settled',p_correlation,result);
    status:=201;
   ELSE
    -- Lock the newly created aggregate before sorted balances; no other process can see it yet.
    INSERT INTO ledger.payments(id,actor_id,source_id,destination_id,amount_minor,currency)
    VALUES(operation,p_actor,source.id,destination.id,amount,source.currency);
    PERFORM 1 FROM ledger.account_balances WHERE account_id IN (source.id,destination.id) ORDER BY account_id FOR UPDATE;
    SELECT * INTO balance FROM ledger.account_balances WHERE account_id=source.id;
    IF balance.posted_minor-balance.reserved_minor<amount THEN RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='INSUFFICIENT_FUNDS'; END IF;
    UPDATE ledger.account_balances SET reserved_minor=reserved_minor+amount,version=version+1,updated_at=clock_timestamp() WHERE account_id=source.id;
    INSERT INTO ledger.holds(payment_id,account_id,amount_minor,state) VALUES(operation,source.id,amount,'ACTIVE');
    PERFORM ledger._audit(p_actor,'PAYMENT_ACCEPTED',operation,operation,1,p_correlation,'');
    PERFORM ledger._payment_event(operation,'payment.requested',p_correlation);
    result:=jsonb_build_object('id',operation,'kind','PAYMENT','state','PENDING','amountMinor',amount::text,'currency',source.currency);
    status:=202;
   END IF;
  ELSE
   SELECT * INTO p FROM ledger.payments WHERE id=p_parent FOR UPDATE;
   IF p.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND'; END IF;
   IF p_kind='CANCEL' THEN
    IF p.actor_id<>p_actor AND actor.role<>'ADMIN' THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND'; END IF;
    IF actor.role='ADMIN' AND coalesce(length(btrim(p_payload->>'reason')),0) NOT BETWEEN 1 AND 500 THEN
     RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='ADMIN_REASON_REQUIRED'; END IF;
    IF p.state<>'PENDING' THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='INVALID_PAYMENT_STATE'; END IF;
    PERFORM 1 FROM ledger.account_balances WHERE account_id IN (p.source_id,p.destination_id) ORDER BY account_id FOR UPDATE;
    UPDATE ledger.holds SET state='RELEASED',updated_at=clock_timestamp() WHERE payment_id=p.id AND state='ACTIVE';
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MISSING_ACTIVE_HOLD'; END IF;
    UPDATE ledger.account_balances SET reserved_minor=reserved_minor-p.amount_minor,version=version+1,updated_at=clock_timestamp() WHERE account_id=p.source_id;
    UPDATE ledger.payments SET state='CANCELLED',version=version+1,updated_at=clock_timestamp() WHERE id=p.id;
    result:=jsonb_build_object('id',p.id,'state','CANCELLED');status:=200;
   ELSE
    SELECT * INTO destination FROM ledger.accounts WHERE id=p.destination_id;
    IF (p_kind='REFUND' AND destination.owner_id<>p_actor AND actor.role<>'ADMIN') OR (p_kind='REVERSAL' AND actor.role<>'ADMIN') THEN
     RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='FORBIDDEN'; END IF;
    IF p.state<>'SETTLED' OR p.reversed THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='INVALID_PAYMENT_STATE'; END IF;
    reason:=btrim(coalesce(p_payload->>'reason','Recipient refund'));
    IF length(reason) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='REASON_REQUIRED'; END IF;
    IF p_kind='REVERSAL' THEN
     IF p.refunded_minor<>0 THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='REVERSAL_FORBIDDEN'; END IF;
     amount:=p.amount_minor;
    ELSIF amount>p.amount_minor-p.refunded_minor THEN RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='EXCESS_REFUND'; END IF;
    journal:=ledger._post(operation,p_kind,p.destination_id,p.source_id,amount,p.currency);
    INSERT INTO ledger.adjustments(id,payment_id,actor_id,kind,amount_minor,journal_id,reason)
    VALUES(operation,p.id,p_actor,p_kind,amount,journal,reason);
    UPDATE ledger.payments SET refunded_minor=refunded_minor+CASE WHEN p_kind='REFUND' THEN amount ELSE 0 END,
     reversed=(p_kind='REVERSAL'),version=version+1,updated_at=clock_timestamp() WHERE id=p.id;
    result:=jsonb_build_object('id',operation,'paymentId',p.id,'kind',p_kind,'amountMinor',amount::text,'currency',p.currency,'journalId',journal);status:=201;
   END IF;
   PERFORM ledger._audit(p_actor,p_kind,p.id,operation,p.version+1,p_correlation,coalesce(p_payload->>'reason',''));
   PERFORM ledger._payment_event(p.id,'payment.updated',p_correlation);
  END IF;
 EXCEPTION
  WHEN SQLSTATE 'P4220' THEN status:=422;result:=jsonb_build_object('code',SQLERRM);
  WHEN SQLSTATE 'P4090' THEN status:=409;result:=jsonb_build_object('code',SQLERRM);
  WHEN SQLSTATE 'P4040' THEN status:=404;result:=jsonb_build_object('code','NOT_FOUND');
  WHEN SQLSTATE 'P4030' THEN status:=403;result:=jsonb_build_object('code','FORBIDDEN');
 END;
 UPDATE ledger.idempotency_records SET status=cmd.status,response=result,operation_id=CASE WHEN cmd.status<300 THEN operation ELSE NULL END
 WHERE actor_id=p_actor AND operation_kind=p_kind AND parent_scope=scope AND key=p_key;
 RETURN QUERY SELECT cmd.status,result,false;
END $$;

CREATE FUNCTION settle_event(p_event uuid,p_payment uuid,p_correlation uuid) RETURNS text LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE p ledger.payments%ROWTYPE; journal uuid; failure text;
BEGIN
 -- Aggregate first, then inbox; all consumers use this order.
 SELECT * INTO p FROM ledger.payments WHERE id=p_payment FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='UNKNOWN_PAYMENT'; END IF;
 INSERT INTO ledger.consumer_inbox(consumer,event_id) VALUES('payment-settler-v1',p_event) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN 'DUPLICATE'; END IF;
 IF p.state<>'PENDING' THEN RETURN p.state; END IF;
 BEGIN
  PERFORM 1 FROM ledger.account_balances WHERE account_id IN (p.source_id,p.destination_id) ORDER BY account_id FOR UPDATE;
  UPDATE ledger.holds SET state='CONSUMED',updated_at=clock_timestamp() WHERE payment_id=p.id AND state='ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MISSING_ACTIVE_HOLD'; END IF;
  UPDATE ledger.account_balances SET reserved_minor=reserved_minor-p.amount_minor WHERE account_id=p.source_id;
  journal:=ledger._post(p.id,'PAYMENT',p.source_id,p.destination_id,p.amount_minor,p.currency);
  UPDATE ledger.payments SET state='SETTLED',journal_id=journal,version=version+1,updated_at=clock_timestamp() WHERE id=p.id;
  PERFORM ledger._audit(NULL,'PAYMENT_SETTLED',p.id,p.id,p.version+1,p_correlation,'');
 EXCEPTION WHEN SQLSTATE 'P4220' THEN
  failure:=SQLERRM;
  -- Subtransaction rollback restored the ACTIVE hold and all posting fragments.
  PERFORM 1 FROM ledger.account_balances WHERE account_id IN (p.source_id,p.destination_id) ORDER BY account_id FOR UPDATE;
  UPDATE ledger.holds SET state='RELEASED',updated_at=clock_timestamp() WHERE payment_id=p.id AND state='ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MISSING_ACTIVE_HOLD'; END IF;
  UPDATE ledger.account_balances SET reserved_minor=reserved_minor-p.amount_minor,version=version+1,updated_at=clock_timestamp() WHERE account_id=p.source_id;
  UPDATE ledger.payments SET state='FAILED',failure_code=failure,version=version+1,updated_at=clock_timestamp() WHERE id=p.id;
  PERFORM ledger._audit(NULL,'PAYMENT_FAILED',p.id,p.id,p.version+1,p_correlation,failure);
 END;
 PERFORM ledger._payment_event(p.id,'payment.updated',p_correlation);
 SELECT state INTO failure FROM ledger.payments WHERE id=p.id;RETURN failure;
END $$;

CREATE FUNCTION register_customer(p_email text,p_hash text,p_name text) RETURNS uuid LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE result uuid;
BEGIN
 INSERT INTO ledger.app_users(email,password_hash,display_name,role) VALUES(lower(btrim(p_email)),p_hash,btrim(p_name),'CUSTOMER') RETURNING id INTO result;
 RETURN result;
END $$;
CREATE FUNCTION create_account(p_actor uuid,p_label text,p_currency text) RETURNS uuid LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE result uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ledger.app_users WHERE id=p_actor AND role='CUSTOMER' AND enabled) THEN
 RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='FORBIDDEN'; END IF;
 INSERT INTO ledger.accounts(owner_id,label,currency) VALUES(p_actor,p_label,p_currency) RETURNING id INTO result;
 INSERT INTO ledger.account_balances(account_id) VALUES(result);RETURN result;
END $$;

-- Every object/function has explicit grant rules. In particular _post and _audit are not callable by runtime.
REVOKE ALL ON ALL TABLES IN SCHEMA ledger FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ledger FROM PUBLIC;
GRANT USAGE ON SCHEMA ledger TO ledger_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA ledger TO ledger_runtime;
GRANT INSERT,UPDATE ON auth_sessions TO ledger_runtime;
GRANT INSERT,UPDATE ON payment_projection TO ledger_runtime;
GRANT UPDATE ON outbox_events TO ledger_runtime;
GRANT INSERT,UPDATE ON webhook_endpoints,webhook_deliveries TO ledger_runtime;
GRANT INSERT ON webhook_attempts,reconciliation_runs TO ledger_runtime;
GRANT EXECUTE ON FUNCTION register_customer(text,text,text),create_account(uuid,text,text),
execute_command(uuid,text,uuid,text,jsonb,uuid),settle_event(uuid,uuid,uuid) TO ledger_runtime;
