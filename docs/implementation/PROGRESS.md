# Execution checkpoint — P01/P02 FOUNDATION CANDIDATE

Overall product status remains **INCOMPLETE / NO_GO**. This checkpoint implements the next coherent milestone without relabeling later product phases as complete.

## Repository and delivery

- Repository: `azerish25-ux/transaction-reliability-lab`.
- Target branch: `main`.
- Observed parent before this milestone: `1c2aaf42d66d176edbf5e3306a9dbfadc90db32e`.
- The owner-linked GitHub integration now exposes ordinary Git-data writes. Publication and final remote/Actions identities are recorded in `DELIVERY.md` after verification.
- No force push, branch bypass, unrelated repository, worktree or history replacement is used.

## P01 — IMPLEMENTED_UNVERIFIED at source checkpoint

Implemented:

- Checked Maven 3.9.16 bootstrap with committed distribution SHA-256 and Java 21 baseline.
- Executable Spring Boot application with restricted default endpoint surface.
- Correlation IDs, structured console context, liveness/readiness and explicit database-role health.
- Pinned PostgreSQL 17.11, RabbitMQ 4.3.5 and Temurin 21.0.12.1 container tags.
- Docker Compose role separation, internal database/broker networking, real health checks, loopback-only HTTP/management ports and non-root/read-only API runtime.
- Runtime-generated ignored sandbox secrets; no committed live credentials.
- Idempotent balanced fictional fixture seeding through the protected posting function.
- Locked TypeScript 5.8.3 dependency.
- Permanent pull-request/push/manual fast workflow with an aggregate gate and retained reports.
- Working `lab up/down/status/logs/test/reconcile` foundation commands.

Verification is promoted to VERIFIED_PASS only after the candidate's actual GitHub Actions run completes successfully.

## P02 — IMPLEMENTED_UNVERIFIED at source checkpoint

Preserved and integrated:

- Exact integer-minor-unit money policies for CAD/USD/JPY/KWD.
- Protected PostgreSQL posting/financial command functions and restricted runtime grants.
- Deferred journal, balance/hold, payment/adjustment and idempotency consistency checks.
- Eleven committed-transaction PostgreSQL tests, including role bypass prevention, commit-time journal rejection, replay/conflict, synchronized overspending, duplicate settlement and concurrent refund limits.
- Independent reconciliation that now exits nonzero on any discrepancy.
- Existing Java and TypeScript component/unit evidence remains distinct from full-boundary proof.

## Open phases

- P03 authentication, revocable sessions, roles, ownership-safe accounts and OpenAPI: NOT_STARTED.
- P04 live transfer HTTP/idempotency/uncertain-response boundary: NOT_STARTED.
- P05 RabbitMQ publisher/consumer, worker and projection: NOT_STARTED.
- P06 cancellation/refund/reversal product APIs: NOT_STARTED.
- P07 schedules and webhook dispatcher/receiver: NOT_STARTED.
- P08 React interface and browser/accessibility journeys: NOT_STARTED.
- P09 complete F01–F08 and D01–D24 isolated laboratory: NOT_STARTED.
- P10 contracts/security/performance/migration/restore and all CI lanes: NOT_STARTED beyond the fast foundation lane.
- P11 complete portfolio evidence and video: NOT_STARTED.

No release, public application, authentication claim, complete test-lab claim or production-readiness claim is made.
