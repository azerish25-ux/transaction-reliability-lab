# P06 verified evidence — payment cancellation, refunds and reversal

Verified source: `bb1eeb1167b71fb92fb28f82c110fc489f60f03b`
Workflow: `P06 verification`
Run: `36306335283`
Event: `push`
Result: `VERIFIED_PASS`

## Executed gate

The permanent workflow checked out the exact source SHA and completed both mandatory jobs successfully on September 27, 2026:

- `108583623323` — build, payment adjustments, messaging recovery, security and financial invariants: SUCCESS.
- `108584444271` — required P06 gate: SUCCESS.

The gate executed Java 21, Node 22, PostgreSQL 17.11, RabbitMQ 4.3.5 and the real Docker Compose topology. It validated the Compose model, scanned 251 tracked files for high-signal literal secrets, started and reconciled the topology, exercised P05 recovery proofs, exercised the complete P06 adjustment campaign, required P03–P06 traceability, captured logs and tore the environment down.

## Passing suites

- 120 core domain/policy JUnit cases.
- 13 security-configuration JUnit cases.
- 58 authentication/account real HTTP integration cases.
- 28 immediate-transfer real HTTP and concurrency cases.
- 13 PostgreSQL financial cases.
- 1 outbox failure-boundary case.
- 14 payment-adjustment PostgreSQL/two-API race cases.
- 44 base TypeScript client cases.
- 6 authentication, 7 transfer, 5 payment and 8 adjustment TypeScript contract cases.
- 42 P05 live Compose checks.
- 32 P06 cancellation/refund/reversal live Compose checks.
- 44 scoped P03–P06 requirements bound to executed evidence.

Every required suite reported zero failures, zero errors and zero skips. Reconciliation ended with zero discrepancies.

## P06 proofs

The verified scope includes:

- payer cancellation before settlement, with one hold release and no compensating journal;
- reasoned administrator cancellation and non-disclosing authorization failures;
- cancellation-versus-settlement serialization;
- recipient/administrator partial and full compensating refunds;
- administrator-only full reversal with a required reason;
- immutable original settlement journals and separate adjustment state;
- parent-scoped durable idempotency, changed-intent conflicts and lost-response replay;
- concurrent refund bounds and reversal-versus-spending serialization;
- deferred database posting-integrity enforcement, runtime-role restrictions and adjustment reconciliation;
- preservation of all verified P03–P05 behavior.

## Artifact provenance

- Artifact ID: `10927072704`.
- Name: `ledgerguard-p06-evidence-bb1eeb1167b71fb92fb28f82c110fc489f60f03b`.
- Size: 134,809 bytes.
- SHA-256: `da7191a394f4e5c66cab2b3f5ee73f805b966a560bba458a37b7f0d7b7fd74d7`.
- Created: 2026-09-27 08:34:33 UTC.
- Scheduled expiry: 2026-10-11 08:34:32 UTC.

This durable report preserves the result after the temporary Actions artifact expires. It does not relabel P07–P11 as complete and does not constitute a product release.
