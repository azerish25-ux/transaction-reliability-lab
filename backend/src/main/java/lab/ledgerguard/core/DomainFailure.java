package lab.ledgerguard.core;

/** Stable safe failures; infrastructure exceptions must never be converted to business rejection. */
public final class DomainFailure extends RuntimeException {
    private static final long serialVersionUID = 1L;
    private final String code;
    private final int status;
    public DomainFailure(String code, int status) {
        super(code); this.code = code; this.status = status;
    }
    public String code() { return code; }
    public int status() { return status; }
    public static void require(boolean predicate, String code, int status) {
        if (!predicate) throw new DomainFailure(code, status);
    }
}
