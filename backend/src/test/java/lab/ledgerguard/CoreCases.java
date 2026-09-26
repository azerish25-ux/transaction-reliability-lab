package lab.ledgerguard;

import lab.ledgerguard.core.*;
import lab.ledgerguard.core.PaymentRules.State;
import lab.ledgerguard.core.PaymentRules.Snapshot;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.time.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Shared test bodies: Jupiter DynamicTest in Maven; explicitly labeled standalone runner offline. */
public final class CoreCases {
    public record Case(String id, String risk, Runnable run) { }
    private static final List<Case> CASES = new ArrayList<>();
    private static final UUID A = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID B = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-09-26T10:00:00Z"), ZoneOffset.UTC);
    private CoreCases() { }
    private static void test(String id, String risk, Runnable runnable) { CASES.add(new Case(id, risk, runnable)); }
    public static List<Case> all() {
        if (!CASES.isEmpty()) return List.copyOf(CASES);
        for (CurrencyUnit unit : CurrencyUnit.values()) {
            test("MONEY-"+unit+"-minor", "R09", () -> equal(Money.amount("1250", unit.name()).minorString(), "1250"));
            test("MONEY-"+unit+"-roundtrip", "R09", () -> {
                for (long n : new long[]{1, 10, 999, 1001, Money.MAX_TRANSACTION}) {
                    Money m = new Money(n, unit);
                    equal(Money.decimalAmount(m.decimalString(), unit), m);
                }
            });
            test("MONEY-"+unit+"-precision", "R09", () -> failure("EXCESS_PRECISION",
                () -> Money.decimalAmount("1." + "1".repeat(unit.exponent()+1),unit)));
        }
        String[] invalid={"", " ", " 1", "1 ", "-1", "+1", "1.0", "1e3", "1E3", "01", "00", "NaN", "Infinity", "١", "1_000", "1,000", "1\n"};
        for (int i=0; i<invalid.length; i++) {
            final String input=invalid[i]; test("MONEY-invalid-"+i,"R09",() -> failure("INVALID_AMOUNT",() -> Money.amount(input,"CAD")));
        }
        test("MONEY-null", "R09", () -> failure("INVALID_AMOUNT", () -> Money.amount(null,"CAD")));
        for (String c : new String[]{"cad","EUR","", " CAD"})
            test("MONEY-currency-"+c, "R09", () -> failure("UNSUPPORTED_CURRENCY", () -> Money.amount("1",c)));
        test("MONEY-zero","R09",() -> failure("AMOUNT_OUT_OF_RANGE",() -> Money.amount("0","CAD")));
        test("MONEY-api-limit","R09",() -> failure("AMOUNT_OUT_OF_RANGE",() -> Money.amount("1000000000001","CAD")));
        test("MONEY-long-overflow","R09",() -> failure("AMOUNT_OVERFLOW",() -> Money.amount("9223372036854775808","CAD")));
        test("MONEY-lossy-decimal","R09",() -> equal(Money.decimalAmount("0.29",CurrencyUnit.CAD).minor(),29L));
        test("MONEY-add-overflow","R09",() -> failure("BALANCE_OVERFLOW",() -> new Money(Long.MAX_VALUE,CurrencyUnit.CAD).plus(new Money(1,CurrencyUnit.CAD))));
        test("MONEY-mixed-currency","R09",() -> failure("CURRENCY_MISMATCH",() -> new Money(1,CurrencyUnit.CAD).plus(new Money(1,CurrencyUnit.USD))));
        test("MONEY-negative-result","R09",() -> failure("INSUFFICIENT_FUNDS",() -> new Money(1,CurrencyUnit.CAD).minus(new Money(2,CurrencyUnit.CAD))));
        test("WALLET-hold-consume","R07",() -> equal(new WalletBalance(10000,0).reserve(8000).consume(8000),new WalletBalance(2000,0)));
        test("WALLET-hold-release","R07",() -> equal(new WalletBalance(10000,0).reserve(8000).release(8000),new WalletBalance(10000,0)));
        test("WALLET-held-unspendable","R02",() -> failure("INSUFFICIENT_FUNDS",() -> new WalletBalance(10000,8000).debit(8000)));
        test("WALLET-double-consume","R07",() -> failure("INVALID_HOLD",() -> new WalletBalance(10000,8000).consume(8000).consume(8000)));
        test("WALLET-overflow","R09",() -> failure("BALANCE_OVERFLOW",() -> new WalletBalance(Long.MAX_VALUE,0).credit(1)));
        for (long[] pair : new long[][]{{-1,0},{0,-1},{1,2}})
            test("WALLET-invalid-"+Arrays.toString(pair),"R07",() -> failure("BALANCE_INVARIANT",() -> new WalletBalance(pair[0],pair[1])));
        test("WALLET-model-seed-74021","R07",CoreCases::model);
        test("JOURNAL-transfer","R07",() -> new Journal(A,CurrencyUnit.CAD,List.of(entry(A,Journal.Side.DEBIT,1250),entry(B,Journal.Side.CREDIT,1250))));
        test("JOURNAL-unbalanced","R07",() -> failure("UNBALANCED_JOURNAL",() -> new Journal(A,CurrencyUnit.CAD,List.of(entry(A,Journal.Side.DEBIT,1250),entry(B,Journal.Side.CREDIT,1249)))));
        test("JOURNAL-incomplete","R07",() -> failure("INCOMPLETE_JOURNAL",() -> new Journal(A,CurrencyUnit.CAD,List.of(entry(A,Journal.Side.DEBIT,1250)))));
        test("JOURNAL-wide-sums","R09",() -> new Journal(A,CurrencyUnit.CAD,List.of(entry(A,Journal.Side.DEBIT,Long.MAX_VALUE),entry(A,Journal.Side.DEBIT,Long.MAX_VALUE),entry(B,Journal.Side.CREDIT,Long.MAX_VALUE),entry(B,Journal.Side.CREDIT,Long.MAX_VALUE))));
        test("JOURNAL-wide-imbalance","R09",() -> failure("UNBALANCED_JOURNAL",() -> new Journal(A,CurrencyUnit.CAD,List.of(entry(A,Journal.Side.DEBIT,Long.MAX_VALUE),entry(A,Journal.Side.DEBIT,Long.MAX_VALUE),entry(B,Journal.Side.CREDIT,1)))));
        test("JOURNAL-currency","R07",() -> failure("CURRENCY_MISMATCH",() -> new Journal(A,CurrencyUnit.USD,List.of(entry(A,Journal.Side.DEBIT,1),entry(B,Journal.Side.CREDIT,1)))));
        for (State state: State.values()) {
            for (String command : List.of("settle","cancel","fail")) {
                test("STATE-"+state+"-"+command,"R07",() -> {
                    Snapshot p=new Snapshot(10000,state,0,false,1);
                    Runnable action=() -> {switch(command){case "settle" -> p.settle();case "cancel" -> p.cancel();case "fail" -> p.fail();default -> throw new AssertionError();}};
                    if(state==State.PENDING) action.run(); else failure("INVALID_PAYMENT_STATE",action);
                });
            }
        }
        test("REFUND-partial-full","R08",() -> {
            Snapshot p=new Snapshot(10000,State.SETTLED,0,false,2).refund(3000);
            equal(p.adjustment(),PaymentRules.Adjustment.PARTIALLY_REFUNDED);
            equal(p.refund(7000).adjustment(),PaymentRules.Adjustment.FULLY_REFUNDED);
            failure("EXCESS_REFUND",() -> p.refund(7001));
        });
        test("REFUND-after-reversal","R08",() -> failure("INVALID_PAYMENT_STATE",() -> new Snapshot(10000,State.SETTLED,0,true,2).refund(1)));
        test("REVERSAL-after-refund","R08",() -> failure("REVERSAL_FORBIDDEN",() -> new Snapshot(10000,State.SETTLED,1,false,2).reverse()));
        test("REVERSAL-once","R08",() -> {
            Snapshot p=new Snapshot(10000,State.SETTLED,0,false,2).reverse();
            equal(p.adjustment(),PaymentRules.Adjustment.REVERSED);failure("REVERSAL_FORBIDDEN",p::reverse);
        });
        test("IDEMPOTENCY-map-order","R01",() -> equal(fp(Map.of("amountMinor","1","currency","CAD")),fp(new LinkedHashMap<>(Map.of("currency","CAD","amountMinor","1")))));
        test("IDEMPOTENCY-intent-change","R01",() -> notEqual(fp(Map.of("amountMinor","1")),fp(Map.of("amountMinor","2"))));
        test("IDEMPOTENCY-field-framing","R01",() -> notEqual(fp(Map.of("a","bc")),fp(Map.of("ab","c"))));
        test("IDEMPOTENCY-actor-isolation","R10",() -> notEqual(Idempotency.fingerprint(A,"transfer","",Map.of("amountMinor","1")),Idempotency.fingerprint(B,"transfer","",Map.of("amountMinor","1"))));
        test("IDEMPOTENCY-parent-isolation","R01",() -> notEqual(Idempotency.fingerprint(A,"refund","1",Map.of("amountMinor","1")),Idempotency.fingerprint(A,"refund","2",Map.of("amountMinor","1"))));
        test("IDEMPOTENCY-key-bounds","R01",() -> {equal(Idempotency.key("12345678"),"12345678");failure("INVALID_IDEMPOTENCY_KEY",() -> Idempotency.key("short"));failure("INVALID_IDEMPOTENCY_KEY",() -> Idempotency.key("a".repeat(129)));});
        ZoneId halifax=ZoneId.of("America/Halifax");
        test("SCHEDULE-gap","R15",() -> equal(SchedulePolicy.resolve(LocalDateTime.parse("2026-03-08T02:30:00"),halifax),Instant.parse("2026-03-08T06:30:00Z")));
        test("SCHEDULE-overlap","R15",() -> equal(SchedulePolicy.resolve(LocalDateTime.parse("2026-11-01T01:30:00"),halifax),Instant.parse("2026-11-01T04:30:00Z")));
        test("SCHEDULE-daily-spring","R15",() -> equal(SchedulePolicy.nextInstant(LocalDateTime.parse("2026-03-07T09:00:00"),halifax,SchedulePolicy.Recurrence.DAILY),Instant.parse("2026-03-08T12:00:00Z")));
        test("SCHEDULE-daily-fall","R15",() -> equal(SchedulePolicy.nextInstant(LocalDateTime.parse("2026-10-31T09:00:00"),halifax,SchedulePolicy.Recurrence.DAILY),Instant.parse("2026-11-01T13:00:00Z")));
        test("SCHEDULE-weekly","R15",() -> equal(SchedulePolicy.nextInstant(LocalDateTime.parse("2026-03-01T09:00:00"),halifax,SchedulePolicy.Recurrence.WEEKLY),Instant.parse("2026-03-08T12:00:00Z")));
        test("SCHEDULE-once","R15",() -> failure("SCHEDULE_FINISHED",() -> SchedulePolicy.next(LocalDateTime.now(CLOCK),SchedulePolicy.Recurrence.ONCE)));
        test("SCHEDULE-catch-up-boundaries","R15",() -> {yes(SchedulePolicy.withinCatchUp(CLOCK.instant().minusSeconds(86400),CLOCK));no(SchedulePolicy.withinCatchUp(CLOCK.instant().minusSeconds(86401),CLOCK));no(SchedulePolicy.withinCatchUp(CLOCK.instant().plusSeconds(1),CLOCK));});
        test("SCHEDULE-version-identity","R15",() -> notEqual(SchedulePolicy.occurrenceKey(A,1,LocalDateTime.now(CLOCK)),SchedulePolicy.occurrenceKey(A,2,LocalDateTime.now(CLOCK))));
        test("PROJECTION-stale","R06",() -> equal(new Projection(A,3,State.SETTLED).apply(new Projection(A,1,State.PENDING)).state(),State.SETTLED));
        test("PROJECTION-gap-snapshot","R06",() -> equal(new Projection(A,1,State.PENDING).apply(new Projection(A,9,State.SETTLED)).version(),9L));
        test("PROJECTION-other-aggregate","R06",() -> failure("WRONG_AGGREGATE",() -> new Projection(A,1,State.PENDING).apply(new Projection(B,2,State.SETTLED))));
        test("WEBHOOK-independent-vector","R13",() -> equal(WebhookSignature.sign(secret(),1790416800L,UUID.fromString("00000000-0000-0000-0000-000000000123"),body()),"v1=c0f55afd6f8a73978046016f7cc116c9abc47d0a42c8ba0b74c5f166a6da3147"));
        test("WEBHOOK-exact-bytes","R13",() -> {
            String s=WebhookSignature.sign(secret(),CLOCK.instant().getEpochSecond(),A,body());
            yes(WebhookSignature.verify(secret(),CLOCK.instant().getEpochSecond(),A,body(),s,CLOCK));
            no(WebhookSignature.verify(secret(),CLOCK.instant().getEpochSecond(),A,"altered".getBytes(StandardCharsets.UTF_8),s,CLOCK));
            no(WebhookSignature.verify(secret(),CLOCK.instant().getEpochSecond(),B,body(),s,CLOCK));
        });
        test("WEBHOOK-replay-window","R13",() -> {long t=CLOCK.instant().getEpochSecond()-301;String s=WebhookSignature.sign(secret(),t,A,body());no(WebhookSignature.verify(secret(),t,A,body(),s,CLOCK));});
        test("WEBHOOK-invalid-header","R13",() -> no(WebhookSignature.verify(secret(),CLOCK.instant().getEpochSecond(),A,body(),"v1=ff",CLOCK)));
        test("WEBHOOK-attempt-budget","R13",() -> no(WebhookPolicy.nextAttempt(8,CLOCK.instant(),CLOCK,new Random(7),null).isPresent()));
        test("WEBHOOK-age-budget","R13",() -> no(WebhookPolicy.nextAttempt(1,CLOCK.instant().minusSeconds(86400),CLOCK,new Random(7),null).isPresent()));
        test("WEBHOOK-backoff-bounds","R13",() -> {
            for(int n=1;n<=7;n++) for(int seed=0;seed<100;seed++) {
                long delay=Duration.between(CLOCK.instant(),WebhookPolicy.nextAttempt(n,CLOCK.instant(),CLOCK,new Random(seed),null).orElseThrow()).toMillis();
                long base=Math.min(300000,2000L*(1L<<(n-1)));yes(delay>=(long)(base*.8)&&delay<=Math.min(300000,(long)(base*1.2)));
            }
        });
        test("WEBHOOK-retry-after-cap","R13",() -> equal(Duration.between(CLOCK.instant(),WebhookPolicy.nextAttempt(1,CLOCK.instant(),CLOCK,new Random(7),Duration.ofDays(1)).orElseThrow()),Duration.ofSeconds(300)));
        for(int status:new int[]{200,204,299,408,429,500,503,599,0,301,302,400,401,403,404})
            test("WEBHOOK-status-"+status,"R13",() -> equal(WebhookPolicy.classify(status),status>=200&&status<300?WebhookPolicy.Outcome.DELIVERED:status==0||status==408||status==429||status>=500&&status<600?WebhookPolicy.Outcome.RETRY:WebhookPolicy.Outcome.FAILED));
        test("SECRETBOX-roundtrip-binding","R13",() -> {SecretBox box=new SecretBox(secret());String encrypted=box.seal(A,body());yes(Arrays.equals(box.open(A,encrypted),body()));throwsType(IllegalArgumentException.class,() -> box.open(B,encrypted));notEqual(encrypted,box.seal(A,body()));});
        test("SECRETBOX-tampering","R13",() -> {SecretBox box=new SecretBox(secret());byte[] data=Base64.getDecoder().decode(box.seal(A,body()));data[data.length-1]^=1;throwsType(IllegalArgumentException.class,() -> box.open(A,Base64.getEncoder().encodeToString(data)));});
        test("EGRESS-exact-internal","R18",() -> {URI uri=URI.create("http://receiver:8081/events");equal(WebhookDestination.validate(uri,Set.of(uri),true),uri);failure("DESTINATION_DENIED",() -> WebhookDestination.validate(uri,Set.of(uri),false));});
        test("EGRESS-metadata-denied","R18",() -> {URI uri=URI.create("https://169.254.169.254/events");try {failure("DESTINATION_DENIED",() -> WebhookDestination.validateResolved(uri,new InetAddress[]{address(169,254,169,254)},false));}catch(Exception e){throw new AssertionError(e);}});
        test("EGRESS-cgnat-denied","R18",() -> failure("DESTINATION_DENIED",() -> WebhookDestination.validateResolved(URI.create("https://example.test/events"),new InetAddress[]{address(100,100,1,1)},false)));
        test("SQLRETRY-classification","R18",() -> {yes(SqlRetry.retryable(new SQLException("deadlock","40P01")));yes(SqlRetry.retryable(new SQLException("serialization","40001")));no(SqlRetry.retryable(new SQLException("connection lost","08006")));no(SqlRetry.retryable(new SQLException("duplicate","23505")));});
        test("SQLRETRY-bounded","R18",() -> {AtomicInteger attempts=new AtomicInteger();try {SqlRetry.wholeTransaction(() -> {attempts.incrementAndGet();throw new SQLException("deadlock","40P01");},n -> {});throw new AssertionError("expected failure");} catch(SQLException expected){equal(attempts.get(),3);} catch(Exception e){throw new AssertionError(e);}});
        test("SQLRETRY-unknown-commit","R03",() -> {AtomicInteger attempts=new AtomicInteger();try {SqlRetry.wholeTransaction(() -> {attempts.incrementAndGet();throw new SQLException("connection lost","08006");},n -> {});throw new AssertionError("expected failure");}catch(SQLException expected){equal(attempts.get(),1);}catch(Exception e){throw new AssertionError(e);}});
        return List.copyOf(CASES);
    }
    private static InetAddress address(int a,int b,int c,int d) {try{return InetAddress.getByAddress(new byte[]{(byte)a,(byte)b,(byte)c,(byte)d});}catch(UnknownHostException e){throw new AssertionError(e);}}
    private static byte[] secret() {byte[] b=new byte[32];for(int i=0;i<32;i++)b[i]=(byte)i;return b;}
    private static byte[] body() {return "{\"amountMinor\":\"1250\",\"currency\":\"CAD\"}".getBytes(StandardCharsets.UTF_8);}
    private static String fp(Map<String,String> intent) {return Idempotency.fingerprint(A,"transfer","",intent);}
    private static Journal.Entry entry(UUID account,Journal.Side side,long minor) {return new Journal.Entry(account,CurrencyUnit.CAD,side,minor);}
    private static void model() {
        Random random=new Random(74021);WalletBalance wallet=new WalletBalance(100000,0);
        BigInteger posted=BigInteger.valueOf(100000),reserved=BigInteger.ZERO;
        for(int i=0;i<50000;i++) {
            long n=random.nextInt(1000)+1;BigInteger amount=BigInteger.valueOf(n);int kind=random.nextInt(5);
            boolean possible=switch(kind){case 0->posted.subtract(reserved).compareTo(amount)>=0;case 1,2->reserved.compareTo(amount)>=0;case 3->posted.subtract(reserved).compareTo(amount)>=0;default->true;};
            WalletBalance before=wallet;
            try {
                wallet=switch(kind){case 0->wallet.reserve(n);case 1->wallet.release(n);case 2->wallet.consume(n);case 3->wallet.debit(n);default->wallet.credit(n);};
                yes(possible);
                switch(kind){case 0->reserved=reserved.add(amount);case 1->reserved=reserved.subtract(amount);case 2->{reserved=reserved.subtract(amount);posted=posted.subtract(amount);}case 3->posted=posted.subtract(amount);default->posted=posted.add(amount);}
            }catch(DomainFailure failure){no(possible);equal(wallet,before);}
            equal(BigInteger.valueOf(wallet.posted()),posted);equal(BigInteger.valueOf(wallet.reserved()),reserved);
            equal(BigInteger.valueOf(wallet.available()),posted.subtract(reserved));
        }
    }
    private static void equal(Object actual,Object expected) {if(!Objects.equals(actual,expected))throw new AssertionError("expected="+expected+" actual="+actual);}
    private static void notEqual(Object a,Object b) {if(Objects.equals(a,b))throw new AssertionError("values unexpectedly equal: "+a);}
    private static void yes(boolean value) {if(!value)throw new AssertionError("expected true");}
    private static void no(boolean value) {if(value)throw new AssertionError("expected false");}
    private static void failure(String code,Runnable body) {try{body.run();}catch(DomainFailure e){equal(e.code(),code);return;}throw new AssertionError("expected DomainFailure "+code);}
    private static void throwsType(Class<? extends Throwable> type,Runnable action){try{action.run();}catch(Throwable t){if(type.isInstance(t))return;throw new AssertionError("wrong exception",t);}throw new AssertionError("expected "+type.getName());}
}
