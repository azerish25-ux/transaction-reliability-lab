# Execution checkpoint — P03 candidate

Overall product status remains **INCOMPLETE / NO_GO**. P03 authentication/accounts are **IMPLEMENTED_UNVERIFIED** until the exact candidate's expanded fast lane completes. No release or public application is claimed.

## Preserved verified foundation

Repository: `azerish25-ux/transaction-reliability-lab`, branch `main`.

- Original milestone parent: `1c2aaf42d66d176edbf5e3306a9dbfadc90db32e`.
- Foundation implementation: `e91161e2f77b39c5dd59a878102db1cac40fecea`.
- Additive PostgreSQL repair: `e614cdde88336e535f4d6c7c8e5052a0b62659a6`.
- Verified foundation source: `cb9930168ffdc793a5759f754a39685369620422`, successful run `36267641798`.
- Subsequent documentation HEAD: `b15992c7c98e188792f4041a56a94ab63b979320`, successful fast run `36267909205`.

P01/P02 evidence remains the previously executed 120 Java cases (same bodies also run standalone, not counted twice), 44 TypeScript cases, 11 PostgreSQL integration tests, five validated migrations, Compose startup with restricted runtime identity, idempotent balanced fixtures, and two discrepancy-free independent reconciliations. The foundation fixed an ambiguous SQL status reference with additive V5 and a bounded startup readiness connection-reset issue. P03 preserves V1–V5 and all protected financial posting logic.

## P03 candidate implementation

- Registration with normalized identity uniqueness, BCrypt, zero initial funding and strict input-field allowlists.
- HS256 cookie authentication, required claim checks, 15-minute sessions, persisted revocation, current enabled-user/role checks and durable logout.
- Same-origin/CSRF handling, CSRF rotation, HttpOnly/Secure/Strict cookie policies, explicit loopback sandbox exception, bounded JSON requests and safe problem responses.
- PostgreSQL-shared authentication budgets and separate append-only security events.
- Owner-scoped account creation/list/detail/entry/transaction APIs, exact decimal-string balances and minimal recipient routing lookup.
- Additive V6 identity/session protections without granting direct financial mutation rights.
- Versioned actual OpenAPI and updated TypeScript client, including HTTP 204 and CSRF refresh handling.
- Real PostgreSQL HTTP integration suite using two independently restartable JVMs; configuration and TypeScript regression suites.
- Expanded required CI checks for expected nonzero test discovery, live Compose authentication, fixture login, ownership denial and copied-cookie logout revocation.
- Persisted generated sandbox signing key and demo credentials; no secret values printed or committed.

The implementation was authored through the authorized GitHub Git-data API. Git objects are not counted as a delivered branch until the main ref is advanced and re-read. The local authoring container lacks Docker and cannot reach dependency hosts; Docker-dependent checks must actually execute on the repository's GitHub Actions runner. No local Testcontainers or Maven result is claimed.

## Immediate verification actions

1. Publish the coherent candidate by non-forced fast-forward to main.
2. Observe the actual push-triggered workflow; inspect compile, HTTP, database and Compose failures.
3. Repair concrete causes without weakening assertions, then rerun the full affected lane.
4. Record exact source SHA, test counts, workflow/job conclusions and artifact locations after execution.

## Remaining product phases

P04 transfer HTTP/idempotency/uncertain-response boundary; P05 RabbitMQ publisher/consumer and worker; P06 adjustment APIs; P07 schedules/webhooks; P08 React/browser/accessibility; P09 fault/defect laboratory; P10 full contracts/security scans/performance/restore/nightly/release; P11 final evidence/video remain incomplete. Dependency presence, a static OpenAPI document, or a passing component suite alone does not fulfill those phases.

The P03 architecture and limits are documented in [ADR 0012](../architecture/adr/0012-p03-authentication.md).
