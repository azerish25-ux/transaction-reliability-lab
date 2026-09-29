# P09A — isolated reliability laboratory

**Implementation status: IMPLEMENTED_UNVERIFIED. Full product: INCOMPLETE / NO_GO.**

This change adds the first executable slice of P09, not the entire eight-fault,
24-defect campaign. F01 and D02 have implementation, orchestration, assertions,
and browser/lifecycle tests. A passing component suite is not proof that either
experiment has executed against PostgreSQL or the browser.

## Integration-hardening checkpoint

A follow-up audit against `b4185db03f72df97c77d82f0b18f25bc42af518a` adds atomic
lease admission, pre/post-IO activation checks, canonical JSON/JUnit correspondence,
recorded-input/route validation, lifecycle artifact integrity, bounded nested
archive scanning and frontend artifact hashes. The changes are integrated on
`b6d291a57eaeb35aae3d48fff0319552dcfae6c7`, retaining its 47 tests, shared
evidence validators and parallel product/lab jobs with a combined required gate.
The guardian also handles the two fixed wildcard listener representations that
Go can report, without permitting arbitrary targets. The saved source
`724b055067e53a06eaf7b16affda3131d324d0ac` passed **215 component tests**, but
its live P09A command was blocked by missing Docker/Compose in that session.
These tests do not qualify as G06/G07 or built-image G12 evidence. See
[INTEGRATION_REVIEW.md](INTEGRATION_REVIEW.md) for corrections and unresolved risks.

## Original implementation handoff — historical verification and limitations

The implementation was prepared against `24b6fc29d043627c9e10f09f85bc345dcfc11f2f`.
The development session executed **116 component tests**, Python compilation,
JavaScript syntax checks, and YAML parsing. HTTP boundary component tests run the
real lab HTTP server with a substituted authentication backend; guardian tests
use an explicitly fake driver. None counts toward G06 or G07.

The session could not run Docker/Compose, PostgreSQL, Maven, the normal application,
normal-artifact packaging checks, or the new live F01/D02 campaign. A Chromium
navigation attempt was denied by the environment's browser policy. These are
**unverified/blocked**, not passing results. The GitHub integration in that session
exposed repository reads but no write action, and direct Git access failed DNS.
A local patch or commit alone is not GitHub delivery. See the accompanying delivery
report for the actual commit/push result, rather than assuming it from this file.

The existing P08F evidence retains its own historical source and scope. It is not
relabelled as verification of this change. P09A must pass both the normal product
campaign and the new isolated-lab campaign on the same clean candidate before its
status can be changed to VERIFIED_PASS.

## Commands

Run from a complete checkout with Docker Engine and Docker Compose available:

```bash
./scripts/lab test p09a-unit           # dependency-free component checks
./scripts/lab test pr                 # shared P01-P08F product campaign
./scripts/lab up --lab                # separate disposable lab; generated private configuration
./scripts/lab status --lab
./scripts/lab resilience F01          # real proxied PostgreSQL latency and disconnection
./scripts/lab defect D02              # baseline / mutant / restoration
./scripts/lab test p09a               # product + packaging + live lab + browser + recovery
./scripts/lab down --lab              # restoration read-back; preserves this lab's data
./scripts/lab down --lab --reset-data # explicitly destroys only this lab's volumes/configuration
```

`./scripts/lab defects --all` deliberately fails with an incomplete-catalogue
message. It must not pretend that D02 alone satisfies the required 24 detections.
Other required Fxx/Dxx identifiers remain NOT_STARTED. Normal startup continues
to use the existing `compose.yaml`; faults are not enabled by normal startup.

Default console: `http://127.0.0.1:8090/lab/`. Use the fictional administrator
`admin@example.test` and the generated `LEDGER_DEMO_PASSWORD` in the private
`.ledgerguard/p09a/runtime.env`. It is not printed, checked into Git, or uploaded.
The host port may be selected with `LEDGER_LAB_PORT` only before the lab is first
initialized. Source changes require explicit disposable-data reset rather than
silently attaching an old database to a new candidate.

## Architecture and isolation

`compose.lab.yaml` is an independent topology, not a merge over the normal stack:

