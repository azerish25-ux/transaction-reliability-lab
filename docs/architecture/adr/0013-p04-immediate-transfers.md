# ADR 0013 — P04 immediate transfer and uncertain-outcome boundary

Status: implemented and verified by source `60a95db82350983eaf1ad3c7545190866c831f98`, GitHub Actions run `36276049817`; the full product remains NO_GO.

## Decision

P04 exposes the existing protected PostgreSQL transfer command instead of implementing a second ledger path. `TransferService` derives the actor from the verified P03 principal, normalizes the economic intent, and invokes `FinancialCommands.execute(actor, "TRANSFER", null, key, payload, correlationId)`. The runtime role cannot insert transfers, journals, entries, audit records, idempotency outcomes or outbox events directly.

A successful command commits the transfer row, balanced journal, two entries, account balances, financial audit, idempotency response and outbox event in one PostgreSQL transaction. HTTP success is returned only after JDBC commit returns. The creation receipt is the exact durable command response. Owner-scoped GET/list responses join only the destination public reference and never disclose the destination account UUID, owner identity, balance or unrelated history.

## Idempotency

`Idempotency-Key` is mandatory and bounded to the existing 8–128 character syntax. Scope is authenticated actor, operation kind `TRANSFER`, empty parent scope and key. PostgreSQL fingerprints the normalized JSONB intent, so incidental property ordering does not matter. Source ownership and malformed intent are rejected before claim. Same scope/key/fingerprint returns the original status/body/resource and `Idempotency-Replayed: true`; a changed economic field returns `409 IDEMPOTENCY_CONFLICT`; deterministic accepted business rejections are persisted and replayed.

The frontend stores only normalized economic intent, key, owner and resolution state. Network loss or a keyed 5xx becomes `OutcomeUnknown`; the same stored key and intent must be replayed. A deterministic 4xx rejection becomes `REJECTED`. Logout does not erase an uncertain operation.

## Commit uncertainty proof

The integration suite uses a test-only TCP proxy outside the application artifact. It forwards a real authenticated transfer request, consumes the complete upstream HTTP response after the controller has returned from the committed command, then resets the downstream connection before returning response bytes. The client observes a lost response while PostgreSQL contains the committed transfer. Replaying the exact key/intent through the normal API returns the original ID and leaves exactly one transfer/journal/two entries. No production fault hook or alternate posting method is packaged.

## Concurrency and lock ordering

The existing posting function locks relevant account-balance rows in stable UUID order. Every retry uses a new JDBC connection/transaction; only classified deadlock/serialization states receive bounded whole-transaction retry. Retry logs use JDK `System.Logger` so the shared adapter remains compatible with the dependency-light standalone core boundary.

The canonical executed proof starts with 10,000 available and synchronizes two 8,000 requests through separate API JVMs. Exactly one commits; the other receives persisted `INSUFFICIENT_FUNDS`. Additional passing tests cover concurrent same-key replay, eight-client pressure on one account, opposite directions and independent accounts.

## OpenAPI compatibility

`/api/v1/openapi.json` remains the immutable P03 compatibility snapshot so previously verified consumers are not silently relabeled. The current contract is `/api/v1/openapi/p04.json`; it includes transfer command/read paths and explicitly omits asynchronous payment APIs. P05 may add a new versioned document.

## Evidence

The durable execution report is `docs/evidence/p04-60a95db.md`. The generated artifact contains the actual XML, requirement matrix, process logs and live Compose smoke result. Ten scoped P04 requirements and all fourteen P03 requirements resolve to passing case names.

## Limits

P04 does not implement RabbitMQ publishing/consumption, asynchronous payments, cancellation, refunds, reversal, schedules, webhooks, React/browser journeys or release certification. Outbox rows are committed for later P05 processing but are not claimed published. Offset pagination has stable ordering but is not a snapshot cursor under concurrent insertions.
