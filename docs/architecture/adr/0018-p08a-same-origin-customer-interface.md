# ADR 0018 — P08A same-origin customer interface

Status: accepted for P08A candidate verification
Date: 2026-09-27

## Context

Bad Penny already had a verified financial API and TypeScript client core but no browser application. The first interface increment must exercise real session, account and ledger boundaries without widening disclosure or introducing fake dashboard data. Sandbox origin controls require unsafe browser requests to present a loopback host and an Origin matching the externally visible port.

## Decision

Build the customer interface as a React/TypeScript/Vite application and serve its immutable production bundle from a separately restartable non-root nginx container. Publish only the UI and existing API on loopback. The browser calls relative `/api/v1` paths; nginx preserves the external `Host` and proxies to the internal API, so Spring evaluates CSRF, cookies and sandbox-origin rules against the browser’s actual same origin.

The frontend owns presentation and transient request state only. The backend remains authoritative for sessions, balances, pagination, journal effects and ownership. Authentication and CSRF material are held only by the API client/cookies and are never written to local storage. The existing intent store remains limited to economic command intent for later slices.

Add one narrow read model for transaction detail:

`GET /api/v1/accounts/{accountId}/transactions/{journalId}`

It first authorizes the selected account by owner, then aggregates and returns only entries where that same owned account participates. It includes immutable operation and journal identifiers, wallet reference/name, currency, timestamp and owner-side entries. It deliberately excludes counterparty balances, unrelated journal lines, webhook secrets and administrator metadata. Missing or cross-owner resources use the existing non-disclosing `404` behavior.

## Verification

P08A requires:

- Locked TypeScript and production Vite builds.
- Production-client path, pagination, validation and identity-boundary tests.
- Real Compose-backed registration/login/logout/session-expiry journeys.
- Real seeded balances, account history and transaction-detail navigation.
- A registered-customer zero-balance proof.
- An explicit dependency-unavailable proof that renders no balances.
- Authenticated axe WCAG A/AA analysis.
- Chromium execution and screenshots at 1440×900, 768×1024 and 390×844.
- Complete P01–P07B regression, reconciliation and exact-SHA evidence.

## Consequences and limits

The UI is operational rather than a mock, and API/cookie behavior is representative of a same-origin deployment. The nginx process is read-only, non-root and health checked. P08A does not claim that transfer/payment, adjustment, schedule, webhook, administrator or lab-console interfaces are complete; those remain explicit later P08 slices. It also does not claim public deployment, accessibility conformance, security certification or production banking readiness.
