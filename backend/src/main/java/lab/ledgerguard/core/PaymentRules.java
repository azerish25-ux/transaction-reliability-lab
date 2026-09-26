package lab.ledgerguard.core;

public final class PaymentRules {
    public enum State { PENDING, SETTLED, FAILED, CANCELLED }
    public enum Adjustment { NONE, PARTIALLY_REFUNDED, FULLY_REFUNDED, REVERSED }
    private PaymentRules() { }
    public record Snapshot(long amount, State state, long refunded, boolean reversed, long version) {
        public Snapshot {
            DomainFailure.require(amount > 0 && amount <= Money.MAX_TRANSACTION && refunded >= 0
                && refunded <= amount && version >= 1, "PAYMENT_INVARIANT", 409);
            DomainFailure.require(state != null && (state == State.SETTLED || (refunded == 0 && !reversed)),
                "PAYMENT_INVARIANT", 409);
            DomainFailure.require(!reversed || refunded == 0, "PAYMENT_INVARIANT", 409);
        }
        public Adjustment adjustment() {
            if (reversed) return Adjustment.REVERSED;
            if (refunded == 0) return Adjustment.NONE;
            return refunded == amount ? Adjustment.FULLY_REFUNDED : Adjustment.PARTIALLY_REFUNDED;
        }
        public Snapshot settle() { pending(); return new Snapshot(amount, State.SETTLED, 0, false, nextVersion()); }
        public Snapshot cancel() { pending(); return new Snapshot(amount, State.CANCELLED, 0, false, nextVersion()); }
        public Snapshot fail() { pending(); return new Snapshot(amount, State.FAILED, 0, false, nextVersion()); }
        public Snapshot refund(long value) {
            DomainFailure.require(state == State.SETTLED && !reversed, "INVALID_PAYMENT_STATE", 409);
            DomainFailure.require(value > 0 && value <= amount - refunded, "EXCESS_REFUND", 422);
            return new Snapshot(amount, state, Math.addExact(refunded, value), false, nextVersion());
        }
        public Snapshot reverse() {
            DomainFailure.require(state == State.SETTLED && refunded == 0 && !reversed, "REVERSAL_FORBIDDEN", 409);
            return new Snapshot(amount, state, 0, true, nextVersion());
        }
        private void pending() { DomainFailure.require(state == State.PENDING, "INVALID_PAYMENT_STATE", 409); }
        private long nextVersion() { return Math.incrementExact(version); }
    }
}
