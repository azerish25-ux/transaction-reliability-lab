# 2026-10-03 product presentation checkpoint — IMPLEMENTED_UNVERIFIED

Bad Penny now uses one shared navigation shell with explicit active destinations,
route-change focus, consistent customer/administrator controls and no navigation
portals or DOM observers. The copper/paper visual system emphasizes available
money, reservation context and inspectable references. Wallet references can be
read and copied on touch screens. A same-wallet comparison defect in both
transfer/payment forms is corrected with case-insensitive reference comparison.

Local TypeScript checks and 187 client cases pass. The production frontend build
passes. The new presentation suite has 33 desktop/tablet/mobile browser cases,
including keyboard dismissal, Back/Forward, auth, copy failure, 320-pixel layout,
loading and error states, with axe checks and screenshot retention. Chromium
could not start locally: `socket() failed: Operation not permitted`, also after
one supported permission escalation. These attempted tests are **BLOCKED**, not
passes or evidence of the UI defect. The Java runtime lacks `javac`, so ordinary
core verification is delegated to the unchanged Java 21 CI toolchain.

A separate presentation workflow adds fixture-based UI evidence; it does not
replace or weaken any real PostgreSQL/RabbitMQ/product/lab gate. Visual acceptance
requires actual screenshot inspection and a successful exact-source browser run.
See [portfolio checklist](PORTFOLIO_CHECKLIST.md). Full project remains
**INCOMPLETE / NO_GO**; F01–F08/D01–D24, P10 and P11 are not completed by UI work.

## Earlier source-bound progress

## 2026-09-30 — Reference history and disposable restore implementation

Added a reproducible minimum reference-history generator (100 customers, 200 wallets, 100000 protected journals), six passing deterministic generator tests, and a compiling ordinary PostgreSQL integration test for real counts/reconciliation plus backup/restore fingerprints, audit continuity and old-key replay. Dataset-profile Java unit suite passed (165 cases). Live SQL loading/restore has not run because Docker is unavailable; no benchmark or migration-upgrade acceptance is claimed. Independent manual `history.yml` workflow retains only non-secret evidence. See [PERFORMANCE_HISTORY.md](PERFORMANCE_HISTORY.md). Full project remains NO_GO.

## 2026-09-30 — Webhook wire and incompatible-schema contracts

Verified the real sender wire builder against the real receiver signature/body boundary with deterministic synthetic fixtures. Extracted only wire construction; destination validation, delivery and persistence behavior remain intact. Replaced the proxy-dependent sensitivity diagnostic with genuine in-memory Pact JVM matching of the actual generated consumer contract. It accepts the compatible response and rejects numeric money in place of a decimal string. Both focused tests passed; the final combined run passed 168 Java unit/contract cases, one real message-provider interaction, five Pact JS interactions, 186 existing client cases, type checks and the frontend build. Live PostgreSQL provider and hosted acceptance remain pending; no full-project GO claim.

## 2026-09-30 — Actual publisher/worker Pact message boundary

Added a genuine Pact JVM asynchronous consumer through the real Rabbit listener method and message-provider verification through the real outbox serializer. Both focused local interactions passed without skips. SQL and broker transport are isolated collaborators, so this proves message compatibility only, not live settlement/reliability. The ordinary manual workflow now includes this contract pair. Full project and live HTTP provider acceptance remain pending; see [CONTRACTS.md](CONTRACTS.md).

## 2026-09-30 — P10 real Pact HTTP contract slice

Implemented actual-client Pact JS consumer generation (five interactions), Pact JVM verification sources for the real normal Spring API with PostgreSQL-backed provider states and real session/CSRF setup, and an independent manual-only contract workflow. Local consumer generation and contract-profile package compilation passed. Live provider acceptance is pending Docker/hosted execution; the synthetic schema-sensitivity script was blocked by Pact JS local-provider proxy handling. See [CONTRACTS.md](CONTRACTS.md) for exact scope, commands and run button. This is partial P10 implementation, not P10 acceptance or full-project readiness. No restricted lab workflow was triggered.

## 2026-09-30 — Product display branding

