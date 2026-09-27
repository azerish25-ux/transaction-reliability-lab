# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. P01–P05 are verified development milestones. P06 payment adjustments are implemented but remain unverified until the permanent remote gate succeeds. The complete product remains INCOMPLETE / NO_GO.**

LedgerGuard is a compact transaction system built to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants, asynchronous delivery, crash recovery and compensating financial adjustments. It is not a bank, payment processor, compliance product or production-ready financial service.

## Run the current application

From a clean clone with Docker Engine and Docker Compose:

```bash
./scripts/lab up
```

Startup generates private sandbox secrets, builds the Java 21 application, starts PostgreSQL and RabbitMQ, applies Flyway migrations as `ledger_owner`, runs application queries as restricted `ledger_runtime`, seeds balanced fictional fixtures and performs independent reconciliation. The topology contains one API process, one independently restartable transactional-outbox publisher and two competing payment-worker processes. Published ports bind to loopback.

The API provides registration, login/logout, revocable sessions, customer-owned accounts and histories, recipient lookup, immediate settled transfers, asynchronously processed payments with fund reservations, payment status reads, payer/ADMIN cancellation before settlement, recipient/ADMIN partial or full refunds, ADMIN full reversal, immutable adjustment inspection and administrator failed-work inspection/replay.

All money-changing commands require CSRF and `Idempotency-Key`. Identical replay returns the original operation; changed economic intent returns `409` without another financial effect. Payment acceptance returns `202` only after PostgreSQL atomically records a `PENDING` payment, `ACTIVE` hold, idempotency result, audit entry and `payment.requested` outbox event. It does not post a journal at acceptance.

Cancellation releases a pending hold once and never posts a refund journal. Refund and reversal commands create new balanced compensating journals while preserving the original settlement journal and base `SETTLED` state. Adjustment status is exposed separately as `NONE`, `PARTIALLY_REFUNDED`, `FULLY_REFUNDED` or `REVERSED`. PostgreSQL locking, constraints, deferred integrity triggers and independent reconciliation remain the financial authority.

The leased publisher uses persistent RabbitMQ messages, mandatory routing and correlated confirms. Workers acknowledge only after the protected PostgreSQL settlement transaction commits. Delivery is at least once; stable event identities, the transactional consumer inbox and payment-state checks provide at-most-once committed financial effects for each payment.

The API does not depend on RabbitMQ readiness. During a broker outage, accepted payments remain durably pending while authentication, account access and immediate transfers continue. Recovery republishes overdue work without inventing balances or deleting history. The version-aware payment projection is observational and never spending authority.

The startup output prints local URLs. Fictional identities are `alice@example.test`, `bob@example.test`, `merchant@example.test` and `admin@example.test`; their generated password is stored privately as `LEDGER_DEMO_PASSWORD` in ignored `.ledgerguard/runtime.env`. Obtain `/api/v1/auth/csrf` before login and after login/logout. The current contract is `/api/v1/openapi/p06.json`.

**There is no React product interface or public deployment yet.** Schedules, signed webhooks, the complete fault laboratory and release evidence remain later phases.

## Current verification status

The verified P05 implementation is `bbca6dd7478e33320aa134f6cd59c9652f4b60db`. P06 adds a 14-case real PostgreSQL/two-API race suite, eight compiled TypeScript adjustment cases and a live Compose adjustment campaign, but these additions must not be described as passing until GitHub Actions verifies the final source SHA.

Useful commands:

```bash
./scripts/lab test unit
./scripts/lab test auth
./scripts/lab test transfer
./scripts/lab test payment
./scripts/lab test adjustment
./scripts/lab test pr
./scripts/lab reconcile
./scripts/lab status
./scripts/lab down
```

## Inspection paths

- [Progress and next executable action](docs/implementation/PROGRESS.md)
- [P06 scoped requirements](docs/implementation/P06_REQUIREMENTS.json)
- [P06 payment-adjustment architecture](docs/architecture/adr/0015-p06-payment-adjustments.md)
- [Current OpenAPI](backend/src/main/resources/openapi/p06.json)
- [P05 durable evidence](docs/evidence/p05-bbca6dd.md)
- [Delivery provenance](docs/implementation/DELIVERY.md)
- [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
- [Testing strategy](docs/testing/STRATEGY.md)
- [Evidence index](docs/evidence/INDEX.md)
- [Full-product release gates](docs/implementation/RELEASE_READINESS.md)
