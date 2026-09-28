# ADR 0021 — Replay-safe customer schedule management

Status: implemented; exact-SHA verification is recorded separately in evidence.

## Decision

Expose the existing protected P07A schedule API through the existing React product router and shell. Reuse the production `ApiClient`, exact money parser, owner-scoped `IntentStore`, session handling, native confirmation dialog and existing styles. No new runtime dependency, financial posting path, scheduling engine or administrative spending authority is introduced.

The customer can list schedules, inspect details, create/edit ONCE/DAILY/WEEKLY definitions, pause/resume/cancel eligible schedules, and page through immutable occurrence results. All server reads are authoritative and owner-scoped. Cancelled/finished schedules retain history. A read failure never becomes an empty list or evidence that an earlier command failed. The opt-in P07 Compose overlay remains required; the UI explicitly identifies a missing schedule capability rather than fabricating records.

## Mutation and uncertainty boundary

`ApiClient` supports keyed PUT as well as POST. Both methods preserve the uncertain outcome on transport errors, 408/5xx, invalid JSON or malformed/mismatched successful receipts. Editing uses PUT, not a POST workaround. Schedule commands normalize a discriminated action, exact definition, schedule identity and original expected definition version.

The existing owner-scoped intent slot gains a `schedules` kind; it does not gain authentication data. The original key and body survive reload, CSRF denial, throttling and reauthentication. Unresolved instructions block new financial/schedule intents. Recovery requires an explicit click. No retry creates a new key, substitutes a newer version, silently rebases an edit, or infers rollback from a failed read. After stale CSRF denial, an authoritative session read may require reauthentication; refreshing CSRF is not automatic resubmission.

Definition `version` and lifecycle `eventVersion` remain distinct: edit advances the definition, whereas pause/resume/cancel advance event history without changing the definition version. A stale edit receives a visible conflict and an explicit reload action. Replayed receipts describe state at original acceptance, not necessarily current schedule status. A subsequent protected GET supplies current state.

## Time and money

The new pure, authenticated/CSRF-protected temporal preview calls the existing Java `SchedulePolicy.resolve`. It returns intended wall time, resolved local time, offset, UTC instant and gap/overlap policy. It neither saves a schedule nor reserves money. The preview and its scoped OpenAPI contract are available only when scheduling is enabled.

A browser wall-time string is parsed without browser-zone conversion. The selected IANA zone remains explicit; Halifax and UTC are fixtures. Daily/weekly recurrence, spring gap-forward, earlier-offset autumn overlap, the 24-hour catch-up window and the already-claimed execution race are explained before confirmation. Preview is a time resolution, not a promise that a later command will be accepted; the existing API still rejects nonfuture create/edit definitions.

Amounts use existing currency-specific parsing and canonical integer strings. Recipient resolution checks same currency and rejects source=destination without exposing counterparty balances. Future schedules are not blocked solely by a currently empty wallet. Funds are checked by the protected execution path; business failure is recorded once rather than silently creating another obligation.

Occurrence history renders its recorded local value, original definition version and authoritative UTC due instant. It does not apply the current schedule zone to older occurrences, because the existing history resource does not contain an original-zone field. Successful occurrences link to actual transfer/journal references; failed/skipped occurrences never imply a successful posting. The published occurrence wire state for a business failure is `REJECTED`, rendered as "Failed" in the interface. The production-client regression checks this enum against the actual scoped OpenAPI schema.

## Evidence and isolation

Production-client regression covers keyed PUT transport, response validation and intent recovery. Java unit cases exercise exact Halifax transition fixtures. Ten browser scenarios run against real same-origin API, PostgreSQL and two schedulers in each of three viewport projects, with keyboard and axe checks. Independent SQL oracles count occurrences, transfers and journals and recompute entry totals and wallet balances.

The catch-up browser scenario uses a named disposable temporal fixture: it backdates only the isolated schedule definition, not financial records. Real workers create every history record and journal. No privileged fixture or clock-control endpoint is added to the application. Existing deterministic P07A concurrency/DST/catch-up/restart tests remain mandatory through the prior evidence-gate chain.

`assert-p08d-evidence` first executes the unchanged P01-P08C gate, then requires all named P08D cases, responsive screenshots and a clean tracked source tree. Source SHA, actual results and artifact retention are recorded separately. This slice does not complete customer webhooks, broader administrator interfaces, P09-P11 or the full product.
