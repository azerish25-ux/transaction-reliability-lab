# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. P01–P06 are verified development milestones. P07A durable scheduled transfers are implemented as a source candidate and must not be called verified until the permanent remote gate succeeds. Signed durable webhooks, the product interface, the full fault laboratory and release evidence remain incomplete. Overall status: INCOMPLETE / NO_GO.**

LedgerGuard is a compact transaction system built to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants, asynchronous delivery, crash recovery, compensating financial adjustments and time-dependent transaction execution. It is not a bank, payment processor, compliance product or production-ready financial service.

## Run the verified P06 topology

From a clean clone with Docker Engine and Docker Compose:

```bash
./scripts/lab up
```

Startup generates private sandbox secrets, builds the Java 21 application, starts PostgreSQL and RabbitMQ, applies Flyway migrations as `ledger_owner`, runs application queries as restricted `ledger_runtime`, seeds balanced fictional fixtures and performs independent reconciliation. The verified topology contains one API process, one independently restartable transactional-outbox publisher and two competing payment-worker processes. Published ports bind to loopback.

## Activate the P07A schedule candidate

After the base topology is running, apply the opt-in overlay:

```bash
docker compose --env-file .ledgerguard/runtime.env \
  -f compose.yaml -f compose.p07.yaml \
  up -d --build --wait api scheduler-a scheduler-b
```

The overlay restarts the API with the additive P07 migration location and starts two independent schedule workers. It provides customer-owned one-time, daily and weekly schedules; versioned edit/pause/resume/cancel commands; immutable occurrence history; DST-aware local-wall-time recurrence; a 24-hour catch-up window; and stable duplicate-safe occurrence execution. The default Compose model remains the exact P06 topology until P07 receives its own verified evidence.

The API provides registration, login/logout, revocable sessions, customer-owned accounts and histories, recipient lookup, immediate settled transfers, asynchronously processed payments with fund reservations, payment status reads, payer/ADMIN cancellation before settlement, recipient/ADMIN partial or full refunds, ADMIN full reversal, immutable adjustment inspection, schedules and administrator failed-work inspection/replay.

All money-changing and schedule-lifecycle commands require CSRF and `Idempotency-Key`. Identical replay returns the original operation; changed economic intent returns `409` without another financial effect. Schedule occurrence identities derive from schedule ID, definition version and intended local occurrence. Two workers may observe the same due row, but PostgreSQL row locking, expected-tuple checks and uniqueness allow only one committed effect.

Payment acceptance returns `202` only after PostgreSQL atomically records a `PENDING` payment, `ACTIVE` hold, idempotency result, audit entry and `payment.requested` outbox event. Cancellation releases a pending hold once and never posts a refund journal. Refund and reversal commands create balanced compensating journals while preserving the original settlement journal and base `SETTLED` state.

A scheduled occurrence checks funds only when it executes. Success atomically records the protected transfer, immutable occurrence, schedule advancement, audit and outbox events. Insufficient funds records one rejected occurrence without financial fragments. Work older than 24 hours is recorded individually as `SKIPPED_LATE`; obligations are never collapsed into a larger transfer. Daily and weekly recurrence advances local intent rather than adding fixed elapsed hours.

The leased publisher uses persistent RabbitMQ messages, mandatory routing and correlated confirms. Workers acknowledge only after protected PostgreSQL processing commits. Delivery is at least once; stable identities, the transactional consumer inbox and business-state checks provide at-most-once committed financial effects for each operation.

The API does not depend on RabbitMQ readiness. During a broker outage, accepted payments remain durably pending while authentication, account access, immediate transfers and schedule management continue. Recovery republishes overdue work without inventing balances or deleting history. Projections remain observational and are never spending authority.

The startup output prints local URLs. Fictional identities are `alice@example.test`, `bob@example.test`, `merchant@example.test` and `admin@example.test`; their generated password is stored privately as `LEDGER_DEMO_PASSWORD` in ignored `.ledgerguard/runtime.env`. Obtain `/api/v1/auth/csrf` before login and after login/logout. The verified compatibility contract is `/api/v1/openapi/p06.json`; the scoped schedule candidate contract is `/api/v1/openapi/p07a-schedules.json`.

**There is no React product interface or public deployment yet.** Signed webhook delivery is P07B. The complete fault laboratory and release evidence remain later phases.

## Current verification status

P06 source `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed permanent workflow run `36306335283`; its durable report is [`docs/evidence/p06-bb1eeb.md`](docs/evidence/p06-bb1eeb.md). The current P07A source candidate adds a real PostgreSQL schedule race suite and a live two-scheduler Compose campaign, but those additions must not be described as passing until GitHub Actions verifies the final source SHA.

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
- [P07A scoped requirements](docs/implementation/P07A_REQUIREMENTS.json)
- [P07A scheduled-transfer architecture](docs/architecture/adr/0016-p07a-scheduled-transfers.md)
- [P06 durable evidence](docs/evidence/p06-bb1eeb.md)
- [P06 requirements](docs/implementation/P06_REQUIREMENTS.json)
- [Verified P06 OpenAPI](backend/src/main/resources/openapi/p06.json)
- [Scoped P07A schedule OpenAPI](backend/src/main/resources/openapi/p07a-schedules.json)
- [Delivery provenance](docs/implementation/DELIVERY.md)
- [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
- [Testing strategy](docs/testing/STRATEGY.md)
- [Evidence index](docs/evidence/INDEX.md)
- [Full-product release gates](docs/implementation/RELEASE_READINESS.md)
