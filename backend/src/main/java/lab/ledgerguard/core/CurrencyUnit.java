package lab.ledgerguard.core;

public enum CurrencyUnit {
    CAD(2), USD(2), JPY(0), KWD(3);
    private final int exponent;
    CurrencyUnit(int exponent) { this.exponent = exponent; }
    public int exponent() { return exponent; }
    public static CurrencyUnit parse(String value) {
        if (value == null) throw new DomainFailure("UNSUPPORTED_CURRENCY", 400);
        try { return valueOf(value); }
        catch (IllegalArgumentException ex) { throw new DomainFailure("UNSUPPORTED_CURRENCY", 400); }
    }
}
