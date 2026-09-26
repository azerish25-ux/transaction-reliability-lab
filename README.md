# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. INCOMPLETE / NO_GO as a complete product; the P01/P02 executable foundation is verified.**

LedgerGuard is a compact transaction system whose purpose is to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants and recovery. It is not a bank, payment processor, compliance product or production-ready financial service.

## Run the verified foundation

From a clean clone with Docker Engine and Docker Compose:

```bash
./scripts/lab up
```

The command generates sandbox-only secrets under ignored `.ledgerguard/`, builds the Java 21 application, starts PostgreSQL 17 and RabbitMQ 4, applies Flyway migrations as `ledger_owner`, runs the API as restricted `ledger_runtime`, seeds balanced fictional fixtures, waits on real readiness checks and executes independent reconciliation.

Useful commands:

```bash
./scripts/lab doctor
./scripts/lab status
./scripts/lab test unit
./scripts/lab test database
./scripts/lab reconcile
./scripts/lab logs
./scripts/lab down
```

## Current architecture boundary

`HTTP -> Spring Boot API -> restricted PostgreSQL runtime role`

The source also contains exact-money/state policies, protected posting and command functions, durable idempotency records, holds, outbox/inbox tables, audit-chain records, schedules and webhook persistence. The executable foundation exposes only health and a read-only system-boundary endpoint; authentication, product APIs, worker processing and the React UI remain later phases and are not represented as complete.

## Verified fast-lane result

Source commit [`cb9930168ffdc793a5759f754a39685369620422`](https://github.com/azerish25-ux/transaction-reliability-lab/commit/cb9930168ffdc793a5759f754a39685369620422) passed [GitHub Actions run 36267641798](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36267641798):

- 120 standalone Java policy cases passed.
- The same 120 cases passed through JUnit Jupiter; they are not double-counted as unique tests.
- 44 TypeScript client/money/uncertain-intent cases passed.
- 11 real PostgreSQL/Testcontainers committed-transaction tests passed.
- Five Flyway migrations applied successfully.
- Clean Compose build/start, restricted-role readiness, deterministic balanced seeding and two independent zero-discrepancy reconciliation scans passed.
- The literal high-signal secret scan checked 180 tracked text files with zero findings.
- Both the verification job and required aggregate gate passed.

A green fast lane is not a complete release decision. Full G01–G16 status remains in [release readiness](docs/implementation/RELEASE_READINESS.md).

Inspection paths:

- [Implementation progress](docs/implementation/PROGRESS.md)
- [Delivery and CI state](docs/implementation/DELIVERY.md)
- [Verified fast-lane evidence](docs/evidence/fast-lane-cb993016.md)
- [Exact dependencies](docs/architecture/DEPENDENCIES.md)
- [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
- [Testing strategy](docs/testing/STRATEGY.md)
- [Evidence index](docs/evidence/INDEX.md)
