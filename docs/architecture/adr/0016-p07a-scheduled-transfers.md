# ADR 0016 — P07A durable scheduled transfers

Status: source candidate, not verified until the permanent remote gate passes the exact implementation SHA.

## Decision

Bad Penny stores schedule intent as an intended local timestamp, IANA zone, recurrence, definition version and derived next UTC instant. `SchedulePolicy` resolves and advances local time in Java, while the restricted PostgreSQL command boundary independently validates the derived instant with the same gap/overlap policy. PostgreSQL remains the financial, lifecycle and duplicate-effect authority.

The P07A schema is an additive Flyway location, `classpath:db/p07`, activated through `compose.p07.yaml`. The default `compose.yaml` remains the exact verified P06 topology until P07 receives its own permanent gate. The overlay restarts the API with both migration locations and adds two independently running scheduler processes.

## Durable command boundary

Customers create, edit, pause, resume and cancel schedules through `ledger.execute_schedule_command`. The runtime role can execute that function but has no schedule-table DML. Commands use the existing actor/kind/parent/key idempotency table and canonical fingerprints. Malformed input is rejected before key claim. Deterministic state and business rejections are persisted and replayed.

Definition `version` changes only when economic schedule intent is edited. `event_version` orders lifecycle and occurrence events. Pause, resume and cancel lock the schedule row, so they serialize with an already executing occurrence. A lifecycle command that loses the row race observes the resulting state rather than undoing a committed occurrence.

Resume is derived inside the durable PostgreSQL command from the stored local intent, recurrence and zone, so retries need only the same key and expected definition version. It advances paused recurring intent to the first future local occurrence, does not recreate obligations intentionally suppressed while paused, and rejects a past one-time schedule. Time/state checks occur after idempotency lookup so a lost response remains replayable after the schedule advances.

## Occurrence execution

Both scheduler processes may read the same due schedule. They call `ledger.execute_schedule_occurrence` with the exact expected tuple:

- schedule ID;
- definition version;
- intended local occurrence;
- derived due instant.

The function locks the schedule row and acts only when that tuple is still current. It derives a stable operation UUID from schedule ID, version and intended local occurrence. One transaction then records either:

- `SUCCEEDED`: protected transfer posting, transfer row, immutable occurrence, audit and outbox events;
- `REJECTED`: immutable occurrence and error, with every attempted financial fragment rolled back; or
- `SKIPPED_LATE`: an occurrence older than the 24-hour catch-up window, without a financial effect.

The same transaction advances recurring intent by one local day/week or marks a one-time schedule `FINISHED`. A retry after an unknown commit is safe: if the first commit succeeded, the expected tuple is stale and the retry returns `IGNORED`; if it rolled back, the tuple remains due.

## Time policy

- Spring gap: move the nonexistent wall time forward by the transition gap.
- Autumn overlap: use the earlier valid offset.
- Daily/weekly recurrence advances local intent, never the prior instant by 24 hours or 7×24 hours.
- Catch-up processes one overdue obligation at a time, oldest first through the due index.
- Obligations older than 24 hours are individually recorded as `SKIPPED_LATE`; they are never combined into a larger transfer.
- Business time is injected through `Clock` into scheduler execution; database lock and statement timeouts remain real operational clocks. PostgreSQL independently validates every next local occurrence and derived instant before advancing state.

## Security and authorization

Schedule queries are owner-scoped at SQL query time. Schedule commands are customer-only, CSRF-protected browser operations requiring `Idempotency-Key`. Source ownership, recipient existence, account state, currency and amount are revalidated in PostgreSQL. Direct calls to internal `_post`, `_audit`, `_resolve_schedule_local` and `_schedule_body` remain denied to `ledger_runtime`. Schedule HTTP resources are disabled in the verified base topology and enabled only by the P07A overlay.

## Verification boundary

The candidate adds real PostgreSQL proofs for idempotent creation, restricted-role enforcement, synchronized two-scheduler execution, insufficient-funds rejection, catch-up skipping, versioned edits and lifecycle races. It does not yet claim:

- P07B webhook delivery;
- a verified live Compose schedule campaign before the exact source SHA passes the permanent workflow;
- the P08 React schedule interface;
- full P07 verified status.
