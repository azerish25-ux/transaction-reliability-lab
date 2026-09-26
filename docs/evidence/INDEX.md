# Evidence index — P04 verified, full product NO_GO

## Current P04 evidence

Verified implementation `60a95db82350983eaf1ad3c7545190866c831f98` passed [run 36276049817](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36276049817), including both verification and the required aggregate gate.

- [Durable human-readable P04 report](p04-60a95db.md)
- [Machine-readable result and report hashes](p04-60a95db.json)
- [Scoped P04 requirements/test-ID source](../implementation/P04_REQUIREMENTS.json)
- [Immediate transfer architecture and limits](../architecture/adr/0013-p04-immediate-transfers.md)

Actual results: 120 core JUnit, 13 security-configuration, 11 PostgreSQL financial, 58 authentication/account HTTP and 20 immediate-transfer HTTP cases passed. TypeScript passed 44 existing, 6 authentication and 7 transfer cases. Fifteen live Compose checks, six migrations, restricted runtime, two zero-discrepancy reconciliations, limited literal scan and teardown passed. The standalone 120-core run repeats CoreTest bodies and is not double-counted.

Raw artifact `10916927772` contains 56 files, 106,305 bytes and SHA-256 `f0eb46254f81208bf834ea54ac6888f29a91588de724c7b270a839cc0ff202f2`. It expires 2026-10-10. The durable reports preserve scope and provenance after expiry; each later candidate also generates its own P03/P04 requirement matrix.

## Preserved P03 and foundation evidence

P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed [run 36270965725](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36270965725); its [human-readable](p03-8ee1e1f.md) and [JSON](p03-8ee1e1f.json) reports retain original scope. Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed [run 36267641798](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36267641798); its [summary](fast-lane-cb993016.md) and [JSON](fast-lane-cb993016.json) remain unchanged.

Historical component records remain available under `component/` and `unit-probes/`. They are not relabeled as current integrated Dxx evidence.

## Honest failure history

P04's first run caught a dependency-boundary regression before Maven: the dependency-light standalone compiler rejected framework logging imports in the shared JDBC adapter. The corrected JDK logger and full rerun passed. P03 execution earlier caught a duplicate migration trigger, unintended ordinary-request CSRF rotation and an incorrect SQLSTATE test assumption. Foundation execution caught a command SQL ambiguity and startup connection-reset boundary. Failed runs remain linked in their phase reports and are not counted as required seeded-defect experiments.

## Remaining evidence

Transactional-outbox publishing, RabbitMQ payment workers/recovery, adjustments, schedules, webhooks, React, Pact, Playwright/axe, ZAP, complete F01–F08/D01–D24, full financial-history backup/restore, reference k6, nightly/release lanes and video remain incomplete. P04's test-only response-drop proxy is not a packaged production fault hook.

No public application, release tag, security certification, accessibility conformance or measured performance claim exists. GitHub Actions results are the current authority for Docker/PostgreSQL/Compose execution.
