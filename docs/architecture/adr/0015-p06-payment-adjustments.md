# ADR 0015: P06 payment cancellation and compensating adjustments

- Status: Accepted for P06 implementation; verification is recorded separately.
- Date: 2026-09-27
- Scope: cancellation, partial/full refunds, administrative reversal, adjustment reads and race proofs.

## Context

P05 established durable asynchronous payment acceptance and settlement. A payment is accepted as `PENDING` with an `ACTIVE` hold, then a worker either atomically settles it or safely fails it. The canonical specification also requires cancellation before settlement, partial/full refunds after settlement and a full administrative reversal. These commands are economically sensitive because they race settlement and subsequent recipient spending.

The original schema and protected `execute_command` function already reserved command kinds and tables for `CANCEL`, `REFUND` and `REVERSAL`. That source was deliberately treated as latent, unverified groundwork: no HTTP boundary, client contract, complete race matrix or permanent evidence claimed it as delivered.

## Decision

### One protected command boundary

All P06 money-affecting commands continue through `ledger.execute_command`. The API runtime cannot call `_post` or mutate journals, balances, holds, payments or adjustments directly. Each command is scoped by authenticated actor, operation kind, parent payment and idempotency key.

### Lock order and economic authority

Commands lock the parent payment first. They then lock involved balance rows in stable UUID order through the protected posting path. PostgreSQL remains the only spending authority.

- Cancellation wins only while the locked payment is `PENDING`. It changes the hold from `ACTIVE` to `RELEASED`, removes the reservation and posts no journal.
- Settlement and cancellation serialize on the payment row. Exactly one transition wins.
- Refund and reversal require a locked `SETTLED` payment. The recipient account is the compensating debit source and must have sufficient current availability.
- Concurrent refunds serialize on the payment row, so successful refund totals cannot exceed the original settlement.
- Reversal and recipient spending serialize on the same balance rows. One may succeed; the other receives a controlled insufficient-funds rejection.

### Authorization and disclosure

- Cancellation: original payer or ADMIN. ADMIN requires a bounded reason.
- Refund: original recipient owner or ADMIN. The payer is explicitly forbidden from self-authorizing a refund.
- Reversal: ADMIN only, with a bounded reason.
- Adjustment reads: payer, recipient owner or ADMIN.
- Unrelated customers receive non-disclosing `404` responses.

Authorization checks occur both at the HTTP/service boundary and in the protected database command. Reversal role rejection occurs without disclosing payment existence to a non-admin.

### Immutable compensation, not mutation

Refund and reversal create new adjustment identities and balanced journals. They never rewrite the original payment journal. The payment base state remains `SETTLED`; `NONE`, `PARTIALLY_REFUNDED`, `FULLY_REFUNDED` and `REVERSED` are derived from immutable successful adjustments.

V8 adds a deferred integrity trigger that independently verifies each committed adjustment against its parent payment, journal header, exact debit/credit entries, actor authority and maintained aggregate flags. Historical migrations V1-V7 are not edited.

### API contract

P06 adds:

- `POST /api/v1/payments/{id}/cancel`
- `POST /api/v1/payments/{id}/refunds`
- `POST /api/v1/payments/{id}/reversal`
- `GET /api/v1/payments/{id}/adjustments`
- `GET /api/v1/payments/{id}/adjustments/{adjustmentId}`

Every command requires the existing session, CSRF boundary and a bounded `Idempotency-Key`. Successful refunds/reversals return the immutable adjustment identity and a resource `Location`. Cancellation points back to the payment resource. An uncertain client outcome must retain and replay the exact normalized intent and key.

The P05 payment DTO is not expanded with a new refunded-amount field, preserving its strict snapshot shape. P06 adds adjustment resources and uses the already-existing derived `adjustmentState` field.

## Verification obligations

P06 is not complete merely because endpoints exist. Verification must include real PostgreSQL, two independent API JVMs, synchronized races, exact accounting reconciliation, HTTP authorization/CSRF behavior, TypeScript uncertain-outcome replay and a live Compose campaign. All P01-P05 suites must continue to pass.

## Consequences

- Economic history stays auditable and append-only.
- Database locking, rather than JVM synchronization, governs multi-process races.
- Reversal cannot manufacture funds; it can lose to legitimate recipient spending.
- Versioned OpenAPI snapshots P03-P05 remain unchanged while P06 describes the expanded contract.
- Frontend screens remain P08 work, but their typed command and recovery boundary is available now.
