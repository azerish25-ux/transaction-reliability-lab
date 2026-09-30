# Current delivery checkpoint

Repository: azerish25-ux/transaction-reliability-lab; single main branch.
UI observation fix `514552db900ea561b3ae8d20c2cc856a4d78321e` is remote-confirmed.
Its eight component tests and frontend verification pass; actual Chromium launch
was blocked by the executor's socket restriction. Publication did not rerun the
isolated fault workflow. Product source `d8d3656` has independently retained
[exact-source evidence](../evidence/product-d8d3656.md), while its lab gate failed.

See the [reviewer guide](../PORTFOLIO.md) and [current progress](PROGRESS.md).
Overall delivery remains INCOMPLETE / NO_GO; no final video/release is claimed.

## Historical records retain their original source scope

# Delivery record — P08F verified

## P08F verified delivery

Tested source `8802f8b20c9bf3996d19ba90e7be26fd123b7580` passed permanent run `36511855593` and **Required P08F gate**. Results: 159 JUnit unit, 140 PostgreSQL/HTTP integration, 186 TypeScript client, 147 Browser; zero required failures/errors/skips and zero functional browser retries. Nine validator regressions also passed. [Report](../evidence/p08f-8802f8b.md) and [provenance](../evidence/p08f-8802f8b.json) retain tested source, job/artifact identities, hashes and limitations. Later documentation commits preserve that result without relabeling the tested SHA. Only `main` is used; no force push or additional delivery branch was needed. Full product remains INCOMPLETE / NO_GO. P09 is next.

## Historical delivery records

The entries below preserve their original tested sources and limitations. Their former next-action statements are historical and superseded by the verified P08F checkpoint above.

# Delivery record — P08D verified

Repository: `azerish25-ux/transaction-reliability-lab`. Branch: `main`.
Verified implementation: `13bdd62c924a3230825b6d9304f449f887c8e7fe`.
P08D: `VERIFIED_PASS`. Full product: **INCOMPLETE / NO_GO**.

Permanent run `36464316280` and both required jobs passed. Artifact `10989063634` was downloaded and rehashed against GitHub's `sha256:7a4f2458e4e81e238332137aecc0e07452f5a3616b2c4cfb865602e94d4b672a`. The [report](../evidence/p08d-13bdd62.md), [JSON provenance](../evidence/p08d-13bdd62.json) and four attested screenshots retain the verified source and artifact expiry separately from this documentation commit.

Delivered: owner-scoped schedule management, version-aware lifecycle, immutable occurrences, pure temporal preview, preserved POST/PUT uncertainty recovery and responsive/accessible browser verification. Async-review focus restoration was repaired without weakening the earlier financial or browser gate. Customer webhook/admin interfaces and P09-P11 remain incomplete. No public deployment or release tag is claimed.

The following records retain their historical P08C/P08B implementation SHAs and counts.

## Preserved P08C delivery record

Repository: `azerish25-ux/transaction-reliability-lab`
Branch: `main`
Verified P08C implementation source: `3b87e3a078d7b9270b56964ed1c50dc299958379`
P08C result: `VERIFIED_PASS`
Full-product result: `INCOMPLETE / NO_GO`

## P08C GitHub delivery

Permanent `P08C verification` run `36436424432`, attempt 1, checked out the exact implementation SHA and passed on September 28, 2026. Verification job `108975429770` and required gate `108980532491` both succeeded.

The full run preserved P01-P08B and executed the P08C production-client, PostgreSQL/HTTP and responsive browser/accessibility evidence, with successful reconciliation, secret scan, requirements gate, teardown and artifact publication. The gate enforces zero failed/errored/skipped required cases, zero functional browser retries and a clean tracked source tree.

Artifact `10977005382`: `ledgerguard-p08c-evidence-3b87e3a078d7b9270b56964ed1c50dc299958379`, 3,521,926 bytes, GitHub-reported SHA-256 `7bf691dab89de39fd74912ba73d18377d06bc9fcb2f499ed29df7614aeba08e0`. Scheduled expiry: October 12, 2026 at 14:41:46 UTC. The archive was not independently rehashed for this documentation update.

See the [durable P08C report](../evidence/p08c-3b87e3a.md) and [machine-readable provenance](../evidence/p08c-3b87e3a.json). They distinguish the verified source SHA from the separate evidence-documentation commit and gate-enforced minima from exact generated counts.

## Delivered P08C boundary

Recipient-owner partial/full refunds; administrator payment lookup and full reversal with a mandatory reason; exact-money authoritative adjustment review; owner-safe paged history and immutable journal receipts; preserved same-key recovery after uncertain outcomes; and separate settlement/adjustment states. The administrator surface does not provide arbitrary balance editing or general customer spending permissions.

