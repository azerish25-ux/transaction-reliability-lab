# Execution checkpoint — P07B VERIFIED_PASS

Overall product status remains **INCOMPLETE / NO_GO**. P01–P07B now have durable exact-SHA verification. P08–P11 remain incomplete.

## Verified source

P07B implementation source `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975` passed permanent `LedgerGuard P07B verification` push workflow run `36330862462` on September 27, 2026. Verification job `108652383318` and required gate `108653566120` both succeeded.

Durable reports:

- `docs/evidence/p07b-cc6b3ca.md`
- `docs/evidence/p07b-cc6b3ca.json`

Transient GitHub artifact `10935339693` contained 157,131 bytes with SHA-256 `83378eb2ba6040004d7ba95f7280d00f3d7fc6953635abc1a78a12aa3327d94f`.

## Verified P07B scope

- Owner-scoped approved sandbox webhook endpoint creation, list/read, enable/disable and secret rotation.
- One-time secret disclosure with AES-256-GCM encryption at rest and endpoint-bound authenticated encryption.
- Append-only secret versions so rotation does not invalidate already durable deliveries.
- Durable endpoint/event logical identity with exact persisted payload bytes and SHA-256 digest.
- Exact-byte `v1` HMAC-SHA256 over timestamp, event UUID and raw body, with a five-minute receiver replay window and constant-time comparison.
- Two separately restartable dispatcher processes using persisted PostgreSQL leases and `FOR UPDATE SKIP LOCKED` claims.
- Immutable attempts, lease-expiry recovery, eight-attempt bounded retry cycles, exponential backoff/jitter, a 24-hour age limit and audited manual retry.
- Strict exact destination allowlisting, disabled redirects and the named internal HTTP sandbox exception only.
- A real receiver with durable endpoint/event deduplication and controlled 429, 503, permanent 400, delay and accepted-response-loss modes.
- Owner delivery inspection, non-disclosing cross-owner behavior and administrator inspection/retry.
- Scoped OpenAPI, TypeScript client contract, PostgreSQL reliability suite and live Compose campaign.
- Preservation of all verified P01–P07A behavior and independent reconciliation.

## Executed evidence

The exact-SHA gate completed 133 core/security JUnit cases, 124 PostgreSQL/HTTP integration cases, 77 TypeScript contract cases, 42 P05 live checks, 32 P06 live checks, 15 P07A live checks and 26 P07B live checks with zero failures, errors or skips. Eight P07B requirements were bound to named executed evidence, 282 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

## Next executable action

Implement **P08A**, the first real product-interface vertical slice:

1. Establish a pinned React/TypeScript build, same-origin frontend container and reproducible Compose startup.
2. Implement registration, login, logout and session-expiry behavior against the real API.
3. Render real posted, reserved and available balances.
4. Implement authorized account history and customer-safe transaction detail.
5. Add deliberate loading, empty, validation, unavailable and permission states.
6. Add responsive desktop/tablet/mobile inspection, Playwright Chromium journeys and authenticated axe checks.
7. Preserve the complete P01–P07B regression gate and publish exact-SHA P08A evidence before moving to later P08 slices.
