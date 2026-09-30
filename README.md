# Bad Penny
## Financial Transaction Reliability Laboratory

A compact synthetic-money application for studying reliable transfers, asynchronous
payments, reservations, schedules, signed webhooks and independent investigation.
The engineering emphasis is correct outcomes across browser, API, PostgreSQL and
RabbitMQ, with evidence tied to the exact tested source.

**Product P01–P08F: verified on `d8d3656`. Full project: INCOMPLETE / NO_GO.**
The product job passed 165 Java unit, 140 real integration, 186 client and 147
browser tests. The same run's isolated laboratory gate failed; a later UI
observation repair is not yet a live campaign pass. No real money, banking
integration, compliance certification or production-financial readiness is claimed.

- [Reviewer guide](docs/PORTFOLIO.md)
- [Architecture, ER, state and sequence diagrams](docs/architecture/DIAGRAMS.md)
- [Exact-source product evidence and real screenshots](docs/evidence/product-d8d3656.md)
- [Current progress and remaining scope](docs/implementation/PROGRESS.md)
- [Full implementation contract](docs/implementation/MASTER_SPEC.md)

Run the ordinary local topology with `./scripts/lab up`. Representative reliability
stories include resolving a lost response with the original key, safely processing
redelivery after a worker restart, and independently reconciling immutable posting
history. Each evidence record identifies what actually ran; diagrams are explanatory.

## Run the base topology

From a clean clone with Docker Engine and Docker Compose:

```bash
./scripts/lab up
```

The command generates private sandbox secrets, builds the locked Java 21 and React/TypeScript applications, starts PostgreSQL and RabbitMQ, applies Flyway migrations as `ledger_owner`, executes application queries as restricted `ledger_runtime`, seeds balanced fictional fixtures and performs independent reconciliation. It prints the actual URLs; defaults are:

- Product UI: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:8080`

The same-origin frontend proxy, API, transactional-outbox publisher and two competing payment workers are independently restartable processes. The default topology is loopback-only, not a public deployment. Browser session and CSRF material are not stored in local storage.

Fictional identities are `alice@example.test`, `bob@example.test`, `merchant@example.test` and `admin@example.test`. Their generated password is stored privately as `LEDGER_DEMO_PASSWORD` in ignored `.ledgerguard/runtime.env`. New customers and newly created wallets start at zero; fixture funding uses balanced journals, never direct balance top-ups.

## Customer workflows and failure demonstrations

Customers can register/sign in, manage wallets, inspect authoritative history, make immediate transfers, create asynchronous payments, cancel eligible pending payments and perform authorized refunds. Administrators retain the existing full-reversal controls. Pending acceptance is never displayed as settlement; receipts carry actual immutable operation and journal references.

Representative executed demonstrations:

1. **Lost response after commit:** retain the original owner-scoped intent and idempotency key, resolve or explicitly replay it, and prove exactly one economic effect.
2. **Worker death after commit:** restart the independent worker, redeliver the original broker event and verify that inbox/business-operation deduplication prevents another posting.
3. **Independent investigation:** inspect both posting sides, run a consistent-snapshot reconciliation, detect controlled audit discrepancies and retain the historical report without automatic financial repair.

All money-changing and schedule-lifecycle commands require CSRF and `Idempotency-Key`. Same-intent replay returns the original operation; conflicting economic intent returns `409`. Payment acceptance returns `202` only after its payment, reservation, idempotency outcome, audit and outbox event have been durably recorded together.

## Activate schedules and signed webhooks

After the base topology starts, apply the documented P07 overlay:

```bash
docker compose --env-file .ledgerguard/runtime.env \
  -f compose.yaml -f compose.p07.yaml \
  up -d --build --wait \
  api scheduler-a scheduler-b receiver \
  webhook-dispatcher-a webhook-dispatcher-b
