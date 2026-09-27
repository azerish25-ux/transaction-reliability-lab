# Evidence index — P08A verified, full product NO_GO

## Current verified P08A evidence

Implementation `d675db096b8f023469e253737ade80a2b8b3b0fa` passed permanent `LedgerGuard P08A verification` push workflow run `36345292129` for the exact `main` source SHA.

- [Durable human-readable P08A report](p08a-d675db0.md)
- [Machine-readable P08A provenance](p08a-d675db0.json)
- [Scoped P08A requirements/test-ID source](../implementation/P08A_REQUIREMENTS.json)
- [Same-origin customer-interface architecture](../architecture/adr/0018-p08a-same-origin-customer-interface.md)
- [Verified P08A UI OpenAPI](../../backend/src/main/resources/openapi/p08a-ui.json)

The exact-SHA run completed 133 core/security JUnit cases, 124 real PostgreSQL/HTTP integration cases, 83 TypeScript client/contract cases, 42 live P05 checks, 32 live P06 checks, 15 live P07A checks, 26 live P07B checks and 12 P08A browser journeys. All required suites had zero failures, errors and skips. Seven scoped P08A requirements were bound to named executed evidence, 305 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

P08A proofs cover the locked React production build, non-root loopback same-origin delivery, registration/session behavior, real balances, zero-balance wallet creation, deterministic history, customer-safe detail, explicit outage/expiry states, responsive desktop/tablet/mobile rendering and authenticated axe checks.

## Preserved P07B and earlier evidence

P07B implementation `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975` passed run `36330862462`.

- [Durable human-readable P07B report](p07b-cc6b3ca.md)
- [Machine-readable P07B provenance](p07b-cc6b3ca.json)

P07A implementation `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed run `36319414655`; its [human-readable report](p07a-9478663.md) and [JSON provenance](p07a-9478663.json) retain original scope.

P06 implementation `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed run `36306335283`. P05 implementation `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`. P04 implementation `60a95db82350983eaf1ad3c7545190866c831f98` passed run `36276049817`. P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`. Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`. Their durable reports retain original scope and timestamps.

Historical component records remain available under `component/` and `unit-probes/`. They are not relabeled as current integrated Dxx evidence.

## Honest failure history

P08A's initial browser run exposed a native-fetch receiver defect. The next exact-SHA run exposed a stale balance fixture assumption, a real WCAG contrast issue and fixture-authentication throttling. Each root cause was repaired, and the entire gate—not only the failed browser step—was rerun successfully on `d675db096b8f023469e253737ade80a2b8b3b0fa`.

## Remaining evidence

P08B and later customer/admin interfaces, P09 complete F01–F08 and D01–D24 campaigns, P10 Pact/ZAP/k6/backup-restore/nightly/release lanes, and P11 final exploratory package/video remain incomplete.

No public application, release tag, security certification, whole-product accessibility conformance or measured performance claim exists. GitHub Actions results are the authority for Docker/PostgreSQL/RabbitMQ/Compose/browser execution.