Updated the customer/admin display name, document titles and synthetic-identity copy to Bad Penny, with BP brand marks. Existing LG public references, session-cookie names and API compatibility remain unchanged. `npm --prefix frontend run verify` passed (type checks, all 186 existing client cases and production build). Fresh live browser acceptance remains outstanding; this commit does not change the overall NO_GO verdict. Publication uses `[skip ci]` to avoid starting the restricted coupled lab workflow.

# Reviewer guide and durable product evidence

Added seven source-controlled rendered diagrams (runtime, financial ER, payment
state and four transaction sequences), a current chart-of-accounts/lock-boundary
explanation and a concise reviewer guide. Stale architecture prose claiming the
API, consumer and reconciliation did not exist has been replaced with source-bound
current facts. Diagram previews and two unmodified CI screenshots were inspected.

Product source d8d3656: 165 Java unit, 140 PostgreSQL/HTTP, 186 TypeScript client and
147 browser cases passed with zero failures/errors/skips. The downloaded artifact
matched GitHub's digest. Selected screenshots and readable provenance now survive
artifact expiry. The same workflow's laboratory gate failed, and later UI repair
514552d is not relabelled as a live pass. Reviewer links, SVG safety/structure,
sequence definitions and retained screenshot hashes pass the local checker.

Full product remains INCOMPLETE / NO_GO. No new lab execution, exploratory session,
performance/security certification or four-minute demo video is claimed. Those
remaining deliverables are not replaced by this documentation batch.

# Accepted-run UI synchronization repair

Status: **IMPLEMENTED_UNVERIFIED** for live browser integration. Full product: **INCOMPLETE / NO_GO**.

Read-only inspection of [run 36656046918](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36656046918)
confirmed that source `d8d365690d961580d22105feb15ddec3267185ae` passed the full product job
and Required P08F gate, while the isolated browser campaign failed at
`D01_AWAIT_REAL_VERDICT / ASSERTION_FAILURE`. The P09A gate correctly failed.

D01 follows D06 and both display DETECTED. The old assertion could accept D06's
still-visible terminal status before the newly submitted request returned. A
synthetic regression reproduces that premature acceptance. Completion now binds
to the exact HTTP 202 receipt ID, expected scenario, visible verdict and evidence
run ID. All five existing observations use the same helper. No expectation was
relaxed and no fault implementation changed.

Eight deterministic DOM-adapter tests pass, including repeated same-scenario
runs, stale IDs, wrong receipts and mismatched evidence. Frontend type checks,
client contract tests and production build pass. The actual Chromium synthetic
fixture is retained, but its launch was blocked by this executor's socket
restriction. The supported escalation route returned the same runtime failure.
No live browser or lab pass is claimed by these component tests. Full lab CI was
not rerun in this delivery. [Exact changed-file hashes](ui-run-identity.json).

## Earlier source-bound checkpoints

# D01 duplicate-idempotency experiment — IMPLEMENTED_UNVERIFIED

The disposable command-function variant remaps the incoming key to a fresh
identity before the normal command logic. Identical replay therefore creates a
second actual transfer/journal. The unchanged three-phase HTTP/SQL oracle requires
one returned operation and no additional economic effect; detection additionally
requires raw independently hashed balances to show exactly one extra debit/credit
and journal. A mere changed response ID or setup error cannot count. Guardian
allowlists, backup/read-back, same-seed fixtures, ADMIN/browser control and retained
failing JUnit are integrated. Normal financial code/migrations remain unchanged.

274 local component tests pass, including ten new mutation/evidence regressions.
Actual baseline/mutant/restoration execution and same-source product/lab gates
remain required. Six faults, 21 other defects, P10/P11 remain open. Continue fixing
live CI before making milestone claims; never convert component fixtures to live
evidence. Mutant synthetic postings are retained in the disposable instance and
are not described as repaired by code restoration.

# Catalogue authentication-budget correction — IMPLEMENTED_UNVERIFIED

D06's real broker experiment detected the intended duplicate-money assertion on
7424a1b (run 36654638819); F01/F02 and D02 also passed their real experiments and
the four browser journeys completed. The final lifecycle expiry test then timed
out before activation. The expanded campaign attempts eleven Alice logins inside
the unchanged ten-per-five-minute identity budget: four CLI runs, four browser
runs, one customer-denial login and two lifecycle runs.

