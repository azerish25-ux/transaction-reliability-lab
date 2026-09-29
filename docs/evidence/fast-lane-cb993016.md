# Verified P01/P02 fast lane — `cb993016`

Status: **VERIFIED_PASS for the documented foundation scope; overall product remains INCOMPLETE / NO_GO.**

## Source and run

- Repository: `azerish25-ux/transaction-reliability-lab`
- Branch: `main`
- Clean source commit: `cb9930168ffdc793a5759f754a39685369620422`
- Source tree: `b958f1c96f8540f5bd766ffcffa7339cae2830b1`
- Workflow: [fast verification run 36267641798](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36267641798)
- Event: `push`
- Verification job `108475257072`: SUCCESS
- Required aggregate gate `108475591888`: SUCCESS
- Execution window: 2026-09-26 19:54:07–19:56:20 UTC
- Machine-readable record: [fast-lane-cb993016.json](fast-lane-cb993016.json)

## Executed results

| Boundary | Result |
|---|---|
| Standalone Java policies | 120 passed; 0 failed/errors/skipped; deterministic model seed 74021 |
| JUnit Jupiter adapter | 120 passed; the same case bodies as the standalone execution, not 120 additional unique tests |
| TypeScript money/client/uncertain-intent utilities | 44 passed; 0 failed |
| PostgreSQL/Testcontainers committed-transaction suite | 11 passed; 0 failed/errors/skipped |
| Flyway | Five migrations validated and applied to PostgreSQL 17.11; resulting schema version v5 |
| Compose configuration | Valid |
| Clean runtime build | Java 21 non-root API image built successfully |
| Runtime dependencies | PostgreSQL and RabbitMQ healthy; API healthy |
| Authority boundary | Live API reported PostgreSQL authority and `ledger_runtime` restricted role |
| Fixture creation | Four fictional users, eleven accounts and seven wallet views; opening value created by protected balanced journals |
| Reconciliation | Two REPEATABLE READ / READ ONLY scans; zero discrepancies in each |
| Literal secret scan | 180 tracked text files checked; zero configured high-signal matches |
| Teardown | Scoped containers/network removed successfully |

The eleven PostgreSQL cases include runtime-role bypass rejection, commit-time incomplete-journal rejection, independently balanced funding, idempotency replay/conflict, synchronized overspending, duplicate settlement deduplication, cancellation semantics, refund authority/reversal policy, concurrent-refund limits, incomplete idempotency rejection and registration-role safety.

## Evidence artifact

- Artifact ID: `10913469364`
- Name: `ledgerguard-fast-evidence-cb9930168ffdc793a5759f754a39685369620422`
- Files: 39
- Size: 73,969 bytes
- SHA-256: `61a1903b6904e748e38cd8f2a50b3240a252ef975b9228f7512f312c93275b78`
- Expiry: 2026-10-10 19:56:09 UTC
- Contents: service logs, secret-scan result, JUnit Surefire reports and PostgreSQL Failsafe reports

The expiring artifact supplements this durable summary; it is not the only evidence index.

## Defects found and repaired by execution

1. Run `36267116956` detected a genuine PostgreSQL defect: an unqualified `status` predicate in `execute_command` conflicted with a local variable. Commit `e614cdde88336e535f4d6c7c8e5052a0b62659a6` added guarded Flyway V5, preserving V2 migration identity while qualifying the destination-account columns.
2. Run `36267330328` showed that a transient socket reset during JVM startup escaped the bounded readiness poll. Commit `cb9930168ffdc793a5759f754a39685369620422` made connection-level startup failures retryable until the deadline and retained hidden service logs in artifacts.

Neither failure was hidden, skipped or converted into an artificial pass. The complete affected lane reran after each root-cause fix.

## Explicit boundary

This evidence does not claim complete authentication, live customer/admin product workflows, RabbitMQ business consumption, webhooks, schedules, React/browser behavior, F01–F08, D01–D24, Pact, ZAP, axe, k6, upgrade/restore or video completion. It does not establish production banking readiness, security certification, comprehensive accessibility or reference-load performance.
