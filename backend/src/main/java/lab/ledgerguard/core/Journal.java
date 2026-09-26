package lab.ledgerguard.core;

import java.math.BigInteger;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public record Journal(UUID operationId, CurrencyUnit currency, List<Entry> entries) {
    public enum Side { DEBIT, CREDIT }
    public enum AccountKind { WALLET_LIABILITY, SANDBOX_FUNDING_ASSET }
    public record Entry(UUID accountId, CurrencyUnit currency, Side side, long minor) {
        public Entry {
            Objects.requireNonNull(accountId); Objects.requireNonNull(currency); Objects.requireNonNull(side);
            DomainFailure.require(minor > 0, "INVALID_ENTRY", 422);
        }
    }
    public Journal {
        Objects.requireNonNull(operationId); Objects.requireNonNull(currency);
        entries = List.copyOf(entries);
        DomainFailure.require(entries.size() >= 2, "INCOMPLETE_JOURNAL", 422);
        BigInteger debits = BigInteger.ZERO, credits = BigInteger.ZERO;
        for (Entry entry : entries) {
            DomainFailure.require(entry.currency() == currency, "CURRENCY_MISMATCH", 422);
            if (entry.side() == Side.DEBIT) debits = debits.add(BigInteger.valueOf(entry.minor()));
            else credits = credits.add(BigInteger.valueOf(entry.minor()));
        }
        DomainFailure.require(debits.equals(credits), "UNBALANCED_JOURNAL", 422);
    }
}
