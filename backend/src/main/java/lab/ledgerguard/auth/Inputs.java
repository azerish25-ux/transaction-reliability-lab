package lab.ledgerguard.auth;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;
import lab.ledgerguard.http.ApiException;

public final class Inputs {
    private Inputs() { }
    public static String email(String input) {
        if (input == null || input.length() > 300) throw new ApiException(400, "INVALID_EMAIL");
        String value = input.strip().toLowerCase(Locale.ROOT);
        if (value.length() > 254 || !value.matches("[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\\.[a-z]{2,63}"))
            throw new ApiException(400, "INVALID_EMAIL");
        return value;
    }
    public static String password(String value) {
        // BCrypt has a 72-byte input boundary. Reject, never silently truncate UTF-8 passwords.
        if (value == null || value.length() < 12 || value.getBytes(StandardCharsets.UTF_8).length > 72
                || value.codePoints().anyMatch(Character::isISOControl)) throw new ApiException(400, "INVALID_PASSWORD");
        return value;
    }
    public static String label(String value) {
        if (value == null) throw new ApiException(400, "INVALID_LABEL");
        value = value.strip();
        if (value.isEmpty() || value.length() > 80 || value.codePoints().anyMatch(Character::isISOControl))
            throw new ApiException(400, "INVALID_LABEL");
        return value;
    }
    public static String currency(String value) {
        if (value == null || !Set.of("CAD", "USD", "JPY", "KWD").contains(value))
            throw new ApiException(400, "INVALID_CURRENCY");
        return value;
    }
}
