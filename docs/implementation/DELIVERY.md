# Delivery record — P07A verified

Repository: `azerish25-ux/transaction-reliability-lab`
Branch: `main`
Verified P07A implementation source: `9478663f97f9dc65d0c85117f244e1b8b80c37cb`
P07A result: `VERIFIED_PASS`
Full-product result: `INCOMPLETE / NO_GO`

## P07A GitHub delivery

Permanent `LedgerGuard P07A verification` push workflow run `36319414655` checked out the exact implementation SHA and completed successfully on September 27, 2026.

- Verification job `108620228488`: SUCCESS.
- Required gate `108621256048`: SUCCESS.
- Every mandatory build, Java/TypeScript test, PostgreSQL integration, Compose validation, secret scan, P05/P06 regression, two-scheduler campaign, reconciliation, evidence and teardown step succeeded.
- Artifact `10932146860`, `ledgerguard-p07a-evidence-9478663f97f9dc65d0c85117f244e1b8b80c37cb`, 142,982 bytes, SHA-256 `ca15e81bd90673978890b5e97f51e82aee1d6e3b2da3b092270568877c699473`.

Executed results included 133 core/security JUnit cases, 119 PostgreSQL/real-HTTP integration cases, 70 TypeScript client/contract cases, 42 P05 Compose checks, 32 P06 Compose checks and 15 P07A schedule Compose checks. All required suites reported zero failures/errors/skips. Fifty scoped P03–P07A requirements were bound to executed evidence, the tracked source was clean, 264 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

See the [durable P07A report](../evidence/p07a-9478663.md) and [machine-readable provenance](../evidence/p07a-9478663.json).

## Delivered P07A boundary

- Additive V9 scheduled-transfer migration in `classpath:db/p07`.
- Restricted security-definer schedule lifecycle and occurrence commands.
- Customer schedule REST resources and scoped OpenAPI.
- Two independent scheduler processes in `compose.p07.yaml`.
- Local-wall-time recurrence with explicit DST gap/overlap policies.
- Stable occurrence identities, one-effect row locking and atomic financial posting.
- Rejected and skipped-late occurrence history without invented balances.
- Durable edit behavior that preserves the validated `sourceId` and rejects unknown aliases without mutation.
- Real PostgreSQL race tests and a live two-scheduler Compose campaign.
- Permanent P07A verification layered on the complete P01–P06 regression gate.

The P07A overlay remains separate from `compose.yaml`, preserving the verified P06 topology and eight-migration history. Activating the overlay restarts the API with both migration locations and adds `scheduler-a` and `scheduler-b`.

## Remaining delivery

The original application remains **INCOMPLETE / NO_GO**. P07B signed durable webhook delivery, P08 React/browser/accessibility, P09 complete fault/defect laboratory, P10 contracts/scanners/performance/backup-restore/nightly/release lanes and P11 final evidence/video remain incomplete. There is no public deployment or release tag.

## Preserved prior delivery

P06 source `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed run `36306335283`. P05 source `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`. P04 source `60a95db82350983eaf1ad3c7545190866c831f98` passed run `36276049817`. P03 source `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`. Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`. Their durable reports retain their original scope and timestamps.