The experiment worker now reuses its fixture session in memory, verifies it via
actual /auth/me before each experiment, and reauthenticates once only on explicit
401. Dependency errors and rate limits never trigger credential retry. No auth
limit is raised and no credentials enter saved state/evidence. Lifecycle waits
now retain a premature terminal report and fail immediately instead of hiding
its cause behind a generic timeout. 264 local component tests pass; the corrected
same-source live campaign is still required. The previous failure is not counted
as a completed P09 milestone. All remaining scope stays open.

# G12 receiver isolation repair — IMPLEMENTED_UNVERIFIED

A further release review found active delay/status/accept-then-fail webhook modes
in the normal receiver. They now live exclusively in a verification-only provider.
The normal receiver fails closed with 403 for every non-NORMAL mode, even in the
sandbox. The product smoke campaign sends validly signed requests under all five
forbidden modes against the normal image and requires no receipt side effect,
then explicitly switches to a separately named verification image for the
existing failure/recovery tests. Browser fault tests retain that explicit image.
Normal and verification Maven outputs remain separate.

165 Java unit tests and both Maven package variants passed locally; 258 Python
component tests passed. Full exact-source product/lab CI remains required.
The prior process-death isolation source f1c8235 passed both required CI gates in
run 36653129350. Global G12 is not yet declared closed. D06 source 7424a1b is being
verified independently; six fault scenarios, 22 mutants and P10/P11 remain open.

# D06 duplicate-message protection cut — IMPLEMENTED_UNVERIFIED

D06 is now an explicitly guarded mutation of the disposable settlement function.
For already settled replay only, the variant bypasses inbox/state protection and
uses a fresh journal operation identity. This documents all defenses intentionally
cut; ordinary migrations and normal release source are unchanged. A guardian
backup/hash/read-back and bounded lease restore the exact original function.
External teardown independently verifies both mutated functions.

The same real broker/independent SQL test runs against baseline, mutant and restored
code using identical economic intent/seed and fresh phase-local payment fixtures.
It detects extra source debits/destination credits and two additional journals,
retaining the actual failing mutant JUnit. Raw snapshots and hashes, identical
message bytes, acknowledgements, code hashes and exact deltas are mandatory.
Mutant synthetic postings remain in the isolated disposable database as evidence;
restoring code never claims to repair or reverse those transactions.

258 component tests pass locally. This does not establish a live D06 detection.
F02 predecessor b278e3d passed its isolated real-stack lab job, including browser
and restoration; same-source product CI is still running. The full project
remains INCOMPLETE / NO_GO, with six faults and 22 other defects plus P10/P11 open.

# F02 real-broker expansion — IMPLEMENTED_UNVERIFIED

The isolated topology now includes its own RabbitMQ and normal payment worker.
F02 reads the actual durable payment event, publishes identical bytes and message
identity through the real broker twice, waits for queue acknowledgements, and
checks one immutable settlement/inbox plus unchanged independent financial
snapshots. Baseline and restored delivery use the same event. The ADMIN console,
CLI, browser campaign, complete evidence validator and image manifest include
F02. All targets are fixed; no broker credential or arbitrary publish endpoint
is exposed by the console. Cancellation/deadline checks bound every publication
and polling loop. There is no persistent F02 mutation to reset.

244 local component tests pass, including 14 new broker/provenance negatives.
These are component evidence, not a live F02 pass. The next exact-source CI must
execute the actual broker and browser journey before F02 can be VERIFIED_PASS.
G12 predecessor f1c8235 passed 162 Java unit tests, both normal and verification
Maven packaging and normal-artifact scanning locally; its live CI is ongoing.
D06, the remaining faults/defects, P10/P11 and global G12 closure remain open.

# G12 process-death artifact separation — IMPLEMENTED_UNVERIFIED

Active JVM termination code now lives only in the explicit Maven `verification`
profile, with separate source/resource directories, build output and Docker
image names. Normal `WorkerFaults` has no provider and fails startup if either
crash property is requested, even with sandbox enabled. The normal-artifact
scanner rejects verification classes and service registrations, including nested
archives. Existing real publisher/consumer death-and-recovery proofs remain,
using the explicit verification image. The smoke campaign additionally attempts
both forbidden flags against normal images before building verification images.

Local checks and exact-source CI remain required before G12 can close. Do not
confuse these implemented checks with an executed Docker pass. P09A's historical
verified evidence remains source-bound below. Remaining 30 P09 scenarios and
P10/P11 are open. Continue F02/D06 after validating this separation.

