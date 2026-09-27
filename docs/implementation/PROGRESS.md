# Execution checkpoint — P08B IMPLEMENTED_UNVERIFIED

Overall product status remains **INCOMPLETE / NO_GO**. P01–P08A retain durable exact-SHA verification. P08B is implemented as a source candidate but must not be called verified until its permanent exact-SHA GitHub Actions gate succeeds. Later P08 slices and P09–P11 remain incomplete.

## Verified baseline

P08A implementation source `d675db096b8f023469e253737ade80a2b8b3b0fa` passed permanent `LedgerGuard P08A verification` run `36345292129` on September 27, 2026. Its complete P01–P08A campaign remains the required regression baseline.

## P08B candidate scope

- Real owner-authorized transfer form with exact currency parsing, source-wallet balances, recipient-reference validation and explicit confirmation.
- Authoritative settled transfer receipt containing stable transfer and journal references.
- Owner-scoped economic-intent persistence that retains the normalized command and original idempotency key across response loss, reload and session expiry.
- Safe same-key replay for uncertain transfers, payments and cancellation, with conflicting replacement commands blocked.
- Real asynchronous payment creation that displays durable `PENDING` acceptance rather than optimistic settlement.
- Owner-visible payment history/detail with direction, counterparty reference, state, version, adjustment state, timestamps, failure code, projection and settlement journal when present.
- Bounded authoritative status polling that stops at `SETTLED`, `FAILED` or `CANCELLED` and never converts a polling failure into a financial state.
- Explicit pending-payment cancellation with separate idempotency, race-safe authoritative refresh and no action for ineligible states.
- Four new Playwright journeys across desktop, tablet and mobile: settled transfer, committed transfer with lost response and same-key replay, pending-to-settled payment, and pending cancellation with workers deliberately stopped.
- Authenticated axe checks, responsive transfer/payment screenshots, eight production-client contract cases, scoped OpenAPI, ADR and executable evidence mapping.

## Verification required

The candidate gate must preserve every P01–P08A test and additionally pass the locked frontend build, P08B client contracts, 24 total Chromium journeys across three viewport projects, authenticated accessibility checks, exact one-effect replay evidence, real RabbitMQ settlement, deterministic cancellation while workers are stopped, repeatable reconciliation and the tracked-source secret scan.

## Next executable action

Run the permanent **LedgerGuard P08B verification** workflow against the exact final source SHA. Repair any real failure and rerun the entire gate. Only after success may P08B be recorded as `VERIFIED_PASS`. Do not begin P09; the next product slice after P08B verification is the remaining customer adjustment interface, followed by schedule/webhook and administrator interfaces.
