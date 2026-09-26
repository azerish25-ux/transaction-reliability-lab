# Delivery record — P03 verified

Repository: `azerish25-ux/transaction-reliability-lab`  
Branch: `main`  
Verified P03 source: `8ee1e1f91a86c11e33468d764b639b425b3e12a7`  
Source tree: `d53a6c9432298e7f5f521cdc3183603a12302512`

## GitHub delivery mechanism and ancestry

The owner-linked authorized GitHub Git-data route created actual source/workflow commits and advanced main only through non-forced fast-forward updates. Ordinary source and workflow writes both succeeded. The remote ref and actual push-triggered workflow were inspected; no local commit or unreferenced Git object was substituted for delivered main-branch code.

P03 commits, in order:

1. `bf4ebf6af8391c1172d8d59be171fccb0648beab` — registration, revocable authentication, account APIs, OpenAPI, real multi-process HTTP tests, client/startup/CI integration; parent `b15992c7c98e188792f4041a56a94ab63b979320`.
2. `299590976f3f2952ebfbd70b5229f73fdfecafcf` — remove the duplicate V6 declaration and reuse V4's existing account-identity protection.
3. `8ee1e1f91a86c11e33468d764b639b425b3e12a7` — correct repeated-request CSRF rotation and assert the existing SQLSTATE/immutable-account contract.

Documentation and the executed-requirements checker are a subsequent coherent checkpoint. They deliberately reference the already-tested implementation above; their own commit/run is independently visible on main. No force-push, history rewrite, unrelated branch or release tag was used.

## Verified P03 workflow

- Workflow: LedgerGuard fast verification.
- Run: [36270965725](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36270965725).
- Event: `push`; exact head SHA `8ee1e1f91a86c11e33468d764b639b425b3e12a7`.
- Verification job `108484709639`: SUCCESS, 2026-09-26 20:51:41–20:55:15 UTC.
- Required aggregate gate `108485265060`: SUCCESS, completed 20:55:21 UTC.
- All mandatory verification steps ran; none was skipped.

Executed results: 120 core JUnit, 13 authentication-configuration, 58 actual HTTP authentication/account and 11 PostgreSQL financial cases passed with zero failure/error/skip. The TypeScript suites passed 44 existing and six new client cases. The standalone 120-case runner repeats core bodies and is not additional unique coverage. Nine live Compose checks passed after clean startup, including seeded logins and copied-cookie revocation. Six migrations and two independent zero-discrepancy reconciliations passed. The configured literal scan checked 208 tracked files with zero matches; it is not a complete security scan.

See [durable P03 report](../evidence/p03-8ee1e1f.md) and [JSON provenance](../evidence/p03-8ee1e1f.json) for scope, exact commands and failed-run/fix history.

## P03 artifact

- ID `10915292636`.
- Name `ledgerguard-fast-evidence-8ee1e1f91a86c11e33468d764b639b425b3e12a7`.
- 50 files; 92,336 bytes.
- SHA-256 `11df5bea2eae448180c1ba5b254bb94e79fbadc044b41ef510a9d20de1a215f4`.
- Expires 2026-10-10 20:55:11 UTC.
- Downloaded ZIP hash and individual test-report counts were inspected.

Raw reports are supplementary expiring artifacts; small durable source/run/count/hash records are committed. Authentication keys, passwords and cookie values are not included in the published evidence.

## Preserved foundation delivery

P01/P02 source `cb9930168ffdc793a5759f754a39685369620422`, tree `b958f1c96f8540f5bd766ffcffa7339cae2830b1`, passed run [36267641798](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36267641798). Earlier coherent commits were `e91161e2f77b39c5dd59a878102db1cac40fecea` (foundation), `e614cdde88336e535f4d6c7c8e5052a0b62659a6` (additive V5 repair) and `cb9930168ffdc793a5759f754a39685369620422` (readiness retry).

Foundation verification job `108475257072` and gate `108475591888` succeeded. Artifact `10913469364` contained 39 files and 73,969 bytes with SHA-256 `61a1903b6904e748e38cd8f2a50b3240a252ef975b9228f7512f312c93275b78`, expiring 2026-10-10. [Original foundation summary](../evidence/fast-lane-cb993016.md) retains its five-migration scope and original timestamps. Documentation head `b15992c7c98e188792f4041a56a94ab63b979320` subsequently passed run `36267909205`.

## Delivery boundaries

P03 source, startup, APIs, regression tests and the permanent fast lane are delivered. The whole original product remains INCOMPLETE / NO_GO. No versioned release or public full-stack deployment exists. The React interface, P04–P11, nightly/release lanes, full testing-laboratory evidence and video remain incomplete. Secure-cookie policy testing is not a public TLS deployment. No local Docker or local Maven execution is claimed; the actual Docker-dependent verification occurred on the authorized GitHub Actions runner.