# P09A exact-source verification — VERIFIED_PASS

Synthetic money only. Full product remains **INCOMPLETE / NO_GO**.

Tested source: `1d7c443c7537c1a647e60c583832beef3be1de63`.
[Run 36589948377](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36589948377)
passed the product campaign, isolated laboratory, Required P08F gate and Required
P09A gate on that same source. The downloaded lab artifact 11043667085 matched
GitHub's SHA-256 digest. Its original files are retained without rewriting.

- F01 actual HTTP/PostgreSQL/Toxiproxy baseline, injected fault and restoration passed
- D02 actual HTTP/PostgreSQL baseline, intended mutant assertion and restoration detected the seeded defect
- Eight browser and authorization checks passed
- Controller SIGKILL recovery and automatic mutant expiry passed
- Scoped P09A packaging exclusion passed; **global G12 remains open**

[Provenance](p09a-1d7c443/provenance.json), [summary](p09a-1d7c443/summary.json),
[browser](p09a-1d7c443/browser/results.json), [lifecycle](p09a-1d7c443/lifecycle.json).
The expected failing mutant JUnit is preserved, not counted as a product failure
or rewritten to pass. Screenshot integrity does not establish visual approval.

This evidence closes P09A only. F02–F08, D01/D03–D24, P10, P11 and G12 remain open.
Next work is expanded fault/defect coverage and release-artifact isolation.

## Earlier checkpoints retain their original scope

# P09A recovery evidence repair — IMPLEMENTED_UNVERIFIED

Overall product: **INCOMPLETE / NO_GO**. This change addresses the confirmed
`EVIDENCE_LIFECYCLE_VERDICT_INVALID` failure on parent
`ea4cd5e582b1d82bd335bcffeb3c70119bd90833`, Actions run `36566324545`.
`Runner.recover()` omitted `instanceId` from interrupted-run reports, while the
artifact gate correctly required the same instance as the F01/D02 experiments.

Execution and recovery now use one small result-identity builder for source SHA,
clean/dirty status, instance, durable run ID, scenario, seed and schema version.
Recovery still records `CANCELLED` only after acknowledged restoration, retains
empty phases rather than invented experiment results, and leaves failed cleanup
as `CLEANUP_FAILED`. The artifact validator is unchanged; historical artifacts
are not repaired, relabelled or counted as a new candidate pass.

Thirteen new tests in `tests/test_p09a_recovery_evidence.py` exercise the actual
recovery producer, SQLite store, `collect_result` serializer, JUnit/manifest
writer and complete artifact gate. They reuse explicitly synthetic surrounding
campaign fixtures and guardian acknowledgements; these do not count as real
controller-death, F01 or D02 evidence. Negative cases retain rejection of absent
or wrong instance/source identity, dirty source, bad restoration and JUnit
modification even after rehashing. Additional cases cover queued interruption,
cleanup timeout, missing acknowledgement, terminal-report preservation and
cancellation not qualifying as a defect detection.

Local Python syntax checks and isolated recovery-method probes passed, including
reproducing the missing-instance defect against the exact original runner blob.
The full component suite and real-stack verification must execute on this new
candidate in the existing GitHub Actions workflow. No product code, workflow,
financial assertion, evidence gate or normal-build isolation rule is weakened.

Next: require both product and isolated-lab jobs, plus `Required P09A gate`, to
pass on the same immutable candidate and retain the actual source-bound report.
Until then P09A remains **IMPLEMENTED_UNVERIFIED**. Global G12 release isolation,
F02–F08, the other 23 Dxx variants, P10 and P11 remain open.

## Preserved hardening checkpoint

The records below retain their original source identities and verification scope.

# P09A hardening integration — IMPLEMENTED_UNVERIFIED

Overall product: **INCOMPLETE / NO_GO**. This delivery recovers the saved local
hardening commit `724b055067e53a06eaf7b16affda3131d324d0ac` onto remote parent
`4acb6925fabc7f1f4d81f34563eb20d757931420`, preserving all intervening changes.
The seven implementation/test files retain their saved blob identities. The
README and progress records merge, rather than replace, concurrent documentation.