## Preserved P08B GitHub delivery

Verified P08B source: `5d6d883444845bc5de3364d0c682c3df26005d8e`.

Permanent `P08B verification` push workflow run `36355379901` completed successfully on September 27, 2026.

- Verification job `108721959438`: SUCCESS.
- Required gate `108723219635`: SUCCESS.
- Every mandatory frontend build, Java/TypeScript test, PostgreSQL integration, Compose validation, secret scan, P05–P07B regression, P08A/P08B browser/accessibility, reconciliation, evidence and teardown step succeeded.
- Artifact `10944390774`, `ledgerguard-p08b-evidence-5d6d883444845bc5de3364d0c682c3df26005d8e`, 1,732,590 bytes, SHA-256 `7fadf64bfff5689eea5ab0e4a933bc4b8bc3862f310bfdf8cefd0af6a6251d7f`.

Historical P08B results included 133 core/security JUnit cases, 124 PostgreSQL/real-HTTP integration cases, 91 TypeScript client/contract cases, 42 P05 Compose checks, 32 P06 Compose checks, 15 P07A Compose checks, 26 P07B Compose checks and 24 Chromium journeys. All required suites reported zero failures/errors/skips. Seven scoped P08B requirements were bound to executed evidence, 316 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

See the [durable P08B report](../evidence/p08b-5d6d883.md) and [machine-readable provenance](../evidence/p08b-5d6d883.json).

### Preserved P08B boundary

- Locked React/TypeScript/Vite product build.
- Non-root nginx frontend with loopback binding, health check and same-origin API proxy.
- Exact-money immediate transfer form, explicit confirmation and settled receipt.
- Owner-scoped intent/key preservation across response loss, reload and session expiry.
- Safe same-key replay proving one committed transfer effect and blocking conflicting replacement commands.
- Durable asynchronous payment acceptance, real outbox/RabbitMQ/two-worker settlement and authoritative status polling.
- Owner-visible payment history/detail with lifecycle, version, timestamps, adjustment state, projection and settlement/failure data.
- Pending-payment cancellation while both workers are deliberately stopped, with race-safe authoritative refresh.
- Desktop, tablet and mobile Chromium journeys with nine responsive screenshots across the P08A/P08B campaign.
- Authenticated axe WCAG A/AA checks and keyboard/focus behavior.
- Exact-SHA preservation of every P01–P08A financial and reliability proof.

## Remaining delivery

The original application remains **INCOMPLETE / NO_GO**. Customer webhook interfaces and the broader administrator interface remain open, followed by P09 complete fault/defect laboratory, P10 contracts/scanners/performance/backup-restore/nightly/release lanes and P11 final evidence/video. This delivery record does not claim a public deployment or release tag.

The next delivery unit is the customer webhook subscription/delivery interface against the existing P07B API. Preserve P01-P08D and verify integrated browser, authorization and recovery paths before the broader administrator interface and P09.

## Preserved prior delivery

P08A source `d675db096b8f023469e253737ade80a2b8b3b0fa` passed run `36345292129`. P07B source `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975` passed run `36330862462`. P07A source `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed run `36319414655`. P06 source `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed run `36306335283`. P05 source `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`. Their durable reports retain original scope and timestamps.


## P08E exact-source delivery

Implementation `026dca3ec4c3c68696e87f8192872a4d2e45e157` passed permanent run `36485630387` and Required P08E gate. Later evidence-documentation commits are separate from the tested source. See [report](../evidence/p08e-026dca3.md) and [provenance](../evidence/p08e-026dca3.json). Full product remains INCOMPLETE / NO_GO. Broader administrator interfaces are next.


## P08E exact-source delivery

Implementation `644022340c0f3277297ed205610e4227584e720a` passed permanent run `36499192991` and Required P08E gate. Later evidence-documentation commits are separate from the tested source. See [report](../evidence/p08e-6440223.md) and [provenance](../evidence/p08e-6440223.json). Full product remains INCOMPLETE / NO_GO. Broader administrator interfaces are next.


## P08F implementation checkpoint

The connected azerish25-ux Git data API successfully created checkpoint `644022340c0f3277297ed205610e4227584e720a` on main, establishing requirements and a temporary source-workspace exporter. No new branch or force update was used. Source workspace run `36499193005` succeeded and its downloaded archive matched SHA-256 `c5bc6c65464cd108a0db904bdc54b3ffe1a2f3440c34ecfe69e2b93f814c8cac`. The exporter and obsolete P08E handoff are retired in the implementation. Historical evidence files remain preserved.

P08F implementation and exact-source verification are distinct delivery states. Until the P08F required gate succeeds, the milestone is IMPLEMENTED_UNVERIFIED. Full product remains INCOMPLETE / NO_GO.

