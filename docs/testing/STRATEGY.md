# Risk-based test strategy

## Scope and entry conditions

The complete target is the unchanged MASTER_SPEC. This checkpoint verifies only Java component policies and TypeScript client behavior offline. PostgreSQL integration sources exist but are unexecuted. Authentication, a working API/UI/worker/receiver, contracts, operational faults, real throughput and delivery gates remain mandatory open work, not exclusions.

Financial correctness has priority over presentation. No real money, third-party targets, live identities or arbitrary egress are permitted. All test identities must be fictional and each integration worker gets unique financial fixtures. A component test is not evidence of database locking, a mocked Fetch response is not a provider contract, and a compile failure is not a valid mutant detection.

## Risk scoring

Impact, likelihood and detection difficulty are analyst-assigned ordinal 1–5 scales, not hiring statistics or incident probabilities. Impact 5 means possible money loss/creation or unauthorized financial access; 4 means material outage/inconsistent obligations; 3 means material operational/usability harm; 2 means limited friction; 1 means cosmetic. Likelihood 5 means routine triggering inputs, 3 means plausible races/environmental faults, 1 means rare guarded conditions. Detection difficulty 5 means silent delayed harm, 3 requires cross-boundary evidence, 1 is immediately visible. The product I×L×D just prioritizes test depth; all financial/auth gates are mandatory regardless of rank.

| Risk | Boundary and oracle | I | L | D | Priority product | Present evidence |
|---|---|---:|---:|---:|---:|---|
| R01 duplicate request | Same scope/key → one operation/posting | 5 | 5 | 4 | 100 | Fingerprint unit cases; DB suite unrun |
| R02 concurrent spending | Two APIs, 10,000 funds, two 8,000 requests → one controlled rejection | 5 | 4 | 4 | 80 | Pure availability tests; two-connection PG source unrun |
| R03 timeout after commit | Retried original key resolves original operation | 5 | 4 | 5 | 100 | Client replay and retry-classification units only |
| R04 worker crash | Commit/ACK order and eventual recovery after dependencies return | 5 | 3 | 5 | 75 | No executed evidence |
| R05 duplicate broker message | Inbox and business identity prevent extra journal | 5 | 4 | 5 | 100 | Settlement SQL/DB source unrun |
| R06 reordered events | Lower version never regresses terminal snapshot | 4 | 4 | 4 | 64 | Projection unit cases only |
| R07 partial transaction failure | Entries/holds/balances/state/audit/outbox commit atomically | 5 | 4 | 5 | 100 | Arithmetic reference model; DB invariants unrun |
| R08 invalid compensation | Authorized adjustment totals never exceed settlement | 5 | 4 | 4 | 80 | State-policy tests; PG race source unrun |
| R09 representation/overflow | String minor units agree exactly across browser/API/entries | 5 | 4 | 5 | 100 | Java/TS units; no browser-to-ledger proof |
| R10 cross-user access | Owner predicates on direct/nested reads/writes | 5 | 4 | 4 | 80 | Intent-store isolation only; HTTP auth unimplemented |
| R11 privilege escalation | CUSTOMER cannot perform administrator operations | 5 | 3 | 4 | 60 | DB function policy source unrun |
| R12 expired/altered auth | Actual protected endpoints reject invalid sessions | 5 | 4 | 4 | 80 | HTTP/JWT implementation missing |
| R13 webhook outage | Durable attempt budget/exact signatures; settlement isolated | 4 | 5 | 3 | 60 | Signature/retry/encryption units only |
| R14 migration | Historical fingerprints and replay survive real upgrade/restore | 5 | 3 | 5 | 75 | Additive migration source; no upgrade/restore proof |
| R15 scheduling | Unique occurrence; correct wall time/DST/catch-up | 4 | 4 | 5 | 80 | DST/identity policy units only |
| R16 performance | Measured thresholds plus independent financial reconciliation | 4 | 3 | 3 | 36 | Not measured |
| R17 accessibility | Axe + keyboard/focus + responsive critical journeys | 3 | 5 | 3 | 45 | No UI/browser evidence |
| R18 dependency fault | Actual fault reaches dependency; controlled recovery | 4 | 4 | 4 | 64 | Retry/egress unit cases, no injected infrastructure fault |

## Data and independent oracles

Java's seed-74021 arithmetic model executes 50,000 hold/release/consume/debit/credit steps against independent BigInteger posted/reserved totals. It is not a full payment/queue state machine and does not simulate distributed concurrency. TypeScript performs exact-string round trips against BigInt for 10,000 deterministic values in four currencies. Signature bytes are compared with an independently generated HMAC test vector, not only self-verification. PostgreSQL sources independently sum entries and active holds in one consistent snapshot.

The pending full-system state machine must include transfers, pending payments, settlement, cancellations, adjustments, duplicates and ambiguous failures, comparing identities and every invariant after each step. Tests must not authorize spending from the same broken helper they use as an oracle.

## Layers and exit criteria

Unit/component: strict compilation, actual nonzero discovery, no implicit retries, recorded seed. Database: real PostgreSQL owner/runtime roles, commits, rollback/failure boundaries and old-data migration. API: real Spring HTTP + CSRF/JWT/ownership/errors. Contracts: real frontend client to Pact consumer, real API/database provider states, actual broker/message and sender/receiver contracts. Browser: all critical customer/admin actions, exact amount/receipt evidence, responsive sizes and a11y. Resilience: prove F01–F08 were active, capture pre/active/recovery snapshots and teardown. Performance: maintain specified dataset/load/duration thresholds, include rejected/replayed/uncertain classes and post-load reconciliation.

Every gate consumes evidence from the exact candidate SHA; missing/skipped/pending/cancelled checks are not PASS. Coverage percentages, stress capacity, a11y conformance and security assurance cannot be inferred from test counts. All unperformed suites remain listed in release readiness.

## Component mutation protocol

`lab-support/unit-probes.json` describes exactly seven unit-component variants. The runner changes one matched source span in the single checkout, records original/mutant SHA-256 and source commit/dirty state, runs the same detecting case baseline/mutant/restored, rejects missing tests/compiler errors/unexpected failures, verifies restoration and retains red XML/logs. It has a filesystem lock and a recoverable original source copy. Expected mutant failure is not hidden through `continue-on-error`.

These probes are a partial learning/effectiveness experiment; their manifest explicitly sets `counts_toward_G07=false`. Full D01–D24 implementations at required HTTP/database/broker/browser boundaries are absent. No F01–F08 fault was activated.

## Security/evidence publication

No authentication tokens, signing keys or database backups may be published. Current fixtures have no live secrets; deterministic cryptographic vectors are labeled tests. Logs must be reviewed before curation. A local source scan is not a secret scanner certification. Future browser traces must be redacted or kept private when cookies cannot be safely removed. CI artifact expiry must be documented rather than presented as durable public storage.
