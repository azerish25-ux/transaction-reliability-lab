# Delivery record — P08A verified

Repository: `azerish25-ux/transaction-reliability-lab`  
Branch: `main`  
Verified P08A implementation source: `d675db096b8f023469e253737ade80a2b8b3b0fa`  
P08A result: `VERIFIED_PASS`  
Full-product result: `INCOMPLETE / NO_GO`

## P08A GitHub delivery

Permanent `LedgerGuard P08A verification` push workflow run `36345292129` checked out the exact implementation SHA and completed successfully on September 27, 2026.

- Verification job `108693127471`: SUCCESS.
- Required gate `108694570086`: SUCCESS.
- Every mandatory frontend build, Java/TypeScript test, PostgreSQL integration, Compose validation, secret scan, P05–P07B regression, P08A browser/accessibility, reconciliation, evidence and teardown step succeeded.
- Artifact `10940665452`, `ledgerguard-p08a-evidence-d675db096b8f023469e253737ade80a2b8b3b0fa`, 1,110,905 bytes, SHA-256 `c48ec1b997c8fef477ff664009bcf37e3c91c3e8ad70904bc9b684830f20a7ff`.

Executed results included 133 core/security JUnit cases, 124 PostgreSQL/real-HTTP integration cases, 83 TypeScript client/contract cases, 42 P05 Compose checks, 32 P06 Compose checks, 15 P07A Compose checks, 26 P07B Compose checks and 12 P08A Chromium journeys. All required suites reported zero failures/errors/skips. Seven scoped P08A requirements were bound to executed evidence, 305 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

See the [durable P08A report](../evidence/p08a-d675db0.md) and [machine-readable provenance](../evidence/p08a-d675db0.json).

## Delivered P08A boundary

- Locked React/TypeScript/Vite product build.
- Non-root nginx frontend with loopback binding, health check and same-origin API proxy.
- Real registration, login, logout, bootstrap and expired-session recovery.
- Real posted, reserved and available balances with version/update time.
- Zero-balance wallet creation.
- Deterministic account history and customer-safe immutable transaction detail.
- Explicit loading, empty, validation, authentication and outage states.
- Desktop, tablet and mobile Chromium journeys with responsive screenshots.
- Authenticated axe WCAG A/AA checks and keyboard/focus behavior.
- Exact-SHA preservation of all P01–P07B financial and reliability proofs.

## Remaining delivery

The original application remains **INCOMPLETE / NO_GO**. Transfer/payment, adjustment, schedule, webhook and administrator interfaces remain open, followed by P09 complete fault/defect laboratory, P10 contracts/scanners/performance/backup-restore/nightly/release lanes and P11 final evidence/video. There is no public deployment or release tag.

The next delivery unit is P08B: real transfer and asynchronous-payment customer journeys with confirmation, replay-safe idempotency, uncertain-outcome resolution, receipts, status/history and pending cancellation.

## Preserved prior delivery

P07B source `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975` passed run `36330862462`. P07A source `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed run `36319414655`. P06 source `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed run `36306335283`. P05 source `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`. Their durable reports retain original scope and timestamps.