```

This activates the additive schedule/webhook schema, two schedule workers, two webhook dispatchers and the signed sandbox receiver.

**Schedules:** create one-time/daily/weekly instructions, inspect server-resolved local-time/zone/UTC previews, edit versioned definitions, pause/resume/cancel and inspect immutable occurrence results. Commands preserve their original identity through uncertain responses. Schedule creation does not reserve funds or prove execution; historical occurrences are not reinterpreted after a zone edit.

**Webhooks:** manage approved subscriptions, enable/disable, deliberately rotate signing secrets, inspect delivery/attempt history and request eligible audited retries. Secrets are transient and first-disclosure-only; ordinary reads and command replays do not reveal them. A lost secret response requires resolving the original command before a deliberate new rotation. Webhook failure never changes settled money or blocks payment workers.

## Administrator investigation — historical P08F VERIFIED_PASS

Sign in as the fictional administrator. Navigation includes **Transactions**, **Audit history**, **Reconciliation** and **Failed work**, alongside **Adjustments**.

Transaction search supports reference, kind, lifecycle state, account/user, currency, exact minor-unit amount and UTC time filters. Results are bounded and deterministically ordered within each recorded snapshot. Detail connects immutable journals, adjustments, outbox events and failed-work references. Server-side ADMIN enforcement protects direct API calls as well as the browser journeys; there is no balance editor or audit/ledger modification API.

Reconciliation independently checks entries/balances, journals, business postings, payment holds, adjustments, idempotency records, durable work and audit chains in one database-enforced read-only repeatable-read snapshot. Saved reports preserve scope, time, identities, full discrepancy counts and bounded samples. They represent historical observations, not live health. Lost responses reuse the original owner-scoped report UUID across reload and reauthentication; they do not replace a historical report with a new scan under the same identity.

Ordinary audit reads say **NOT_CHECKED**; only the scoped reconciliation executes hash-chain verification. Failed-work replay uses the existing audited backend and requires explicit confirmation. No discrepancy triggers automatic money repair.

| Executed suite | Passed |
|---|---:|
| JUnit unit | 159 |
| PostgreSQL/HTTP integration | 140 |
| TypeScript client | 186 |
| Browser | 147 |

The campaign had zero required failures, errors or skips and zero functional browser retries. P08F includes 30 administrator journey cases plus three responsive table/keyboard cases across desktop, tablet and mobile. Fifteen new screenshots passed validation; representative unmodified images are retained in the evidence report. Nine evidence-validator regression tests also passed. These results belong to the verified source above, not automatically to later code changes. Raw CI artifacts have finite retention. See the [final agent-driven responsive review](docs/evidence/p08f-8802f8b-visual-review.md).

## Contracts, evidence and next work

The administrator contract is `/api/v1/openapi/p08f-ui.json`. Earlier scoped contracts include `/api/v1/openapi/p06.json`, `/api/v1/openapi/p07a-schedules.json`, `/api/v1/openapi/p07b-webhooks.json` and the P08A-P08E UI contracts. They describe actual versioned capabilities, not a claim that the complete original mandate is finished.

See [original implementation contract](docs/implementation/MASTER_SPEC.md), [P08F requirements](docs/implementation/P08F_REQUIREMENTS.json), [administrator architecture decision](docs/architecture/adr/0023-p08f-administrator-investigation.md), [financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md), [testing strategy](docs/testing/STRATEGY.md), [evidence index](docs/evidence/INDEX.md) and [delivery record](docs/implementation/DELIVERY.md). Historical evidence retains its own tested source and scope.

**P09A verification is closed for source `1d7c443`**: [same-source product/lab evidence](docs/evidence/p09a-1d7c443.md). F01/F02 and D01/D02/D06 implementations are present; six other faults and 21 other seeded defects remain open. The current isolated campaign still needs successful end-to-end verification. P10 contracts/security/performance/restore and complete CI lanes, and P11 final exploratory evidence, diagrams, video and release delivery remain open. No public hosting, full-product accessibility conformance, security certification or production-financial readiness is claimed.

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
./scripts/lab test p09a-unit
./scripts/lab test p09a
./scripts/lab reconcile
./scripts/lab status
./scripts/lab down
```

## Naming and compatibility

Bad Penny is the project name. Existing Java package paths, database names,
Docker volumes, webhook headers and `.ledgerguard/` runtime paths remain
unchanged so documented commands keep working. Historical artifact names, raw
results and screenshots are preserved exactly as recorded. Verification labels
in the narrative describe the campaign scope, not a rename of past GitHub runs.
This branding change does not attribute historical test results to a new source.
