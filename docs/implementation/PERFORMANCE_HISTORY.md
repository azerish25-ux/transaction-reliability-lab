# Reference-history fixture and disposable restore

Status: implementation and local generation checks only. Live PostgreSQL fixture,
backup/restore and load measurement are **NOT VERIFIED**. Overall NO_GO remains.

## Reproducible dataset plan

`scripts/generate-performance-history` produces ignored SQL and a SHA-256-bound
manifest under `.evidence/performance-history/`. It never connects to a database.
The minimum plan contains 100 synthetic customers, 200 CAD wallets, one balancing
funding asset, 200 funding journals and 99,800 immediate-transfer journals. Customer
and account identities, keys, transfer distribution and amounts are deterministic;
actual journal IDs and insertion timestamps come from protected database commands.
The generator does not backdate immutable records or invent measured history.

Identity/account setup follows the existing sandbox fixture pattern. Funding uses
`ledger._post`; every transfer uses `ledger.execute_command`, including normal
locking, balance validation, journal creation, idempotency, outbox and audit paths.
The script never directly inserts financial journals/entries or disables triggers.
Each batch enforces deferred constraints before commit. Every command must return
201/SETTLED with `replayed=false`; null/unexpected results fail closed.

The SQL refuses any database except `ledgerguard_performance`, requires the
migration owner role, and refuses an existing customer/account/journal dataset.
A partial or repeated load cannot silently reset an existing database. Use a new
disposable test container after an interrupted load. A synthetic fixture password
must come from `LEDGER_PERF_PASSWORD`; it is never embedded in generated SQL or
its manifest. This is not a general-purpose production seeder.

## Ordinary integration acceptance

The `dataset` Maven profile adds only `HistoricalDatasetIT`. It creates a fresh
PostgreSQL17 Testcontainer, applies real Flyway migrations, loads generated SQL
through psql, checks exact counts, and runs the existing independent reconciliation.
It also asserts a second load is rejected before changing the dataset.

The test then creates a pg_dump archive inside the disposable container and restores
it to a separate new `ledgerguard_restore` database. It compares ordered row-content
fingerprints for every ledger table, verifies audit sequence/hash continuity,
reruns financial reconciliation, and checks an original transfer key replays with
all ledger fingerprints unchanged. Backups and synthetic authentication material
never enter Git or the uploaded evidence. Only the manifest, redacted summary and
test report are configured as artifacts.

These assertions are implemented, **not yet observed passing**. Docker is unavailable
in the current execution environment. The generator's six local deterministic tests
passed and the dataset-profile Java build/unit suite passed (165 tests). No SQL
load, backup/restore, throughput or latency result is claimed.

```sh
python3 -m unittest discover -s tests/performance -v
./scripts/generate-performance-history
./mvnw -B -ntp -f backend/pom.xml -Pdataset -Dit.test=HistoricalDatasetIT verify
```

The separate manual workflow is `.github/workflows/history.yml`, named
**Bad Penny ordinary reference-history fixture**, job `reference-history`.
It performs only this ordinary fixture/restore test. It does not run a load test,
interrupt a broker, invoke a fault workflow, or replace required release gates.

## Remaining performance and migration work

The reference profile still requires real runner-resource capture, k6 scenarios,
arrival-rate load and actual measurements, independent post-load financial
acceptance, and raw/result reports. The fixture itself is not a performance report.
The master-spec recovery/interruption scenario remains outside the currently
permitted execution scope.

This test restores a current-schema snapshot. It is not a historical baseline-schema
upgrade test. Representative baseline schedules, webhook history, settled/pending
payments, holds and adjustments, followed by real upgrade/replay acceptance, remain
required separately. Neither generated code nor a compiling integration test proves
those outcomes.
