# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. P08C refund/reversal interfaces are IMPLEMENTED_UNVERIFIED pending the permanent exact-SHA gate. P01–P08B are exact-SHA verified development milestones. The verified P08B boundary includes replay-safe customer transfers, asynchronous-payment creation/history/status and pending cancellation. The remaining customer adjustment, schedule, webhook and administrator interfaces, the complete fault laboratory, later test lanes and final release evidence remain incomplete. Overall status: INCOMPLETE / NO_GO.**

LedgerGuard is a compact transaction system built to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants, asynchronous delivery, crash recovery, compensating financial adjustments, time-dependent execution and unreliable external notification. It is not a bank, payment processor, compliance product or production-ready financial service.

## Run the verified P08B topology

From a clean clone with Docker Engine and Docker Compose:

```bash
./scripts/lab up
```

The command generates private sandbox secrets, builds the locked Java 21 and React/TypeScript applications, starts PostgreSQL and RabbitMQ, applies Flyway migrations as `ledger_owner`, runs application queries as restricted `ledger_runtime`, seeds balanced fictional fixtures, performs independent reconciliation and starts the loopback-only same-origin product UI.

It prints the actual URLs. The defaults are:

- Product UI: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:8080`

The default topology contains the non-root frontend proxy, one API process, one independently restartable transactional-outbox publisher and two competing payment-worker processes. The browser uses the same origin for UI and API requests; session and CSRF material are not stored in local storage.

The verified P08A baseline provides registration/login/logout/session-expiry recovery, real balances, zero-balance wallet creation, deterministic account history and owner-safe transaction detail.

The verified P08B slice adds:

- Real owner-authorized immediate transfer creation with exact currency parsing and explicit confirmation.
- Authoritative settled transfer receipts with stable transfer and journal references.
- Owner-scoped preservation of normalized economic intent and the original idempotency key when a response is lost or uncertain.
- Safe same-key replay that returns the original operation, proves one economic effect and blocks conflicting replacement commands while an outcome is unresolved.
- Durable asynchronous payment creation that displays `PENDING` honestly rather than optimistically claiming settlement.
- Owner-visible payment history and detail with direction, counterparty reference, version, lifecycle state, timestamps, adjustment state, projection and journal/failure information when present.
- Bounded live polling of the authoritative payment resource until `SETTLED`, `FAILED` or `CANCELLED`.
- Explicit cancellation of eligible outgoing pending payments, with a separate replay-safe idempotency key and truthful settlement-race handling.
- Four additional Chromium scenarios repeated at 1440×900, 768×1024 and 390×844, authenticated axe WCAG A/AA checks and six responsive transfer/payment screenshots.

The P08C candidate adds recipient refunds, administrator full reversal, adjustment context/history/receipts and preserved uncertainty recovery. Schedule, webhook and broader administrator interfaces remain later P08 slices.

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
- `/api/v1/openapi/p08b-ui.json` — verified P08B customer money-movement contract.

## P08C source candidate

The candidate adds a narrow administrator payment lookup/reversal surface, not a generic balance editor. Review totals are read in one authorized SQL statement; current balances and parent adjustment rules are rechecked by the existing protected financial command. Payer read access does not expose recipient balances or grant refund authority.

See `docs/implementation/P08C_REQUIREMENTS.json` and `docs/architecture/adr/0020-p08c-adjustment-interface.md`. The candidate contract is `/api/v1/openapi/p08c-ui.json`. Browser fixtures use the explicitly test-only `compose.p08c-test.yaml`; the default application is unchanged.

## Current verification status

P08B implementation source `5d6d883444845bc5de3364d0c682c3df26005d8e` passed permanent workflow run `36355379901` on September 27, 2026. Verification job `108721959438` and required gate `108723219635` both succeeded.

The exact-SHA gate preserved the complete P01–P08A campaign and passed 133 core/security JUnit cases, 124 real PostgreSQL/HTTP integration cases, 91 TypeScript client/contract cases including eight P08B cases, 24 real Chromium journeys across three viewport projects, authenticated accessibility analysis, committed-response-loss replay with one transfer effect, real RabbitMQ payment settlement, cancellation while both payment workers were deliberately stopped, nine responsive screenshots, repeatable reconciliation and a 316-file tracked-source literal-secret scan with zero findings. All required suites reported zero failures, errors and skips.

Durable provenance is in `docs/evidence/p08b-5d6d883.md` and `docs/evidence/p08b-5d6d883.json`. The full product remains **INCOMPLETE / NO_GO**.

The P08C candidate implements the customer adjustment interface: recipient-owner partial/full refunds plus administrator full reversal, including replay-safe uncertainty recovery, adjustment receipts/history, authorization proofs, responsive browser coverage and exact-SHA verification. Schedule, webhook and broader administrator interfaces follow after P08C exact-SHA verification and before P09.

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
- [P08B durable evidence](docs/evidence/p08b-5d6d883.md)
- [P08B machine-readable provenance](docs/evidence/p08b-5d6d883.json)
- [P08B scoped requirements](docs/implementation/P08B_REQUIREMENTS.json)
- [P08B architecture decision](docs/architecture/adr/0019-p08b-replay-safe-customer-money-movement.md)
- [P08A durable evidence](docs/evidence/p08a-d675db0.md)
- [P07B durable evidence](docs/evidence/p07b-cc6b3ca.md)
- [Delivery provenance](docs/implementation/DELIVERY.md)
- [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
- [Testing strategy](docs/testing/STRATEGY.md)
- [Evidence index](docs/evidence/INDEX.md)
- [Full-product release gates](docs/implementation/RELEASE_READINESS.md)
