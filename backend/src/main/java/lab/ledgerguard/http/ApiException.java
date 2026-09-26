package lab.ledgerguard.http;

/** Deliberately contains only a stable public error code, never database/request contents. */
public final class ApiException extends RuntimeException {
    private final int status;
    public ApiException(int status, String code) { super(code); this.status = status; }
    public int status() { return status; }
}
