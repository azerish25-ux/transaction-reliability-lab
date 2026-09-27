# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. P01–P04 are verified development milestones. P05 asynchronous-payment reliability is implemented as a candidate and remains unverified until its complete GitHub Actions lane passes. The full product remains INCOMPLETE / NO_GO.**

LedgerGuard is a compact transaction system built to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants and recovery. It is not a bank, payment processor, compliance product or production-ready financial service.

## Run the candidate application

From a clean clone with Docker Engine and Docker Compose:

```bash
./scripts/lab up
```

Startup generates persistent private sandbox secrets, builds the Java 21 application, starts PostgreSQL and RabbitMQ, applies Flyway migrations as `ledger_owner`, runs application queries as restricted `ledger_runtime`, seeds balanced fictional fixtures and performs independent reconciliation. The P05 topology contains one API process, one independently restartable transactional-outbox publisher and two competing payment-worker processes. Published ports bind to loopback.

The API provides registration, login/logout, revocable 15-minute cookie sessions, customer-owned accounts and histories, minimal recipient lookup, an administrator security-event feed, immediate settled account-to-account transfers, and accepted asynchronous payments with fund reservations.

Transfer and payment commands require both CSRF and `Idempotency-Key`. Identical replay returns the original status, body and operation identity with `Idempotency-Replayed: true`; changed economic intent returns `409` without another financial effect. A timeout or keyed server failure is an uncertain outcome: preserve and replay the same normalized intent and key rather than declaring failure or generating a new instruction.

Payment acceptance returns `202` only after PostgreSQL atomically records a `PENDING` payment, `ACTIVE` hold, idempotency result, audit entry and `payment.requested` outbox event. It does not post a journal. The publisher uses durable leased claims, persistent RabbitMQ messages, mandatory routing and correlated publisher confirms. Workers acknowledge only after the protected PostgreSQL settlement transaction commits. Delivery is at least once; stable event identities, a transactional consumer inbox and payment-state checks prevent a second committed payment effect.

The API does not depend on RabbitMQ readiness. During a broker outage, accepted payments remain durably pending while authentication, account access and immediate transfers continue. Recovery republishes overdue work without inventing balances or deleting history. The payment-status projection is observational and version-aware; it is never spending authority.

The startup output prints local URLs. Fictional identities are `alice@example.test`, `bob@example.test`, `merchant@example.test` and `admin@example.test`; their generated password is stored privately as `LEDGER_DEMO_PASSWORD` in ignored `.ledgerguard/runtime.env`. Obtain `/api/v1/auth/csrf` before login and again after login/logout. The candidate API contract is `/api/v1/openapi/p05.json`.

**There is no React product interface or public deployment yet.** Cancellation/refund/reversal APIs, schedules, webhooks and the complete fault/release laboratory remain later phases.

## Verified evidence and candidate verification

P04 implementation [`60a95db`](https://github.com/azerish25-ux/transaction-reliability-lab/commit/60a95db82350983eaf1ad3c7545190866c831f98) passed [GitHub Actions run 36276049817](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36276049817), including its verification job and required aggregate gate. The later P04 evidence commit also passed. Those results remain the latest durable verified milestone until P05 completes its own expanded lane.

The P05 candidate lane preserves every P01–P04 suite and adds real PostgreSQL payment/projection/replay tests, two-process HTTP payment tests, TypeScript uncertain-payment intent tests, and a live Compose campaign covering broker outage, duplicate delivery, stale projection events, poison work, publisher death after confirmation and worker death after settlement commit.

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

- [Progress and next executable action](docs/implementation/PROGRESS.md)
- [P05 scoped requirements](docs/implementation/P05_REQUIREMENTS.json)
- [P05 asynchronous-payment architecture](docs/architecture/adr/0014-p05-asynchronous-payments.md)
- [Candidate P05 OpenAPI](backend/src/main/resources/openapi/p05.json)
- [Delivery and workflow provenance](docs/implementation/DELIVERY.md)
- [P04 durable evidence](docs/evidence/p04-60a95db.md)
- [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
- [Dependencies](docs/architecture/DEPENDENCIES.md)
- [Testing strategy](docs/testing/STRATEGY.md)
- [Evidence index](docs/evidence/INDEX.md)
- [Full-product release gates](docs/implementation/RELEASE_READINESS.md)