The changes enforce cancellation and deadline checks under the store write lock,
recheck leases before activation and after external IO, immediately restore
rejected activations, bind recorded inputs and lifecycle reports to their actual
artifacts, inspect bounded nested archives and validate proxy target read-back.
There are 52 additional regression tests. Financial posting code, normal
migrations, product UI, newer browser corrections and workflow configuration are
unchanged by this delivery. See the [hardening review](../../lab-support/p09a/INTEGRATION_REVIEW.md).

The saved source passed **215 component tests** (116 original + 47 concurrent +
52 new). Its full P09A command stopped with `DOCKER_ENGINE_AND_COMPOSE_REQUIRED`.
Neither that component result nor a successful GitHub ref update establishes a
same-candidate product/lab pass. Historical evidence and integration observations
below retain their original source identities; they are not relabelled as results
for this new commit. Later retained observations are also available in
[P09A_INTEGRATION.md](P09A_INTEGRATION.md) and
[the source-bound live report](../evidence/p09a-b6d291a-live.md).

Next: execute and fix the required product and lab campaigns on the delivered
commit, retain exact-source results and complete remaining normal-release
isolation. **G12 remains open.** Only after verification closure extend the lab
with F02/D06. The remaining 30 P09 scenarios, P10 and P11 remain incomplete.

## Preserved concurrent integration checkpoint

The following checkpoint is historical; its “current implementation candidate”
and verification statements apply to its recorded source, not this delivery.

# P09A integration — IMPLEMENTED_UNVERIFIED

Overall product: **INCOMPLETE / NO_GO**. The F01/D02 laboratory is delivered on `main`; its real-stack integration is being verified. Do not restart P09 from scratch or treat the earlier P08F pass as a pass for new code.

Current implementation candidate: `b6d291a57eaeb35aae3d48fff0319552dcfae6c7`, [run 36560099620](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36560099620). The full integration record, actual failing runs, source identities and remaining isolation blocker are in [P09A_INTEGRATION.md](P09A_INTEGRATION.md).

Delivered corrections include concurrent same-candidate product/lab CI with unchanged required gates, sanitized restoration diagnostics, complete JUnit and PNG integrity validation, source/build/image/instance provenance, the Toxiproxy listener normalization fix, and loopback console publication through a controller-only bridge. Normal financial code and migrations were not modified by these corrections.

Verification established so far: 47 newly added component tests passed locally. The real lab job on `92a2563ee302df843eb47a5a461fbeae0db10440` passed all 163 component tests, frontend verification, Maven packaging and P09A-specific normal-artifact checks. Guardian startup and physical teardown restoration then passed, exposing a separate host-console connection failure. The console-topology correction is in the newer candidate above; an in-progress run is not a pass. The full product campaign and Required P08F gate passed separately on historical source `cc49976f576bc95038aaad5a66e82e5333b9ef8c` in run `36557255628`; that source's lab gate correctly failed.

## Next executable action

Complete `./scripts/lab test p09a` on one clean source: fix observed integration failures, execute real F01 and D02 baseline/mutant/restoration, browser/authorization and death/expiry tests, and validate the retained evidence. Both product and isolated-lab jobs must succeed before P09A becomes VERIFIED_PASS. Then implement F02/D06. Global G12 remains open because legacy active fault hooks still compile into normal artifacts; preserve existing recovery tests while separating them. The other 30 P09 scenarios, P10 and P11 remain incomplete.

## Preserved P08F checkpoint

The historical records below retain their exact tested sources and scopes. Their old next-action statements are superseded by the P09A checkpoint above.

# P08F administrator investigation — VERIFIED_PASS

Overall product: **INCOMPLETE / NO_GO**. P08F is a verified development milestone, not a complete product release.

## Exact-source verification

Implementation `8802f8b20c9bf3996d19ba90e7be26fd123b7580` passed permanent **P08F verification** run `36511855593`, including **Required P08F gate**. Executed totals: 159 JUnit unit, 140 PostgreSQL/HTTP integration, 186 TypeScript client, 147 Browser. Required failures, errors and skips were zero; functional browser retries were zero. The gate also executed nine evidence-validator regression tests.

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

Implementation `644022340c0f3277297ed205610e4227584e720a` passed permanent **P08E verification** run `36499192991`, including **Required P08E gate**. Tracked source was clean, required failures/errors/skips were zero, and functional browser retries were zero.

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
