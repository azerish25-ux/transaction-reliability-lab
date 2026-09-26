# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. P01/P02 foundation and P03 authentication/account APIs are verified development milestones. The full product remains INCOMPLETE / NO_GO.**

LedgerGuard is a compact transaction system built to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants and recovery. It is not a bank, payment processor, compliance product or production-ready financial service.

## Run the API

From a clean clone with Docker Engine and Docker Compose:

```bash
./scripts/lab up
```

Startup generates persistent private sandbox secrets, builds the Java 21 API, starts PostgreSQL/RabbitMQ, applies migrations as `ledger_owner`, uses restricted `ledger_runtime` for application operations, seeds balanced fictional fixtures and runs independent reconciliation. Host ports bind to loopback.

P03 provides registration, login/logout, revocable 15-minute cookie sessions, customer-owned account creation/list/detail/history, minimal recipient lookup and an administrator security-event feed. New accounts start at zero. Account balances and amounts are exact decimal integer strings. There is no public top-up or generic admin spending endpoint.

The startup output prints the real local API/OpenAPI URLs. Fictional identities are `alice@example.test`, `bob@example.test`, `merchant@example.test` and `admin@example.test`. Their generated password is stored privately as `LEDGER_DEMO_PASSWORD` in ignored `.ledgerguard/runtime.env`; it is not printed in CI logs. Obtain `/api/v1/auth/csrf` before JSON login and again after successful login/logout. See [authentication protocol and trade-offs](docs/architecture/adr/0012-p03-authentication.md).

**There is not yet a React product interface or public deployment.** Transfer/payment HTTP workflows, worker processing and the full fault laboratory remain later phases, even where underlying SQL/domain logic exists.

## Executed evidence

Implementation [`8ee1e1f`](https://github.com/azerish25-ux/transaction-reliability-lab/commit/8ee1e1f91a86c11e33468d764b639b425b3e12a7) passed [run 36270965725](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36270965725), including both verification and required gate:

| Suite | Passed | Failed / errors / skipped |
|---|---:|---|
| Core JUnit cases | 120 | 0 / 0 / 0 |
| Authentication configuration cases | 13 | 0 / 0 / 0 |
| Real PostgreSQL financial integration | 11 | 0 / 0 / 0 |
| Actual HTTP authentication/accounts across independent JVMs | 58 | 0 / 0 / 0 |
| Existing TypeScript money/client/intent cases | 44 | 0 / 0 / 0 |
| New TypeScript authentication-client cases | 6 | 0 / 0 / 0 |
| Live Compose authentication smoke checks | 9 | No failures |

The 120 core cases also run standalone and are not counted twice as unique tests. Six migrations, clean Compose setup, fixture login, restricted-role checks, two discrepancy-free reconciliations and the configured literal secret scan passed. The scan is not a security certification.

Representative proofs now include copied-cookie rejection after logout across a second process/restart, rejection of altered/expired tokens and cross-customer history requests, and exact owner-only economic history after a real protected posting. The repeated-command test caught and now prevents unintended CSRF rotation after ordinary requests.

Useful verification commands:

```bash
./scripts/lab test unit
./scripts/lab test auth
./scripts/lab test pr
./scripts/lab reconcile
./scripts/lab status
./scripts/lab down
```

## Inspection paths

- [Progress and next executable phase](docs/implementation/PROGRESS.md)
- [Delivery and workflow provenance](docs/implementation/DELIVERY.md)
- [P03 durable evidence](docs/evidence/p03-8ee1e1f.md)
- [Scoped P03 requirements-to-tests source](docs/implementation/P03_REQUIREMENTS.json)
- [OpenAPI source](backend/src/main/resources/openapi/p03.json)
- [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
- [Dependencies](docs/architecture/DEPENDENCIES.md)
- [Testing strategy](docs/testing/STRATEGY.md)
- [Evidence index](docs/evidence/INDEX.md)
- [Full-product release gates](docs/implementation/RELEASE_READINESS.md)
