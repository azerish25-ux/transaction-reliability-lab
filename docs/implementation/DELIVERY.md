# Delivery record — P07B verified

Repository: `azerish25-ux/transaction-reliability-lab`  
Branch: `main`  
Verified P07B implementation source: `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975`  
P07B result: `VERIFIED_PASS`  
Full-product result: `INCOMPLETE / NO_GO`

## P07B GitHub delivery

Permanent `LedgerGuard P07B verification` push workflow run `36330862462` checked out the exact implementation SHA and completed successfully on September 27, 2026.

- Verification job `108652383318`: SUCCESS.
- Required gate `108653566120`: SUCCESS.
- Every mandatory build, Java/TypeScript test, PostgreSQL integration, Compose validation, secret scan, P05/P06 regression, P07A schedule campaign, P07B webhook campaign, reconciliation, evidence and teardown step succeeded.
- Artifact `10935339693`, `ledgerguard-p07b-evidence-cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975`, 157,131 bytes, SHA-256 `83378eb2ba6040004d7ba95f7280d00f3d7fc6953635abc1a78a12aa3327d94f`.

Executed results included 133 core/security JUnit cases, 124 PostgreSQL/real-HTTP integration cases, 77 TypeScript client/contract cases, 42 P05 Compose checks, 32 P06 Compose checks, 15 P07A Compose checks and 26 P07B Compose checks. All required suites reported zero failures/errors/skips. Eight scoped P07B requirements were bound to executed evidence, the tracked source was clean, 282 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

See the [durable P07B report](../evidence/p07b-cc6b3ca.md) and [machine-readable provenance](../evidence/p07b-cc6b3ca.json).

## Delivered P07B boundary

- Additive V10 webhook delivery migration in `classpath:db/p07`.
- Customer-owned approved endpoint lifecycle and one-time secret disclosure.
- AES-256-GCM encrypted and versioned signing secrets.
- Exact-byte HMAC-SHA256 signing with receiver replay-window validation.
- Durable unique fan-out and immutable attempt history.
- Two independently restartable dispatcher processes using PostgreSQL leases.
- Bounded retry/exhaustion, backoff, age limits and audited manual retry.
- Strict sandbox destination controls with redirects disabled.
- Durable receiver deduplication across accepted-response loss.
- Owner/admin delivery inspection without secret disclosure.
- Financial-state isolation and repeatable reconciliation.
- Scoped OpenAPI, TypeScript contract, PostgreSQL integration and live Compose evidence.

The P07 overlay remains separate from `compose.yaml`, preserving the verified default P06 topology while activating schedules, dispatchers and receiver when explicitly selected.

## Remaining delivery

The original application remains **INCOMPLETE / NO_GO**. P08 React/browser/accessibility interfaces, P09 complete fault/defect laboratory, P10 contracts/scanners/performance/backup-restore/nightly/release lanes and P11 final evidence/video remain incomplete. There is no public deployment or release tag.

The next delivery unit is P08A: same-origin React authentication/session behavior, real balances, authorized account history and transaction detail, responsive inspection, Playwright and axe evidence.

## Preserved prior delivery

P07A source `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed run `36319414655`. P06 source `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed run `36306335283`. P05 source `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`. P04 source `60a95db82350983eaf1ad3c7545190866c831f98` passed run `36276049817`. P03 source `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`. Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`. Their durable reports retain original scope and timestamps.
