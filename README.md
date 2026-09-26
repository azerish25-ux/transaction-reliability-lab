# LedgerGuard
## Financial Transaction Reliability Laboratory

**Synthetic money only. INCOMPLETE / NO_GO as a complete product; P01/P02 foundation is now implemented for executable verification.**

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

## What the fast lane proves

The permanent GitHub Actions fast lane runs the existing Java and TypeScript suites, the eleven real PostgreSQL/Testcontainers financial tests, source secret scanning, a clean Compose build/start, restricted-role readiness, idempotent fixture seeding and independent reconciliation. A green subset is not a release decision; full G01–G16 status remains in [release readiness](docs/implementation/RELEASE_READINESS.md).

Inspection paths:

- [Implementation progress](docs/implementation/PROGRESS.md)
- [Delivery and CI state](docs/implementation/DELIVERY.md)
- [Exact dependencies](docs/architecture/DEPENDENCIES.md)
- [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
- [Testing strategy](docs/testing/STRATEGY.md)
- [Evidence index](docs/evidence/INDEX.md)
