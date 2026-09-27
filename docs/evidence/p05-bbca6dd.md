# P05 asynchronous-payment reliability — VERIFIED_PASS

## Decision

**Status: VERIFIED_PASS for the P05 milestone.**  
**Full-product status: INCOMPLETE / NO_GO.**

Published implementation: `bbca6dd7478e33320aa134f6cd59c9652f4b60db`  
Published tree: `992c8c0b89e17a96b42e631d7ba6e313957d1984`  
Branch: `main`  
Workflow run: `36285547632`  
Verification job: `108525519311`  
Required gate: `108526205503`  
Artifact: `10920557373` (`sha256:b509e74ea2038f5cb58a529fa2ae0df43e7d82131d04145061c47f8b66c6098a`)

P05 is limited to accepted asynchronous payments, fund reservations, transactional-outbox publication, RabbitMQ settlement, consumer deduplication, status projection, failed-work handling and recovery. P06–P11 remain outside this decision.

## Delivered behavior

Payment acceptance requires an authenticated CUSTOMER, CSRF and a bounded `Idempotency-Key`. The PostgreSQL command atomically commits:

- one `PENDING` payment;
- one `ACTIVE` hold;
- one replayable idempotency outcome;
- one append-only audit record; and
- one stable `payment.requested` outbox event.

The API returns `202` and a stable resource location only after that transaction commits. No journal exists at acceptance.

The independently restartable publisher claims bounded batches with durable leases, publishes persistent messages using mandatory routing and correlated confirms, and marks outbox publication only after confirmation. Two independent workers consume with manual acknowledgement. They acknowledge only after the protected settlement transaction commits.

Settlement atomically consumes the hold, posts one balanced journal, updates account balances and payment state, writes audit/outbox records and records the consumer/event identity. Redelivery is permitted; a second financial effect is not.

The status projection accepts only newer aggregate versions. It is observational and never authorizes spending. Failed work is recorded per consumer/event, bounded, inspectable by ADMIN and replayable through an append-only-audited path that preserves original identities.

## Executed verification

| Boundary | Passed | Failed / errors / skipped |
|---|---:|---|
| Core and security-configuration JUnit | 133 | 0 / 0 / 0 |
| Authentication/account HTTP integration | 58 | 0 / 0 / 0 |
| Immediate-transfer HTTP integration | 28 | 0 / 0 / 0 |
| PostgreSQL financial/payment integration | 13 | 0 / 0 / 0 |
| Outbox failure-boundary integration | 1 | 0 / 0 / 0 |
| Existing TypeScript client | 44 | 0 |
| Authentication TypeScript | 6 | 0 |
| Transfer TypeScript | 7 | 0 |
| Payment TypeScript | 5 | 0 |
| Live Compose P05 assertions | 42 | 0 |

Additional executed gates:

- Seven Flyway migrations applied and historical upgrade checks passed.
- Docker Compose model validation passed.
- Runtime used the restricted `ledger_runtime` identity.
- The configured scan checked 241 tracked text files with zero high-signal literal-secret findings.
- Reconciliation completed repeatedly with zero discrepancies.
- Thirty-four scoped P03/P04/P05 requirements resolved to executed passing evidence.
- Scoped teardown passed.

The standalone dependency-light run executes the same 120 core case bodies and is not counted as 120 additional unique tests. The literal scan is a narrow regression control, not security certification.

## Reliability proofs

### Atomic acceptance and idempotency

The live API proved that acceptance creates the payment, hold, audit, replay outcome and outbox event together while leaving journals untouched. Identical key/intent replay returned the same payment. Changed intent did not create a second operation.

### Two-worker settlement

Each worker was independently capable of settlement. Competing workers and duplicate delivery produced one consumed hold, one payment journal and one committed economic effect.

### Broker outage

RabbitMQ unavailability did not make the PostgreSQL-backed API unready. Authentication, account reads, immediate transfers and durable payment acceptance continued. Accepted payments remained pending and settled after broker recovery.

### Publisher death

The publisher was terminated after broker confirmation but before durable outbox marking. Lease recovery republished the stable event without creating a second financial effect.

### Worker death

A worker was terminated after PostgreSQL settlement commit but before Rabbit acknowledgement. Redelivery was deduplicated and did not produce another journal.

### Duplicate and stale messages

A duplicate event ID, a logical duplicate carrying another event ID and an older projection snapshot could not repeat settlement or regress observed status.

### Poison work and replay

The malformed event was delivered to both independent consumers. The proof required one failed-work record for `payment-settler-v1` and one for `payment-projection-v1`, matching the `(consumer,event)` identity. ADMIN inspection and audited replay preserved the original event/payment identity and did not create a second payment.

### Bounded failure diagnostics

A focused Testcontainers case proved that a valid 500-character publisher diagnostic can always transition to durable failed work: the full diagnostic remains on the outbox record, while the failed-work code is truncated to its 200-character schema contract.

## Findings and corrections

1. **Incorrect poison assertion:** the first live candidate expected one global failed-work row. The implementation correctly records one row per consumer/event. The smoke proof was corrected and rerun.
2. **Failure-code width mismatch:** `fail_outbox` accepted diagnostics up to 500 characters, while failed work accepts 200. V7 now bounds the failed-work code and preserves the complete outbox error. A focused integration test protects the boundary.
3. **Migration-history noise:** the fix was initially added as V8, causing the existing seven-migration assertion to fail. Because P05 was unreleased, the change was folded into V7 and V8 removed; the clean migration and upgrade suite then passed.
4. **Publication permission:** a pre-publication workflow completed all verification but its final Git push could not modify workflow files with the Actions token. The authorized repository Git-data route published the verified tree, and the permanent push workflow tested the exact remote SHA.

No failed candidate run is counted as a passing result.

## Remaining work

P06 cancellation/refund/reversal, P07 schedules/webhooks, P08 React/browser/accessibility, P09 F01–F08 and D01–D24 laboratory work, P10 full contracts/scanning/performance/restore lanes and P11 final evidence/video remain incomplete. No public deployment, release tag, compliance certification, accessibility conformance, production-readiness or performance claim is made.
