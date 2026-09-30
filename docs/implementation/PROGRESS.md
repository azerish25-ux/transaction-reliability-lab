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
