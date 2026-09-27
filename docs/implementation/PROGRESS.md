# Execution checkpoint — P07B IMPLEMENTED_UNVERIFIED

Overall product status remains **INCOMPLETE / NO_GO**. P01–P07A retain exact-SHA verified evidence. P07B signed durable webhook delivery is integrated as a source candidate. P08–P11 remain incomplete.

## Preserved verified source

P07A implementation source `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed permanent `LedgerGuard P07A verification` push workflow run `36319414655` on September 27, 2026. The durable reports remain `docs/evidence/p07a-9478663.md` and `docs/evidence/p07a-9478663.json`.

## Implemented P07B candidate scope

- Owner-scoped approved sandbox webhook endpoint creation, list/read, enable/disable and secret rotation.
- One-time secret disclosure with AES-256-GCM encryption at rest and endpoint-bound authenticated encryption.
- Append-only secret versions so rotation does not invalidate already durable deliveries.
- Durable endpoint/event logical identity with exact persisted payload bytes and SHA-256 digest.
- Exact-byte `v1` HMAC-SHA256 over timestamp, event UUID and raw body, with a five-minute receiver replay window and constant-time comparison.
- Two separately restartable dispatcher processes using persisted PostgreSQL leases and `FOR UPDATE SKIP LOCKED` claims.
- Immutable attempts, lease-expiry recovery, eight-attempt bounded retry cycles, exponential backoff/jitter, 24-hour age limit and audited manual retry.
- Strict exact destination allowlisting, disabled redirects and the named internal HTTP sandbox exception only.
- Real receiver with durable endpoint/event deduplication and controlled 429, 503, permanent 400, delay and accepted-response-loss modes.
- Owner delivery inspection, non-disclosing cross-owner behavior and administrator inspection/retry.
- Scoped OpenAPI, TypeScript client contract, PostgreSQL reliability suite, live Compose campaign and P07B evidence assertion.
- Preservation of the P06 default Compose topology and all verified P01–P07A behavior.

## Local/static verification completed before publication

- P07B Python evidence/smoke scripts compile.
- P07B JSON/OpenAPI/requirements files parse.
- The new TypeScript module compiles under TypeScript 5.8.3 and its seven production-client contract cases pass against the existing compiled `ApiClient`.
- Production P07B Java sources and the five-case PostgreSQL integration test compile against signature-compatible stubs under Java 21.

These checks are not substitutes for the permanent Maven/Testcontainers/Docker Compose workflow. PostgreSQL migration execution, real Spring compilation and live multi-process behavior must be established by GitHub Actions on the exact published source SHA.

## Next executable action

Run the permanent **LedgerGuard P07B verification** push workflow for the exact candidate SHA. Fix any root-cause failure, rerun the complete gate, and only after both mandatory jobs succeed publish durable exact-SHA P07B evidence. Do not begin P08 interface completion before P07B is remotely verified.
