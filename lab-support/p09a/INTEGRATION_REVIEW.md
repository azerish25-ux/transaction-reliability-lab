# P09A integration-hardening review

Status: **IMPLEMENTED_UNVERIFIED**. Full product: **INCOMPLETE / NO_GO**.
Initial reviewed base: `b4185db03f72df97c77d82f0b18f25bc42af518a`.
Integrated parent: `b6d291a57eaeb35aae3d48fff0319552dcfae6c7`; its concurrent
changes and 47 tests are preserved rather than attributed to this patch.
This report concerns actual defects in the laboratory and its evidence gate, not
invented production incidents or newly completed Fxx/Dxx experiments.

## Corrections

### H01 — stale run authorization at fault admission

`Store.request_fault` previously read cancellation/deadline before acquiring its
SQLite write transaction. A cancellation and acknowledged restoration could
complete between those operations, leaving the cached run eligible to activate.
The corrected implementation reads the run, deadline, scenario and lease together
inside the write transaction. The deadline is exclusive (`now >= deadline`).

Regression identities:
`test_cancelled_run_is_rechecked_after_acquiring_write_lock`,
`test_deadline_is_rechecked_after_acquiring_write_lock`,
`test_deadline_is_exclusive`.
The boundary tests use the actual SQLite store and deterministic interleavings.

### H02 — activation and acknowledgement after lease expiry

`Guardian.tick` previously checked safety only before driver IO. Resetting the
baseline or activating the fault could outlast the twenty-second lease without
changing its generation; the generation-only acknowledgement would then accept
an expired activation. Cancellation during baseline restoration could also permit
a needless activation before the later CAS rejected it.

The guardian now rechecks the same generation/run after baseline restoration and
before activation. Acknowledgement transactionally rechecks desired mode,
generation, run status, cancellation, expiry and worker liveness after IO. Rejected
or stale activation is physically restored and read back before returning, not
left for the next polling tick. No SQLite transaction is held across external IO.

Regression identities:
`test_preparation_cannot_activate_a_lease_that_expired_during_io`,
`test_cancellation_during_preparation_prevents_activation`,
`test_expiry_during_activation_is_restored_before_tick_returns`,
`test_worker_loss_during_activation_is_not_acknowledged`,
`test_acknowledgement_checks_expiry_inside_write_transaction`,
`test_acknowledgement_rejects_a_different_mode_for_same_generation`.
These driver tests use explicit fakes; they are not container-kill or real-database proof.
A lease is not a hard-real-time shutdown guarantee: external cleanup IO remains bounded
by its own existing timeouts and must still be verified against real services.

### H03 — unrelated/missing JUnit assertions accepted as defect evidence

At the initial base, the gate checked suite counters and testcase count but not their actual contents.
Removing the mutant failure node, replacing its assertion identity, changing its
source property, or duplicating cases still passed after recomputing file hashes.

The concurrent parent added semantic JUnit comparison. This change retains that
shared validator and extends its use to lifecycle reports: canonical XML content
must match the deterministic serialization of the corresponding verdict.
Insignificant XML attribute ordering is not a failure. This preserves the
actual failing business assertion, phase identities, source/run properties and
error classification. Lifecycle artifacts also use the manifest/hash/XML checks;
restoration requires actual matching function hashes and cleared proxy state.

Regression identities include:
`test_missing_real_failure_cannot_hide_behind_suite_counter`,
`test_wrong_failing_assertion_is_rejected_even_after_rehash`,
`test_wrong_junit_source_is_rejected_even_after_rehash`,
`test_duplicate_testcases_are_not_valid_coverage`,
`test_lifecycle_artifact_hash_is_verified`,
`test_lifecycle_requires_physical_function_hashes`.
These tests construct synthetic artifacts to exercise the real validator. They do
not establish execution of the observations inside those fixtures. Hashes and
internal consistency are not a substitute for trusted exact-candidate CI execution.

### H04 — recorded input and route observations insufficiently bound

The old validator accepted arbitrary recorded input as long as phase hash strings
looked valid. F01 could also carry inconsistent per-phase input hashes or a
`proved=true` route whose recorded client address was not a proxy address.

Qualified results now require the recorded seed, instance, run-scoped request key,
and input dictionaries. Every phase hash must equal the hash of that recorded
input. F01 route observations must name the disposable instance database, actual
proxy addresses, positive backend PIDs and the target JDBC application name.
The live oracle remains the source of observations; the validator does not create
new observations or label fabricated fixtures as executed evidence.

### H05 — nested normal-build archives skipped

`packaging.py` previously skipped every nested JAR on the assumption that its name
made it a trusted third-party dependency. A nested archive could therefore contain
P09A controls. Path-only leakage could also evade content-token checks.

The checker now examines nested JAR/ZIP archives, including renamed ZIP payloads,
and rejects known P09A source paths. Duplicate ZIP entries, excessive nesting,
large entries/aggregate expansion and frontend symlinks fail closed. The checks
remain P09A-specific; `globalG12Complete` remains `false`.

