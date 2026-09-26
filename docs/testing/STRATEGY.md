# Risk-based test strategy

## Scope and evidence discipline

The complete target is the unchanged `MASTER_SPEC.md`. P01–P04 have executed durable evidence. P05 is an implemented candidate and must not be marked `VERIFIED_PASS` until its complete GitHub Actions lane succeeds against the exact source SHA. P06–P11 remain open.

Financial correctness has priority over presentation. All money is synthetic; no live identities, third-party payment targets or arbitrary egress are allowed. A component test is not evidence of database locking, a mocked Fetch response is not a broker proof, and an unexecuted test source is not evidence. Every mandatory suite must report nonzero discovery with zero failures, errors and skips.

## Risk scoring

Impact, likelihood and detection difficulty are analyst-assigned ordinal 1–5 scales, not incident probabilities. Impact 5 means possible money loss/creation or unauthorized financial access; likelihood 5 means routine triggering inputs; detection difficulty 5 means silent delayed harm. Their product prioritizes depth, but every financial/authentication gate remains mandatory regardless of score.

| Risk | Boundary and independent oracle | I | L | D | Priority | Current state |
|---|---|---:|---:|---:|---:|---|
| R01 duplicate command | Same actor/kind/key/normalized intent → one operation and one financial effect | 5 | 5 | 4 | 100 | P04 verified; P05 acceptance/replay candidate |
| R02 concurrent spending/reservation | Separate API processes cannot post or reserve beyond availability | 5 | 4 | 4 | 80 | P04 posting verified; P05 reservation race candidate |
| R03 response lost after commit | Replaying the original key resolves the durable result | 5 | 4 | 5 | 100 | Immediate transfer verified; payment client intent preservation candidate |
| R04 publisher crash | Broker-confirmed event with an unmarked outbox row is safely republished | 5 | 3 | 5 | 75 | Real process-death Compose proof configured for P05 |
| R05 worker crash | Settlement commit before acknowledgement redelivers without a second journal | 5 | 4 | 5 | 100 | PostgreSQL dedup plus real process-death proof configured for P05 |
| R06 duplicate/logical duplicate event | Inbox identity and payment state prevent extra committed effects | 5 | 4 | 5 | 100 | Database and Rabbit duplicate proofs configured for P05 |
| R07 reordered/future event | Aggregate version cannot regress or outrun authoritative payment state | 4 | 4 | 4 | 64 | Projection database and stale-delivery proofs configured for P05 |
| R08 partial transaction failure | Payment, hold, balances, journal, audit, inbox and outbox remain atomic | 5 | 4 | 5 | 100 | Database constraints plus acceptance/settlement inspection configured |
| R09 representation/overflow | String minor units agree across client, API and ledger | 5 | 4 | 5 | 100 | Java/TypeScript verified in earlier phases; payment extension candidate |
| R10 cross-user access | Relevant-party reads reveal no private counterparty UUID/owner/balance | 5 | 4 | 4 | 80 | Account/transfer verified; payment privacy candidate |
| R11 privilege escalation | CUSTOMER cannot administer replay; ADMIN cannot spend customer funds | 5 | 3 | 4 | 60 | Prior role boundary verified; failed-work replay/payment denial candidate |
| R12 broker outage | API and immediate transfers remain healthy; payment backlog drains later | 4 | 4 | 4 | 64 | Real RabbitMQ outage/recovery campaign configured for P05 |
| R13 poison/retry exhaustion | No hot requeue loop; bounded failed work remains inspectable and replayable | 4 | 4 | 4 | 64 | Bounded queues, permanent validation and replay campaign configured |
| R14 migration/restore | Historical financial identities survive upgrade and restore | 5 | 3 | 5 | 75 | Additive V1–V7 migration candidate; full backup/restore remains P10 |
| R15 adjustment races | Cancellation/refund/reversal cannot exceed or rewrite settlement | 5 | 4 | 4 | 80 | Database scaffolding exists; complete P06 HTTP/race evidence remains open |
| R16 schedules/webhooks | Unique DST-safe occurrence and signed bounded delivery | 4 | 4 | 5 | 80 | P07 not started |
| R17 performance/security/accessibility | Measured thresholds and real scanners/browser checks | 4 | 3 | 4 | 48 | P08/P10 remain open |

## Independent financial oracles

PostgreSQL is the spending authority. Tests independently recompute each account’s posted balance from immutable journal entries and reserved balance from active holds; they do not trust API totals as their oracle. Settlement assertions separately inspect payment state, hold state, one journal, two balanced entries, consumer inbox rows, audit records and outbox records.

Java’s deterministic arithmetic model and TypeScript BigInt round trips remain lower-level representation checks. They do not substitute for real transaction locking, RabbitMQ delivery or process restart proofs.

## P05 execution layers

1. **Component and client:** strict Java compilation; existing 120 core cases; TypeScript type checking; exact-string payment requests; stable idempotency keys; uncertain-intent persistence and replay.
2. **Database:** real PostgreSQL 17 with owner/runtime roles; V1–V7 migration; protected payment acceptance/settlement; reservation concurrency; inbox deduplication; monotonic projection; failed-work authorization/audit; direct runtime DML denial.
3. **HTTP:** two independent Spring Boot JVMs sharing PostgreSQL; payment acceptance, replay/conflict, reservation races, relevant-party privacy, OpenAPI and Rabbit-independent API behavior.
4. **Messaging and resilience:** real RabbitMQ, durable exchanges/queues, bounded prefetch/queue sizes, persistent messages, mandatory routing, correlated confirms, leased outbox claims, one publisher and two independently proven workers.
5. **Process death and outage:** publisher death after confirm/before outbox marking; worker death after settlement commit/before acknowledgement; complete broker outage; recovery and exact-one-effect inspection.
6. **Failure handling:** invalid envelopes, duplicate/different IDs, stale snapshots, bounded failed work and ADMIN-authorized append-only-audited replay.
7. **Regression and reconciliation:** all P01–P04 suites rerun; final repeated independent reconciliation must report zero discrepancies.

## Exit criteria

P05 becomes `VERIFIED_PASS` only when:

- all required XML suites exist with expected nonzero discovery and no failure/error/skip;
- the live Compose evidence contains every required passing check;
- P03, P04 and P05 requirement manifests resolve to exact executed test/check names;
- both OpenAPI compatibility snapshots remain internally valid;
- source SHA, dirty-tree state, environment, commands and artifacts are recorded;
- the required GitHub Actions aggregate gate succeeds.

A failed candidate is retained as a failed run and fixed at the root. Evidence documentation must reference the tested implementation SHA; the later evidence commit is a separate SHA and must pass its own lane.

## Remaining full-product work

P05 does not satisfy the complete project. P06 adjustment state/races, P07 schedules and signed webhooks, P08 React/Playwright/axe journeys, P09 F01–F08 and D01–D24 laboratory execution, P10 Pact/ZAP/k6/restore/nightly/release lanes, and P11 final reports/diagrams/video remain mandatory. No test count implies security certification, accessibility conformance, production-financial readiness or performance capacity.
