# P08D customer schedule management — IMPLEMENTED_UNVERIFIED

P08D implementation adds real customer schedule routes, pure server temporal preview, replay-safe PUT and existing-store recovery, explicit lifecycle commands and paged immutable occurrence results. Production-client and Java unit checks are not a substitute for the real browser/Compose gate. Do not mark P08D VERIFIED_PASS until the permanent full campaign succeeds at the exact implementation SHA.

Next executable action: execute the complete permanent P08D campaign, inspect its responsive images/results, repair any failed assertions and record exact-SHA provenance. Customer webhook and broader administrator interfaces follow. Overall status remains **INCOMPLETE / NO_GO**.

The following P08C checkpoint is retained as historical provenance; its old next action is superseded by the P08D checkpoint above.

# Execution checkpoint — P08C VERIFIED_PASS

Overall product status remains **INCOMPLETE / NO_GO**. P01–P08C retain exact-SHA verification. The remaining P08 schedule, webhook and broader administrator interfaces plus P09–P11 remain incomplete.

## Verified P08C source

Implementation `3b87e3a078d7b9270b56964ed1c50dc299958379` passed permanent `LedgerGuard P08C verification` workflow run `36436424432` on September 28, 2026.

- Verification job `108975429770`: SUCCESS.
- Required P08C gate `108980532491`: SUCCESS.
- Artifact `10977005382`: `ledgerguard-p08c-evidence-3b87e3a078d7b9270b56964ed1c50dc299958379`.
- Artifact size: 3,521,926 bytes.
- GitHub-reported artifact SHA-256: `7bf691dab89de39fd74912ba73d18377d06bc9fcb2f499ed29df7614aeba08e0`.
- Required suite failures/errors/skips: zero; functional browser retries: zero; tracked source tree: clean, enforced by the successful gate.

Durable provenance and scope limitations are recorded in [the P08C report](../evidence/p08c-3b87e3a.md) and [JSON record](../evidence/p08c-3b87e3a.json). The report records the tested implementation SHA separately from the later documentation commit.

## Verified P08C scope

- Recipient-owner partial/full refunds with exact minor-unit validation, authoritative remaining-refundable context and explicit confirmation.
- Narrow administrator payment lookup and full reversal with mandatory reason, without generic balance editing or customer spending authority.
- Owner-safe, paged adjustment history and immutable adjustment/journal receipts.
- Preserved normalized refund/reversal intent and original key for same-key response-loss, reload and reauthentication recovery.
- Base settlement and adjustment states presented separately.
- Real PostgreSQL/HTTP authorization and adjustment checks, production-client contracts, responsive desktop/tablet/mobile browser journeys and authenticated accessibility behavior.
- Complete earlier P01-P08B gate preserved; repeatable reconciliation, secret scan, requirement assertions and environment teardown succeeded.

The successful gate requires at least 18 P08C client cases, at least 54 combined browser cases, each of ten named P08C scenarios in all three viewport projects, three named P08C PostgreSQL/HTTP cases and nine P08C screenshots. These are enforced minima/named-case requirements; exact generated suite totals remain in the run artifact rather than being inferred here.

## Preserved verified P08B source

P08B implementation source `5d6d883444845bc5de3364d0c682c3df26005d8e` passed permanent `LedgerGuard P08B verification` workflow run `36355379901` on September 27, 2026.

- Verification job `108721959438`: SUCCESS.
- Required gate `108723219635`: SUCCESS.
- Artifact `10944390774`: `ledgerguard-p08b-evidence-5d6d883444845bc5de3364d0c682c3df26005d8e`.
- Artifact size: 1,732,590 bytes.
- Artifact SHA-256: `7fadf64bfff5689eea5ab0e4a933bc4b8bc3862f310bfdf8cefd0af6a6251d7f`.
- Tracked source tree: clean.
- Required failures/errors/skips: zero.

Durable provenance is recorded in `docs/evidence/p08b-5d6d883.md` and `docs/evidence/p08b-5d6d883.json`.

### Preserved P08B scope

- Real owner-authorized transfer form with exact currency parsing, source-wallet balances, recipient-reference validation and explicit confirmation.
- Authoritative settled transfer receipt containing stable transfer and journal references.
- Owner-scoped economic-intent persistence that retains the normalized command and original idempotency key across response loss, reload and session expiry.
- Safe same-key replay for uncertain transfers, payments and cancellation, with conflicting replacement commands blocked.
- Real asynchronous payment creation that displays durable `PENDING` acceptance rather than optimistic settlement.
- Owner-visible payment history/detail with direction, counterparty reference, state, version, adjustment state, timestamps, failure code, projection and settlement journal when present.
- Bounded authoritative status polling that stops at `SETTLED`, `FAILED` or `CANCELLED` and never converts a polling failure into a financial state.
- Explicit pending-payment cancellation with separate idempotency, race-safe authoritative refresh and no action for ineligible states.
- Four P08B Playwright scenarios repeated across desktop, tablet and mobile: settled transfer, committed transfer with lost response and same-key replay, pending-to-settled payment, and pending cancellation with both workers deliberately stopped.
- Authenticated axe checks, six P08B responsive transfer/payment screenshots, eight production-client contract cases, scoped OpenAPI, ADR and executable evidence mapping.

### Historical P08B gate counts

The P08B exact-SHA workflow passed 133 core/security JUnit cases, 124 real PostgreSQL/HTTP integration cases, 91 TypeScript client/contract cases including eight P08B cases, 24 Chromium journeys across three viewport projects, 42 P05/32 P06/15 P07A/26 P07B live Compose checks, seven P08B requirement mappings, nine responsive screenshots and a 316-file secret scan with zero findings. Independent reconciliation reported zero discrepancies. These counts retain their original P08B attribution.

## Next executable action

Implement the customer schedule interface using the existing verified P07A API:

1. One-time and recurring schedule creation/editing with exact money, recipient validation and explicit confirmation.
2. Clear local time, IANA zone, DST and catch-up behavior; version-aware updates.
3. Real pause/resume/cancel commands and immutable occurrence history/results.
4. Owner authorization, preserved idempotent command recovery and truthful loading/error/permission states.
5. Production-client contracts, real desktop/tablet/mobile browser journeys, keyboard/axe checks and independent reconciliation.
6. Preserve the complete P01-P08C campaign and record a successful permanent gate against the exact final source SHA.

After that slice, complete customer webhook and broader administrator interfaces. Do not begin P09 until the remaining P08 interfaces are implemented and exact-SHA verified. Do not relabel the whole product complete on the strength of P08C alone.
