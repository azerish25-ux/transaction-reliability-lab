# P09A — first executed F01 and D02 results

**Two live experiments succeeded; P09A as a complete milestone remains IMPLEMENTED_UNVERIFIED.**

Source: `b6d291a57eaeb35aae3d48fff0319552dcfae6c7`.
[Workflow 36560099620](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36560099620),
lab job `109378622364`, [artifact 11028329219](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36560099620/artifacts/11028329219).
The laboratory job ultimately failed in browser verification. Its two actual
financial experiments must not be confused with a full job or milestone pass.
[Curated machine-readable observations](p09a-b6d291a-live.json).

The downloaded archive SHA-256 is
`d3007b00d7ab6a55c866a6f7327e381798575c48e932288e7357fa1c09e3c80e`.
Its original per-run manifest hashes were checked against the retrieved verdict
and JUnit bytes. The D02 XML retains one genuine failing mutant assertion; the
F01 XML has no failures. Raw artifacts have finite 14-day workflow retention.
The JSON here is a curated derivative, not a fabricated replacement raw report.

## F01: real proxied PostgreSQL disruption — PASSED

Run `e0b8aa3b-8239-4005-82b9-b15674bd6b13`, seed `74021`.
`pg_stat_activity` identified the target JDBC connection as arriving from the
actual Toxiproxy address. The latency phase returned HTTP 200 in 0.518498 seconds.
During disconnection, the target returned a bounded HTTP 503 in 3.012144 seconds
while the control API remained HTTP 200. Restored replay resolved to the original
operation and journal with one durable replay record. All four phases retained
identical financial snapshot hashes and zero balance/journal discrepancies.

## D02: ignored recipient fingerprint — DETECTED

Run `38163c9e-2871-4e95-8fb7-ffb334a5e2ab`, seed `74021`.
The identical changed-recipient test/input produced:

| Phase | Actual response | Assertion result |
|---|---:|---|
| Correct baseline | 409 | PASS |
| Installed defective function | 201 | D02_CHANGED_RECIPIENT_REJECTED failed as required |
| Restored original function | 409 | PASS |

The operation, journal, financial snapshot and replay count remained unchanged.
This demonstrates a replay-contract defect, **not duplicated money**. Original
and mutant function hashes and the real failing artifact hashes are retained in
the JSON. Both experiment cleanups read back the exact original function, an
enabled proxy and no active toxics.

## Browser blocker and subsequent correction

The browser result retained only `UNAUTHENTICATED_LAB_DENIED` and
`ADMIN_COMMAND_REQUIRES_CSRF` as passing. The remaining browser checks and the
lifecycle suite were not completed on this source. No required P09A pass is claimed.

Commit `6331caadd8a5dae0191150c569f767b586d3e1df` replaces page-context evaluation
waits with locator assertions under the unchanged strict CSP, scopes confirmation
controls to the named dialog, and records safe failure-stage/category diagnostics.
Its own [run 36561276857](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36561276857)
must establish its results separately. A code fix and a previously passing
experiment are not substitutes for same-candidate product/lab verification.
