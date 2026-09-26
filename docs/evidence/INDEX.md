# Evidence index — verified foundation, overall NO_GO

The newest verified source is `cb9930168ffdc793a5759f754a39685369620422`. Its permanent summary is [Verified P01/P02 fast lane](fast-lane-cb993016.md), with a [machine-readable record](fast-lane-cb993016.json). GitHub Actions run [36267641798](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36267641798) completed successfully for that exact clean source SHA.

## Current executed evidence

| Executed check | Actual result | Boundary |
|---|---|---|
| `./scripts/lab test unit`: standalone Java | 120 passed, 0 failed/errors/skipped | Java 21 case runner; deterministic model seed 74021 |
| `./scripts/lab test unit`: TypeScript | 44 passed, 0 failed | Production TS money/client/intent modules with injected Fetch/storage |
| Maven JUnit core | 120 passed, 0 failed/errors/skipped | Same Java case bodies through JUnit Jupiter; not additional unique tests |
| PostgreSQL/Testcontainers integration | 11 passed, 0 failed/errors/skipped | PostgreSQL 17.11, real commits, independent connections and role boundaries |
| Flyway | Five migrations validated/applied | Fresh schema reached version v5 |
| Compose foundation | Build/start/readiness/seed/teardown passed | API, PostgreSQL and RabbitMQ healthy; API used `ledger_runtime` |
| Independent reconciliation | Two runs, zero discrepancies each | REPEATABLE READ / READ ONLY snapshot oracle |
| Literal high-signal secret scan | 180 tracked text files, zero findings | Limited pattern scan; not comprehensive security assurance |
| Required aggregate CI gate | Passed | Missing/failed verification job would fail the lane |

The historical component evidence remains available: [Java XML](component/java.xml), [client XML](component/client.xml), [combined log](component/unit.log), [unit-probe summary](unit-probes/summary.json) and [scoped bug reports](../testing/bugs/README.md). Those records retain their original earlier source identity and are not silently relabeled as current full-stack Dxx evidence.

## Resolved findings in this milestone

- A real `execute_command` SQL ambiguity found by the first PostgreSQL run was repaired through additive Flyway V5; the eleven database tests then passed.
- A transient JVM-startup socket reset exposed an overly narrow readiness exception boundary; the bounded poll was repaired and the complete clean Compose lane then passed.

## Still unexecuted or incomplete

Spring authentication/CSRF/ownership APIs, live transfer/payment HTTP paths, RabbitMQ publisher/consumer processing, worker recovery, webhook sender/receiver, scheduler execution, the React product UI, Pact, real Playwright/axe journeys, ZAP, complete F01–F08, complete D01–D24, data-bearing upgrade/backup restore, reference k6, nightly/release lanes and the demonstration video remain open. Five exploratory charters are prepared but not represented as human execution. No public application, release tag, security certification, accessibility conformance or performance claim exists.

## Provenance

The verified run used Ubuntu 24.04.5, Java 21.0.12+1, Node 22.23.2, npm 10.9.8, Docker 28.0.4, Testcontainers 1.21.4 and PostgreSQL 17.11. The retained Actions artifact contains 39 files, is 73,969 bytes, has SHA-256 `61a1903b6904e748e38cd8f2a50b3240a252ef975b9228f7512f312c93275b78`, and expires 2026-10-10. Its expiry is why this compact durable summary is committed.

Older environment/blocker records remain historical evidence of their original execution environment; they are superseded for current GitHub write, PostgreSQL and Compose capability by the verified run above.
