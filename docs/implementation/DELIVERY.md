# Delivery record — P04 verified

Repository: `azerish25-ux/transaction-reliability-lab`  
Branch: `main`  
Verified P04 source: `60a95db82350983eaf1ad3c7545190866c831f98`  
Source tree: `7dcea7445209a501a9a036e5d9170224ea623ba4`

## GitHub delivery and ancestry

The authorized owner-linked Git-data route created ordinary commits and moved `main` only through non-forced fast-forward updates. The remote branch, push-triggered workflow, jobs and artifact were reread after publication.

P04 commits:

1. `9847369369fcb8ae685dfc6fe6fe910070a8160b` — immediate transfer API/read boundary, client intent recovery, OpenAPI, two-process PostgreSQL tests, Compose smoke and CI evidence gate; parent `5d1c1474e0c020763cf2e35bc05e04907c286237`.
2. `60a95db82350983eaf1ad3c7545190866c831f98` — retain dependency-free standalone core compilation by replacing SLF4J retry logging with JDK `System.Logger`.

The documentation/evidence checkpoint follows the tested implementation and has its own CI identity. No force-push, unrelated branch or release tag was used.

## Verified workflow

- Workflow: `LedgerGuard fast verification`.
- Run: [36276049817](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36276049817).
- Event: `push`; exact head SHA `60a95db82350983eaf1ad3c7545190866c831f98`.
- Verification job `108498899419`: SUCCESS, 2026-09-26 22:22:20–22:26:28 UTC.
- Required gate `108499548289`: SUCCESS, completed 22:26:32 UTC.
- Every mandatory step ran successfully; none was skipped.

Executed results: 120 core JUnit, 13 configuration, 11 PostgreSQL financial, 58 actual HTTP authentication/account and 20 actual HTTP transfer cases passed with zero failure/error/skip. TypeScript passed 44 existing, 6 authentication and 7 transfer cases. The same 120 core bodies also passed standalone and are not additional unique tests. Fifteen live Compose P04 assertions, six migrations, two reconciliations, secret scan and teardown passed.

See [durable P04 report](../evidence/p04-60a95db.md) and [JSON provenance](../evidence/p04-60a95db.json).

## Artifact

- ID `10916927772`.
- Name `ledgerguard-fast-evidence-60a95db82350983eaf1ad3c7545190866c831f98`.
- 56 files; 106,305 bytes.
- SHA-256 `f0eb46254f81208bf834ea54ac6888f29a91588de724c7b270a839cc0ff202f2`.
- Created 2026-09-26 22:26:25 UTC; expires 2026-10-10 22:26:24 UTC.
- Downloaded archive hash, report counts and smoke result were inspected.

The artifact contains XML reports, generated P03/P04 requirement evidence, process/Compose logs, safe smoke results and limited secret-scan output. Private runtime credentials and cookie values are not published.

## Preserved prior delivery

P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`, and evidence commit `5d1c1474e0c020763cf2e35bc05e04907c286237` passed `36271372093`. Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`. Their durable evidence retains original scope and timestamps.

## Delivery boundaries

P04 source, API contracts, startup, regression tests, immediate-transfer reliability proofs and permanent fast CI lane are delivered. The full original application remains INCOMPLETE / NO_GO. There is no public full-stack deployment, release tag, asynchronous payment worker, React interface, complete scanner/performance/restore campaign or final video. Docker-dependent execution occurred on GitHub Actions; no local Docker result is claimed.
