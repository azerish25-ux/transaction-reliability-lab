# P08C source candidate — exact-SHA verification pending

P08C refund/reversal UI source is implemented with scoped server review and regression coverage. Existing durable P08B evidence below remains historical, not evidence for P08C. The final product remains INCOMPLETE / NO_GO.

# Delivery record — P08B verified

Repository: `azerish25-ux/transaction-reliability-lab`
Branch: `main`
Verified P08B implementation source: `5d6d883444845bc5de3364d0c682c3df26005d8e`
P08B result: `VERIFIED_PASS`
Full-product result: `INCOMPLETE / NO_GO`

## P08B GitHub delivery

Permanent `LedgerGuard P08B verification` push workflow run `36355379901` checked out the exact implementation SHA and completed successfully on September 27, 2026.

- Verification job `108721959438`: SUCCESS.
- Required gate `108723219635`: SUCCESS.
- Every mandatory frontend build, Java/TypeScript test, PostgreSQL integration, Compose validation, secret scan, P05–P07B regression, P08A/P08B browser/accessibility, reconciliation, evidence and teardown step succeeded.
- Artifact `10944390774`, `ledgerguard-p08b-evidence-5d6d883444845bc5de3364d0c682c3df26005d8e`, 1,732,590 bytes, SHA-256 `7fadf64bfff5689eea5ab0e4a933bc4b8bc3862f310bfdf8cefd0af6a6251d7f`.

Executed results included 133 core/security JUnit cases, 124 PostgreSQL/real-HTTP integration cases, 91 TypeScript client/contract cases, 42 P05 Compose checks, 32 P06 Compose checks, 15 P07A Compose checks, 26 P07B Compose checks and 24 Chromium journeys. All required suites reported zero failures/errors/skips. Seven scoped P08B requirements were bound to executed evidence, 316 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

See the [durable P08B report](../evidence/p08b-5d6d883.md) and [machine-readable provenance](../evidence/p08b-5d6d883.json).

## Delivered P08B boundary

- Locked React/TypeScript/Vite product build.
- Non-root nginx frontend with loopback binding, health check and same-origin API proxy.
- Exact-money immediate transfer form, explicit confirmation and settled receipt.
- Owner-scoped intent/key preservation across response loss, reload and session expiry.
- Safe same-key replay proving one committed transfer effect and blocking conflicting replacement commands.
- Durable asynchronous payment acceptance, real outbox/RabbitMQ/two-worker settlement and authoritative status polling.
- Owner-visible payment history/detail with lifecycle, version, timestamps, adjustment state, projection and settlement/failure data.
- Pending-payment cancellation while both workers are deliberately stopped, with race-safe authoritative refresh.
- Desktop, tablet and mobile Chromium journeys with nine responsive screenshots across the P08A/P08B campaign.
- Authenticated axe WCAG A/AA checks and keyboard/focus behavior.
- Exact-SHA preservation of every P01–P08A financial and reliability proof.

## Remaining delivery

The original application remains **INCOMPLETE / NO_GO**. The remaining customer adjustment, schedule, webhook and administrator interfaces remain open, followed by P09 complete fault/defect laboratory, P10 contracts/scanners/performance/backup-restore/nightly/release lanes and P11 final evidence/video. There is no public deployment or release tag.

The next delivery unit is the customer adjustment interface: recipient-owner partial/full refund plus ADMIN full reversal, with replay-safe uncertainty handling, adjustment receipts/history, authorization/concurrency proofs, responsive accessibility coverage and a permanent exact-SHA gate.

## Preserved prior delivery

P08A source `d675db096b8f023469e253737ade80a2b8b3b0fa` passed run `36345292129`. P07B source `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975` passed run `36330862462`. P07A source `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed run `36319414655`. P06 source `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed run `36306335283`. P05 source `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`. Their durable reports retain original scope and timestamps.
