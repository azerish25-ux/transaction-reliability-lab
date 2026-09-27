# Evidence index — P07B verified, full product NO_GO

## Current verified P07B evidence

Implementation `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975` passed permanent `LedgerGuard P07B verification` push workflow run `36330862462` for the exact `main` source SHA.

- [Durable human-readable P07B report](p07b-cc6b3ca.md)
- [Machine-readable P07B provenance](p07b-cc6b3ca.json)
- [Scoped P07B requirements/test-ID source](../implementation/P07B_REQUIREMENTS.json)
- [Signed durable webhook architecture and limits](../architecture/adr/0017-p07b-signed-durable-webhooks.md)
- [Verified P07B webhook OpenAPI](../../backend/src/main/resources/openapi/p07b-webhooks.json)

The exact-SHA run completed 133 core/security JUnit cases, 124 real PostgreSQL/HTTP integration cases, 77 TypeScript client/contract cases, 42 live P05 checks, 32 live P06 checks, 15 live P07A checks and 26 live P07B checks. All required suites had zero failures, errors and skips. Eight scoped P07B requirements were bound to named executed evidence, 282 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

P07B proofs cover encrypted and versioned secrets, exact-byte signatures, replay-window validation, durable unique fan-out, immutable attempts, two-dispatcher lease claims, restart recovery, bounded retry/exhaustion, audited manual retry, strict egress controls, receiver deduplication, owner/admin inspection, financial isolation and contract agreement.

## Preserved P07A evidence

P07A implementation `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed run `36319414655`.

- [Durable human-readable P07A report](p07a-9478663.md)
- [Machine-readable P07A provenance](p07a-9478663.json)
- [Scoped P07A requirements/test-ID source](../implementation/P07A_REQUIREMENTS.json)
- [Scheduled-transfer architecture and limits](../architecture/adr/0016-p07a-scheduled-transfers.md)

Its original report retains the exact source, artifact and scope. P07B verification reran and preserved the P07A campaign under the additive V10 schema.

## Preserved earlier evidence

P06 implementation `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed run `36306335283`; its [human-readable report](p06-bb1eeb.md) retains original scope.

P05 implementation `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`; its [human-readable report](p05-bbca6dd.md) and [JSON provenance](p05-bbca6dd.json) retain original scope.

P04 implementation `60a95db82350983eaf1ad3c7545190866c831f98` passed run `36276049817`; its [human-readable](p04-60a95db.md) and [JSON](p04-60a95db.json) reports retain original scope.

P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`; its [human-readable](p03-8ee1e1f.md) and [JSON](p03-8ee1e1f.json) reports retain original scope.

Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`; its [summary](fast-lane-cb993016.md) and [JSON](fast-lane-cb993016.json) remain unchanged.

Historical component records remain available under `component/` and `unit-probes/`. They are not relabeled as current integrated Dxx evidence.

## Honest failure history

The P07B gate first exposed PostgreSQL JDBC type inference for a nullable retry `Instant`. The implementation was repaired to bind an explicit timestamp, and the complete permanent gate was rerun successfully on the exact final source SHA. Earlier P07A candidate failures similarly remain historical failures rather than passing or seeded-defect evidence.

## Remaining evidence

P08 React/Playwright/axe interfaces, P09 complete F01–F08 and D01–D24 campaigns, P10 Pact/ZAP/k6/backup-restore/nightly/release lanes, and P11 final exploratory package/video remain incomplete.

No public application, release tag, security certification, accessibility conformance or measured performance claim exists. GitHub Actions results are the authority for Docker/PostgreSQL/RabbitMQ/Compose execution.
