package lab.ledgerguard.core;

import java.math.BigInteger;
import java.util.Objects;

/** Exact nonnegative money. API amounts and balances serialize as decimal integer strings. */
public record Money(long minor, CurrencyUnit currency) {
    public static final long MAX_TRANSACTION = 1_000_000_000_000L;
    public Money {
        Objects.requireNonNull(currency);
        DomainFailure.require(minor >= 0, "INVALID_AMOUNT", 400);
    }
    public static Money amount(String minor, String currency) {
        CurrencyUnit unit = CurrencyUnit.parse(currency);
        DomainFailure.require(minor != null && minor.matches("(?:0|[1-9][0-9]{0,18})"), "INVALID_AMOUNT", 400);
        long value;
        try { value = Long.parseLong(minor); }
        catch (NumberFormatException ex) { throw new DomainFailure("AMOUNT_OVERFLOW", 400); }
        DomainFailure.require(value > 0 && value <= MAX_TRANSACTION, "AMOUNT_OUT_OF_RANGE", 400);
        return new Money(value, unit);
    }
    public static Money decimalAmount(String value, CurrencyUnit unit) {
        DomainFailure.require(value != null && value.length() <= 32
            && value.matches("(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?"), "INVALID_DECIMAL", 400);
        String[] parts = value.split("\\.", -1);
        String fractional = parts.length == 2 ? parts[1] : "";
        DomainFailure.require(fractional.length() <= unit.exponent(), "EXCESS_PRECISION", 400);
        BigInteger scale = BigInteger.TEN.pow(unit.exponent());
        BigInteger whole = new BigInteger(parts[0]).multiply(scale);
        BigInteger fraction = fractional.isEmpty() ? BigInteger.ZERO
            : new BigInteger(fractional + "0".repeat(unit.exponent() - fractional.length()));
        return amount(whole.add(fraction).toString(), unit.name());
    }
    public String minorString() { return Long.toString(minor); }
    public String decimalString() {
        int exponent = currency.exponent();
        if (exponent == 0) return minorString();
        String digits = minorString();
        digits = "0".repeat(Math.max(0, exponent + 1 - digits.length())) + digits;
        return digits.substring(0, digits.length() - exponent) + "." + digits.substring(digits.length() - exponent);
    }
    public Money plus(Money other) {
        sameCurrency(other);
        try { return new Money(Math.addExact(minor, other.minor), currency); }
        catch (ArithmeticException ex) { throw new DomainFailure("BALANCE_OVERFLOW", 422); }
    }
    public Money minus(Money other) {
        sameCurrency(other);
        DomainFailure.require(minor >= other.minor, "INSUFFICIENT_FUNDS", 422);
        return new Money(Math.subtractExact(minor, other.minor), currency);
    }
    private void sameCurrency(Money other) {
        DomainFailure.require(currency == other.currency, "CURRENCY_MISMATCH", 400);
    }
}
