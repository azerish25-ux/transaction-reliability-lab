# Execution checkpoint — P08A IMPLEMENTED_UNVERIFIED

Overall product status remains **INCOMPLETE / NO_GO**. P01–P07B retain durable exact-SHA verification. P08A is integrated as a source candidate; later P08 slices and P09–P11 remain incomplete.

## Preserved verified source

P07B implementation source `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975` passed permanent `LedgerGuard P07B verification` run `36330862462` on September 27, 2026. Durable reports remain `docs/evidence/p07b-cc6b3ca.md` and `docs/evidence/p07b-cc6b3ca.json`.

## Implemented P08A candidate scope

- Pinned React 18, TypeScript and Vite application with a production build.
- Non-root nginx container with loopback-only published port, health check, SPA routing, security headers and same-origin `/api` proxying.
- Real registration, login, logout, authenticated bootstrap and session-expiry handling using the existing cookie/CSRF API.
- Customer dashboard backed by real account reads, showing posted, reserved and available balances, currency, version and update timestamp.
- Zero-balance wallet creation through the real protected API.
- Deterministic account-history pagination.
- New owner-scoped customer-safe transaction-detail endpoint returning only the selected wallet’s entries and immutable operation/journal references.
- Deliberate loading, empty, validation, authentication, unavailable and not-found states.
- Semantic responsive interface with visible focus, keyboard-operable session dialog, reduced-motion support and non-color-only statuses.
- Playwright Chromium journeys at 1440×900, 768×1024 and 390×844, with screenshots, traces and authenticated axe checks.
- Six TypeScript production-client contract cases and seven machine-readable P08A requirement mappings.
- Integration into `./scripts/lab up`, status, UI/e2e/PR commands and the permanent GitHub verification lane.

## Local/static verification completed before publication

- P08A JSON and scoped OpenAPI parse successfully.
- New Python control/evidence scripts compile.
- The P08A client-contract runner parses under Node 22.
- Source review confirms the UI has no mock balance provider, fake metrics, password/token persistence or cross-owner journal payload.

These checks are not substitutes for the permanent npm/TypeScript/Vite/Maven/PostgreSQL/Docker/Playwright/axe workflow.

## Next executable action

Publish the reviewed source with its exact npm lockfile and run the permanent **LedgerGuard P08A verification** workflow on the exact final source SHA. Fix every root-cause failure and rerun the complete gate. Only after the required job and aggregate gate succeed may P08A be relabeled `VERIFIED_PASS` and durable evidence be published.
