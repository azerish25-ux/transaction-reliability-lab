# PostgreSQL verification suite — NOT EXECUTED

Executable location: `backend/src/test/java/lab/ledgerguard/PostgresFinancialIT.java`.
Command: `mvn -f backend/pom.xml verify`. Required infrastructure: Docker daemon, registry/Maven access.

The suite creates actual PostgreSQL 17.11-bookworm, separate owner/runtime credentials generated for the disposable container, runs Flyway V1–V4 and commits fixtures through `_post` as schema owner. Runtime commands cannot call `_post`.

PG01–PG11 cover restricted-role permissions, commit-time journal rejection, balanced synthetic funding, zero new-account balances, durable replay/conflict, synchronized 10,000/8,000 overspending on two connections, duplicate settlement, cancellation, refund authority, reversal-after-refund, racing refunds, complete idempotency outcomes, and forced customer registration. The independent oracle re-sums entries and holds in one repeatable-read snapshot.

These are source-written tests, not passing evidence. This execution environment has no Docker, PostgreSQL or Maven and cannot resolve dependency hosts. Tests are deliberately not configured to skip when Docker is absent. Two independent JDBC connections are not the two independently running API/worker processes required by the master spec; that further proof remains missing. RabbitMQ delivery, real process death, upgrade/restore preservation, query-plan measurements and live HTTP authorization are not covered by this class.
