# Execution checkpoint — P04 VERIFIED_PASS

Overall product status remains **INCOMPLETE / NO_GO**. P04 immediate transfer reliability is implemented and verified; this does not mark P05–P11 complete.

## Current verified implementation

- Repository: `azerish25-ux/transaction-reliability-lab`; branch: `main`.
- Verified P04 source: `60a95db82350983eaf1ad3c7545190866c831f98`.
- Source tree: `7dcea7445209a501a9a036e5d9170224ea623ba4`.
- Successful push workflow: `36276049817`.
- Verification job `108498899419` and required gate `108499548289`: SUCCESS.
- Original P04 parent: `5d1c1474e0c020763cf2e35bc05e04907c286237`.
- Main was advanced only by non-forced fast-forwards; migrations V1–V6 and the protected posting SQL are unchanged.

## P04 implemented and executed

Authenticated CUSTOMER requests can create immediate transfers through `POST /api/v1/transfers` with CSRF and a mandatory bounded idempotency key. The API derives the actor from the P03 principal and delegates to the existing protected PostgreSQL command; no controller or JVM balance mutation was introduced. Successful execution atomically commits the transfer, balanced journal/two entries, balances, financial audit, idempotency response and outbox event before returning `201`.

Identical replay returns the original status/body/resource with `Idempotency-Replayed: true`. A changed normalized intent returns `409 IDEMPOTENCY_CONFLICT`. Deterministic insufficient-funds, self-transfer, cross-currency and invalid-recipient outcomes are atomically retained and replayed. Malformed, mass-assigned and unowned requests are rejected before claiming the key.

Owner-scoped transfer GET/list endpoints expose the source account and destination public routing reference, never the private destination account UUID, owner or balance. ADMIN does not gain customer spending authority. The TypeScript client and intent store retain the same key and normalized instruction after an uncertain response.

The current contract is `/api/v1/openapi/p04.json`; `/api/v1/openapi.json` remains the verified P03 compatibility snapshot. No new migration was required because the protected transfer/idempotency structures already existed.

## Verified results

- JUnit: 120 core and 13 authentication-configuration cases; zero failures/errors/skips.
- PostgreSQL financial integration: 11; zero failures/errors/skips.
- Actual HTTP P03 authentication/account suite: 58; zero failures/errors/skips.
- Actual HTTP P04 transfer suite through two independent API JVMs and PostgreSQL: 20; zero failures/errors/skips.
- TypeScript: 44 existing, 6 authentication-client and 7 transfer-client cases; zero failures.
- Real clean Compose P04 smoke: 15 passing checks.
- Twenty-four scoped P03/P04 requirements resolved against actual passing XML case names.
- Six Flyway migrations, restricted runtime identity, fixture login, transfer posting/replay, two independent zero-discrepancy reconciliations and scoped teardown passed.
- Configured literal scan: 219 tracked text files, zero findings.

The standalone execution of the 120 core case bodies is reported separately, not double-counted. The secure-cookie policy check is not a public HTTPS/browser deployment. The literal scan is not comprehensive security assurance.

## Reliability proofs

- **Canonical overspend:** two synchronized 8,000 requests against 10,000 available, through separate API processes, produced exactly one `201` and one persisted `422`; final source availability was 2,000 with no hold or duplicate posting.
- **Concurrent replay:** identical key/intent requests through separate processes returned one durable transfer and one replay response.
- **Lost response after commit:** a test-only TCP proxy consumed the complete upstream success and reset the downstream connection before returning bytes; replay returned the original transfer ID with one committed effect.
- **Locking and pressure:** opposite-direction transfers completed without lock-order deadlock, independent accounts progressed concurrently, and eight synchronized 1,800 requests against 10,000 produced five successes and three controlled rejections.
- **Privacy and authority:** foreign transfer IDs returned the same 404 as absent IDs; read responses omitted private destination identity; restricted runtime SQL and ADMIN customer-spending attempts were rejected.

## Finding resolved without concealing the failed run

Initial candidate `9847369369fcb8ae685dfc6fe6fe910070a8160b`, run `36275988571`, failed in the standalone Java boundary because the shared JDBC adapter imported SLF4J while that intentional dependency-light compiler includes only JDK/core sources. Commit `60a95db82350983eaf1ad3c7545190866c831f98` replaced it with JDK `System.Logger`; retry observability remained, the dependency boundary was preserved, and the complete lane passed. The failed run is not counted as verified evidence.

## Evidence and traceability

The durable report is [P04 evidence](../evidence/p04-60a95db.md). [P04_REQUIREMENTS.json](P04_REQUIREMENTS.json) defines ten scoped requirements and actual test-ID prefixes. `scripts/assert-p04-evidence` verifies all current P03/P04 suites, rejects missing/failed/skipped cases, validates internal OpenAPI references and generates the exact requirement matrix for each candidate.

This evidence documentation is intentionally committed after the tested implementation. Its own source SHA receives a separate full CI run; no self-referential evidence claim is made.

## Preserved prior evidence

P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`; P03 evidence commit `5d1c1474e0c020763cf2e35bc05e04907c286237` passed `36271372093`. P01/P02 source `cb9930168ffdc793a5759f754a39685369620422` passed `36267641798`. P04 reruns, rather than replaces, those suites.

## Next executable milestone

**P05:** implement independently restartable transactional-outbox publishers and payment workers: publisher claims/leases, RabbitMQ persistent messages/confirms/unroutable handling, manual acknowledgement only after PostgreSQL commit, consumer/event deduplication, payment hold settlement/failure recovery, duplicate delivery and crash-after-publish/commit proofs, and at least two worker instances. Preserve every P01–P04 suite.

P06 adjustment APIs, P07 schedules/webhooks, P08 React/browser/accessibility, P09 complete fault/defect laboratory, P10 contracts/scanners/performance/restore/nightly/release and P11 final evidence/video remain incomplete. No public application or release tag is claimed.
