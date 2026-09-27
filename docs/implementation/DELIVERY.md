# Delivery record — P05 verified

Repository: `azerish25-ux/transaction-reliability-lab`  
Branch: `main`  
Verified P05 source: `bbca6dd7478e33320aa134f6cd59c9652f4b60db`  
Source tree: `992c8c0b89e17a96b42e631d7ba6e313957d1984`

## GitHub delivery and ancestry

The authorized owner-linked Git-data route created an ordinary commit and advanced `main` through a non-forced fast-forward. The published branch was reread after delivery, and the permanent push workflow checked out the exact remote implementation SHA.

P05 was developed on `p05-async-payments`, where candidate execution exposed and resolved:

1. A poison-work smoke assertion that incorrectly expected one global failed-work row instead of one row per consumer/event.
2. A 500-character publisher diagnostic crossing the failed-work table's 200-character code boundary.
3. A temporary migration-count mismatch after the boundary fix was initially placed in V8; because P05 had not been released, the fix was folded into V7 and V8 removed.
4. An Actions-token workflow-file permission failure during pre-publication Git push. Verification had already completed successfully; publication was then performed through the authorized repository Git-data route.

The final implementation commit `bbca6dd7478e33320aa134f6cd59c9652f4b60db` has parent `67eadbfe19f8650898cc3cfea20c3e2774cd17b0`. No force-push or release tag was used.

## Verified workflow

- Workflow: `LedgerGuard P05 verification`.
- Run: `36285547632`.
- Event: `push`.
- Exact head SHA: `bbca6dd7478e33320aa134f6cd59c9652f4b60db`.
- Verification job `108525519311`: SUCCESS, 2026-09-27 01:26:48–01:31:32 UTC.
- Required gate `108526205503`: SUCCESS, completed 01:31:37 UTC.
- Every mandatory verification, recovery, reconciliation, evidence and teardown step succeeded.

Executed results:

- 133 core/security-configuration JUnit cases passed.
- 100 PostgreSQL and real HTTP integration cases passed: 58 authentication/account, 28 transfer, 13 financial/payment and 1 outbox-failure boundary.
- TypeScript passed 44 existing client, 6 authentication, 7 transfer and 5 payment cases.
- Forty-two live Compose P05 checks passed.
- Seven migrations, Compose validation, restricted-role startup, limited literal-secret scan, repeated zero-discrepancy reconciliation, 34-requirement traceability and teardown passed.
- The standalone 120-core execution repeats the core JUnit bodies and is not counted as additional unique tests.

See [durable P05 report](../evidence/p05-bbca6dd.md) and [JSON provenance](../evidence/p05-bbca6dd.json).

## Artifact

- ID `10920557373`.
- Name `ledgerguard-p05-evidence-bbca6dd7478e33320aa134f6cd59c9652f4b60db`.
- Size: 121,477 bytes.
- SHA-256: `b509e74ea2038f5cb58a529fa2ae0df43e7d82131d04145061c47f8b66c6098a`.
- Created 2026-09-27 01:31:30 UTC; expires 2026-10-11 01:31:30 UTC.

The artifact contains generated traceability, test reports and safe runtime evidence. Private sandbox credentials and session material are not published.

## Delivered topology and boundaries

P05 delivers:

- Customer asynchronous-payment acceptance and owner/relevant-party reads.
- Atomic payment, hold, audit, idempotency and outbox acceptance.
- Leased transactional-outbox publication with persistent messages, mandatory routing and confirms.
- Two independent manual-ack workers.
- Inbox and business-operation deduplication.
- Version-aware payment projection.
- Broker-outage tolerance, lease recovery, bounded failed work, administrator inspection and audited replay.
- Permanent P05 CI and a real Compose topology with PostgreSQL, RabbitMQ, API, publisher and two workers.

The full original application remains **INCOMPLETE / NO_GO**. There is no public deployment or release tag. P06 adjustments, P07 schedules/webhooks, P08 React/browser/accessibility, P09 complete fault/defect laboratory, P10 full contracts/scanners/performance/restore lanes and P11 final evidence/video remain incomplete.

## Preserved prior delivery

P04 implementation `60a95db82350983eaf1ad3c7545190866c831f98` passed run `36276049817`. P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`. Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`. Their durable reports retain their original scope and timestamps.
