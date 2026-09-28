# ADR 0020 — Authorized adjustment review, immutable receipts and retained uncertain intent

Status: accepted implementation decision; verification status belongs to the exact-SHA evidence, not this ADR.

## Context and boundary

P06 already implements protected cancellation/refund/reversal postings, locking, idempotency and independent financial verification. P08B exposes transfers, payments and pending cancellation. P08C adds the missing customer refund and narrow administrator reversal interface without replacing the financial engine. Synthetic money only; the complete product remains INCOMPLETE / NO_GO.

The original customer payment GET is correctly CUSTOMER/owner scoped. Administrators could execute reversals but could not safely obtain a complete payment review through that route. The existing paginated adjustment list is also not a sound source for a remaining-refundable total.

## Decision

Add a read-only `PaymentAdjustmentQueries` service and two narrow routes: customer `/payments/{id}/adjustment-context` and ADMIN `/admin/payments/{id}/adjustment-context`. One PostgreSQL statement joins the parent, account ownership/public references and recipient balance/version, producing a consistent review snapshot. The customer query requires participant ownership. Payers receive null recipient balance/version; only the recipient owner and ADMIN may inspect that availability. Existing HTTP role enforcement and explicit service role checks are both retained. Unauthorized/missing resources use the established security denial event, not a new silently unpersistable event type.

No migration or new financial posting path is introduced. Existing financial commands recheck the parent, cumulative adjustments and current availability under their existing lock ordering; the review snapshot never authorizes a spend. The UI handles stale reviews as controlled rejections and refreshes authoritative state. Full reversal remains ADMIN-only, mandatory reason, full amount and zero prior successful adjustments. Recipient refunds preserve the original settlement and use separate compensating journals. A payer's read access is not refund authority.

Remaining refundable and refunded totals come from the parent context, not a sum of a displayed history page. Money parsing and arithmetic remain exact decimal strings/BigInt. Original settlement and adjustment receipts are shown separately. Native modal dialogs provide an inert background and keyboard focus containment; adjustment confirmation initially focuses the non-destructive action and restores focus on dismissal. Shared product primitives were extracted from P08B rather than copied.

## Uncertain outcomes and session boundaries

Reuse the production `IntentStore` and `ApiClient`. Persist the normalized parent, amount/reason and original key before sending. Keep owner-scoped economic intent through reload, logout and session expiry; do not persist authentication/CSRF material. Route saved refunds to their payment and reversals to their restricted administrator page. A malformed successful response is still an unknown financial outcome and must not unlock a replacement command.

Fix the previously broad `status < 500` rejection rule: 401, CSRF expiry, throttling and idempotency conflicts cannot erase uncertainty. A later authorization or read denial does not prove that an earlier command rolled back. Same-key recovery remains available even if the current record now shows a full refund/reversal. Explicit deterministic business rejection may resolve an instruction, but HTTP failure is never itself a new economic state.

Corrupt/unavailable browser storage fails closed for adjustment submission. Server-side role and amount controls remain authoritative even when JavaScript is bypassed. The local single-instruction slot is a convenience, not a distributed financial lock; existing backend parent locks, request fingerprints and unique operation identities supply financial concurrency protection.

## Verification and test-only differences

P08C has compiled production-client contracts, three additional real PostgreSQL/two-process HTTP integration cases and ten real Chromium scenarios repeated at 1440x900, 768x1024 and 390x844. Browser settlement uses the existing outbox/RabbitMQ workers. Lost-response scenarios let the real POST commit (`route.fetch`) before cutting the response; they never mock successful posting. Independent SQL recomputes compensating debit/credit totals, identities, direction, currency and wallet reconciliation from immutable entries. P06's coordinated multi-instance race proofs remain in the gate.

Fixture setup creates unique accounts through real authenticated HTTP and funds them through a balanced protected posting with the disposable owner role. No public top-up or balance-edit endpoint is introduced. A loopback-only check and explicit Compose credentials constrain fixture mutation to the test target. `compose.p08c-test.yaml` raises only the shared CI IP authentication budget to 1000 for the browser campaign; normal per-identity limits and normal app defaults are unchanged. Earlier security/throttle tests run before this overlay. The overlay is not part of `scripts/lab up` or a release deployment.

Playwright functional retries are zero. Strict type-checking now includes the actual browser suite. Pin `playwright-core` to the existing runner's exact 1.51.1 because axe's broad peer range had selected a different incompatible core version. No unrelated package upgrade is made.

Authenticated raw traces can contain cookies, CSRF and fixture credentials. The permanent artifact publication excludes raw trace ZIPs; screenshots and redacted assertions remain. Automated axe and keyboard checks are partial accessibility coverage, not whole-product WCAG certification or a claimed screen-reader audit. The final evidence records actual executed counts and source identity, not planned counts.

## Remaining work

This is not transaction-wide administrator search, audit inspection, a scheduler UI, webhook UI, the isolated fault/defect laboratory, or the final release. Those remain later P08/P09-P11 requirements. A new schema/contract field must preserve owner privacy and the exact-money representation; a richer admin console must not weaken this narrow authorization boundary.
