# Bad Penny — reviewer guide

A synthetic-money transaction application demonstrating reliable intent handling
across browser, API, PostgreSQL and asynchronous messaging. Its engineering focus
is correct economic outcomes and inspectable evidence under concurrency and
uncertainty. It is not a financial service or a production-readiness claim.

## A five-minute review

1. [Architecture and transaction atlas](architecture/DIAGRAMS.md): runtime boundaries,
   payment lifecycle, selected ER relationships and four transaction sequences.
2. [Verified product evidence](evidence/product-d8d3656.md): actual test counts and
   desktop/mobile screenshots, tied to one source and retained artifact digest.
3. [Financial boundary](architecture/FINANCIAL_BOUNDARY.md): chart of accounts,
   reservation semantics, immutable compensation and transaction/lock order.
4. [Current progress](implementation/PROGRESS.md): remaining work, observed failures
   and verification limits. Every historical pass retains its original scope.
5. [Master contract](implementation/MASTER_SPEC.md) and
   [release gates](implementation/RELEASE_READINESS.md): the bounded target and the
   conditions still required before declaring completion.

## What is demonstrated

- Customers manage wallets, make transfers and asynchronous payments, and resolve
  uncertain responses without silently replacing the original intent.
- Schedules and signed webhooks use durable state; delivery failure does not turn
  an accepted payment into a fabricated settlement result.
- Administrators inspect authoritative operations, immutable posting sides,
  audit history, failed work and independent reconciliation snapshots.
- PostgreSQL is the authoritative money boundary. Broker delivery is repeatable;
  inbox/business identity and commit-before-ACK make repetitions safe.
- A same-source campaign covers Java, actual PostgreSQL/HTTP integration,
  TypeScript clients and real responsive browser journeys.

## Verified scope, without overstatement

Source `d8d3656` passed 165 Java unit, 140 integration, 186 client and 147 browser
cases, with zero required failures/errors/skips. Its product gate passed. Its
isolated laboratory gate failed a browser observation assertion, so the combined
workflow did not pass. The subsequent run-identity observation repair has eight
component regressions and frontend verification, with live browser/lab verification
still outstanding. [Repair evidence](evidence/ui-run-identity.md).

The full project is **INCOMPLETE / NO_GO**: the remaining laboratory catalogue,
P10 contract/performance/restore and complete CI campaigns, final exploratory
sessions and approximately four-minute real demonstration video are not all
complete. This guide and its diagrams do not substitute for those deliverables.

## Normal product startup

From a clean clone with Docker Engine and Compose: `./scripts/lab up`.
The command prints actual loopback URLs. See [README](../README.md) for the P07
schedule/webhook overlay and sandbox identities. Runtime-generated credentials
remain local and are not included in this guide or screenshots.
