# Execution checkpoint — P05 VERIFIED_PASS

Overall product status remains **INCOMPLETE / NO_GO**. P05 asynchronous payment reliability is implemented, published on `main` and verified. This does not mark P06–P11 complete.

## Verified implementation

- Repository: `azerish25-ux/transaction-reliability-lab`; branch: `main`.
- Published P05 source: `bbca6dd7478e33320aa134f6cd59c9652f4b60db`.
- Published source tree: `992c8c0b89e17a96b42e631d7ba6e313957d1984`.
- Permanent verification run: `36285547632` — SUCCESS.
- Verification job: `108525519311`; required gate: `108526205503`.
- Seven Flyway migrations; P01–P04 behavior and evidence remain preserved.

## P05 delivered

Authenticated CUSTOMER requests can create asynchronous payments through `POST /api/v1/payments` with CSRF and a mandatory bounded idempotency key. Acceptance atomically records one `PENDING` payment, one `ACTIVE` hold, the replayable response, an append-only audit record and a stable `payment.requested` outbox event before returning `202` and a resource location. No journal is posted at acceptance.

An independently restartable publisher claims bounded outbox batches through durable leases, publishes persistent messages to durable RabbitMQ topology with mandatory routing and correlated confirms, and marks publication only after broker confirmation. Two independent manual-ack workers compete for settlement work. They acknowledge only after PostgreSQL commits the protected settlement transaction.

Settlement consumes the hold, posts one balanced journal, updates balances and payment state, appends audit/outbox records and durably records consumer/event processing in one transaction. Duplicate redelivery, a logically repeated event with another message ID and stale projection events cannot create a second posting or regress status.

The API remains ready when RabbitMQ is unavailable. Accepted work remains durably pending, immediate transfers continue, and recovery drains the backlog after the broker returns. Failed/poisoned work is bounded per consumer, inspectable by ADMIN and replayable through an audited path that preserves original event and payment identities. The version-aware projection is observational and is never spending authority.

The current API contract is `/api/v1/openapi/p05.json`. The Compose topology contains PostgreSQL, RabbitMQ, API, publisher and two workers.

## Verified results

- Core/configuration JUnit: 133 passed; zero failures/errors/skips.
- PostgreSQL and real HTTP integration: 100 passed; zero failures/errors/skips.
  - Authentication/account HTTP: 58.
  - Immediate-transfer HTTP: 28.
  - PostgreSQL financial/payment: 13.
  - Outbox failure-boundary regression: 1.
- TypeScript: 44 existing client, 6 authentication, 7 transfer and 5 payment cases passed.
- Live Compose P05 campaign: 42 checks passed.
- Seven migrations, restricted runtime identity, Compose validation, limited literal-secret scan, repeated reconciliation and scoped teardown passed.
- Thirty-four scoped P03/P04/P05 requirements resolved to executed passing evidence.

The standalone execution of 120 core case bodies repeats the core JUnit cases and is not counted as additional unique tests. The literal scan is not comprehensive security assurance.

## Reliability proofs

- **Acceptance boundary:** `202` was returned only after the payment, hold, audit, idempotency result and outbox event committed; no journal existed at acceptance.
- **Two-worker settlement:** either worker could settle independently, while competing delivery still produced one journal and one economic effect.
- **Broker outage:** API readiness, payment acceptance and immediate transfers continued; accepted payments remained pending and settled after RabbitMQ recovery.
- **Publisher crash:** death after broker confirmation but before outbox marking caused safe republishing with one committed effect.
- **Worker crash:** death after PostgreSQL settlement commit but before Rabbit acknowledgement caused redelivery without a second posting.
- **Duplicates/order:** duplicate event IDs, logical duplicates with different IDs and stale projection snapshots were harmless.
- **Poison work:** both independent consumers recorded bounded failed work; ADMIN inspection and audited replay preserved identity without creating another payment.
- **Failure bounds:** 500-character publisher diagnostics remain available on the outbox record while the failed-work code is safely bounded to its 200-character schema contract.

## Findings resolved

The first live candidate run exposed an incorrect smoke assumption that one malformed event would create one global failed-work row. The design correctly records one row per consumer/event, so the proof was corrected to require both settlement and projection consumer records.

A focused test then exposed that a valid 500-character outbox diagnostic could exceed the failed-work code limit. The unreleased V7 migration now bounds the failed-work code while retaining the full outbox diagnostic. A temporary V8 migration was folded back into unreleased V7 to preserve the expected seven-migration history.

A pre-publication workflow completed every verification step but its final Git push was rejected because the Actions token could not modify workflow files. The authorized repository Git-data route published the exact verified tree to `main`, after which the permanent push workflow verified the final remote SHA.

## Next executable milestone

**P06:** implement customer/admin cancellation before settlement, recipient-authorized partial/full refunds, ADMIN full reversal, derived adjustment states, and the complete authorization/forbidden-transition/concurrency race matrix. Preserve every P01–P05 suite and financial invariant.
