# Evidence index — P03 verified, full product NO_GO

## Current P03 evidence

Verified implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed [run 36270965725](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36270965725), including both verification and required gate.

- [Durable human-readable P03 report](p03-8ee1e1f.md)
- [Machine-readable result and report hashes](p03-8ee1e1f.json)
- [Scoped requirements/test-ID source](../implementation/P03_REQUIREMENTS.json)
- [Authentication architecture and limits](../architecture/adr/0012-p03-authentication.md)

Actual results: 120 core JUnit cases, 13 security-configuration cases, 58 live HTTP authentication/account cases, 11 PostgreSQL financial integration cases, 44 existing plus six new TypeScript cases and nine separate live Compose checks. All passed. Core bodies also ran standalone and are not double-counted. Six migrations, restricted runtime, synthetic fixture login, two independent zero-discrepancy reconciliations, limited literal scan and teardown passed.

Raw artifact `10915292636` contains 50 files, 92,336 bytes and SHA-256 `11df5bea2eae448180c1ba5b254bb94e79fbadc044b41ef510a9d20de1a215f4`. It expires 2026-10-10; the durable reports preserve scope and provenance. Per-candidate CI artifacts additionally include the generated test/requirement matrix after the traceability update.

## Preserved P01/P02 and earlier component evidence

The earlier foundation source `cb9930168ffdc793a5759f754a39685369620422` passed [run 36267641798](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36267641798). Its [human-readable](fast-lane-cb993016.md) and [JSON](fast-lane-cb993016.json) records retain their original five-migration/120-Java/44-TypeScript/11-PostgreSQL scope.

Historical component records remain: [Java XML](component/java.xml), [client XML](component/client.xml), [combined log](component/unit.log), [unit-probe summary](unit-probes/summary.json) and [scoped bug reports](../testing/bugs/README.md). These are not relabeled current full-stack Dxx evidence.

## Honest failure history

P03 execution caught a duplicate migration trigger, an ordinary-request CSRF rotation defect, and an incorrect test SQLSTATE assumption. The P03 report links failed source/run identities and the passing correction. Earlier foundation execution caught financial-command SQL ambiguity and a startup connection-reset boundary. No failed run is hidden or counted as a successful seeded-defect experiment.

## Remaining evidence

Live transfer/payment HTTP workflows, RabbitMQ publisher/consumer recovery, webhook delivery, scheduler execution, the React UI, Pact, Playwright/axe, ZAP, complete F01–F08/D01–D24, full financial-data upgrade/backup restore, reference k6, nightly/release lanes and video remain incomplete. The P03 V5-to-V6 user/account preservation test does not replace the full financial-history migration campaign. Prepared exploratory charters are not claimed as performed human testing.

No public application, release tag, security certification, accessibility conformance or measured performance claim exists. Environment limitations from earlier local attempts remain historical; actual GitHub Actions results are the current evidence for Docker/PostgreSQL/Compose execution.
