# Execution checkpoint — P04 candidate

Overall product status remains **INCOMPLETE / NO_GO**. P01–P03 remain verified. P04 immediate transfers are **IMPLEMENTED_UNVERIFIED** until the exact candidate passes the expanded GitHub Actions lane; no release or public application is claimed.

## Candidate implementation

- Authenticated `POST /api/v1/transfers` with mandatory `Idempotency-Key`, CSRF and CUSTOMER authority.
- Existing protected PostgreSQL command remains the sole posting authority; no controller-side balance mutation or second ledger path.
- Exact durable 201 receipt, `Location`, `Idempotency-Replayed`, committed deterministic 422 rejection and 409 changed-intent conflict semantics.
- Owner-scoped `GET /api/v1/transfers/{id}` and bounded transfer list exposing only destination public routing reference.
- Safe problem handling for missing keys, dependency failure and explicit unknown commit outcome.
- TypeScript transfer client and intent-state execution/retry preserving the same key and normalized intent after timeout.
- Versioned current OpenAPI at `/api/v1/openapi/p04.json`; the unversioned route retains the verified P03 compatibility snapshot.
- Real PostgreSQL/HTTP integration suite with two API JVMs, canonical 10,000-versus-two-8,000 overspend, concurrent replay, opposite-direction locking, many-client pressure, owner/privacy checks and test-only lost-response-after-commit proxy.
- Expanded Compose smoke, requirements-to-executed-test evidence and CI artifact paths.

No migration is required for P04: transfers, journals, idempotency, audit and outbox structures and the protected command function already exist in V1–V6. Existing migrations are unchanged.

## Verification actions

1. Publish the coherent candidate as a non-forced fast-forward to `main`.
2. Inspect the actual push-triggered workflow, compile/test output and live Compose result.
3. Repair concrete failures without weakening or skipping assertions; rerun the complete affected lane.
4. Record the exact passing source SHA, run/job conclusions, counts and artifact only after execution.

## Preserved P03 evidence

P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` and evidence commit `5d1c1474e0c020763cf2e35bc05e04907c286237` passed runs `36270965725` and `36271372093`. P04 runs all prior suites rather than replacing them.

## Remaining phases

P05 outbox publisher/RabbitMQ/worker settlement, P06 adjustment APIs, P07 schedules/webhooks, P08 React/browser/accessibility, P09 complete fault/defect laboratory, P10 contracts/scanners/performance/restore/nightly/release and P11 final evidence/video remain incomplete.
