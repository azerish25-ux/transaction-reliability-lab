package lab.ledgerguard.core;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.UUID;

/** AES-256-GCM using a required externally supplied key; endpoint identity binds ciphertext. */
public final class SecretBox {
    private final byte[] key;
    private final SecureRandom random = new SecureRandom();
    public SecretBox(byte[] key) {
        if (key == null || key.length != 32) throw new IllegalArgumentException("A 32-byte key is required");
        this.key = key.clone();
    }
    public String seal(UUID endpoint, byte[] value) {
        byte[] nonce = new byte[12]; random.nextBytes(nonce);
        byte[] encrypted = crypt(Cipher.ENCRYPT_MODE, endpoint, nonce, value);
        return Base64.getEncoder().encodeToString(ByteBuffer.allocate(nonce.length + encrypted.length)
            .put(nonce).put(encrypted).array());
    }
    public byte[] open(UUID endpoint, String encoded) {
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException e) { throw new IllegalArgumentException("Invalid protected secret"); }
        if (bytes.length < 29) throw new IllegalArgumentException("Invalid protected secret");
        return crypt(Cipher.DECRYPT_MODE, endpoint, Arrays.copyOfRange(bytes, 0, 12), Arrays.copyOfRange(bytes, 12, bytes.length));
    }
    private byte[] crypt(int mode, UUID endpoint, byte[] nonce, byte[] input) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
            cipher.updateAAD(("ledgerguard-secret-v1:" + endpoint).getBytes(StandardCharsets.US_ASCII));
            return cipher.doFinal(input);
        } catch (GeneralSecurityException e) { throw new IllegalArgumentException("Invalid protected secret", e); }
    }
}
