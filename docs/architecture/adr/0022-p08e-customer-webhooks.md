# ADR 0022 — Customer webhooks and recoverable one-time disclosure

Status: implemented candidate; exact-source verification required.

## Context

P07B already implements signed durable delivery, receiver deduplication, encrypted versioned secrets, approved destinations and audited retries. Its original mutation endpoints do not promise command-id replay. Reusing a payment-recovery button with those endpoints could rotate again or start another retry cycle after a lost response. P08E must expose the existing system without that ambiguity.

## Decision

Keep P07B endpoints compatible. Add a CUSTOMER-only POST `/api/v1/webhook-commands` and owner-scoped GET `/api/v1/webhook-commands/{id}`. POST requires CSRF and a UUID Idempotency-Key. Commands are CREATE, STATE, ROTATE and RETRY. State/rotation retain the reviewed endpoint version; retry retains the reviewed delivery cycle and normalized audit reason. CREATE uses only the configured sandbox receiver, never an arbitrary URL.

Add V11 in the existing opt-in `db/p07b` Flyway location. A protected PostgreSQL function inserts/locks `(owner_id,command_id)`, compares canonical intent, calls the existing protected action, and commits an immutable receipt in the same transaction. A deferred constraint prevents receipt-less commands from committing. Changed intent conflicts. Concurrent identical submissions and late replays return the original applied version/cycle, even if the resource has since changed. Runtime credentials cannot insert/update/delete receipts directly. No financial posting, dispatcher or receiver logic is replaced.

Receipts contain identities, applied version/cycle and completion time, never plaintext or encrypted signing secrets. Plaintext is returned only on the first successful CREATE/ROTATE response. Replays and GET return null signingSecret. This intentionally does not promise recovery of a lost secret: first resolve the original command, then explicitly review a new rotation if a usable secret is needed. Old delivery jobs retain their original key version.

The frontend persists only an allowlisted owner-scoped command ID/body/timestamp/state, before transmitting. It keeps the original ID and expected version/cycle through reload, 401, CSRF failures, network errors and malformed responses. Recovery is explicit GET or same-command POST, never automatic. A 404 lookup does not prove rollback. Only a serialized WEBHOOK_CONFLICT eligibility/version rejection clears that rejected command; idempotency conflicts remain blocked. Storage failure blocks new submissions. One pending webhook instruction blocks other webhook mutations but does not conflate independent money instructions with notification management.

Secret display is component memory only, cleared on dismissal, route change, tab hiding, page hide or session unmount. A late response while hidden is not displayed. Clipboard copying requires user action and cannot erase the user's clipboard afterward. Client validation checks ownership/identities, versions and states, strips ordinary records to known fields, and rejects secret-bearing ordinary responses. This is defense in depth; server authorization remains authoritative.

Delivery pages show backend states separately from payment settlement. Polling is bounded to three minutes, pauses when hidden, and stops on error or terminal state. Manual refresh is always available. Endpoints and deliveries use bounded server pagination; attempt history currently uses the existing complete P07B detail response with an eight-row browser pager, not a new server-paginated attempt contract. Disabling does not cancel an already executing attempt.

## Verification and consequences

P08E adds production TypeScript contract tests, command validation JUnit cases and real Compose-backed Playwright journeys at three viewports. Browser oracles use immutable financial entries/current balance consistency and durable command/audit counts, not UI claims. Deliberate response loss happens after a real POST completes. Actual logout tests reauthentication; controlled internal receiver errors test manual retries without another payment. Concurrent command submissions and immutable receipt protections are checked against PostgreSQL.

P08E tests disable automatic trace/video/screenshot capture because they receive one-time secrets. Manual responsive captures occur only after secret dismissal or on secret-free screens. Tests assert secret absence with booleans rather than including secret values in failure diagnostics. This is a documented evidence-redaction trade-off, not permission to skip functional checks.

The permanent P08E gate invokes the intact P08D gate, which preserves earlier gates, then requires every named new case, responsive screenshots, clean tracked source and exact SHA. No success evidence is generated unless all required checks execute and pass. Broader administrator interfaces, P09-P11 and full release readiness remain open.
