# Financial boundary and integration state

## Current executable boundary

The offline Java policies and TypeScript client utilities execute without downloaded dependencies. `FinancialCommands` compiles against JDBC and calls actual PostgreSQL stored functions when a real driver/database is available. It does not simulate a database. V1–V4 define the intended persistent financial boundary, but **none of those migrations or SQL functions has run in this execution**. A correctly compiled adapter cannot establish the SQL's correctness.

## Accounting semantics

Customer and merchant wallets are credit-normal liabilities; a synthetic funding asset is debit-normal. A funding journal debits that asset and credits a wallet. Transfers/payments debit the source liability and credit the recipient liability. Refunds/reversals make a new opposite-direction journal, preserving the original immutable operation.

`posted = credits − debits` for wallet liabilities; `available = posted − reserved`. All persisted monetary columns are BIGINT. Cross-row totals in deferred constraints use PostgreSQL NUMERIC so summing individually valid BIGINT entries does not wrap. The permitted per-command limit is 1,000,000,000,000 minor units. JSON amounts are canonical decimal integer strings. JPY, KWD, CAD and USD have fixed exponents; conversion is absent.

## SQL roles and invariants

Migrations must execute as `ledger_owner`, not `ledger_runtime`. The owner requires database/schema creation privileges but must not be a superuser. Runtime gets SELECT and limited operational-table DML; it receives EXECUTE only for registered public commands. It has no direct financial table INSERT/UPDATE/DELETE, no `_post` or `_audit` EXECUTE, no generic SQL endpoint, and no balance top-up command.

SECURITY DEFINER routines use a fixed `pg_catalog,ledger,pg_temp` search path with explicit schema qualifications. PUBLIC function execution is revoked. An owner/superuser can defeat these protections and is outside the threat boundary; encrypted secret keys/anchor integrity need separate operational protection.

V1 defers journal completeness/balance and account/hold/payment consistency until commit. V4 adds immutable account routing identity, complete idempotency outcomes and business journal amount/account/operation consistency. A row CHECK is not used to pretend it validates a cross-row sum. Repeated deferred re-summation may be expensive on large histories; query plans and the 100,000-journal performance fixture are NOT measured.

## Transaction and lock order

1. An authenticated command claims/locks its actor + kind + parent + key identity. A replay returns the committed status/body, rather than a new operation.
2. Existing payment aggregates are locked before their related account balances. New payment rows are invisible until their accepting transaction commits.
3. Balance rows are locked in stable ascending UUID order across transfer, reservation, settlement, cancellation and compensation.
4. Holds, entries, balances, business state, audit, idempotency outcome and outbox are changed in one transaction. The receiving worker's inbox marker belongs to the settlement transaction.
5. No external HTTP or RabbitMQ publication belongs inside that transaction.

The JDBC adapter creates a new connection and transaction for every retry. Only PostgreSQL 40P01 (deadlock) and 40001 (serialization) qualify, bounded to three attempts and the core retry budget. Lock timeout and statement timeout are separately bounded. An 08-class exception while committing is treated as unknown outcome, never a known rollback. Retry with the same original idempotency key is the only safe financial resolution. Logging/metrics for retries are not wired yet.

## Durable semantics in the SQL source

- Immediate transfers create one balanced journal and immutable transfer identity.
- Payment acceptance creates PENDING + ACTIVE hold + audit + `payment.requested` outbox and returns 202.
- `settle_event` locks the payment, deduplicates event identity, consumes the hold and posts once. Terminal business identity prevents another journal even for a different duplicate event ID. A caller must ACK only after it returns after commit; the broker consumer is not implemented yet.
- Cancellation releases a pending hold without a refund journal. The payer or an administrator with a reason may cancel.
- Recipient-owned/admin partial refunds check remaining amount and available recipient funds. An administrator may fully reverse only an unadjusted settled payment. Prior journals remain unchanged.
- Audit records use a serialized per-aggregate head and SHA-256 of previous hash bytes plus the stored canonical UTF-8 JSON text. An independent full chain/anchor verifier is still missing.

## Intended integration, not currently running

Browser → same-origin reverse proxy → Spring API → PostgreSQL. Committed outbox → confirming publisher → RabbitMQ → worker → PostgreSQL. Independent durable webhook dispatcher → allowlisted sandbox receiver. Lab-only controllers/mutations → isolated disposable dependencies.

These API, broker, webhook, scheduler and UI processes do not exist as working integrations in this checkpoint. The schema includes the durable work tables, but a table is not an implemented scheduler/dispatcher. Webhook/DST policies pass unit cases, not delivery/restart/occurrence tests.

## Idempotency normalization

SQL commands reject unknown fields, non-string amounts, invalid UUID/reference formats and invalid reasons before key claim. UUIDs, recipient whitespace and reasons normalize before hashing JSONB, so property ordering is irrelevant. SQL's persisted v1 fingerprint is SHA-256 of the canonical JSONB command envelope; the pure Java `Idempotency.fingerprint` is a separately unit-tested length-prefixed design utility, NOT a hash interchange format. The JDBC adapter only uses the Java key validator; it does not compare the Java hash to the SQL hash.

This duplication of policy representations is an open consistency risk: the unexecuted PostgreSQL integration suite, future contract/property tests and source review must establish alignment before claiming end-to-end financial correctness.

## Independent reconciliation

`tests/database/reconcile.sql` starts one REPEATABLE READ, READ ONLY snapshot. It separately recomputes journal totals and wallet balances/active hold sums, checks state/hold/refund consistency and incomplete idempotency claims. It produces discrepancy rows, never edits history or mints corrective balances. It is not yet the complete admin reconciliation service or every required invariant query.
