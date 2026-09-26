# ADR 0014 — P05 asynchronous payment, outbox and worker boundary

Status: implemented candidate; verification evidence must come from the P05 GitHub Actions lane before this decision is marked verified. The full product remains NO_GO.

## Decision

Payment acceptance remains a synchronous PostgreSQL transaction, while settlement is asynchronous durable work. `POST /api/v1/payments` calls the protected `PAYMENT` command through the same restricted JDBC adapter used by immediate transfers. Acceptance creates one `PENDING` payment, one `ACTIVE` hold, the durable idempotency response, financial audit and a `payment.requested` outbox row atomically. It returns `202` only after commit and does not create a journal.

The API does not connect its readiness to RabbitMQ. Authentication, account reads, immediate transfers and durable payment acceptance remain available while the broker is down. RabbitMQ connectivity belongs to separately restartable publisher/worker processes.

## Publication

An independent outbox process claims bounded due rows with PostgreSQL `FOR UPDATE SKIP LOCKED`, a unique lease owner and an expiring lease. It publishes a stable full-snapshot envelope using the outbox UUID as the RabbitMQ message ID, persistent delivery mode, a durable exchange/queue topology, mandatory routing and correlated publisher confirms. `published_at` is written only after broker acknowledgement and the absence of a returned/unroutable message.

Death after confirmation but before the database mark leaves the claim leased. Expiry permits republication with the same event ID. This intentionally provides at-least-once delivery rather than claiming exactly-once RabbitMQ delivery.

## Consumption and financial authority

Two independent worker services compete on the same settlement queue with bounded prefetch and manual acknowledgement. The worker calls the existing protected `settle_event` transaction. That transaction locks the payment, inserts `(payment-settler-v1,event_id)` into the consumer inbox, consumes the hold, posts through the protected double-entry function, changes the payment to `SETTLED`, writes audit/outbox state and commits as one unit. A duplicate event ID returns `DUPLICATE`; a logically repeated message with a different event ID observes the non-`PENDING` payment and cannot post again.

The Rabbit delivery is acknowledged only after the PostgreSQL transaction returns from commit. Process death after commit but before acknowledgement therefore causes a safe redelivery and never a second journal. Permanent pre-posting business failure releases the hold and records `FAILED`; transport or broker failures do not relabel an already committed payment.

## Retry, poison work and replay

Transient consumer failures are republished with confirms to consumer-specific durable delay queues. Retry count and delay are bounded; main queues do not use an immediate nack/requeue loop for application failures. Malformed or exhausted work is stored in `failed_work`, rejected to a durable dead-letter queue and exposed to ADMIN inspection.

An administrator may request replay through a protected API. The request and completion are append-only audited. The publisher republishes the retained event/message identity; replay is not a new payment instruction. A replay failure returns the work to `FAILED` rather than looping indefinitely.

## Projection and recovery

The payment projection is explicitly observational and cannot authorize spending. Its consumer deduplicates in the same database transaction as projection update. Full snapshots apply only when aggregate version increases; older events and invalid terminal-state transitions cannot regress state.

Periodic recovery scans bounded stale `PENDING` payments. It reactivates the original `payment.requested` outbox row—preserving its event ID—or reconstructs a missing row from authoritative payment state. Expired publisher/replay leases are reclaimable. Recovery may reschedule durable work but never invent balances, delete history or post outside the protected financial command.

## Proof boundary

The P05 lane must exercise real PostgreSQL, RabbitMQ, the API, one publisher and two workers. Required proofs include broker-down acceptance, publisher death after confirm, worker death after commit, duplicate delivery with another message ID, stale projection delivery, poison-message inspection/replay and independent reconciliation. Unit tests or mocked broker calls alone are not sufficient.

## Limits

P05 does not complete cancellation/refund/reversal HTTP workflows, schedules, signed webhooks, React/browser journeys, the seeded defect/fault laboratory, performance/security release lanes or final evidence/video. Those remain P06–P11.
