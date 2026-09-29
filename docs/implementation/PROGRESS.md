# P08F administrator investigation — VERIFIED_PASS

Overall product: **INCOMPLETE / NO_GO**. P08F is a verified development milestone, not a complete product release.

## Exact-source verification

Implementation `8802f8b20c9bf3996d19ba90e7be26fd123b7580` passed permanent **LedgerGuard P08F verification** run `36511855593`, including **Required P08F gate**. Executed totals: 159 JUnit unit, 140 PostgreSQL/HTTP integration, 186 TypeScript client, 147 Browser. Required failures, errors and skips were zero; functional browser retries were zero. The gate also executed nine evidence-validator regression tests.

P08F contributes 12 Java validation/authorization unit cases, 13 real PostgreSQL/HTTP integration cases, 24 production-client cases, 30 administrator browser journeys and three additional responsive table/keyboard cases. Seven requirements and fifteen responsive screenshots are bound to the clean tested source. [Durable report](../evidence/p08f-8802f8b.md), [JSON provenance](../evidence/p08f-8802f8b.json), and [requirements matrix](../evidence/p08f-8802f8b/requirements-matrix.md).

## Delivered scope

ADMIN-only transaction search with reference, kind, status, account/user, currency, exact amount and UTC filters; immutable journal and linked adjustment/event/failed-work detail; separately labelled redacted financial audit history; independent eight-category read-only reconciliation with saved immutable snapshot reports; same-report UUID recovery across reload and reauthentication; existing failed-work inspection and explicitly confirmed replay.

The financial command path and migrations are unchanged. Investigation is not a balance editor. Reconciliation never silently repairs money, and an old report never represents current live health. Ordinary audit reads state NOT_CHECKED; the scoped reconciliation executes hash-chain verification.

## Corrections and evidence discipline

The implementation cycle corrected numeric event/audit ordering, accessible filter names and narrow-screen table/navigation behavior. Final evidence validation now accounts for the separate layout suite and all thirteen integration identities. Its own regression tests reject missing, duplicate, failed, skipped, retried and wrong-project evidence. No product assertion was removed to obtain a passing gate.

GitHub verified the full campaign on the implementation SHA above. Later documentation commits only retain and describe that result; they are not substituted for the tested SHA. Raw CI artifacts have finite retention. Curated evidence and representative screenshots are retained in Git.

## Next executable action

Begin **P09**: isolated F01-F08 resilience faults, D01-D24 seeded defects, the lab-only console and the baseline/mutant/restoration runner. Preserve the P01-P08F campaign. P10 contracts/security/performance/restore and complete CI lanes, and P11 final exploratory/evidence/video/release work remain open.

## Historical checkpoints

Historical records below retain their own tested source and scope; their old next-action statements are superseded by this checkpoint.

## Preserved P08E history

# P08E customer webhook interface — VERIFIED_PASS

Overall product remains **INCOMPLETE / NO_GO**. P01–P08E retain exact-source verification; broader administrator interfaces and P09–P11 remain incomplete.

## Exact-source checkpoint

Implementation `644022340c0f3277297ed205610e4227584e720a` passed permanent **LedgerGuard P08E verification** run `36499192991`, including **Required P08E gate**. Tracked source was clean, required failures/errors/skips were zero, and functional browser retries were zero.

Executed totals: 147 JUnit unit, 127 PostgreSQL/HTTP integration, 162 TypeScript client, 114 Browser. Seven P08E requirements and twelve responsive screenshots passed. Durable evidence: [report](../evidence/p08e-6440223.md), [provenance](../evidence/p08e-6440223.json).

## Delivered P08E scope

Approved customer subscriptions, version-aware enable/disable and rotation, transient one-time secret disclosure, owner-scoped delivery/attempt history, bounded polling and audited retry. Atomic command receipts prevent lost-response recovery from rotating again or opening another retry cycle. Original non-secret command metadata survives reload and reauthentication. Real responsive browser/SQL oracles verify ownership, concurrency, receipt immutability and financial isolation. Legacy P07B and the full earlier campaign remain preserved.

The documented P07 overlay activates V11 and the signed receiver/dispatchers. See `P08E_REQUIREMENTS.json`, ADR 0022 and `/api/v1/openapi/p08e-ui.json`.

## Next executable action

Complete broader administrator transaction search, ledger detail, audit history and reconciliation interfaces. Preserve P01–P08E, execute real authorization and responsive browser journeys, and retain a successful permanent gate against the exact final source SHA. Do not begin P09 until the remaining P08 interfaces are verified. No individual milestone completes the whole product.

## Preserved P08D checkpoint

P08D implementation `13bdd62c924a3230825b6d9304f449f887c8e7fe` passed permanent run `36464316280`, including Required P08D gate. Executed totals: 139 JUnit unit, 127 PostgreSQL/HTTP integration, 134 TypeScript client and 84 browser cases; required failures/errors/skips and functional retries were zero. Eight P08D requirements and twelve screenshots passed. These results belong to that historical SHA, not automatically to P08E.

The checkpoint includes versioned customer schedules, temporal previews, occurrence history and POST/PUT uncertainty recovery. Durable report: `../evidence/p08d-13bdd62.md`; machine-readable provenance: `../evidence/p08d-13bdd62.json`.

## Earlier exact-source evidence

P08C `3b87e3a078d7b9270b56964ed1c50dc299958379`, run `36436424432`: `../evidence/p08c-3b87e3a.md` and `.json`. P08B `5d6d883444845bc5de3364d0c682c3df26005d8e`, run `36355379901`: `../evidence/p08b-5d6d883.md` and `.json`. Full evidence index and release-readiness document remain authoritative for their explicitly stated scopes; no individual milestone completes the whole product.
