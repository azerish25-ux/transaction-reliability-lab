-- Meaningful additive upgrade: stable transport-envelope version for pre-existing outbox events.
-- Application reads the default first; backfill prior rows, then constrain. No history deletion.
ALTER TABLE ledger.outbox_events ADD COLUMN envelope_version integer;
UPDATE ledger.outbox_events SET envelope_version=1 WHERE envelope_version IS NULL;
ALTER TABLE ledger.outbox_events ALTER COLUMN envelope_version SET DEFAULT 1;
ALTER TABLE ledger.outbox_events ALTER COLUMN envelope_version SET NOT NULL;
ALTER TABLE ledger.outbox_events ADD CONSTRAINT supported_envelope_version CHECK(envelope_version=1);
