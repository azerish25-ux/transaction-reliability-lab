package lab.ledgerguard.admin;

import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.http.ApiException;

/** Defense in depth: administrator queries also reject direct non-admin service calls. */
final class AdminAccess {
    private AdminAccess() { }
    static void require(Identity identity) {
        if (identity == null) throw new ApiException(401, "AUTHENTICATION_REQUIRED");
        if (!"ADMIN".equals(identity.role())) throw new ApiException(403, "FORBIDDEN");
    }
}