### H06 — frontend packaging evidence not bound to artifact bytes

At the initial base, a frontend file could change or be added after packaging
while the old report retained only a count. The concurrent parent added complete
frontend hashes and the corresponding gate comparison. Those shared functions
and wire fields are retained here, together with its complete PNG, immutable
image-ID and instance/source checks. This patch does not claim authorship of
those concurrent changes.

### H07 — Go-normalized proxy listener rejected during real startup

The actual parent P09A job `109374002575`, run `36558691367`, failed on
2026-09-29 after PostgreSQL, Toxiproxy and both Java APIs became healthy. The
redacted teardown diagnostic identified `PROXY_TARGET_CHANGED`, followed by
`TEARDOWN_RESTORATION_NOT_ACKNOWLEDGED`. These observations came from GitHub's
job logs, not a local reproduction of the full stack.

The old guardian required the configuration literal `0.0.0.0:15432`. Toxiproxy
2.12.0 `proxy.go`, lines 105-113, assigns the result of
`net.Listener.Addr().String()` to its reported listen address:
https://raw.githubusercontent.com/Shopify/toxiproxy/v2.12.0/proxy.go
An executed standard-library Go probe in this session returned:

```text
configured=0.0.0.0:15432 reported=[::]:15432
```

The CI diagnostic did not include the actual observed listener string, so the
normalization is a code-backed explanation consistent with that failure, not a
claim that the complete remote failure has already been reproduced or repaired
in CI. The fix accepts exactly those two wildcard literals on port 15432, and
requires the exact proxy name and `postgres:5432` upstream. It checks target
identity before activation and on actual proxy read-back, including update and
restoration responses. Invalid state types fail closed. No hostname resolution
or arbitrary listener/upstream input is introduced.

During integration, concurrent commit `92a2563ee302df843eb47a5a461fbeae0db10440`
also introduced the fixed shared proxy allowlist and eight tests. This patch
retains and uses that shared helper, adding checks before activation, on update
responses and for malformed toxic entries. Its normalized-listener correction
is not attributed solely to this patch. Commit
`b6d291a57eaeb35aae3d48fff0319552dcfae6c7` also adds the controller console
bridge; that topology change is preserved without claiming its live verification.

Regression file: `tests/test_p09a_proxy_boundary.py` (12 additional cases). The proxy response
fixtures are component inputs and do not count as live F01 evidence. The Go
probe demonstrates listener normalization only, not Toxiproxy recovery.

## Executed development verification

- Original component suite: 116 tests passed before edits.
- First 30 new probes: 25 failed against the pre-fix implementation; the raw
  development log retains the individual assertion failures.
- Final component suite: 215 tests passed: 116 original cases, 47 retained
  concurrent cases and 52 new regressions (40 hardening plus 12 proxy-boundary
  cases). No existing test was removed or skipped.
- The 12 new proxy-boundary cases produced 31 failing subtest assertions and
  one error before the proxy fix; all 12 cases pass afterward.
- Python compilation, JavaScript syntax, YAML parsing and patch consistency were
  checked separately; they are not substitutes for application/container builds.

Command: `python3 scripts/lab test p09a-unit`.
The complete command `python3 scripts/lab test p09a` was attempted and returned
`DOCKER_ENGINE_AND_COMPOSE_REQUIRED`. Docker/Compose were unavailable in this
session. Maven/application builds, real PostgreSQL/Toxiproxy activation, live
browser/lifecycle runs and built-image exclusion were therefore not executed here.
No completed same-candidate GitHub pass is asserted by this report.

## Remaining isolation findings — G12 stays open

The inspected normal source
`backend/src/main/java/lab/ledgerguard/messaging/WorkerFaults.java`
contains `Runtime.getRuntime().halt(86)` and `.halt(87)`, gated by sandbox/test
settings. The normal Dockerfile packages the ordinary backend with Maven and has
no separate lab source selection. A disabled flag does not satisfy the master
prompt's requirement that normal release artifacts exclude active test controls.
This is a source/build-wiring observation, not a claim that an image was built here.

At the reviewed base, `compose.verification.yaml` refers to
`infra/docker/Dockerfile.lab`, which GitHub returned as absent. The shared
`scripts/verify-product` does not select that overlay. This latent configuration
problem is not presented as the cause of an observed CI failure. The overlay was
preserved rather than silently deleted or pointed at an ordinary image and called
isolated. A proper lab artifact needs compatible packaging and executed restart
regressions before that wiring can be completed safely.

Global release isolation also still requires an inventory and runtime-negative
checks for legacy response-loss, receiver, clock and other privileged test hooks.
This change does not label the broader G12 requirement complete.

## Next acceptance boundary

Execute both the normal product and isolated lab jobs against the final delivered
candidate, fix demonstrated failures, and retain the resulting exact-source
artifacts. Complete remaining normal-release isolation with real packaging and
runtime proof. Only then extend P09 with F02/D06 RabbitMQ duplicate-delivery
experiments. The other 30 Fxx/Dxx scenarios, P10 and P11 remain open.
