# ADR 0013 — P04 immediate transfer and uncertain-outcome boundary

Status: implemented candidate; the exact execution verdict is recorded in `docs/implementation/PROGRESS.md`.

## Decision

P04 exposes the existing protected PostgreSQL transfer command instead of implementing a second ledger path. `TransferService` derives the actor from the verified P03 principal, normalizes the economic intent, and invokes `FinancialCommands.execute(actor, "TRANSFER", null, key, payload, correlationId)`. The runtime role cannot insert transfers, journals, entries, audit records, idempotency outcomes or outbox events directly.

A successful command commits the transfer row, balanced journal, two entries, account balances, financial audit, idempotency response and outbox event in one PostgreSQL transaction. HTTP success is returned only after JDBC commit returns. The creation receipt is the exact durable command response. Owner-scoped GET/list responses join only the destination public reference and never disclose the destination account UUID, owner identity, balance or unrelated history.

## Idempotency

`Idempotency-Key` is mandatory and bounded to the existing 8–128 character syntax. Scope is authenticated actor, operation kind `TRANSFER`, empty parent scope and key. PostgreSQL fingerprints the normalized JSONB intent, so incidental property ordering does not matter. Source ownership and malformed intent are rejected before claim. Same scope/key/fingerprint returns the original status/body/resource and `Idempotency-Replayed: true`; a changed economic field returns `409 IDEMPOTENCY_CONFLICT`; deterministic accepted business rejections are persisted and replayed.

The frontend stores only the normalized economic intent, key, owner and resolution state. Network loss or a keyed 5xx becomes `OutcomeUnknown`; the same stored key and intent must be replayed. A deterministic 4xx rejection becomes `REJECTED`. Logout does not erase an uncertain operation.

## Commit uncertainty proof

The integration suite uses a test-only TCP proxy outside the application artifact. It forwards a real authenticated transfer request, consumes the complete upstream HTTP response after the controller has returned from the committed command, then resets the downstream client connection before returning any response bytes. The client therefore observes a lost response while the database contains the committed transfer. Replaying the exact key/intent through the normal API must return the original ID and leave exactly one journal/two entries. No production fault hook or alternate posting method is packaged.

## Concurrency and lock ordering

The existing posting function validates aggregate identities, then locks relevant account-balance rows in stable UUID order. All retries acquire a new JDBC connection/transaction and only deadlock/serialization states are retried, with bounded attempts/time. The required cross-process proof starts with 10,000 available and synchronizes two 8,000 requests through separate API JVMs. Exactly one may commit; the other must receive persisted `INSUFFICIENT_FUNDS`. Additional tests cover concurrent same-key replay, many clients on one account, opposite directions and independent accounts.

## OpenAPI compatibility

`/api/v1/openapi.json` remains the immutable P03 compatibility snapshot so previously verified consumers are not silently relabeled. The current contract is `/api/v1/openapi/p04.json`; it includes transfer command/read paths and explicitly omits asynchronous payment APIs. P05 may add a new versioned document.

## Limits

P04 does not implement RabbitMQ publishing/consumption, asynchronous payments, cancellation, refunds, reversal, schedules, webhooks, React/browser journeys or release certification. Outbox rows are committed for later P05 processing, but P04 does not claim they are published. Offset pagination is stable within the specified ordering but is not a snapshot cursor under concurrent insertions.
