# Financial boundary

Synthetic money only. The P01–P08F product campaign passed on
`d8d365690d961580d22105feb15ddec3267185ae`; [exact-source evidence](../evidence/product-d8d3656.md).
The complete project remains **INCOMPLETE / NO_GO**. Earlier statements that the
API, broker and admin reconciliation were not implemented are superseded by this
source-bound checkpoint. Performance, full laboratory and final release gates
must be evaluated separately.

## Accounting model and chart of accounts

| Account kind | Normal side | Balance calculation | Purpose |
|---|---|---|---|
| SANDBOX_FUNDING_ASSET | Debit | Debits minus credits | Balanced fictional opening funds |
| WALLET_LIABILITY | Credit | Credits minus debits | Customer and merchant wallets |

A funding journal debits the synthetic asset and credits a wallet. Transfers and
payments debit the source liability and credit the recipient liability. Refunds
and reversals create new opposite-direction journals; they never edit settlement
history. The merchant owns an ordinary customer account, not another role.

For wallets, available funds are posted balance minus active reservations.
Amounts use BIGINT minor units and canonical integer strings at the JSON boundary.
Cross-row sums use NUMERIC; the per-command maximum is 1,000,000,000,000 minor units.
CAD/USD use exponent 2, JPY 0 and KWD 3. No currency conversion is implemented.
New customers start at zero; fixture funding uses balanced journals.

## Transaction and lock boundaries

1. Claim the owner-scoped actor + kind + parent + idempotency-key identity.
2. For an existing payment, lock the payment aggregate before its balance rows.
3. Lock participating account balances in stable UUID order.
4. Commit business state, ledger, holds, replay outcome, audit and outbox together.
   Settlement's consumer inbox marker belongs to that same transaction.
5. Publish external messages outside the financial transaction. Mark the outbox
   published only after confirmed broker acceptance. ACK delivery only after commit.

The JDBC boundary retries only qualifying serialization/deadlock failures using a
fresh transaction, within bounded attempts/time. A lost connection during commit
is an unknown outcome, not proof of rollback. Resolve the original intent or
explicitly replay the same key; a new key is new financial intent.

## Durable outcomes

- Transfers produce one immutable transfer identity and balanced journal.
- Payment acceptance returns 202 after committing PENDING, ACTIVE hold and work.
- Settlement consumes the hold, records a journal and moves to SETTLED.
- An eligible cancellation releases the pending hold without a refund journal.
- Controlled settlement rejection releases the hold and records FAILED.
- Recipient-owned/admin refunds are bounded by remaining amount and available funds.
- ADMIN full reversal requires an unadjusted settled payment. Prior journals remain.
- Terminal state, inbox and operation identity prevent duplicate economic effects.

[Payment state diagram](diagrams/payment-state.svg) and
[sequence diagrams](DIAGRAMS.md) describe these implemented boundaries.

## SQL roles and integrity

Migrations run as ledger_owner; ordinary application queries use ledger_runtime.
Financial writes go through the registered command routines, with explicit grants,
fixed search paths and schema-qualified objects. Runtime cannot arbitrarily edit
balances, journals or financial audit history. Cross-row deferred constraints
check journal completeness, currency, posting relationships and hold consistency.
The database owner/superuser remains outside this integrity boundary.

Idempotency normalization and canonical intent fingerprinting happen in the SQL
command path. The separately tested Java fingerprint utility is not a hash
interchange format. Exact replay returns the stored status/body; conflicting
intent receives a controlled conflict without another posting.

## Independent investigation

Administrator reconciliation is an independently implemented, database-enforced
read-only repeatable-read snapshot. It checks ledger/balances, journals, business
postings, holds, adjustments, idempotency, durable work and audit chains. Saved
reports retain original scope, time and discrepancies; they do not represent
continuously live health and never repair money automatically. Ordinary audit
reads label integrity NOT_CHECKED until the scoped reconciliation executes it.

Source authorities: [V1 schema](../../backend/src/main/resources/db/migration/V1__financial_schema.sql),
[V2 commands](../../backend/src/main/resources/db/migration/V2__protected_financial_commands.sql),
[financial migrations](../../backend/src/main/resources/db/migration),
[consumer](../../backend/src/main/java/lab/ledgerguard/messaging/ReliableEventConsumers.java),
[reconciliation](../../backend/src/main/java/lab/ledgerguard/admin/AdminReconciliationService.java).
