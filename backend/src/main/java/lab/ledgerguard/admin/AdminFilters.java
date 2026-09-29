package lab.ledgerguard.admin;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.http.ApiException;

/** Only known predicates are appended to SQL. All caller values remain bound parameters. */
public record AdminFilters(Map<String, String> values, int limit, int offset) {
    private static final String UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
    private static final Set<String> KINDS = Set.of("FUNDING", "TRANSFER", "PAYMENT", "REFUND", "REVERSAL");
    private static final Set<String> STATES = Set.of("PENDING", "SETTLED", "FAILED", "CANCELLED");
    private static final Set<String> CURRENCIES = Set.of("CAD", "USD", "JPY", "KWD");
    private static final Set<String> TRANSACTIONS = Set.of("reference", "kind", "status", "account", "user", "currency",
        "minAmountMinor", "maxAmountMinor", "from", "to", "parentId", "limit", "offset");
    private static final Set<String> AUDIT = Set.of("aggregateId", "operationId", "actorId", "correlationId", "action", "from", "to", "limit", "offset");

    public AdminFilters { values = Map.copyOf(values); Page.validate(limit, offset); }
    public static AdminFilters transactions(Map<String, List<String>> query) { return parse(query, TRANSACTIONS); }
    public static AdminFilters audit(Map<String, List<String>> query) { return parse(query, AUDIT); }
    public static AdminFilters paging(Map<String, List<String>> query) { return parse(query, Set.of("limit", "offset")); }

    private static AdminFilters parse(Map<String, List<String>> query, Set<String> allowed) {
        Map<String, String> values = new LinkedHashMap<>();
        query.forEach((key, input) -> {
            if (!allowed.contains(key) || input == null || input.size() != 1 || input.getFirst() == null) invalid();
            String value = input.getFirst().trim();
            if (value.length() > 254 || value.chars().anyMatch(Character::isISOControl)) invalid();
            if (!value.isEmpty()) values.put(key, value);
        });
        int limit = integer(values.remove("limit"), 25), offset = integer(values.remove("offset"), 0);
        Page.validate(limit, offset);
        for (String name : List.of("reference", "parentId", "aggregateId", "operationId", "actorId", "correlationId")) {
            if (values.containsKey(name)) values.put(name, uuid(values.get(name)).toString());
        }
        choice(values, "kind", KINDS); choice(values, "status", STATES); choice(values, "currency", CURRENCIES);
        if (values.containsKey("account")) {
            String account = values.get("account");
            if (account.matches(UUID_PATTERN)) account = uuid(account).toString();
            else if (account.matches("(?i)LG-[0-9a-f]{32}")) account = "LG-" + account.substring(3).toLowerCase(Locale.ROOT);
            else invalid();
            values.put("account", account);
        }
        if (values.containsKey("user")) {
            String user = values.get("user").toLowerCase(Locale.ROOT);
            if (!user.matches(UUID_PATTERN) && !user.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) invalid();
            values.put("user", user);
        }
        if (values.containsKey("action") && !values.get("action").matches("[A-Z][A-Z0-9_]{0,79}")) invalid();
        for (String name : List.of("minAmountMinor", "maxAmountMinor")) {
            if (values.containsKey(name)) values.put(name, Long.toString(amount(values.get(name))));
        }
        if (values.containsKey("minAmountMinor") && values.containsKey("maxAmountMinor")
                && amount(values.get("minAmountMinor")) > amount(values.get("maxAmountMinor"))) invalid();
        for (String name : List.of("from", "to")) {
            if (values.containsKey(name)) values.put(name, instant(values.get(name)).toString());
        }
        if (values.containsKey("from") && values.containsKey("to")
                && !instant(values.get("from")).isBefore(instant(values.get("to")))) invalid();
        return new AdminFilters(values, limit, offset);
    }
    public static UUID uuid(String value) {
        if (value == null || !value.matches(UUID_PATTERN)) throw new ApiException(400, "INVALID_ADMIN_FILTER");
        return UUID.fromString(value);
    }
    static long amount(String value) {
        if (value == null || !value.matches("0|[1-9][0-9]{0,18}")) throw new ApiException(400, "INVALID_ADMIN_FILTER");
        try { return Long.parseLong(value); }
        catch (NumberFormatException failure) { throw new ApiException(400, "INVALID_ADMIN_FILTER"); }
    }
    static Instant instant(String value) {
        if (value == null || !value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z")) invalid();
        try { return Instant.parse(value); }
        catch (DateTimeParseException failure) { throw new ApiException(400, "INVALID_ADMIN_FILTER"); }
    }
    private static int integer(String value, int fallback) {
        if (value == null) return fallback;
        if (!value.matches("0|[1-9][0-9]{0,4}")) throw new ApiException(400, "INVALID_PAGINATION");
        return Integer.parseInt(value);
    }
    private static void choice(Map<String, String> values, String key, Set<String> allowed) {
        if (values.containsKey(key) && !allowed.contains(values.get(key))) invalid();
    }
    private static void invalid() { throw new ApiException(400, "INVALID_ADMIN_FILTER"); }

    Map<String, Object> parameters() {
        Map<String, Object> result = new LinkedHashMap<>(values);
        for (String name : List.of("reference", "parentId", "aggregateId", "operationId", "actorId", "correlationId"))
            if (values.containsKey(name)) result.put(name, uuid(values.get(name)));
        for (String name : List.of("from", "to"))
            if (values.containsKey(name)) result.put(name, Timestamp.from(instant(values.get(name))));
        for (String name : List.of("minAmountMinor", "maxAmountMinor"))
            if (values.containsKey(name)) result.put(name, amount(values.get(name)));
        result.put("limit", limit + 1); result.put("offset", offset);
        return result;
    }
}
