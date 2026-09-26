# LedgerGuard
## Financial Transaction Reliability Laboratory

**INCOMPLETE / NO_GO — local implementation checkpoint, not a working full-stack product.**
All amounts are synthetic. No real money, card processing, banking integration, compliance certification or production-readiness claim.

LedgerGuard's goal is to make transaction risks inspectable: duplicate intent, ambiguous outcomes, concurrent spending, partial failures and recovery. The complete [implementation contract](docs/implementation/MASTER_SPEC.md) remains in scope; this archive does not satisfy it in full.

### What currently exists

Java 21 exact-money, reservation, payment-transition, idempotency, DST, projection, webhook-signing/encryption and retry policies; protected PostgreSQL schema/command migrations and a JDBC transaction adapter; TypeScript exact-money and safe uncertain-intent client modules. PostgreSQL Testcontainers tests are source-written but unexecuted. There is no running Spring/React/RabbitMQ application yet.

Executed checks and source identities are recorded in [evidence](docs/evidence/INDEX.md). Offline standalone Java and Node client-unit results are explicitly separate from JUnit, live API, database and browser verification. Component mutation probes show genuine red assertions and restored passing baselines, but **do not count as the 24 required full-stack defect experiments**.

### Inspection paths

- [Current progress and blockers](docs/implementation/PROGRESS.md)
- [Delivery state and remote identity](docs/implementation/DELIVERY.md)
- [Financial architecture and remaining integration](docs/architecture/FINANCIAL_BOUNDARY.md)
- [PostgreSQL test source and limitations](tests/database/README.md)
- [Dependency/maintenance decisions](docs/architecture/DEPENDENCIES.md)
- [Risk-based testing strategy](docs/testing/STRATEGY.md)
- [Release gate status](docs/implementation/RELEASE_READINESS.md)

### Executable checks in a prepared Java 21/Node/TypeScript environment

`./scripts/lab test unit` executes the standalone Java and TypeScript client suites. `./scripts/lab unit-probes --all` runs isolated source mutations with baseline/mutant/restoration evidence. Representative unit probes are D12 (CAD 0.29 becomes 28 cents under a float/truncate bug), D19 (signature/event binding mismatch), and D21 (Halifax daily time drifts by one hour across spring DST).

`./scripts/lab up` is **not implemented or verified** and exits with an explicit blocker. No sandbox credentials, public application URL, completed CI lane or release asset exists. The original remote README and commit remain preserved in Git ancestry; local work has not been pushed because the connection's write requests return HTTP 403.
