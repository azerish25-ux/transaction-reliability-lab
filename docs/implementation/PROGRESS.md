# Execution checkpoint — P07A VERIFIED_PASS

Overall product status remains **INCOMPLETE / NO_GO**. P01–P07A now retain exact-SHA verified evidence. P07B signed durable webhooks and P08–P11 remain incomplete.

## P07A verified source

P07A implementation source `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed permanent `LedgerGuard P07A verification` push workflow run `36319414655` on September 27, 2026.

- Main verification job `108620228488`: SUCCESS.
- Required aggregate gate `108621256048`: SUCCESS.
- Artifact `10932146860`: `ledgerguard-p07a-evidence-9478663f97f9dc65d0c85117f244e1b8b80c37cb`.
- Artifact SHA-256: `ca15e81bd90673978890b5e97f51e82aee1d6e3b2da3b092270568877c699473`.
- The generated evidence identifies the exact source SHA, reports `trackedTreeDirty: false`, and marks all six P07A requirements `VERIFIED_PASS`.

The source chain includes functional repair `6c1994a60447402e00abe451d24c311357b43b99`, which preserves the validated `sourceId` during schedule edits and adds regression coverage, followed by `9478663f97f9dc65d0c85117f244e1b8b80c37cb`, which binds schedule-policy traceability to the named standalone core evidence without weakening the independently verified Surefire gate.

## Verified P07A scope

- Customer-owned one-time, daily and weekly scheduled transfers.
- Intended local date/time plus IANA zone storage and derived UTC execution instant.
- Spring-gap advancement, earlier-offset overlap policy and local-wall-time recurrence.
- Durable create/edit/pause/resume/cancel commands with CSRF, idempotency and expected-version checks.
- Immutable `SUCCEEDED`, `REJECTED` and `SKIPPED_LATE` occurrence history.
- Stable occurrence identity derived from schedule ID, definition version and intended local time.
- Two independently running scheduler processes with PostgreSQL row locking, expected-tuple validation and occurrence uniqueness.
- Atomic success across transfer/journal/balance, occurrence, schedule advancement, audit and outbox events.
- Business rejection without financial fragments and oldest-first, one-obligation-at-a-time catch-up.
- Opt-in P07A Compose overlay while preserving the verified P06 default topology.

## Executed verification

The permanent gate completed 133 core/security JUnit cases, 119 PostgreSQL/real-HTTP integration cases, 70 TypeScript cases, 42 P05 live Compose checks, 32 P06 live adjustment checks and 15 P07A live schedule checks. Fifty scoped P03–P07A requirements were bound to executed evidence. All required suites reported zero failures, errors and skips; 264 tracked files produced zero high-signal literal-secret findings; reconciliation ended with zero discrepancies.

Durable provenance is recorded in `docs/evidence/p07a-9478663.md` and `docs/evidence/p07a-9478663.json`.

## Next executable action

Implement **P07B signed durable webhook delivery** as the next vertical slice: encrypted-at-rest endpoint secrets, exact-byte HMAC signatures, replay-window validation, durable logical delivery jobs and immutable attempts, a separately restartable dispatcher, bounded retries/backoff, strict destination controls, sandbox receiver verification, owner/admin inspection and restart/duplicate/security tests. Do not begin P08 interface completion before P07B is integrated and verified.
