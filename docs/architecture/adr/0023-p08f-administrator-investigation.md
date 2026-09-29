# ADR 0023: Administrator investigation and snapshot reconciliation

Status: accepted implementation; exact-source verification remains pending until the permanent P08F gate passes.

## Scope and authority

Complete the remaining P08 administrator investigation surface without replacing P01-P08E customer flows or financial commands. Add transaction search/detail, financial audit history, saved independent reconciliation, and a UI over existing failed-work inspection/replay. Preserve the administrator adjustment landing route and protected reversal/receipt implementation.

Every new read endpoint is under the existing server-side `/api/v1/admin/**` role boundary. Services also require an ADMIN `Identity`. Role checks do not depend on hidden navigation. All new responses are `no-store`. Scope is synthetic data only; this is not a production banking system.

## Search and journal relationships

One explicit SQL CTE joins actual transfers, payments, immutable adjustments and synthetic funding postings. Filter values are bound, never interpolated into SQL. Only named filters are accepted; repeated/unknown parameters, malformed identifiers, unsupported enums, invalid amount ranges and out-of-bounds pagination fail with controlled 400 responses.

Ordering is `created_at DESC, id DESC, kind DESC`; audit ordering is `occurred_at DESC, aggregate_id DESC, sequence DESC`. Limit is 1..100 and offset 0..10000. Offset pagination is deterministic within each snapshot, not an immutable multi-request cursor: concurrent new records can shift later pages. Every search response states its own snapshot. No cross-page consistency claim is made.

All amounts/counters cross the financial boundary as exact decimal strings. UTC ranges are inclusive from/exclusive to. Refund/reversal detail uses the compensating posting direction and links its original payment. Journal detail never silently truncates a journal; the explicit 100-entry limit yields a conflict. Related adjustments/events/failed work are bounded and expose `hasMore`.

Financial audit lists expose only explicit safe identity/action/version/time columns. They omit canonical bodies, hashes and arbitrary free-form metadata. Adjustment reasons remain available through existing authorized immutable adjustment receipts. A list or detail read displays `NOT_CHECKED` for audit integrity; only reconciliation executes the independent hash-chain check. There are no ledger/audit/balance edit APIs.

## Consistent independent read oracle

`AdminSnapshot` uses a dedicated `REQUIRES_NEW`, `REPEATABLE_READ`, read-only transaction. PostgreSQL enforces `SET TRANSACTION READ ONLY`; the service verifies the actual isolation and read-only flags. Its first query records the snapshot identity and UTC observation time. Every query in the investigation detail/reconciliation scan shares that snapshot. Statement timeout is eight seconds, lock timeout two seconds, and the transaction budget twelve seconds. Timeouts fail the operation; missing evidence never becomes PASS.

The oracle is independent SQL, not a call to the posting/validation function. It recomputes posted values from debit/credit entries with numeric aggregation, active reservation totals from holds, journal balance and exact business posting direction/reference/amount, payment/hold state, refund/reversal totals, durable command completion, payment event/settler/failed-work relationships, and audit canonical byte hashes/chains/heads plus current financial audit presence. It recognizes both immediate and scheduled transfer audit actions. Core PostgreSQL `sha256(bytea)` permits independent verification without granting runtime access to the extensions schema.

All eight checks are required. Full discrepancy counts are preserved while examples are capped at ten per category. Pending operations or unpublished work are operational backlog, not inherently corruption. Scope does not certify scheduler timing, external webhook receipt, performance, security or backup/restore. Database owners able to rewrite records and anchors remain outside the audit tamper-evidence boundary. No repair or invented balancing entry exists.

## Report persistence and uncertainty

The client preserves an owner-scoped report UUID before sending a request. The financial scan is entirely read-only. Once complete, a separate reporting-only `INSERT ... ON CONFLICT(id) DO NOTHING` saves its full snapshot report in the existing `reconciliation_runs` table. Runtime credentials have INSERT/SELECT but no UPDATE/DELETE there. This needs no migration and does not alter the protected financial path.

Same actor + UUID returns the original report (200 and `Idempotency-Replayed: true`); first insertion returns 201 and Location. A different actor's collision is 409. Concurrent requests may perform more than one read-only scan, but exactly one finished report is retained. Lost-response recovery survives reload and reauthentication and never replaces the original snapshot with a new result under the same ID. Only schema version, owner UUID and report UUID are persisted in the browser; no cookies, CSRF values, credentials, audit bodies or report data.

A failed report read/parse shows an error, not a stale success. The production TypeScript validator requires all eight distinct checks, exact counters, consistent totals/status, and real snapshot metadata before displaying results.

## Existing failed-work replay

Reuse the existing protected, audited replay command and original broker event identity; do not implement another financial replay engine. The P08F client strips the legacy response's raw envelope before exposing its UI model. The UI requires explicit confirmation, offers replay only for FAILED records, and clearly distinguishes accepted/re-published/settled. The legacy endpoint permits replay cycles but does not supply an idempotent command receipt. Consequently the UI never automatically resubmits after an ambiguous response; it requires a fresh authoritative read first.

## Verification and delivery

12 unit cases, 12 real PostgreSQL/HTTP integration cases, 24 production-client cases and 10 browser scenarios per desktop/tablet/mobile project are required by the P08F manifest/gate. Integration tests create actual disposable PostgreSQL and API processes. Snapshot isolation is tested against a concurrent independent commit. Real discrepancies are injected only with the isolated test orchestrator, then restored; tests prove the UI/service does not repair money. No privileged test controller or defect implementation is added to the release artifact.

The P08F gate chains the entire P01-P08E campaign, requires all new mapped tests and fifteen responsive screenshots, rejects failures/errors/skips, preserves zero functional retries, and records the exact clean source SHA. Evidence handoff remains separate from tested implementation commits.

The old one-use P08E evidence handoff is retired, not weakened: it had failed on `Production source advanced` after branch-consolidation housekeeping. Its immutable historical reports remain untouched. The temporary source workspace exporter is removed after its successful use. No branch consolidation, history rewrite or force push is performed in P08F.

## Limits and follow-on

No measured scale-performance claim is made. Existing indexes support identities/history; broad union/range scans and full reconciliation remain bounded by database timeouts. Reference dataset/query-plan measurements belong in the remaining P10 performance campaign. Historical reports and paged investigation are not general data export, security-event administration, arbitrary SQL, or financial repair consoles. Full product remains INCOMPLETE / NO_GO; P09-P11 remain separate work.
