# P08E customer webhook interface — IMPLEMENTED_UNVERIFIED

Overall product remains **INCOMPLETE / NO_GO**. This is an implementation candidate, not a verified completion claim. P01–P08D retain their historical exact-source verification; the P08E permanent workflow must pass against its own final source SHA.

## Current candidate

Customer Webhooks navigation, approved subscriptions, enable/disable and secret rotation, owner-scoped delivery and immutable attempt inspection, bounded refresh, and audited retry are implemented. A new protected command-receipt contract prevents response-loss recovery from rotating again or starting another retry cycle. Receipts never redisclose signing secrets. Owner-scoped non-secret metadata survives reload and reauthentication; secret display remains transient.

V11 is additive in the existing P07B opt-in migration location. Start the documented P07 overlay to expose the capability. Legacy P07B contracts, payment workers, settlement and accounting paths remain intact.

See `P08E_REQUIREMENTS.json`, `../architecture/adr/0022-p08e-customer-webhooks.md`, and `/api/v1/openapi/p08e-ui.json`. The permanent workflow adds production-client, JUnit and real responsive browser/database checks while invoking the complete P01–P08D gate unchanged.

## Next executable action

Execute the permanent P08E workflow, inspect every failing check and artifact, fix root causes without weakening assertions, and retain successful exact-SHA evidence. Until that passes, do not relabel this candidate VERIFIED_PASS. After verified P08E, complete the broader administrator transaction, ledger, audit and reconciliation interfaces. Do not start P09 before remaining P08 interfaces are exact-SHA verified.

## Preserved P08D checkpoint

P08D implementation `13bdd62c924a3230825b6d9304f449f887c8e7fe` passed permanent run `36464316280`, including Required P08D gate. Executed totals: 139 JUnit unit, 127 PostgreSQL/HTTP integration, 134 TypeScript client and 84 browser cases; required failures/errors/skips and functional retries were zero. Eight P08D requirements and twelve screenshots passed. These results belong to that historical SHA, not automatically to P08E.

The checkpoint includes versioned customer schedules, temporal previews, occurrence history and POST/PUT uncertainty recovery. Durable report: `../evidence/p08d-13bdd62.md`; machine-readable provenance: `../evidence/p08d-13bdd62.json`.

## Earlier exact-source evidence

P08C `3b87e3a078d7b9270b56964ed1c50dc299958379`, run `36436424432`: `../evidence/p08c-3b87e3a.md` and `.json`. P08B `5d6d883444845bc5de3364d0c682c3df26005d8e`, run `36355379901`: `../evidence/p08b-5d6d883.md` and `.json`. Full evidence index and release-readiness document remain authoritative for their explicitly stated scopes; no individual milestone completes the whole product.
