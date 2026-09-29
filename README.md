# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. P01–P08E are exact-SHA verified development milestones. P08E adds customer webhook management, protected one-time secret handling, delivery/attempt inspection and replay-safe command recovery. Broader administrator interfaces, the complete fault laboratory, later test lanes and final release evidence remain incomplete. Overall status: INCOMPLETE / NO_GO.**

LedgerGuard is a compact transaction system built to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants, asynchronous delivery, crash recovery, compensating financial adjustments, time-dependent execution and unreliable external notification. It is not a bank, payment processor, compliance product or production-ready financial service.

## Run the base topology

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

The verified P08C slice adds recipient partial/full refunds, administrator full reversal, authoritative adjustment context, paged history and immutable receipts, plus preserved same-key uncertainty recovery through reload and reauthentication. P08D adds the schedule interface below. Customer webhook interfaces are verified in P08E below; broader administrator interfaces remain later P08 work.

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
- `/api/v1/openapi/p08c-ui.json` — verified P08C adjustment-interface contract.

## P08C adjustment interface

The interface adds a narrow administrator payment lookup/reversal surface, not a generic balance editor. Review totals are read in one authorized SQL statement; current balances and parent adjustment rules are rechecked by the existing protected financial command. Payer read access does not expose recipient balances or grant refund authority.

See `docs/implementation/P08C_REQUIREMENTS.json` and `docs/architecture/adr/0020-p08c-adjustment-interface.md`. Browser fixtures use the explicitly test-only `compose.p08c-test.yaml`; the default application is unchanged by that fixture overlay.

## P08D customer schedule management — VERIFIED_PASS

With the documented P07 overlay active, customers can use **Schedules** in the product navigation to create one-time/daily/weekly instructions, review a server-resolved local time/zone/UTC preview, edit versioned definitions, pause/resume/cancel, and inspect paged occurrence results and actual transfer/journal references.

Schedule commands use the existing protected backend and owner-scoped intent store. Lost creation or PUT edit responses retain their original key, body and expected version across reload and reauthentication. Recovery is explicit; stale versions are never silently replaced. Creating a schedule does not reserve funds or prove a transfer executed. Historical local occurrences are not reinterpreted after a zone edit.

The P08D gate preserves P01-P08C, requires the production-client cases, server temporal-preview tests, real browser/SQL oracles at desktop/tablet/mobile widths, keyboard/axe checks and responsive screenshots. See `docs/implementation/P08D_REQUIREMENTS.json` and `docs/architecture/adr/0021-p08d-customer-schedule-management.md`. The permanent exact-SHA gate passed for `13bdd62c924a3230825b6d9304f449f887c8e7fe` in run `36464316280`. See [the P08D evidence report](docs/evidence/p08d-13bdd62.md).

## P08E customer webhooks — VERIFIED_PASS

With the documented P07 overlay active, use **Webhooks** in customer navigation. Manage the approved sandbox subscription, enable/disable it, deliberately rotate its signing secret, inspect deliveries and attempts, and request eligible audited retries. Notification failure never changes settled payment results.

Lost responses retain the original owner-scoped command ID and reviewed version/cycle. Check the outcome or explicitly retry the same command. A first-only secret response is not recoverable through replay: resolve the original command before deliberately rotating again. Secrets are not placed in browser persistence or ordinary reads.

Implementation `026dca3ec4c3c68696e87f8192872a4d2e45e157` passed permanent run `36485630387`, including **Required P08E gate**. Executed totals: 147 JUnit unit, 127 PostgreSQL/HTTP integration, 162 TypeScript client, 114 Browser; zero required failures/errors/skips and zero functional browser retries. Seven new requirements and twelve screenshots passed with P01–P08D preserved. See [evidence](docs/evidence/p08e-026dca3.md), [provenance](docs/evidence/p08e-026dca3.json), `docs/implementation/P08E_REQUIREMENTS.json`, and `/api/v1/openapi/p08e-ui.json`.

## P08E customer webhooks — VERIFIED_PASS

With the documented P07 overlay active, use **Webhooks** in customer navigation. Manage the approved sandbox subscription, enable/disable it, deliberately rotate its signing secret, inspect deliveries and attempts, and request eligible audited retries. Notification failure never changes settled payment results.

Lost responses retain the original owner-scoped command ID and reviewed version/cycle. Check the outcome or explicitly retry the same command. A first-only secret response is not recoverable through replay: resolve the original command before deliberately rotating again. Secrets are not placed in browser persistence or ordinary reads.

