# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. P01–P04 are verified development milestones. The full product remains INCOMPLETE / NO_GO.**

LedgerGuard is a compact transaction system built to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants and recovery. It is not a bank, payment processor, compliance product or production-ready financial service.

## Run the verified API

From a clean clone with Docker Engine and Docker Compose:

```bash
./scripts/lab up
```

Startup generates persistent private sandbox secrets, builds the Java 21 API, starts PostgreSQL and RabbitMQ, applies Flyway migrations as `ledger_owner`, runs application queries as restricted `ledger_runtime`, seeds balanced fictional fixtures and performs independent reconciliation. Published ports bind to loopback.

The current API provides registration, login/logout, revocable 15-minute cookie sessions, customer-owned accounts and histories, minimal recipient lookup, an administrator security-event feed, and **immediate settled account-to-account transfers**. New customer accounts start at zero. Money crosses JSON only as exact decimal integer strings.

Transfer commands require both CSRF and `Idempotency-Key`. Identical replay returns the original status, body and transfer identity with `Idempotency-Replayed: true`; changed economic intent returns `409` without another posting. A timeout or keyed server failure is an uncertain outcome: preserve and replay the same normalized intent and key rather than declaring failure or generating a new instruction.

The startup output prints the local URLs. Fictional identities are `alice@example.test`, `bob@example.test`, `merchant@example.test` and `admin@example.test`; their generated password is stored privately as `LEDGER_DEMO_PASSWORD` in ignored `.ledgerguard/runtime.env`. Obtain `/api/v1/auth/csrf` before login and again after login/logout. The current API contract is `/api/v1/openapi/p04.json`.

**There is no React product interface or public deployment yet.** RabbitMQ payment settlement, adjustments, schedules, webhooks and the complete fault/release laboratory remain later phases.

## Executed evidence

Implementation [`60a95db`](https://github.com/azerish25-ux/transaction-reliability-lab/commit/60a95db82350983eaf1ad3c7545190866c831f98) passed [GitHub Actions run 36276049817](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36276049817), including the verification job and required aggregate gate.

| Suite | Passed | Failed / errors / skipped |
|---|---:|---|
| Core JUnit cases | 120 | 0 / 0 / 0 |
| Authentication configuration cases | 13 | 0 / 0 / 0 |
| PostgreSQL financial integration | 11 | 0 / 0 / 0 |
| Actual HTTP authentication/account cases | 58 | 0 / 0 / 0 |
| Actual HTTP immediate-transfer reliability cases | 20 | 0 / 0 / 0 |
| Existing TypeScript money/client/intent cases | 44 | 0 / 0 / 0 |
| TypeScript authentication-client cases | 6 | 0 / 0 / 0 |
| TypeScript transfer-client cases | 7 | 0 / 0 / 0 |
| Live Compose P04 checks | 15 | No failures |

The 120 core cases also run through a standalone dependency-light runner and are not counted twice as unique tests. Six migrations, clean Compose startup, restricted-role checks, real transfer posting/replay, two discrepancy-free reconciliations and the configured literal-secret scan passed. The scan is not a security certification.

Representative P04 proofs include: two synchronized 8,000 transfers against 10,000 available across separate API JVMs with exactly one success; concurrent identical-key requests producing one transfer; many-client pressure without overspend; opposite-direction lock ordering; owner-private transfer reads; and a test-only TCP proxy that drops the response only after commit, followed by safe replay of the original transfer.

Useful commands:

```bash
./scripts/lab test unit
./scripts/lab test auth
./scripts/lab test transfer
./scripts/lab test pr
./scripts/lab reconcile
./scripts/lab status
./scripts/lab down
```

## Inspection paths

- [Progress and next executable phase](docs/implementation/PROGRESS.md)
- [Delivery and workflow provenance](docs/implementation/DELIVERY.md)
- [P04 durable evidence](docs/evidence/p04-60a95db.md)
- [Scoped P04 requirements-to-tests source](docs/implementation/P04_REQUIREMENTS.json)
- [Immediate transfer architecture](docs/architecture/adr/0013-p04-immediate-transfers.md)
- [Current OpenAPI source](backend/src/main/resources/openapi/p04.json)
- [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
- [Dependencies](docs/architecture/DEPENDENCIES.md)
- [Testing strategy](docs/testing/STRATEGY.md)
- [Evidence index](docs/evidence/INDEX.md)
- [Full-product release gates](docs/implementation/RELEASE_READINESS.md)
