package lab.ledgerguard.core;

import java.sql.SQLException;
import java.time.Duration;
import java.util.concurrent.Callable;
import java.util.function.Consumer;

/** Each supplied attempt MUST create and close a fresh transaction. Unknown commits are not retried. */
public final class SqlRetry {
    private SqlRetry() { }
    public static boolean retryable(Throwable failure) {
        for (Throwable t = failure; t != null; t = t.getCause()) {
            if (t instanceof SQLException sql) return "40P01".equals(sql.getSQLState()) || "40001".equals(sql.getSQLState());
        }
        return false;
    }
    public static <T> T wholeTransaction(Callable<T> attempt, Consumer<Integer> retryLog) throws Exception {
        long start = System.nanoTime();
        for (int n = 1; ; n++) {
            try { return attempt.call(); }
            catch (Exception failure) {
                if (!retryable(failure) || n >= 3 || System.nanoTime() - start >= Duration.ofSeconds(2).toNanos()) throw failure;
                retryLog.accept(n);
                Thread.sleep(10L * n);
            }
        }
    }
}
