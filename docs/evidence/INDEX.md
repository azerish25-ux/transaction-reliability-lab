# Evidence index — P06 verified, P07A candidate, full product NO_GO

## Current verified P06 evidence

Published implementation `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed permanent `LedgerGuard P06 verification` workflow run `36306335283` for the exact `main` SHA.

- [Durable human-readable P06 report](p06-bb1eeb.md)
- [Scoped P06 requirements/test-ID source](../implementation/P06_REQUIREMENTS.json)
- [Payment-adjustment architecture and limits](../architecture/adr/0015-p06-payment-adjustments.md)
- [Verified P06 OpenAPI](../../backend/src/main/resources/openapi/p06.json)

Actual results include 133 core/security JUnit cases, 114 real PostgreSQL/HTTP integration cases, 70 TypeScript client/contract cases, 42 live P05 Compose checks and 32 live P06 adjustment checks. All required suites had zero failures, errors and skips. Forty-four scoped P03–P06 requirements were bound to executed evidence, the tracked source was clean, limited literal-secret scanning passed and reconciliation reported zero discrepancies.

P06 proofs cover payer/administrator cancellation, hold release without a journal, cancellation-versus-settlement serialization, partial/full recipient-authorized refunds, administrator full reversal, immutable settlement history, parent-scoped idempotency, commit-response loss, concurrent refund bounds, forbidden transitions, reversal-versus-spending, database enforcement and independent adjustment reconciliation.

## P07A source candidate

The current tree adds durable scheduled transfers but has no verified P07A report until its permanent source-SHA gate passes.

- [P07A requirements](../implementation/P07A_REQUIREMENTS.json)
- [P07A architecture](../architecture/adr/0016-p07a-scheduled-transfers.md)
- [Scoped P07A schedule OpenAPI](../../backend/src/main/resources/openapi/p07a-schedules.json)

Candidate evidence includes a five-case real PostgreSQL schedule suite, the existing deterministic DST/catch-up policy cases and a live two-scheduler Compose campaign. These must not be relabeled as passing before the remote workflow verifies the final source SHA.

## Preserved P05, P04, P03 and foundation evidence

P05 implementation `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`; its [human-readable report](p05-bbca6dd.md) and [JSON provenance](p05-bbca6dd.json) retain original scope.

P04 implementation `60a95db82350983eaf1ad3c7545190866c831f98` passed run `36276049817`; its [human-readable](p04-60a95db.md) and [JSON](p04-60a95db.json) reports retain original scope.

P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`; its [human-readable](p03-8ee1e1f.md) and [JSON](p03-8ee1e1f.json) reports retain original scope.

Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`; its [summary](fast-lane-cb993016.md) and [JSON](fast-lane-cb993016.json) remain unchanged.

Historical component records remain available under `component/` and `unit-probes/`. They are not relabeled as current integrated Dxx evidence.

## Honest failure history

P05 candidate execution caught an incorrect poison-work assertion, a publisher-diagnostic/failed-code width mismatch and unnecessary migration history. P06 candidate execution caught workflow publication and remote-gate issues before the final source SHA passed. Each verified report records only the exact successful source and preserves its own scope.

Failed runs are not counted as required seeded-defect experiments or passing evidence.

## Remaining evidence

P07A remains unverified until its permanent gate passes. P07B signed durable webhooks, P08 React/Playwright/axe, P09 complete F01–F08 and D01–D24 campaigns, P10 Pact/ZAP/k6/backup-restore/nightly/release lanes, and P11 final exploratory package/video remain incomplete.

No public application, release tag, security certification, accessibility conformance or measured performance claim exists. GitHub Actions results are the authority for Docker/PostgreSQL/RabbitMQ/Compose execution.
