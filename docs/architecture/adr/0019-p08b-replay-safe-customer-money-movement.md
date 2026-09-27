# ADR 0019: P08B replay-safe customer money movement

- Status: Accepted for P08B candidate verification
- Date: 2026-09-27
- Scope: customer immediate transfers, asynchronous payments, payment status/history and pending cancellation

## Context

P04–P06 already provide verified transfer, payment, cancellation, refund and reversal APIs with durable idempotency, protected ledger posting, holds, outbox/inbox processing and race tests. P08A added the first real same-origin customer browser journey, but deliberately omitted money-moving controls rather than shipping inert or fabricated buttons.

A browser creates a new reliability boundary. A POST can commit in PostgreSQL while its response is lost. Treating that as a normal failure and generating a new idempotency key can duplicate economic intent. Likewise, displaying a `202` payment as settled would be false: acceptance only proves that the pending payment, active hold, idempotency outcome, audit record and outbox event were durably recorded.

## Decision

1. The browser stores only normalized economic intent, operation kind, owner identity, idempotency key, state and creation time in owner-scoped local storage. Authentication cookies, CSRF tokens and session material are never stored there.
2. Transfer and payment inputs are normalized with operation-specific validation before persistence. Invalid recipient references cannot leave a `PREPARED` command behind.
3. A new idempotency key is generated only for a new explicit customer instruction. A network failure, timeout, HTTP 408 or qualifying 5xx preserves the same normalized request and key as `UNCERTAIN`.
4. While an instruction is `PREPARED` or `UNCERTAIN`, the interface blocks a conflicting new instruction and directs the customer to safe resolution.
5. Immediate transfers require an explicit confirmation dialog and show success only after an authoritative settled receipt is returned or replayed. The receipt exposes the customer’s stable transfer/journal references without counterparty balances.
6. Payment creation requires explicit confirmation and shows `PENDING` on durable `202` acceptance. The detail page polls `GET /payments/{id}` with bounded increasing delays and stops at `SETTLED`, `FAILED` or `CANCELLED`. Polling failure never changes economic state.
7. Cancellation is visible only for an outgoing `PENDING` payment, has its own idempotency key and confirmation, and refreshes the payment resource after success or deterministic race rejection. The refreshed resource—not optimistic UI—is authoritative.
8. Refund/reversal, schedule, webhook and administrator interfaces remain outside P08B. Their existing backend verification remains in the regression gate.

## Consequences

- Reload, session expiry and response loss do not silently discard uncertain money movement.
- A customer may be temporarily blocked from creating another money command until the preserved instruction is resolved; this is intentional protection against duplicate intent.
- Local storage contains synthetic economic routing data and exact amounts. It remains owner-scoped and contains no credentials, but it is not treated as an authoritative financial store.
- Payment pages may show pending for an extended period or pause automatic polling after a bounded campaign. Manual refresh remains safe.
- P08B does not make LedgerGuard a production financial service and does not complete the full P08 or product release scope.
