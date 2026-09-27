# Delivery record — P06 verified, P07A candidate

Repository: `azerish25-ux/transaction-reliability-lab`
Branch: `main`
Verified P06 source: `bb1eeb1167b71fb92fb28f82c110fc489f60f03b`
P07A status: source candidate pending exact-SHA remote verification

## P06 GitHub delivery

P06 was verified by permanent `LedgerGuard P06 verification` push workflow run `36306335283` against exact head SHA `bb1eeb1167b71fb92fb28f82c110fc489f60f03b`.

- Verification job `108583623323`: SUCCESS.
- Required gate `108584444271`: SUCCESS.
- Every mandatory build, test, Compose, recovery, reconciliation, evidence and teardown step succeeded.
- Artifact `10927072704`, `ledgerguard-p06-evidence-bb1eeb1167b71fb92fb28f82c110fc489f60f03b`, SHA-256 `da7191a394f4e5c66cab2b3f5ee73f805b966a560bba458a37b7f0d7b7fd74d7`.

Executed P06 results included 133 core/security JUnit cases, 114 PostgreSQL/real HTTP integration cases, 70 TypeScript cases, 42 P05 Compose checks, 32 P06 Compose checks and 44 executed P03–P06 requirements. All required suites reported zero failures/errors/skips and reconciliation reported zero discrepancies. See [the durable P06 report](../evidence/p06-bb1eeb.md).

## P07A candidate delivery boundary

The candidate adds:

- Additive V9 scheduled-transfer migration in `classpath:db/p07`.
- Restricted security-definer lifecycle and occurrence commands.
- Customer schedule REST resources and scoped OpenAPI.
- Two independent scheduler processes in `compose.p07.yaml`.
- Local-wall-time recurrence with explicit Halifax DST policies.
- Stable occurrence identities, one-effect row-locking and atomic financial posting.
- Rejected and skipped-late occurrence history without invented balances.
- Real PostgreSQL race tests and a live Compose schedule campaign.
- A permanent P07A workflow layered on the complete P01–P06 regression gate.

The P07A overlay is intentionally separate from `compose.yaml` so the exact verified P06 topology and eight-migration history remain reproducible. Activating the overlay restarts the API with both migration locations and adds `scheduler-a` and `scheduler-b`.

No P07A verification result is claimed before the final implementation SHA passes the permanent gate. After success, a durable report must record the final source SHA, run/job IDs, exact suite/check counts and artifact digest.

## Remaining delivery

The full original application remains **INCOMPLETE / NO_GO**. P07B signed durable webhook delivery, P08 React/browser/accessibility, P09 complete fault/defect laboratory, P10 full contracts/scanners/performance/restore lanes and P11 final evidence/video remain incomplete. There is no public deployment or release tag.

## Preserved prior delivery

P05 implementation `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`. P04 implementation `60a95db82350983eaf1ad3c7545190866c831f98` passed run `36276049817`. P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`. Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`. Their durable reports retain their original scope and timestamps.
