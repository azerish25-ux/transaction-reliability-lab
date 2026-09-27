# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. P01–P05 are verified development milestones. The complete product remains INCOMPLETE / NO_GO.**

LedgerGuard is a compact transaction system built to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants, asynchronous delivery and crash recovery. It is not a bank, payment processor, compliance product or production-ready financial service.

## Run the verified application

From a clean clone with Docker Engine and Docker Compose:

```bash
./scripts/lab up
```

Startup generates private sandbox secrets, builds the Java 21 application, starts PostgreSQL and RabbitMQ, applies Flyway migrations as `ledger_owner`, runs application queries as restricted `ledger_runtime`, seeds balanced fictional fixtures and performs independent reconciliation. The P05 topology contains one API process, one independently restartable transactional-outbox publisher and two competing payment-worker processes. Published ports bind to loopback.

The API provides registration, login/logout, revocable sessions, customer-owned accounts and histories, recipient lookup, immediate settled transfers, asynchronously processed payments with fund reservations, payment status reads and administrator failed-work inspection/replay.

Transfer and payment commands require CSRF and `Idempotency-Key`. Identical replay returns the original operation; changed economic intent returns `409` without another financial effect. Payment acceptance returns `202` only after PostgreSQL atomically records a `PENDING` payment, `ACTIVE` hold, idempotency result, audit entry and `payment.requested` outbox event. It does not post a journal at acceptance.

The leased publisher uses persistent RabbitMQ messages, mandatory routing and correlated confirms. Workers acknowledge only after the protected PostgreSQL settlement transaction commits. Delivery is at least once; stable event identities, the transactional consumer inbox and payment-state checks provide at-most-once committed financial effects for each payment.

The API does not depend on RabbitMQ readiness. During a broker outage, accepted payments remain durably pending while authentication, account access and immediate transfers continue. Recovery republishes overdue work without inventing balances or deleting history. The version-aware payment projection is observational and never spending authority.

The startup output prints local URLs. Fictional identities are `alice@example.test`, `bob@example.test`, `merchant@example.test` and `admin@example.test`; their generated password is stored privately as `LEDGER_DEMO_PASSWORD` in ignored `.ledgerguard/runtime.env`. Obtain `/api/v1/auth/csrf` before login and after login/logout. The current contract is `/api/v1/openapi/p05.json`.

**There is no React product interface or public deployment yet.** Cancellation, refunds, reversal, schedules, webhooks and the complete fault/release laboratory remain later phases.

## Verified P05 evidence

Implementation `bbca6dd7478e33320aa134f6cd59c9652f4b60db` is the published P05 source. The permanent P05 workflow executes all earlier suites plus real PostgreSQL payment/projection/replay tests, two-process HTTP payment tests, TypeScript uncertain-payment intent tests and a live Compose campaign covering broker outage, duplicate delivery, stale projection events, poison work, publisher death after confirmation and worker death after settlement commit.

Useful commands:

```bash
./scripts/lab test unit
./scripts/lab test auth
./scripts/lab test transfer
./scripts/lab test payment
./scripts/lab test pr
./scripts/lab reconcile
./scripts/lab status
./scripts/lab down
```

## Inspection paths

- [Progress and next executable phase](docs/implementation/PROGRESS.md)
- [P05 durable evidence](docs/evidence/p05-bbca6dd.md)
- [P05 scoped requirements](docs/implementation/P05_REQUIREMENTS.json)
- [P05 asynchronous-payment architecture](docs/architecture/adr/0014-p05-asynchronous-payments.md)
- [Current OpenAPI](backend/src/main/resources/openapi/p05.json)
- [Delivery provenance](docs/implementation/DELIVERY.md)
- [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
- [Testing strategy](docs/testing/STRATEGY.md)
- [Evidence index](docs/evidence/INDEX.md)
- [Full-product release gates](docs/implementation/RELEASE_READINESS.md)
