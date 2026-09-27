# Execution checkpoint — P05 implementation candidate

Overall product status remains **INCOMPLETE / NO_GO**. P01–P04 remain verified. P05 asynchronous payment reliability is implemented on the candidate branch but must not be called `VERIFIED_PASS` until the complete P05 GitHub Actions lane succeeds and durable evidence is recorded.

## Candidate implementation

- Customer payment acceptance API with exact-string money, CSRF, mandatory durable idempotency and owner/relevant-party reads.
- Atomic `PENDING` payment, `ACTIVE` hold, idempotency result, audit and `payment.requested` outbox creation; no journal at acceptance.
- Independently restartable leased outbox publisher using durable RabbitMQ topology, persistent messages, mandatory routing and correlated confirms.
- Two competing manual-ack workers; acknowledgement occurs only after the protected PostgreSQL settlement transaction commits.
- Consumer/event inbox deduplication plus payment-state business deduplication for logically repeated messages carrying another event ID.
- Version-aware full-snapshot payment projection that rejects stale/regressive events and is never spending authority.
- Bounded retry queues, durable failed-work inspection, ADMIN-authorized append-only-audited replay, expired lease recovery and stale-pending reconciliation.
- API readiness separated from RabbitMQ availability so immediate transfers and durable acceptance continue during broker outage.
- Versioned `/api/v1/openapi/p05.json`, TypeScript payment client/uncertain-intent persistence and P05 traceability manifest.

## Candidate proof suite

The lane is configured to execute all previous P01–P04 suites plus:

- PostgreSQL projection/replay authorization tests.
- Two-process HTTP payment acceptance, replay, conflict, reservation concurrency, privacy and broker-independent API tests.
- TypeScript payment/intent tests.
- A live Compose campaign with PostgreSQL, RabbitMQ, one publisher and two workers.
- Real process death after publish-confirm/before outbox marking.
- Real process death after settlement commit/before Rabbit acknowledgement.
- Broker outage and recovery, duplicate event with a different ID, stale projection delivery and poison-message replay.
- Final independent reconciliation and generated P03/P04/P05 requirement evidence.

## Next executable action

Run the complete candidate through GitHub Actions, fix any compile, migration, topology or recovery findings at their root, rerun until the required gate passes, and then record the tested source SHA/run as durable P05 evidence. Only after that should development proceed to **P06 cancellation, partial/full refunds, administrative reversal and their authorization/race transition table**.