Implementation `644022340c0f3277297ed205610e4227584e720a` passed permanent run `36499192991`, including **Required P08E gate**. Executed totals: 147 JUnit unit, 127 PostgreSQL/HTTP integration, 162 TypeScript client, 114 Browser; zero required failures/errors/skips and zero functional browser retries. Seven new requirements and twelve screenshots passed with P01–P08D preserved. See [evidence](docs/evidence/p08e-6440223.md), [provenance](docs/evidence/p08e-6440223.json), `docs/implementation/P08E_REQUIREMENTS.json`, and `/api/v1/openapi/p08e-ui.json`.

## Historical P08D verification status

P08D implementation `13bdd62c924a3230825b6d9304f449f887c8e7fe` passed permanent workflow [run 36464316280](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36464316280) on September 28, 2026, including **Required P08D gate**. Executed totals: 139 JUnit unit, 127 PostgreSQL/HTTP integration, 134 TypeScript client and 84 browser cases. Required failures/errors/skips and functional browser retries were zero. Eight P08D requirements, twelve new responsive screenshots and the preserved P01-P08C campaign passed, including final reconciliation. The [durable report](docs/evidence/p08d-13bdd62.md) and [JSON provenance](docs/evidence/p08d-13bdd62.json) retain exact artifact metadata and scope limitations.

### Historical P08C and P08B verification

P08C implementation source `3b87e3a078d7b9270b56964ed1c50dc299958379` passed permanent workflow run `36436424432` on September 28, 2026. Verification job `108975429770` and required gate `108980532491` both succeeded.

The full gate preserved P01–P08B and passed the new production-client, real PostgreSQL/HTTP and desktop/tablet/mobile browser/accessibility evidence, secret scan, repeatable reconciliation and requirement assertions. It requires at least 18 P08C client cases, at least 54 combined browser cases, ten named P08C scenarios in each of three viewport projects, three named P08C PostgreSQL/HTTP cases and nine P08C screenshots. Required suites must have zero failures/errors/skips, zero functional browser retries and a clean tracked source tree. These are gate-enforced minimums; actual generated suite totals remain in the run artifact.

Durable provenance is in [the P08C report](docs/evidence/p08c-3b87e3a.md) and [JSON record](docs/evidence/p08c-3b87e3a.json). The GitHub-reported artifact digest, retention limits and tested source SHA are recorded there. The full product remains **INCOMPLETE / NO_GO**.

Historical P08B source `5d6d883444845bc5de3364d0c682c3df26005d8e` passed run `36355379901` on September 27, 2026; its [original evidence](docs/evidence/p08b-5d6d883.md) and [JSON provenance](docs/evidence/p08b-5d6d883.json) retain their original counts and scope.

## P08F administrator investigation — IMPLEMENTED_UNVERIFIED

Administrator navigation now includes **Transactions**, **Audit history**, **Reconciliation**, and **Failed work**, alongside existing **Adjustments**. Search actual operations with bounded filters; inspect both posting sides and linked financial history; run independent accounting/audit checks and inspect saved snapshot reports. Lost report responses retain their original owner-scoped UUID. Report reads never imply live health; failed checks do not trigger automatic money repair. Failed-work replay reuses the existing audited backend and requires explicit confirmation.

This implementation is awaiting its exact-source permanent gate. The P01-P08E records above remain historical evidence, not automatic verification of new code. See `docs/implementation/P08F_REQUIREMENTS.json`, ADR 0023 and `/api/v1/openapi/p08f-ui.json`. All money remains synthetic and the overall product remains **INCOMPLETE / NO_GO**.

Next: execute and retain P08F verification, then P09 isolated fault/defect laboratory.

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
- [P08D durable evidence and screenshots](docs/evidence/p08d-13bdd62.md)
- [P08D machine-readable provenance](docs/evidence/p08d-13bdd62.json)
- [P08D scoped requirements](docs/implementation/P08D_REQUIREMENTS.json)
- [P08C durable evidence](docs/evidence/p08c-3b87e3a.md)
- [P08C machine-readable provenance](docs/evidence/p08c-3b87e3a.json)
- [P08C scoped requirements](docs/implementation/P08C_REQUIREMENTS.json)
- [P08C architecture decision](docs/architecture/adr/0020-p08c-adjustment-interface.md)
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
