# Execution checkpoint — P03 VERIFIED_PASS

Overall product status remains **INCOMPLETE / NO_GO**. The requested P03 authentication, revocable-session and ownership-safe account API milestone is implemented and verified. This does not mark P04–P11 complete.

## Current verified implementation

- Repository: `azerish25-ux/transaction-reliability-lab`; branch: `main`.
- Verified source: `8ee1e1f91a86c11e33468d764b639b425b3e12a7`.
- Source tree: `d53a6c9432298e7f5f521cdc3183603a12302512`.
- Successful push workflow: `36270965725`.
- Verification job `108484709639` and required gate `108485265060`: SUCCESS.
- Original P03 parent: `b15992c7c98e188792f4041a56a94ab63b979320`.
- All main updates are non-forced fast-forwards; existing financial migrations V1–V5 are unchanged.

## P03 implemented and executed

Registration normalizes identities, rejects duplicate/concurrent identities and unknown privileged fields, hashes passwords and supplies only CUSTOMER status. Registration and new accounts do not create funds. Authentication validates HS256 JWTs plus persisted unexpired/unrevoked sessions and current enabled-user roles; logout revocation survives another process and restart. Session lifetime defaults to 15 minutes.

The HTTP boundary implements actual CSRF, lifecycle-only rotation, same-origin checks, HttpOnly/Strict cookies, normal HTTPS Secure cookies, an explicit loopback sandbox exception, bounded JSON and safe problem responses. Login budgets are shared in PostgreSQL. Security events are separate append-only records, not fictional financial postings.

Account APIs create/list/read owned wallets and owner-only entry/transaction history. Currency and identity remain immutable. All monetary output is decimal integer strings. Recipient lookup returns only public routing reference/currency. ADMIN authority protects the actual security-event feed but does not confer unrestricted customer spending or account creation.

The real TypeScript client handles the CSRF lifecycle and empty logout responses. Versioned OpenAPI describes implemented endpoints only. V6 adds session/event/budget protections and reuses the existing V4 account-identity trigger. Startup preserves runtime signing keys and generates private synthetic fixture login credentials.

## Verified results

- JUnit: core 120 and security configuration 13; zero failures/errors/skips.
- PostgreSQL financial integration: 11; zero failures/errors/skips.
- REST Assured actual HTTP against independently restartable JVMs/PostgreSQL: 58; zero failures/errors/skips.
- TypeScript: existing 44 plus authentication-client 6; zero failures.
- Real clean Compose authentication/account smoke: 9 passing checks.
- Six Flyway migrations, V5-to-V6 historical user/account preservation, clean image/startup, restricted runtime identity, fixture login, two zero-discrepancy reconciliations and scoped teardown passed.
- Configured literal scan: 208 tracked text files, no matches on the verified implementation.

The standalone execution of the 120 core case bodies is reported separately, not double-counted. The HTTP fixture uses bounded polling for process readiness; it does not substitute a mocked database or security context for requests. The HTTPS-cookie policy test is not a public TLS/browser deployment.

## Findings resolved, without concealing earlier runs

1. Run `36270455110` failed because V6 redeclared V4's account-identity trigger. PostgreSQL rolled V6 back. Commit `299590976f3f2952ebfbd70b5229f73fdfecafcf` reused V4 instead; no published V1–V5 checksum changed.
2. Run `36270610899` passed all 11 financial tests and 56/58 HTTP cases. Repeated account creation exposed automatic CSRF clearing on ordinary authenticated requests. Commit `8ee1e1f91a86c11e33468d764b639b425b3e12a7` assigned rotation to explicit login/logout while retaining CSRF validation and strengthening repeated-request checks.
3. The same run exposed an incorrect new test expectation: existing V4 rejects account-identity mutation with SQLSTATE 42501, not 23514. The test now verifies the existing contract plus unchanged ownership/currency. The database protection was not weakened.

## Evidence and traceability

The durable report is [P03 evidence](../evidence/p03-8ee1e1f.md). [P03_REQUIREMENTS.json](P03_REQUIREMENTS.json) defines fourteen scoped requirements and actual test-ID prefixes. `scripts/assert-p03-evidence` derives a per-candidate requirement matrix from real passing XML and rejects missing, failed or skipped cases. Broad original requirements in REQUIREMENTS.yaml retain their broader scope; this supplement is not a claim that all original security/product obligations are complete.

Evidence documentation is intentionally committed after the tested implementation. A later evidence/traceability commit has its own CI run; this document does not invent a self-referential commit hash.

## Preserved foundation history

P01/P02 source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`; documentation `b15992c7c98e188792f4041a56a94ab63b979320` passed `36267909205`. Prior fixes addressed the financial-command SQL status ambiguity through V5 and a bounded startup connection-reset retry. See the retained foundation evidence instead of relabeling it as P03.

## Next executable milestone

**P04:** connect the authenticated principal and existing protected `FinancialCommands` adapter to immediate transfer HTTP commands and owned transfer reads; enforce durable scoped idempotency, real two-instance overspend/replay races, and lost-response-after-commit resolution. Preserve P03 CSRF, ownership and fixture guarantees; run all current suites alongside the new transfer proofs.

P05 workers/RabbitMQ, P06 adjustment APIs, P07 schedules/webhooks, P08 React/browser/accessibility, P09 complete fault/defect laboratory, P10 full contracts/scanners/performance/restore/nightly/release and P11 final evidence/video remain incomplete. No public application or release tag is claimed.
