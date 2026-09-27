# Evidence index — P07A verified, full product NO_GO

## Current verified P07A evidence

Implementation `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed permanent `LedgerGuard P07A verification` push workflow run `36319414655` for the exact `main` source SHA.

- [Durable human-readable P07A report](p07a-9478663.md)
- [Machine-readable P07A provenance](p07a-9478663.json)
- [Scoped P07A requirements/test-ID source](../implementation/P07A_REQUIREMENTS.json)
- [Scheduled-transfer architecture and limits](../architecture/adr/0016-p07a-scheduled-transfers.md)
- [Verified P07A schedule OpenAPI](../../backend/src/main/resources/openapi/p07a-schedules.json)

Actual results include 133 core/security JUnit cases, 119 real PostgreSQL/HTTP integration cases, 70 TypeScript client/contract cases, 42 live P05 Compose checks, 32 live P06 adjustment checks and 15 live P07A schedule checks. All required suites had zero failures, errors and skips. Fifty scoped P03–P07A requirements were bound to executed evidence, the tracked source was clean, 264 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

P07A proofs cover owner-scoped durable lifecycle commands, edit-source preservation, replay/conflict behavior, restricted runtime boundaries, two-scheduler one-effect execution, rejection without financial fragments, catch-up expiry, immutable occurrence history, lifecycle serialization, DST gap/overlap policy, versioned occurrence identity, event publication and independent reconciliation.

## Preserved P06 evidence

P06 implementation `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed run `36306335283`.

- [Durable human-readable P06 report](p06-bb1eeb.md)
- [Scoped P06 requirements/test-ID source](../implementation/P06_REQUIREMENTS.json)
- [Payment-adjustment architecture and limits](../architecture/adr/0015-p06-payment-adjustments.md)
- [Verified P06 OpenAPI](../../backend/src/main/resources/openapi/p06.json)

Its original report retains the exact P06 source, artifact and scope. P07A verification reran and preserved the P06 campaign rather than relabeling historical evidence.

## Preserved P05, P04, P03 and foundation evidence

P05 implementation `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`; its [human-readable report](p05-bbca6dd.md) and [JSON provenance](p05-bbca6dd.json) retain original scope.

P04 implementation `60a95db82350983eaf1ad3c7545190866c831f98` passed run `36276049817`; its [human-readable](p04-60a95db.md) and [JSON](p04-60a95db.json) reports retain original scope.

P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`; its [human-readable](p03-8ee1e1f.md) and [JSON](p03-8ee1e1f.json) reports retain original scope.

Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`; its [summary](fast-lane-cb993016.md) and [JSON](fast-lane-cb993016.json) remain unchanged.

Historical component records remain available under `component/` and `unit-probes/`. They are not relabeled as current integrated Dxx evidence.

## Honest failure history

The P07A candidate gate caught a schedule-edit source-field mismatch and later caught that Surefire dynamic-test names were unsuitable for named requirement traceability. The implementation was repaired, regression coverage was added, traceability was rebound to independently generated stable case identities, and the complete permanent gate was rerun successfully on the exact final implementation SHA.

Failed runs are not counted as required seeded-defect experiments or passing evidence.

## Remaining evidence

P07B signed durable webhooks, P08 React/Playwright/axe, P09 complete F01–F08 and D01–D24 campaigns, P10 Pact/ZAP/k6/backup-restore/nightly/release lanes, and P11 final exploratory package/video remain incomplete.

No public application, release tag, security certification, accessibility conformance or measured performance claim exists. GitHub Actions results are the authority for Docker/PostgreSQL/RabbitMQ/Compose execution.
