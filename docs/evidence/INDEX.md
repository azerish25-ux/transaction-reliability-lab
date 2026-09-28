# Evidence index — P08B verified, full product NO_GO

## Current verified P08B evidence

Implementation `5d6d883444845bc5de3364d0c682c3df26005d8e` passed permanent `LedgerGuard P08B verification` push workflow run `36355379901` for the exact `main` source SHA.

- [Durable human-readable P08B report](p08b-5d6d883.md)
- [Machine-readable P08B provenance](p08b-5d6d883.json)
- [Scoped P08B requirements/test-ID source](../implementation/P08B_REQUIREMENTS.json)
- [Replay-safe customer money-movement architecture](../architecture/adr/0019-p08b-replay-safe-customer-money-movement.md)
- [Verified P08B UI OpenAPI](../../backend/src/main/resources/openapi/p08b-ui.json)

The exact-SHA run completed 133 core/security JUnit cases, 124 real PostgreSQL/HTTP integration cases, 91 TypeScript client/contract cases, 42 live P05 checks, 32 live P06 checks, 15 live P07A checks, 26 live P07B checks and 24 Chromium journeys. All required suites had zero failures, errors and skips. Seven scoped P08B requirements were bound to named executed evidence, 316 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

P08B proofs cover explicit transfer confirmation and settled receipts, owner-scoped intent/key persistence, safe same-key replay after a committed response loss with one economic effect, durable `PENDING` payment acceptance, real RabbitMQ settlement, authoritative payment history/status, pending cancellation while both workers are stopped, responsive desktop/tablet/mobile rendering and authenticated axe checks.

## Preserved P08A and earlier evidence

P08A implementation `d675db096b8f023469e253737ade80a2b8b3b0fa` passed run `36345292129`.

- [Durable human-readable P08A report](p08a-d675db0.md)
- [Machine-readable P08A provenance](p08a-d675db0.json)

P07B implementation `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975` passed run `36330862462`.

- [Durable human-readable P07B report](p07b-cc6b3ca.md)
- [Machine-readable P07B provenance](p07b-cc6b3ca.json)

P07A implementation `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed run `36319414655`; its [human-readable report](p07a-9478663.md) and [JSON provenance](p07a-9478663.json) retain original scope.

P06 implementation `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed run `36306335283`. P05 implementation `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`. P04 implementation `60a95db82350983eaf1ad3c7545190866c831f98` passed run `36276049817`. P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`. Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`. Their durable reports retain original scope and timestamps.

Historical component records remain available under `component/` and `unit-probes/`. They are not relabeled as current integrated Dxx evidence.

## Honest failure history

P08B's permanent final run passed after the candidate's status-label accessibility repair was incorporated and the temporary repair workflow was retired. The exact final source was then exercised by the complete gate, not only by a narrow browser retry.

P08A's initial browser run had exposed a native-fetch receiver defect. The next exact-SHA run exposed a stale balance fixture assumption, a real WCAG contrast issue and fixture-authentication throttling. Each root cause was repaired, and the entire gate—not only the failed browser step—was rerun successfully.

## Remaining evidence

The customer adjustment interface, customer schedule/webhook interfaces, broader administrator interface, P09 complete F01–F08 and D01–D24 campaigns, P10 Pact/ZAP/k6/backup-restore/nightly/release lanes, and P11 final exploratory package/video remain incomplete.

No public application, release tag, security certification, whole-product accessibility conformance or measured performance claim exists. GitHub Actions results are the authority for Docker/PostgreSQL/RabbitMQ/Compose/browser execution.