- **Target API:** the unchanged normal backend image; runtime JDBC goes through
  the named Toxiproxy PostgreSQL listener. Its application name identifies the
  actual connections used for the route proof.
- **Control API:** another instance of the same corrected backend and database,
  with a direct connection. Existing authentication and current database role
  checks remain available during the target's F01 network disruption.
- **Controller:** a separate lab-only Python image serves the console, validates
  ADMIN authorization and CSRF, records commands in SQLite, and runs allowlisted
  HTTP/SQL oracles. It has no database-owner password or Docker socket.
- **Guardian:** a separate process in the lab-only image holds the disposable
  owner credential, applies only the declared function mutation/proxy operations,
  and independently restores them after expiry, cancellation, or controller death.
  The normal API migration process and one-shot seed also use their existing
  migration-owner credentials; the browser/controller does not receive them.

The lab database, project name, network, credentials and volumes are instance
scoped. The external CLI supplies an explicit validated Compose project name and
overrides every relevant interpolation value, preventing inherited shell settings
from redirecting a teardown into the normal project. Only the console port is
published, bound to loopback. Database, APIs and proxy control ports remain
internal. No arbitrary SQL, URL, filesystem path, process command or Docker
operation is accepted through HTTP.

The guardian checks the database name and a separately permissioned instance
marker before reading or changing the protected function. It preserves the exact
original definition and hash, refuses unknown concurrent changes, and verifies
restoration by reading the actual function and proxy state. Ordinary Flyway
migrations are not edited. The mutation fixture lives outside their locations.

The console calls the existing authentication API and checks the user's current
ADMIN role on every privileged request. Its cookies use lab-specific names and
paths. A lab-command CSRF token is tied to the authenticated session and origin;
login/logout also retain the backend's original CSRF protections. Exact Host,
Origin, content length, path and request-field allowlists are enforced. Secrets
and raw authentication traces are not included in evidence.

## Execution bounds and recovery

One experiment may be active at a time. Every activation is scoped to its run,
scenario and known target. A fault lease is at most **20 seconds** and is never
extended by polling. No new phase/fault may start after the **150-second run
deadline**. Individual network/database calls have bounded timeouts; cleanup is
attempted even when the deadline or a test fails. The deadline is not a promise
that an already-running bounded I/O call or cleanup finishes at exactly 150
seconds.

The guardian uses controller heartbeat, expiry, cancellation and a generation
compare-and-swap to reject stale activations. Its acknowledgement includes
physical read-back, not just a UI status change. A separate real-container test
kills the controller at an observable D02 checkpoint and requires the guardian
to restore the database while the controller remains dead. Another test outlasts
the lease, proving an expired variant cannot count as a detection. Those tests
are implemented but were not executed in the development session.

The CLI atomically stores the original request identity before submission and
retains it until collecting the terminal result. A concurrent CLI invocation is
rejected. The browser similarly keeps only non-secret owner/instance-scoped
pending intent metadata; uncertain responses do not manufacture new commands.

**Restoration removes the fault or defective function; it does not reverse
committed synthetic transfers.** Each run has its own stable command identity.
Explicit `--reset-data` discards the disposable lab when new fixtures are needed.
Normal teardown retains the lab's run history and financial evidence.

## F01 runbook — actual PostgreSQL traffic disruption

Business risk: a dependency timeout can leave a caller unsure of the financial
outcome; retrying with a new identity could repeat the economic effect.

1. Use a clean corrected lab and seed 74021. Authenticate through the control
   API, submit a real transfer through the target API, and retain its operation
   and idempotency key.
2. Independently check the transfer, both journal entries, durable replay record,
   immutable-entry-derived balances, holds and scoped journal consistency.
3. Read `pg_stat_activity` for the target's JDBC application name. Require
   nonzero target connections and their actual client addresses to match the
   Toxiproxy service, rather than inferring routing from configuration alone.
4. Apply a named 250-ms downstream latency toxic, read it back, and require the
   real API read to remain correct with observable delay.
