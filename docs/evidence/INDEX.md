# Evidence index — P05 verified, full product NO_GO

## Current P05 evidence

Published implementation `bbca6dd7478e33320aa134f6cd59c9652f4b60db`, tree `992c8c0b89e17a96b42e631d7ba6e313957d1984`, passed the permanent `LedgerGuard P05 verification` workflow for the exact `main` SHA.

- [Durable human-readable P05 report](p05-bbca6dd.md)
- [Machine-readable P05 result](p05-bbca6dd.json)
- [Scoped P05 requirements/test-ID source](../implementation/P05_REQUIREMENTS.json)
- [Asynchronous-payment architecture and limits](../architecture/adr/0014-p05-asynchronous-payments.md)
- [Current OpenAPI](../../backend/src/main/resources/openapi/p05.json)

Actual results: 133 core/security-configuration JUnit, 58 authentication/account HTTP, 28 immediate-transfer HTTP, 13 PostgreSQL financial/payment and 1 outbox failure-boundary integration case passed. TypeScript passed 44 existing, 6 authentication, 7 transfer and 5 payment cases. Forty-two live Compose checks, seven migrations, restricted runtime, repeated zero-discrepancy reconciliation, 34-requirement traceability, limited literal scan and teardown passed. The standalone 120-core run repeats CoreTest bodies and is not double-counted.

P05 proofs cover atomic payment/hold acceptance, publisher confirms, two manual-ack workers, broker-outage continuity, publisher death after confirmation, worker death after settlement commit, duplicate/logical-duplicate deduplication, stale projection rejection, per-consumer poison work, audited replay and bounded failure diagnostics.

## Preserved P04, P03 and foundation evidence

P04 implementation `60a95db82350983eaf1ad3c7545190866c831f98` passed run `36276049817`; its [human-readable](p04-60a95db.md) and [JSON](p04-60a95db.json) reports retain original scope.

P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`; its [human-readable](p03-8ee1e1f.md) and [JSON](p03-8ee1e1f.json) reports retain original scope.

Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`; its [summary](fast-lane-cb993016.md) and [JSON](fast-lane-cb993016.json) remain unchanged.

Historical component records remain available under `component/` and `unit-probes/`. They are not relabeled as current integrated Dxx evidence.

## Honest failure history

P05 candidate execution caught an incorrect poison-work assertion, a publisher-diagnostic/failed-code width mismatch and unnecessary V8 migration history. Each root cause was corrected and the complete lane rerun. A pre-publication workflow's final Git push failed because its Actions token could not modify workflow files after every verification step had passed; the authorized Git-data route published the exact tree and the permanent push workflow tested the final remote SHA.

Earlier phase reports preserve their own failed-run history. Failed runs are not counted as required seeded-defect experiments or passing evidence.

## Remaining evidence

P06 adjustments, P07 schedules/webhooks, P08 React/Playwright/axe, P09 complete F01–F08 and D01–D24 campaigns, P10 Pact/ZAP/k6/backup-restore/nightly/release lanes, and P11 final exploratory package/video remain incomplete.

No public application, release tag, security certification, accessibility conformance or measured performance claim exists. GitHub Actions results are the current authority for Docker/PostgreSQL/RabbitMQ/Compose execution.
