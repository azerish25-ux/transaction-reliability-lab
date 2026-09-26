# ADR 0012 — P03 authentication and account boundary

Status: implemented; execution verdict is recorded separately in implementation/PROGRESS.md.

## Decisions

The existing Spring Boot 3.5 / Java 21 modular backend owns authentication. No external identity service or refresh-token subsystem is introduced. Nimbus/Spring Security encode and verify HS256 JWTs; a randomly provisioned key of at least 256 bits is mandatory. The sandbox generates 512 bits once and retains them in its ignored, mode-0600 runtime configuration. Normal deployment must supply its own stable secret and HTTPS origin. There is no hardcoded fallback or silently generated per-JVM key.

A JWT contains issuer, audience, subject, session ID, issuance time and expiry. The default lifetime is 900 seconds. `ledgerguard.auth.session-ttl` is an ISO-8601 duration such as `PT15M`, constrained to whole seconds between one and thirty minutes. Each protected request validates the allowed algorithm, signature, required claims, expiry and an enabled current user joined to the unrevoked, unexpired PostgreSQL session. Roles come from the current database row, not a caller-controlled role claim. No refresh tokens: expiration requires deliberate reauthentication without silently creating a new financial intent.

Login's session insert and success event commit together before the cookie is returned. Logout's revocation and event commit together before HTTP 204. Revocation is durable across processes/restarts, and the migration prohibits restoring revoked sessions or extending session identity/expiry by an ordinary update. This does not claim that requests already authorized before a concurrent logout can be retroactively undone.

## Browser protocol

1. GET `/api/v1/auth/csrf` with same-origin credentials. Retain only the returned masked token in memory.
2. POST JSON registration/login with the returned `X-XSRF-TOKEN` header and browser-managed CSRF cookie.
3. After successful login, acquire a fresh CSRF token before a state-changing command.
4. POST logout with CSRF; success has an empty HTTP 204 body. Acquire fresh CSRF before another login.

The standard Spring Security XOR token handler provides the masked token. The CSRF cookie is HttpOnly; the client never reads it. Authentication cookies are HttpOnly, SameSite=Strict, Path=/, and Secure with `__Host-` names in normal mode. The isolated `sandbox` profile plus explicit HTTP setting uses `LG-SESSION` and `LG-CSRF`, rejects non-loopback Host names, and Compose binds published ports only to loopback. This is not permission to expose the demo Compose stack publicly. A reverse proxy is responsible for TLS and request deadlines in an HTTPS deployment. P03 tests cookie policy, not a public TLS deployment.

No JWT/password is placed in localStorage, URLs, response JSON, logs, evidence or the repository. Token/claim exceptions and database failures produce safe problem responses. Unknown JSON properties and bodies over 16 KiB (including chunked bodies) are rejected. The origin guard supplements, and does not replace, CSRF. No cross-origin browser grants are configured.

## Passwords and abuse limits

BCrypt uses configurable cost 12 by default, constrained to 10–14. Passwords must be at least 12 characters and at most 72 UTF-8 bytes; overlong input is rejected rather than truncated. Identity normalization is trim plus locale-independent lowercase for the supported ASCII email form. PostgreSQL uniqueness resolves concurrent duplicate registrations. Caller-assigned roles, ownership, IDs, account kind and balances are rejected as unknown JSON properties.

Five-minute authentication budgets are persisted in PostgreSQL: default 60 attempts per direct client IP and 10 per normalized identity/operation. Failed and successful attempts count; changing API instance does not reset the budget. `X-Forwarded-For` is not trusted. A proxy deployment therefore needs an explicit reviewed client-address policy; multiple clients behind a proxy share its budget until that policy is provided. Bucket digests are not claimed as anonymization against guessing. Expired buckets are pruned in bounded batches. Throttling returns 429 and conservative Retry-After 300.

## Accounts and privacy

Existing protected `register_customer` and `create_account` functions are reused. Registration creates no funded wallet. Account creation returns a zero-balance wallet with server-owned identity and immutable currency/owner/reference/kind; no public top-up exists. All monetary amounts and balances are decimal integer strings.

Every account/history query includes owner identity from the authenticated principal. History joins return only that account's economic effect/entries, not the counterparty's lines or balances. Absent and unowned resources share 404. Recipient resolution reveals only an active public reference and currency of an enabled wallet owner. ADMIN inspection is explicitly routed to the security-event feed and does not grant customer-wallet creation or generic spending.

Pagination uses a bounded limit (1–100) and offset (0–10000) with stable tie-breaking. It does not promise a cross-request snapshot while new records arrive. Later larger-history work may introduce scoped cursors without changing ownership enforcement.

## Database and evidence boundary

V6 is additive and preserves V1–V5 checksums, posting functions and financial privileges. It adds immutable account/session identity triggers, append-only security events and shared authentication budgets. Security events are deliberately distinct from financial audit records: a denied HTTP request is not a money movement. Restricted runtime credentials cannot mutate users, posted money or existing security events. A schema owner remains outside the ordinary runtime security boundary.

`AuthenticationAccountsIT` launches actual independently restartable application JVMs with real PostgreSQL. REST Assured drives actual HTTP, cookies and CSRF. Tests cover replayed logout cookies across restart, signed/unsigned/altered claims, ownership/role injection, currency/zero balances, shared throttling, private history, body/pagination bounds, V5 upgrade and existing financial reconciliation. `SecuritySettingsTest` covers configuration fail-closed behavior. TypeScript transport tests exercise the real client but are not mislabeled Pact/browser verification.

Normal corrected code is tested; no mutation or clock override is packaged in the application. The normal-cookie policy test sends cookies using an HTTP test client to inspect server attributes; it does not assert that a browser would send Secure cookies over HTTP. The full React/browser/accessibility and later financial failure laboratory remain separate milestones.