5. Restore that toxic. Disable the actual proxy connection, read back the
   disabled state, and replay the original transfer identity. Require a bounded
   dependency-unavailable response or bounded timeout; do not equate a timeout
   with a rollback. Confirm control-plane availability and reconcile directly.
6. Restore the proxy, replay the same key again, and require the original
   operation/posting and unchanged global scoped financial state.

The campaign fails if routing, activation, the business result or restoration is
unproven. F01 is a resilience experiment against corrected code, not a mutant
"detection." It does not yet cover all F01 timing windows or other Fxx mechanisms.

## D02 runbook — ignored idempotency payload fingerprint

Business risk: the same key with changed economic intent is silently treated as
an accepted replay instead of a conflict.

The guardian obtains the exact installed `ledger.execute_command` definition and
replaces the uniquely matched fingerprint comparison with a false condition in
this disposable database only. This is a real protection-cut variant, not an
exception thrown to make a test fail. No normal migration or source file is
mutated in place.

The detecting oracle is identical in all three phases, using the same run key,
original transfer input, changed recipient and seed:

1. Correct baseline: initial and exact replay resolve to one operation; changed
   recipient under the same key returns **409 / IDEMPOTENCY_CONFLICT** without
   changing financial state.
2. Mutant: the same changed-recipient assertion must genuinely fail with an
   inappropriate successful replay. The immutable ledger oracle must still show
   no additional posting. This demonstrates a replay-contract defect, **not
   duplicated money**.
3. Restoration: read back the exact original function, remove all proxy faults,
   and rerun the same oracle. The corrected baseline must pass again.

Changed recipient is intentional: the existing Java transfer service independently
checks returned amount and currency. An amount mismatch might trip that secondary
protection rather than demonstrate this precise successful-replay regression.

Only this exact valid sequence qualifies as DETECTED. SURVIVED, BASELINE_FAILED,
INVALID_EXPERIMENT and CLEANUP_FAILED remain failures. Compiler/setup/service
errors and arbitrary timeouts cannot be counted as business-risk detection. A
lab-only checkpoint used by lifecycle tests is explicitly excluded from qualified
D02 evidence.

## Evidence, packaging and CI

Every completed run retains actual phase observations, input/seed, source SHA,
instance/run identities, timestamps, function/proxy read-back and final verdict.
The CLI exports JSON, a human-readable index, JUnit XML and artifact hashes under
`.evidence/p09a/<run-id>/`. A correctly detected D02 keeps the mutant's failing
JUnit assertion; the successful outer campaign means detection was verified, not
that the broken implementation passed.

`assert-p09a-evidence` rejects missing/dirty/wrong-source evidence, invalid phase
classification, absent restoration, incomplete browser/lifecycle coverage and
missing normal-artifact evidence. The product and isolated-lab CI jobs run on
the same candidate, and the combined required gate requires both to pass. The
lab job publishes curated artifacts with 14-day retention. Neither a written
workflow nor a successful source delivery establishes a green verification run.

Normal backend/frontend artefacts are checked for **P09A-specific** control and
mutation material, and the actual normal backend image is inspected for lab
files. The lab marker is baked only into the separate lab image. These checks do
not claim complete G12 closure: pre-existing legacy test hooks in the product
still require the original full-release isolation review.

## Remaining acceptance gates

| Gate | Recorded hardening-session scope; not a new-candidate pass |
|---|---|
| Component state, authorization, verdict, orchestration and hardening tests | 215 passed on saved source; 116 original + 47 concurrent + 52 new |
| Python/JavaScript syntax and YAML parse | Passed locally; not a container build |
| Same-candidate P01-P08F full regression | Not executed |
| Live F01 routing, activation, recovery and reconciliation | Implemented, unverified |
| Live D02 baseline/mutant/restoration | Implemented, unverified |
| Real browser, responsive/keyboard and customer-denial journeys | Implemented; navigation blocked locally |
| Real controller death and automatic expiry | Implemented, unverified |
| Built normal-artifact exclusion | Implemented, unverified |
| Successful required GitHub gates | Not established |
| Full P09: 8 faults and 24 defects | Incomplete; remaining 30 scenarios not implemented |
| P10 and P11 full-release work | Remains open |
