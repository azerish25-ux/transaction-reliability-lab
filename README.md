# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. P01–P07B are exact-SHA verified development milestones. The React product interface, complete fault laboratory, later test lanes and final release evidence remain incomplete. Overall status: INCOMPLETE / NO_GO.**

LedgerGuard is a compact transaction system built to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants, asynchronous delivery, crash recovery, compensating financial adjustments, time-dependent execution and unreliable external notification. It is not a bank, payment processor, compliance product or production-ready financial service.

## Run the verified default topology

From a clean clone with Docker Engine and Docker Compose:

```bash
./scripts/lab up
```

Startup generates private sandbox secrets, builds the Java 21 application, starts PostgreSQL and RabbitMQ, applies Flyway migrations as `ledger_owner`, runs application queries as restricted `ledger_runtime`, seeds balanced fictional fixtures and performs independent reconciliation. The verified default topology contains one API process, one independently restartable transactional-outbox publisher and two competing payment-worker processes. Published ports bind to loopback.

## Activate the verified P07 topology

After the base topology is running, apply the opt-in overlay:

```bash
docker compose --env-file .ledgerguard/runtime.env \
  -f compose.yaml -f compose.p07.yaml \
  up -d --build --wait \
  api scheduler-a scheduler-b receiver \
  webhook-dispatcher-a webhook-dispatcher-b
```

The overlay activates the verified P07A schedule schema and verified P07B webhook schema. It starts two schedule workers, two webhook dispatchers and a real signed sandbox receiver. The default Compose model remains the verified P06 topology.

P07A provides customer-owned one-time, daily and weekly schedules; versioned edit/pause/resume/cancel commands; immutable occurrence history; DST-aware local-wall-time recurrence; a 24-hour catch-up window; and stable duplicate-safe occurrence execution.

P07B provides owner-managed approved webhook endpoints, one-time secret disclosure, AES-256-GCM encrypted and versioned secrets, exact-byte HMAC-SHA256 signatures, a five-minute replay window, endpoint/event logical uniqueness, immutable attempt history, persisted leases, two competing dispatchers, eight-attempt bounded retry cycles, audited manual retry, strict destination controls and durable receiver deduplication. Webhook failure never changes settled money or blocks payment workers.

The API also provides registration, login/logout, revocable sessions, customer-owned accounts and histories, recipient lookup, immediate settled transfers, asynchronously processed payments with fund reservations, payment status reads, payer/ADMIN cancellation before settlement, recipient/ADMIN partial or full refunds, ADMIN full reversal, schedules and administrator failed-work inspection/replay.

All money-changing and schedule-lifecycle commands require CSRF and `Idempotency-Key`. Identical replay returns the original operation; changed economic intent returns `409` without another financial effect. Payment acceptance returns `202` only after PostgreSQL atomically records the payment, hold, idempotency outcome, audit and outbox event. Cancellation releases a pending hold once; refunds and reversals use immutable compensating journals.

The leased publisher uses persistent RabbitMQ messages, mandatory routing and correlated confirms. Workers acknowledge only after protected PostgreSQL processing commits. Delivery is at least once; stable identities, consumer inbox records and business-state checks provide at-most-once committed financial effects for each operation. Webhook delivery is also at least once; the sandbox receiver deduplicates the logical endpoint/event identity.

Fictional identities are `alice@example.test`, `bob@example.test`, `merchant@example.test` and `admin@example.test`; their generated password is stored privately as `LEDGER_DEMO_PASSWORD` in ignored `.ledgerguard/runtime.env`. Obtain `/api/v1/auth/csrf` before login and after login/logout.

Scoped contracts:

- `/api/v1/openapi/p06.json` — verified P06 compatibility contract.
- `/api/v1/openapi/p07a-schedules.json` — verified P07A schedule contract.
- `/api/v1/openapi/p07b-webhooks.json` — verified P07B webhook contract.

**There is no complete React product interface or public deployment yet.** P08 is the interface milestone. The complete F01–F08 resilience campaign, D01–D24 seeded-defect campaign, Pact/ZAP/k6/backup-restore lanes and final release package remain later phases.

## Current verification status

P07B implementation source `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975` passed permanent workflow run `36330862462`. Durable provenance is in `docs/evidence/p07b-cc6b3ca.md` and `docs/evidence/p07b-cc6b3ca.json`.

The exact-SHA run completed 133 core/security JUnit cases, 124 PostgreSQL/HTTP integration cases, 77 TypeScript contract cases, 42 live P05 checks, 32 live P06 checks, 15 live P07A checks and 26 live P07B checks with zero failures, errors or skips. Eight P07B requirements were bound to named executed evidence, 282 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

The next executable milestone is P08A: the same-origin React application shell, registration/login/logout/session expiry, real account balances, authorized account history, customer-safe transaction detail, responsive inspection, Playwright Chromium journeys and authenticated axe checks.

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
- [P07B durable evidence](docs/evidence/p07b-cc6b3ca.md)
- [P07B scoped requirements](docs/implementation/P07B_REQUIREMENTS.json)
- [P07B webhook architecture](docs/architecture/adr/0017-p07b-signed-durable-webhooks.md)
- [P07A durable evidence](docs/evidence/p07a-9478663.md)
- [P07A scheduled-transfer architecture](docs/architecture/adr/0016-p07a-scheduled-transfers.md)
- [Delivery provenance](docs/implementation/DELIVERY.md)
- [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
- [Testing strategy](docs/testing/STRATEGY.md)
- [Evidence index](docs/evidence/INDEX.md)
- [Full-product release gates](docs/implementation/RELEASE_READINESS.md)
