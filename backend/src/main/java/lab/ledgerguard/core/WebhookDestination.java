package lab.ledgerguard.core;

import java.net.*;
import java.util.Set;

/** Customers select a configured destination ID; they cannot supply an arbitrary URL. */
public final class WebhookDestination {
    private WebhookDestination() { }
    public static URI validate(URI uri, Set<URI> exactAllowlist, boolean sandbox) {
        DomainFailure.require(uri != null && exactAllowlist.contains(uri), "DESTINATION_DENIED", 400);
        DomainFailure.require(uri.getUserInfo() == null && uri.getFragment() == null && uri.getHost() != null
            && uri.getRawQuery() == null && uri.normalize().equals(uri), "DESTINATION_DENIED", 400);
        boolean internal = sandbox && uri.equals(URI.create("http://receiver:8081/events"));
        DomainFailure.require(internal || ("https".equals(uri.getScheme()) && (uri.getPort() == -1 || uri.getPort() == 443)),
            "DESTINATION_DENIED", 400);
        return uri;
    }
    public static void validateResolved(URI uri, InetAddress[] addresses, boolean sandbox) {
        boolean internal = sandbox && uri.equals(URI.create("http://receiver:8081/events"));
        DomainFailure.require(addresses != null && addresses.length > 0, "DESTINATION_UNRESOLVED", 503);
        for (InetAddress address : addresses) {
            byte[] bytes = address.getAddress();
            boolean ula = bytes.length == 16 && (bytes[0] & 0xfe) == 0xfc;
            boolean cgnat = bytes.length == 4 && (bytes[0] & 255) == 100 && ((bytes[1] & 255) >= 64 && (bytes[1] & 255) <= 127);
            boolean special = address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                || address.isSiteLocalAddress() || address.isMulticastAddress() || ula || cgnat;
            DomainFailure.require(internal || !special, "DESTINATION_DENIED", 400);
        }
    }
}
