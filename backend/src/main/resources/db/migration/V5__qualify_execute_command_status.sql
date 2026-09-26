SET search_path=ledger,pg_catalog;

-- V2 was already published as a failed candidate. Preserve its checksum and apply
-- a guarded, additive repair so both fresh and previously migrated databases
-- converge on the same corrected function definition.
DO $migration$
DECLARE
  original_definition text;
  corrected_definition text;
  ambiguous_fragment constant text :=
    'SELECT * INTO destination FROM ledger.accounts WHERE public_ref=p_payload->>''recipientRef'' AND kind=''WALLET_LIABILITY'' AND status=''OPEN'';';
  qualified_fragment constant text :=
    'SELECT destination_account.* INTO destination FROM ledger.accounts AS destination_account WHERE destination_account.public_ref=p_payload->>''recipientRef'' AND destination_account.kind=''WALLET_LIABILITY'' AND destination_account.status=''OPEN'';';
BEGIN
  SELECT pg_get_functiondef(
    'ledger.execute_command(uuid,text,uuid,text,jsonb,uuid)'::regprocedure
  ) INTO original_definition;

  IF strpos(original_definition, ambiguous_fragment) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'EXPECTED_EXECUTE_COMMAND_FRAGMENT_NOT_FOUND';
  END IF;

  corrected_definition := replace(
    original_definition,
    ambiguous_fragment,
    qualified_fragment
  );
  EXECUTE corrected_definition;
END
$migration$;

REVOKE ALL ON FUNCTION ledger.execute_command(uuid,text,uuid,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ledger.execute_command(uuid,text,uuid,text,jsonb,uuid) TO ledger_runtime;
