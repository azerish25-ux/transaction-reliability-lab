-- P05 hardening: the retry record accepts 500 characters, while failed-work codes are deliberately bounded to 200.
-- Preserve the diagnostic prefix and guarantee that exhausting publication retries can always be recorded durably.
SET search_path=ledger,pg_catalog;

CREATE OR REPLACE FUNCTION fail_outbox(p_event uuid,p_owner uuid,p_envelope jsonb,p_error text,p_attempts integer) RETURNS uuid
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
  p_envelope,left(p_error,200),p_attempts);
 UPDATE ledger.outbox_events SET failed_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,last_error=p_error
 WHERE id=p_event;
 RETURN work;
END $$;
