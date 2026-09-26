package lab.ledgerguard.core;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

public final class Idempotency {
    private Idempotency() { }
    public static String key(String value) {
        DomainFailure.require(value != null && value.matches("[A-Za-z0-9][A-Za-z0-9._:-]{7,127}"),
            "INVALID_IDEMPOTENCY_KEY", 400);
        return value;
    }
    public static String fingerprint(UUID actor, String operation, String parent, Map<String, String> canonicalIntent) {
        try {
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            field(hash, "ledgerguard-intent-v1"); field(hash, actor.toString());
            field(hash, operation); field(hash, parent);
            for (var e : new TreeMap<>(canonicalIntent).entrySet()) { field(hash, e.getKey()); field(hash, e.getValue()); }
            return HexFormat.of().formatHex(hash.digest());
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static void field(MessageDigest hash, String value) {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        hash.update(ByteBuffer.allocate(4).putInt(bytes.length).array()); hash.update(bytes);
    }
}
