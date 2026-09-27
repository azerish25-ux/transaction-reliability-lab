# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. P01–P08A are exact-SHA verified development milestones. P08A delivers the first real React customer journey. Later customer/admin interfaces, the complete fault laboratory, later test lanes and final release evidence remain incomplete. Overall status: INCOMPLETE / NO_GO.**

LedgerGuard is a compact transaction system built to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants, asynchronous delivery, crash recovery, compensating financial adjustments, time-dependent execution and unreliable external notification. It is not a bank, payment processor, compliance product or production-ready financial service.

## Run the verified P08A topology

From a clean clone with Docker Engine and Docker Compose:

```bash
./scripts/lab up
```

The command generates private sandbox secrets, builds the locked Java 21 and React/TypeScript applications, starts PostgreSQL and RabbitMQ, applies Flyway migrations as `ledger_owner`, runs application queries as restricted `ledger_runtime`, seeds balanced fictional fixtures, performs independent reconciliation and starts the loopback-only same-origin product UI.

It prints the actual URLs. The defaults are:

- Product UI: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:8080`

The default topology contains the non-root frontend proxy, one API process, one independently restartable transactional-outbox publisher and two competing payment-worker processes. The browser uses the same origin for UI and API requests; session and CSRF material are not stored in local storage.

P08A provides:

- Registration, login, logout, authenticated bootstrap and explicit session-expiry recovery.
- A real customer dashboard showing posted, reserved and available balances, balance version and update time.
- Zero-balance wallet creation without synthetic money creation.
- Deterministically paginated account history.
- Immutable customer-safe transaction detail containing only the selected wallet’s economic lines.
- Deliberate loading, empty, validation, permission, authentication and dependency-outage states.
- Responsive layouts verified at 1440×900, 768×1024 and 390×844.
- Twelve Chromium Playwright journeys and authenticated axe WCAG A/AA checks.

The transfer/payment, adjustment, schedule, webhook and administrator interfaces remain later P08 slices; no inert buttons or fabricated versions of those interfaces are shown.

## Activate the verified P07 topology

After the default topology is running, apply the opt-in overlay:

```bash
docker compose --env-file .ledgerguard/runtime.env \
  -f compose.yaml -f compose.p07.yaml \
  up -d --build --wait \
  api scheduler-a scheduler-b receiver \
  webhook-dispatcher-a webhook-dispatcher-b
```

The overlay activates the verified P07A schedule schema and verified P07B webhook schema. It starts two schedule workers, two webhook dispatchers and a signed sandbox receiver.

P07A provides customer-owned one-time, daily and weekly schedules; versioned edit/pause/resume/cancel commands; immutable occurrence history; DST-aware local-wall-time recurrence; a 24-hour catch-up window; and stable duplicate-safe occurrence execution.

P07B provides owner-managed approved webhook endpoints, one-time secret disclosure, AES-256-GCM encrypted and versioned secrets, exact-byte HMAC-SHA256 signatures, a five-minute replay window, endpoint/event logical uniqueness, immutable attempt history, persisted leases, two competing dispatchers, eight-attempt bounded retry cycles, audited manual retry, strict destination controls and durable receiver deduplication. Webhook failure never changes settled money or blocks payment workers.

The API also provides immediate settled transfers, asynchronously processed payments with fund reservations, cancellation before settlement, recipient/ADMIN partial or full refunds, ADMIN full reversal and administrator failed-work inspection/replay.

All money-changing and schedule-lifecycle commands require CSRF and `Idempotency-Key`. Identical replay returns the original operation; changed economic intent returns `409` without another financial effect. Payment acceptance returns `202` only after PostgreSQL atomically records payment, hold, idempotency outcome, audit and outbox event.

Fictional identities are `alice@example.test`, `bob@example.test`, `merchant@example.test` and `admin@example.test`; their generated password is stored privately as `LEDGER_DEMO_PASSWORD` in ignored `.ledgerguard/runtime.env`.

Scoped contracts:

- `/api/v1/openapi/p06.json` — verified P06 compatibility contract.
- `/api/v1/openapi/p07a-schedules.json` — verified P07A schedule contract.
- `/api/v1/openapi/p07b-webhooks.json` — verified P07B webhook contract.
- `/api/v1/openapi/p08a-ui.json` — verified P08A customer-interface contract.

## Current verification status

P08A implementation source `d675db096b8f023469e253737ade80a2b8b3b0fa` passed permanent workflow run `36345292129`. Verification job `108693127471` and required gate `108694570086` both succeeded. Durable provenance is in `docs/evidence/p08a-d675db0.md` and `docs/evidence/p08a-d675db0.json`.

The exact-SHA gate preserved the complete P01–P07B campaign and additionally passed the locked production frontend build, six P08A client-contract cases, twelve real Chromium journeys across three viewport projects, authenticated accessibility analysis, the customer-safe detail boundary, three responsive screenshots, repeatable reconciliation and a 305-file literal-secret scan with no findings.

Useful commands:

```bash
./scripts/lab test unit
./scripts/lab test ui
./scripts/lab test e2e
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
- [P08A durable evidence](docs/evidence/p08a-d675db0.md)
- [P08A scoped requirements](docs/implementation/P08A_REQUIREMENTS.json)
- [P08A architecture decision](docs/architecture/adr/0018-p08a-same-origin-customer-interface.md)
- [P07B durable evidence](docs/evidence/p07b-cc6b3ca.md)
- [Delivery provenance](docs/implementation/DELIVERY.md)
- [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
- [Testing strategy](docs/testing/STRATEGY.md)
- [Evidence index](docs/evidence/INDEX.md)
- [Full-product release gates](docs/implementation/RELEASE_READINESS.md)
