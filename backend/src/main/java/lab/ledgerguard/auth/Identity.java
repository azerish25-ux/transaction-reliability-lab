package lab.ledgerguard.auth;

import java.security.Principal;
import java.time.Instant;
import java.util.UUID;

/** Authorization identity is read from the current database row, not caller-controlled role claims. */
public record Identity(UUID userId, UUID sessionId, String email, String displayName, String role,
                       Instant expiresAt) implements Principal {
    @Override public String getName() { return userId.toString(); }
    public UserView view() { return new UserView(userId, email, displayName, role, expiresAt); }
    public record UserView(UUID id, String email, String displayName, String role, Instant expiresAt) { }
}
