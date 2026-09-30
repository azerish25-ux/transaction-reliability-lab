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
