# Execution checkpoint — P07A IMPLEMENTED_UNVERIFIED

Overall product status remains **INCOMPLETE / NO_GO**. P01–P06 retain verified evidence. P07A durable scheduled transfers are implemented as a source candidate but must not be called `VERIFIED_PASS` until the exact published source SHA completes the permanent GitHub Actions gate.

## P06 closeout

P06 source `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed permanent push workflow run `36306335283`. Both mandatory jobs succeeded, every required suite reported zero failures/errors/skips, 32 live adjustment checks passed, 44 P03–P06 requirements were bound to executed evidence and reconciliation ended with zero discrepancies. Durable provenance is recorded in `docs/evidence/p06-bb1eeb.md`.

## P07A source candidate

The candidate adds the complete backend reliability slice for:

- Customer-owned one-time, daily and weekly scheduled transfers.
- Intended local date/time plus IANA zone storage and derived UTC execution instant.
- Spring-gap advancement, earlier-offset overlap policy and local-wall-time recurrence.
- Durable create/edit/pause/resume/cancel commands with CSRF, idempotency and expected-version checks.
- Immutable occurrence history with `SUCCEEDED`, `REJECTED` and `SKIPPED_LATE` outcomes.
- Stable occurrence operations derived from schedule ID, definition version and intended local time.
- Two independently running scheduler processes protected by PostgreSQL row locking, expected-tuple validation and occurrence uniqueness.
- Atomic success across transfer/journal/balance, occurrence, schedule advancement, audit and outbox events.
- Business rejection without financial fragments and oldest-first, one-obligation-at-a-time catch-up.
- An opt-in Compose overlay that preserves the exact verified P06 default topology.

## Candidate verification included

- Five real PostgreSQL integration cases covering durable creation/replay/conflict, restricted-role enforcement, synchronized two-scheduler execution, insufficient funds, catch-up expiry, edits and lifecycle races.
- Existing deterministic schedule policy cases for Halifax DST gaps/overlaps, daily/weekly recurrence, catch-up boundaries and versioned occurrence identity.
- A live Compose campaign with two scheduler processes, real API/CSRF/idempotency, owner isolation, one-time execution, lifecycle commands, accounting checks and independent reconciliation.
- A scoped P07A OpenAPI document, requirements manifest and evidence assertion layered on the complete P01–P06 gate.

## Status discipline

No P07A result is claimed in this source checkpoint. Generated evidence belongs to the exact tested implementation SHA. A later documentation-only commit may record a successful run without pretending to be the tested source.

P07A does not complete P07. Signed, encrypted-secret, bounded-retry durable webhook delivery and the sandbox receiver remain P07B.

## Next executable action

Publish this source candidate to `main` and run the permanent `LedgerGuard P07A verification` workflow. Fix any observed root cause and rerun the complete gate. When the final source SHA passes, record its workflow/job identities, suite/check counts and artifact digest as durable evidence. Then implement **P07B signed durable webhook delivery** before beginning P08 interfaces.
