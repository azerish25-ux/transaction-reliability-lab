# Branch consolidation audit

Reviewed main: `e0a1f2a77b84e74e004ee2f093f563da9e1b0816`.

Read-only source/history audit. No feature branch was executed or deleted.

## p05-async-payments

`9c3faa8d9c2d54576f4f6cfafb3b3a7e9b764698`; unique commits: 14.

{"EXACT_CONTENT_IN_MAIN_HISTORY": 18, "IDENTICAL_TO_MAIN": 21}

## p05-staging

`a9e1db246e7933566cb133d9b3ac47dee804a3c1`; unique commits: 10.

{"REVIEW_DIFFERENCE": 16, "PATH_NOT_IN_MAIN_HISTORY": 16, "EXACT_CONTENT_IN_MAIN_HISTORY": 1}

Archive checksum matches historical workflow: True. Actual: `81eb67e1f7f66f816a8e6bfdfbf00247d82a4a4a1c79e279070f526088506cb1`.

### .github/workflows/pr.yml

REVIEW_DIFFERENCE

```diff
--- branch/.github/workflows/pr.yml
+++ main-history/.github/workflows/pr.yml
@@ -11,9 +11,9 @@

 jobs:
   verify:
-    name: Build, security, transfers, payments, PostgreSQL, RabbitMQ and Compose smoke
+    name: Build, security, transfers, financial core, PostgreSQL and Compose smoke
     runs-on: ubuntu-latest
-    timeout-minutes: 90
+    timeout-minutes: 55
     steps:
       - name: Check out candidate
         uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09
@@ -31,25 +31,23 @@
           cache: npm
           cache-dependency-path: frontend/package-lock.json
       - name: Prepare deterministic tools
-        run: chmod +x mvnw scripts/lab scripts/test-core scripts/test-client scripts/assert-p05-evidence scripts/smoke-auth scripts/smoke-payment scripts/unit-probes scripts/validate-evidence scripts/scan-secrets infra/docker/postgres/00-roles.sh
+        run: chmod +x mvnw scripts/lab scripts/test-core scripts/test-client scripts/assert-p04-evidence scripts/smoke-auth scripts/unit-probes scripts/validate-evidence scripts/scan-secrets infra/docker/postgres/00-roles.sh
       - name: Install locked TypeScript dependency
         run: npm ci --prefix frontend
       - name: Run Java and TypeScript component regressions
         run: ./scripts/lab test unit
-      - name: Execute JUnit, PostgreSQL, two-process transfer and RabbitMQ payment verification
+      - name: Execute JUnit, PostgreSQL and two-process transfer HTTP verification
         run: ./mvnw -B -ntp -f backend/pom.xml verify
-      - name: Require executed P03/P04/P05 requirements with no failures or skips
-        run: python3 scripts/assert-p05-evidence
+      - name: Require executed P03/P04 requirements with no failures or skips
+        run: python3 scripts/assert-p04-evidence
       - name: Validate Compose model
         run: docker compose --env-file .env.example -f compose.yaml config --quiet
       - name: Scan tracked source for high-signal literal secrets
         run: ./scripts/scan-secrets
-      - name: Start, seed and reconcile restricted-role application and messaging workers
+      - name: Start, seed and reconcile restricted-role application
         run: ./scripts/lab up
       - name: Exercise live authentication, accounts, transfer and durable replay
         run: python3 scripts/smoke-auth
-      - name: Exercise live payment, outbox, RabbitMQ settlement and owner views
-        run: python3 scripts/smoke-payment
       - name: Verify live status and repeatable reconciliation
         run: |
           ./scripts/lab status
@@ -74,7 +72,6 @@
             backend/target/failsafe-reports/
             backend/target/auth-http-evidence/
             backend/target/transfer-http-evidence/
-            backend/target/payment-messaging-evidence/
   gate:
     name: Required fast-lane gate
     if: always()

```

### backend/src/main/java/lab/ledgerguard/admin/FailedWorkController.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/admin/FailedWorkController.java
+++ main-history/backend/src/main/java/lab/ledgerguard/admin/FailedWorkController.java
@@ -1,9 +1,10 @@
 package lab.ledgerguard.admin;

+import java.util.Map;
 import java.util.UUID;
 import lab.ledgerguard.accounts.Page;
 import lab.ledgerguard.auth.Identity;
-import org.springframework.http.MediaType;
+import lab.ledgerguard.messaging.FailedWorkRepository;
 import org.springframework.http.ResponseEntity;
 import org.springframework.security.core.annotation.AuthenticationPrincipal;
 import org.springframework.web.bind.annotation.*;
@@ -11,28 +12,20 @@
 @RestController
 @RequestMapping("/api/v1/admin/failed-work")
 public class FailedWorkController {
-    private final FailedWorkService failedWork;
-
-    public FailedWorkController(FailedWorkService failedWork) {
-        this.failedWork = failedWork;
-    }
+    private final FailedWorkRepository failed;
+    public FailedWorkController(FailedWorkRepository failed){this.failed=failed;}

     @GetMapping
-    public Page<FailedWorkService.FailedWork> list(@RequestParam(defaultValue = "50") int limit,
-            @RequestParam(defaultValue = "0") int offset) {
-        return failedWork.list(limit, offset);
-    }
+    public Page<FailedWorkRepository.FailedWork> list(@RequestParam(defaultValue="50") int limit,
+            @RequestParam(defaultValue="0") int offset){return failed.list(limit,offset);}

     @GetMapping("/{id}")
-    public FailedWorkService.FailedWork get(@PathVariable UUID id) {
-        return failedWork.get(id);
-    }
+    public FailedWorkRepository.FailedWork get(@PathVariable UUID id){return failed.get(id);}

-    @PostMapping(value = "/{id}/replay", consumes = MediaType.APPLICATION_JSON_VALUE,
-                 produces = MediaType.APPLICATION_JSON_VALUE)
-    public ResponseEntity<FailedWorkService.ReplayAccepted> replay(@AuthenticationPrincipal Identity identity,
-            @PathVariable UUID id, @RequestBody FailedWorkService.ReplayRequest request) {
-        return ResponseEntity.accepted().header("Cache-Control", "no-store")
-            .body(failedWork.replay(identity, id, request));
+    @PostMapping("/{id}/replay")
+    public ResponseEntity<Map<String,Object>> replay(@AuthenticationPrincipal Identity identity,@PathVariable UUID id){
+        failed.request(identity,id);
+        return ResponseEntity.accepted().header("Cache-Control","no-store")
+            .body(Map.of("id",id,"state","REPLAY_REQUESTED"));
     }
 }

```

### backend/src/main/java/lab/ledgerguard/admin/FailedWorkService.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.admin;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.UUID;
import lab.ledgerguard.accounts.Page;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.http.ApiException;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class FailedWorkService {
    private final JdbcTemplate jdbc;

    public FailedWorkService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record FailedWork(UUID id, String consumer, UUID eventId, String messageId, String eventType,
                             String reasonCode, int occurrences, Instant firstFailedAt, Instant lastFailedAt,
                             Instant replayRequestedAt, Instant replayedAt) { }
    public record ReplayRequest(String reason) { }
    public record ReplayAccepted(UUID failedWorkId, UUID eventId, String status) { }

    public Page<FailedWork> list(int limit, int offset) {
        Page.validate(limit, offset);
        return Page.from(jdbc.query("SELECT id,consumer,event_id,message_id,event_type,reason_code,occurrences,"
                + "first_failed_at,last_failed_at,replay_requested_at,replayed_at FROM ledger.failed_messages "
                + "ORDER BY last_failed_at DESC,id DESC LIMIT ? OFFSET ?", this::row, limit + 1, offset),
            limit, offset);
    }

    public FailedWork get(UUID id) {
        var rows = jdbc.query("SELECT id,consumer,event_id,message_id,event_type,reason_code,occurrences,"
            + "first_failed_at,last_failed_at,replay_requested_at,replayed_at FROM ledger.failed_messages WHERE id=?",
            this::row, id);
        if (rows.isEmpty()) throw new ApiException(404, "NOT_FOUND");
        return rows.getFirst();
    }

    public ReplayAccepted replay(Identity identity, UUID id, ReplayRequest request) {
        String reason = request == null || request.reason() == null ? null : request.reason().strip();
        if (reason == null || reason.isEmpty() || reason.length() > 500
            || reason.codePoints().anyMatch(Character::isISOControl)) {
            throw new ApiException(400, "INVALID_REPLAY_REASON");
        }
        try {
            UUID event = jdbc.queryForObject("SELECT ledger.request_failed_replay(?,?,?)", UUID.class,
                id, identity.userId(), reason);
            return new ReplayAccepted(id, event, "REPLAY_QUEUED");
        } catch (DataAccessException failure) {
            String state = sqlState(failure);
            if ("P4040".equals(state)) throw new ApiException(404, "NOT_REPLAYABLE");
            if ("P4030".equals(state)) throw new ApiException(403, "FORBIDDEN");
            throw new ApiException(503, "DEPENDENCY_UNAVAILABLE");
        }
    }

    private FailedWork row(ResultSet rs, int row) throws SQLException {
        return new FailedWork(rs.getObject("id", UUID.class), rs.getString("consumer"),
            rs.getObject("event_id", UUID.class), rs.getString("message_id"), rs.getString("event_type"),
            rs.getString("reason_code"), rs.getInt("occurrences"), rs.getTimestamp("first_failed_at").toInstant(),
            rs.getTimestamp("last_failed_at").toInstant(), instant(rs, "replay_requested_at"), instant(rs, "replayed_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        var timestamp = rs.getTimestamp(column);
        return timestamp == null ? null : timestamp.toInstant();
    }

    private static String sqlState(Throwable failure) {
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current instanceof SQLException sql) return sql.getSQLState();
        }
        return null;
    }
}

```

### backend/src/main/java/lab/ledgerguard/config/FoundationSecurityConfiguration.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/config/FoundationSecurityConfiguration.java
+++ main-history/backend/src/main/java/lab/ledgerguard/config/FoundationSecurityConfiguration.java
@@ -41,7 +41,7 @@
                 StreamReadConstraints.builder().maxNestingDepth(20).maxStringLength(16384).maxNumberLength(32).build()));
     }
     @Bean
-    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
+    @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
     SecurityFilterChain foundationSecurity(HttpSecurity http,SecuritySettings settings,JwtSessions sessions,
             SecurityEvents events,ObjectMapper json,CookieCsrfTokenRepository csrf) throws Exception {
         http.sessionManagement(session->session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))

```

### backend/src/main/java/lab/ledgerguard/messaging/EventEnvelope.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/messaging/EventEnvelope.java
+++ main-history/backend/src/main/java/lab/ledgerguard/messaging/EventEnvelope.java
@@ -2,41 +2,32 @@

 import com.fasterxml.jackson.databind.JsonNode;
 import java.time.Instant;
-import java.util.Set;
 import java.util.UUID;

-/** Stable full-snapshot event envelope. Event IDs survive every outbox re-publication. */
-public record EventEnvelope(UUID eventId, int envelopeVersion, String eventType, int schemaVersion, UUID aggregateId,
+/** Stable full-snapshot envelope. Event IDs and aggregate versions survive every redelivery/replay. */
+public record EventEnvelope(UUID eventId, String eventType, int schemaVersion, UUID aggregateId,
                             long aggregateVersion, UUID correlationId, Instant occurredAt, JsonNode payload) {
-    private static final Set<String> PAYMENT_STATES = Set.of("PENDING", "SETTLED", "FAILED", "CANCELLED");
-
     public EventEnvelope {
-        if (eventId == null || aggregateId == null || correlationId == null || occurredAt == null
-            || eventType == null || !eventType.matches("[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+") || eventType.length() > 100
-            || envelopeVersion != 1 || schemaVersion != 1 || aggregateVersion < 1 || payload == null || !payload.isObject()) {
+        if (eventId == null || aggregateId == null || correlationId == null || occurredAt == null || payload == null
+            || !payload.isObject() || schemaVersion != 1 || aggregateVersion < 1 || eventType == null
+            || !eventType.matches("[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*){1,3}")) {
             throw new IllegalArgumentException("INVALID_EVENT_ENVELOPE");
         }
     }

-    public PaymentSnapshot paymentSnapshot() {
-        if (!eventType.startsWith("payment.")) throw new IllegalArgumentException("NOT_PAYMENT_EVENT");
-        String paymentText = payload.path("paymentId").asText(null);
-        String state = payload.path("state").asText(null);
-        long version = payload.path("version").canConvertToLong() ? payload.path("version").longValue() : -1L;
-        UUID paymentId;
-        try {
-            paymentId = UUID.fromString(paymentText);
-        } catch (IllegalArgumentException | NullPointerException invalid) {
-            throw new IllegalArgumentException("INVALID_PAYMENT_EVENT", invalid);
-        }
-        if (!aggregateId.equals(paymentId) || version != aggregateVersion || !PAYMENT_STATES.contains(state)) {
-            throw new IllegalArgumentException("INVALID_PAYMENT_EVENT");
-        }
-        if ("payment.requested".equals(eventType) && (!"PENDING".equals(state) || version != 1L)) {
-            throw new IllegalArgumentException("INVALID_PAYMENT_REQUEST_EVENT");
-        }
-        return new PaymentSnapshot(paymentId, version, state);
+    public UUID paymentId() {
+        String value = payload.path("paymentId").asText("");
+        UUID parsed;
+        try { parsed = UUID.fromString(value); }
+        catch (IllegalArgumentException invalid) { throw new IllegalArgumentException("INVALID_PAYMENT_EVENT"); }
+        if (!parsed.equals(aggregateId)) throw new IllegalArgumentException("INVALID_PAYMENT_EVENT");
+        return parsed;
     }

-    public record PaymentSnapshot(UUID paymentId, long version, String state) { }
+    public String paymentState() {
+        String state = payload.path("state").asText("");
+        if (!state.matches("PENDING|SETTLED|FAILED|CANCELLED")) throw new IllegalArgumentException("INVALID_PAYMENT_EVENT");
+        if (payload.path("version").asLong(-1) != aggregateVersion) throw new IllegalArgumentException("INVALID_PAYMENT_EVENT");
+        return state;
+    }
 }

```

### backend/src/main/java/lab/ledgerguard/messaging/EventLogListener.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.messaging;

import com.rabbitmq.client.Channel;
import java.io.IOException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("worker")
public class EventLogListener {
    private final EventLogRepository events;
    private final MessageDecoder decoder;
    private final ListenerFailures failures;

    public EventLogListener(EventLogRepository events, MessageDecoder decoder, ListenerFailures failures) {
        this.events = events;
        this.decoder = decoder;
        this.failures = failures;
    }

    @RabbitListener(id = "event-log-v1", queues = RabbitTopology.EVENT_LOG_QUEUE, ackMode = "MANUAL")
    public void observe(Message message, Channel channel) throws IOException {
        EventEnvelope envelope = null;
        try {
            envelope = decoder.decode(message);
            events.observe(envelope.eventId());
            channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
        } catch (Exception failure) {
            failures.reject("event-log-v1", message, channel, envelope, failure);
        }
    }
}

```

### backend/src/main/java/lab/ledgerguard/messaging/EventLogRepository.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.messaging;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class EventLogRepository {
    private final JdbcTemplate jdbc;

    public EventLogRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean observe(UUID event) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT ledger.observe_event('event-log-v1',?)",
            Boolean.class, event));
    }
}

```

### backend/src/main/java/lab/ledgerguard/messaging/FailedMessageRepository.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.messaging;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Arrays;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.amqp.core.Message;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class FailedMessageRepository {
    private static final System.Logger LOG = System.getLogger(FailedMessageRepository.class.getName());
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public FailedMessageRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public void record(String consumer, Message message, EventEnvelope envelope, String reason) {
        try {
            byte[] original = message.getBody();
            byte[] body = original.length <= 65536 ? original : Arrays.copyOf(original, 65536);
            Map<String, String> safeHeaders = new TreeMap<>();
            message.getMessageProperties().getHeaders().forEach((key, value) ->
                safeHeaders.put(limit(key, 100), limit(String.valueOf(value), 500)));
            safeHeaders.put("redelivered", String.valueOf(message.getMessageProperties().getRedelivered()));
            UUID event = envelope == null ? parseUuid(message.getMessageProperties().getMessageId()) : envelope.eventId();
            String eventType = envelope == null ? message.getMessageProperties().getType() : envelope.eventType();
            jdbc.queryForObject("SELECT ledger.record_failed_message(?,?,?,?,?,?,?,?::jsonb,?)", UUID.class,
                limit(consumer, 100), event, limit(message.getMessageProperties().getMessageId(), 200),
                limit(eventType, 100), limit(nullToEmpty(message.getMessageProperties().getReceivedExchange()), 200),
                limit(nullToEmpty(message.getMessageProperties().getReceivedRoutingKey()), 200), body,
                json.writeValueAsString(safeHeaders), limit(reason, 200));
        } catch (Exception unavailable) {
            LOG.log(System.Logger.Level.ERROR, "failed_work_record_unavailable consumer={0} reason={1}", consumer, reason);
        }
    }

    private static UUID parseUuid(String value) {
        try { return UUID.fromString(value); }
        catch (IllegalArgumentException | NullPointerException invalid) { return null; }
    }

    private static String limit(String value, int max) {
        if (value == null) return null;
        return value.length() <= max ? value : value.substring(0, max);
    }

    private static String nullToEmpty(String value) { return value == null ? "" : value; }
}

```

### backend/src/main/java/lab/ledgerguard/messaging/ListenerFailures.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.messaging;

import com.rabbitmq.client.Channel;
import java.io.IOException;
import org.springframework.amqp.core.Message;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("worker")
public class ListenerFailures {
    private static final System.Logger LOG = System.getLogger(ListenerFailures.class.getName());
    private final FailedMessageRepository failed;

    public ListenerFailures(FailedMessageRepository failed) {
        this.failed = failed;
    }

    public void reject(String consumer, Message message, Channel channel, EventEnvelope envelope, Throwable failure)
            throws IOException {
        String reason = reason(failure);
        failed.record(consumer, message, envelope, reason);
        LOG.log(System.Logger.Level.WARNING, "message_rejected consumer={0} eventId={1} reason={2}",
            consumer, envelope == null ? "unknown" : envelope.eventId(), reason);
        channel.basicReject(message.getMessageProperties().getDeliveryTag(), false);
    }

    private static String reason(Throwable failure) {
        String message = failure.getMessage();
        String value = (message == null || message.isBlank()) ? failure.getClass().getSimpleName() : message;
        value = value.replace('\n', ' ').replace('\r', ' ');
        return value.length() <= 200 ? value : value.substring(0, 200);
    }
}

```

### backend/src/main/java/lab/ledgerguard/messaging/MessageDecoder.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.messaging;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("worker")
public class MessageDecoder {
    private final ObjectMapper json;

    public MessageDecoder(ObjectMapper json) {
        this.json = json;
    }

    public EventEnvelope decode(Message message) {
        try {
            if (message.getBody().length == 0 || message.getBody().length > 70000) {
                throw new IllegalArgumentException("INVALID_EVENT_SIZE");
            }
            if (!MessageProperties.CONTENT_TYPE_JSON.equals(message.getMessageProperties().getContentType())
                || message.getMessageProperties().getDeliveryMode() != MessageDeliveryMode.PERSISTENT) {
                throw new IllegalArgumentException("INVALID_EVENT_PROPERTIES");
            }
            EventEnvelope envelope = json.readValue(message.getBody(), EventEnvelope.class);
            String messageId = message.getMessageProperties().getMessageId();
            if (messageId == null || !envelope.eventId().equals(UUID.fromString(messageId))) {
                throw new IllegalArgumentException("EVENT_ID_MISMATCH");
            }
            if (!envelope.eventType().equals(message.getMessageProperties().getType())) {
                throw new IllegalArgumentException("EVENT_TYPE_MISMATCH");
            }
            return envelope;
        } catch (Exception invalid) {
            if (invalid instanceof IllegalArgumentException argument) throw argument;
            throw new IllegalArgumentException("INVALID_EVENT_JSON", invalid);
        }
    }
}

```

### backend/src/main/java/lab/ledgerguard/messaging/OutboxPublisher.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/messaging/OutboxPublisher.java
+++ main-history/backend/src/main/java/lab/ledgerguard/messaging/OutboxPublisher.java
@@ -1,133 +1,74 @@
 package lab.ledgerguard.messaging;

 import com.fasterxml.jackson.databind.ObjectMapper;
-import java.util.Date;
+import java.time.Duration;
 import java.util.UUID;
-import java.util.concurrent.TimeUnit;
-import java.util.concurrent.atomic.AtomicBoolean;
-import org.springframework.amqp.AmqpException;
-import org.springframework.amqp.core.Message;
-import org.springframework.amqp.core.MessageBuilder;
-import org.springframework.amqp.core.MessageDeliveryMode;
-import org.springframework.amqp.rabbit.connection.CorrelationData;
-import org.springframework.amqp.rabbit.core.RabbitTemplate;
+import org.slf4j.Logger;
+import org.slf4j.LoggerFactory;
 import org.springframework.beans.factory.annotation.Value;
-import org.springframework.context.annotation.Profile;
+import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
 import org.springframework.scheduling.annotation.Scheduled;
-import org.springframework.stereotype.Component;
+import org.springframework.stereotype.Service;

-@Component
-@Profile("publisher")
+@Service
+@ConditionalOnProperty(name="ledgerguard.outbox-publisher.enabled",havingValue="true")
 public class OutboxPublisher {
-    private static final System.Logger LOG = System.getLogger(OutboxPublisher.class.getName());
+    private static final Logger LOG=LoggerFactory.getLogger(OutboxPublisher.class);
+    private final UUID owner=UUID.randomUUID();
     private final OutboxRepository outbox;
-    private final RabbitTemplate rabbit;
+    private final ConfirmedRabbitPublisher publisher;
     private final ObjectMapper json;
-    private final UUID owner = UUID.randomUUID();
-    private final AtomicBoolean publishing = new AtomicBoolean();
-    private final AtomicBoolean crashFired = new AtomicBoolean();
-    private final int batchSize;
+    private final WorkerFaults faults;
+    private final int batch;
+    private final int maxAttempts;
+    private final int recoveryAge;
     private final int leaseSeconds;
-    private final int confirmTimeoutMillis;
-    private final int recoveryStaleSeconds;
-    private final boolean crashAfterConfirm;

-    public OutboxPublisher(OutboxRepository outbox, RabbitTemplate rabbit, ObjectMapper json,
-            @Value("${ledgerguard.messaging.publisher-batch-size:32}") int batchSize,
-            @Value("${ledgerguard.messaging.publisher-lease-seconds:15}") int leaseSeconds,
-            @Value("${ledgerguard.messaging.publisher-confirm-timeout-ms:5000}") int confirmTimeoutMillis,
-            @Value("${ledgerguard.messaging.recovery-stale-seconds:30}") int recoveryStaleSeconds,
-            @Value("${ledgerguard.test.crash-after-publish-confirm:false}") boolean crashAfterConfirm) {
-        this.outbox = outbox;
-        this.rabbit = rabbit;
-        this.json = json;
-        this.batchSize = bounded(batchSize, 1, 100, "publisher batch");
-        this.leaseSeconds = bounded(leaseSeconds, 1, 300, "publisher lease");
-        this.confirmTimeoutMillis = bounded(confirmTimeoutMillis, 250, 30000, "publisher confirm timeout");
-        this.recoveryStaleSeconds = bounded(recoveryStaleSeconds, 5, 86400, "recovery staleness");
-        this.crashAfterConfirm = crashAfterConfirm;
-        this.rabbit.setMandatory(true);
+    public OutboxPublisher(OutboxRepository outbox,ConfirmedRabbitPublisher publisher,
+            ObjectMapper json,WorkerFaults faults,@Value("${ledgerguard.outbox.batch-size:32}") int batch,
+            @Value("${ledgerguard.outbox.max-attempts:8}") int maxAttempts,
+            @Value("${ledgerguard.outbox.pending-recovery-age-seconds:120}") int recoveryAge,
+            @Value("${ledgerguard.outbox.lease-seconds:20}") int leaseSeconds) {
+        this.outbox=outbox;this.publisher=publisher;this.json=json;this.faults=faults;
+        this.batch=Math.max(1,Math.min(100,batch));this.maxAttempts=Math.max(2,Math.min(20,maxAttempts));
+        this.recoveryAge=Math.max(30,Math.min(86400,recoveryAge));this.leaseSeconds=Math.max(5,Math.min(300,leaseSeconds));
     }

-    @Scheduled(initialDelayString = "${ledgerguard.messaging.publisher-initial-delay-ms:500}",
-               fixedDelayString = "${ledgerguard.messaging.publisher-delay-ms:250}")
+    @Scheduled(fixedDelayString="${ledgerguard.outbox.poll-ms:250}")
     public void publishDue() {
-        if (!publishing.compareAndSet(false, true)) return;
-        try {
-            for (OutboxRepository.OutboxEvent event : outbox.claim(owner, batchSize, leaseSeconds)) publish(event);
-        } catch (RuntimeException unavailable) {
-            LOG.log(System.Logger.Level.WARNING, "outbox_claim_failed owner={0} type={1}", owner, unavailable.getClass().getSimpleName());
-        } finally {
-            publishing.set(false);
+        for(OutboxRepository.Claimed claimed:outbox.claim(owner,batch,Duration.ofSeconds(leaseSeconds))) {
+            try {
+                EventEnvelope event=claimed.envelope();
+                String envelope=json.writeValueAsString(event);
+                publisher.publish(MessagingTopology.EVENTS_EXCHANGE,event.eventType(),envelope,event.eventId(),0,Duration.ZERO);
+                faults.afterPublisherConfirm();
+                outbox.markPublished(event.eventId(),owner);
+            } catch(Exception failure) {
+                if(failure instanceof InterruptedException) Thread.currentThread().interrupt();
+                String code=code(failure);
+                try {
+                    if(permanent(failure)||claimed.attempts()>=maxAttempts) outbox.fail(claimed,owner,code);
+                    else outbox.retry(claimed.id(),owner,backoff(claimed.attempts()),code);
+                } catch(RuntimeException persistenceFailure) {
+                    LOG.error("outbox_failure_recording eventId={} attempt={}",claimed.id(),claimed.attempts(),persistenceFailure);
+                }
+                LOG.warn("outbox_publish_failed eventId={} eventType={} attempt={} code={}",
+                    claimed.id(),claimed.eventType(),claimed.attempts(),code);
+            }
         }
     }

-    @Scheduled(initialDelayString = "${ledgerguard.messaging.recovery-initial-delay-ms:5000}",
-               fixedDelayString = "${ledgerguard.messaging.recovery-delay-ms:5000}")
+    @Scheduled(fixedDelayString="${ledgerguard.outbox.recovery-ms:30000}")
     public void recoverPendingPayments() {
         try {
-            int recovered = outbox.recoverStalledPayments(recoveryStaleSeconds, 100);
-            if (recovered > 0) LOG.log(System.Logger.Level.WARNING, "payment_recovery_republished count={0}", recovered);
-        } catch (RuntimeException unavailable) {
-            LOG.log(System.Logger.Level.WARNING, "payment_recovery_scan_failed type={0}", unavailable.getClass().getSimpleName());
+            int recovered=outbox.recoverPending(recoveryAge,batch);
+            if(recovered>0) LOG.warn("pending_payment_recovery count={}",recovered);
+        } catch(RuntimeException failure) {
+            LOG.warn("pending_payment_recovery_failed",failure);
         }
     }

-    private void publish(OutboxRepository.OutboxEvent event) {
-        try {
-            EventEnvelope envelope = new EventEnvelope(event.eventId(), event.envelopeVersion(), event.eventType(), event.schemaVersion(),
-                event.aggregateId(), event.aggregateVersion(), event.correlationId(), event.occurredAt(), event.payload());
-            Message message = MessageBuilder.withBody(json.writeValueAsBytes(envelope))
-                .setContentType("application/json")
-                .setContentEncoding("UTF-8")
-                .setDeliveryMode(MessageDeliveryMode.PERSISTENT)
-                .setMessageId(event.eventId().toString())
-                .setType(event.eventType())
-                .setTimestamp(Date.from(event.occurredAt()))
-                .setHeader("ledgerguard-envelope-version", event.envelopeVersion())
-                .setHeader("ledgerguard-schema-version", event.schemaVersion())
-                .setHeader("ledgerguard-aggregate-id", event.aggregateId().toString())
-                .setHeader("ledgerguard-aggregate-version", event.aggregateVersion())
-                .setHeader("ledgerguard-correlation-id", event.correlationId().toString())
-                .build();
-            CorrelationData correlation = new CorrelationData(event.eventId().toString());
-            rabbit.send(RabbitTopology.EVENT_EXCHANGE, event.eventType(), message, correlation);
-            CorrelationData.Confirm confirm = correlation.getFuture().get(confirmTimeoutMillis, TimeUnit.MILLISECONDS);
-            if (!confirm.isAck()) throw new AmqpException("BROKER_NACK:" + safe(confirm.getReason()));
-            if (correlation.getReturned() != null) {
-                throw new AmqpException("UNROUTABLE:" + safe(correlation.getReturned().getReplyText()));
-            }
-            if (crashAfterConfirm && crashFired.compareAndSet(false, true)) Runtime.getRuntime().halt(78);
-            if (!outbox.markPublished(event.eventId(), owner)) {
-                LOG.log(System.Logger.Level.WARNING, "outbox_mark_lost eventId={0}; duplicate publication remains safe", event.eventId());
-            }
-        } catch (InterruptedException interrupted) {
-            Thread.currentThread().interrupt();
-            release(event, "PUBLISH_INTERRUPTED");
-        } catch (Exception failure) {
-            release(event, failure.getClass().getSimpleName() + ":" + safe(failure.getMessage()));
-        }
-    }
-
-    private void release(OutboxRepository.OutboxEvent event, String reason) {
-        int exponent = Math.max(0, Math.min(6, event.attempts() - 1));
-        int delay = Math.min(60, 1 << exponent);
-        try {
-            outbox.release(event.eventId(), owner, reason, delay);
-        } catch (RuntimeException unavailable) {
-            LOG.log(System.Logger.Level.ERROR, "outbox_release_failed eventId={0} type={1}",
-                event.eventId(), unavailable.getClass().getSimpleName());
-        }
-    }
-
-    private static int bounded(int value, int min, int max, String name) {
-        if (value < min || value > max) throw new IllegalArgumentException(name + " outside supported range");
-        return value;
-    }
-
-    private static String safe(String value) {
-        if (value == null) return "none";
-        String compact = value.replace('\n', ' ').replace('\r', ' ');
-        return compact.length() <= 200 ? compact : compact.substring(0, 200);
-    }
+    private static Duration backoff(int attempt){return Duration.ofSeconds(Math.min(60,1L<<Math.min(6,Math.max(0,attempt-1))));}
+    private static boolean permanent(Throwable failure){for(Throwable current=failure;current!=null;current=current.getCause())if(current instanceof IllegalArgumentException)return true;return false;}
+    private static String code(Throwable failure){String message=failure.getMessage();return failure.getClass().getSimpleName()+":"+(message==null?"UNKNOWN":message);}
 }

```

### backend/src/main/java/lab/ledgerguard/messaging/OutboxRepository.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/messaging/OutboxRepository.java
+++ main-history/backend/src/main/java/lab/ledgerguard/messaging/OutboxRepository.java
@@ -1,58 +1,73 @@
 package lab.ledgerguard.messaging;

-import com.fasterxml.jackson.core.JsonProcessingException;
 import com.fasterxml.jackson.databind.JsonNode;
 import com.fasterxml.jackson.databind.ObjectMapper;
+import com.fasterxml.jackson.databind.node.ObjectNode;
 import java.sql.ResultSet;
 import java.sql.SQLException;
+import java.time.Duration;
 import java.time.Instant;
 import java.util.List;
 import java.util.UUID;
+import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
 import org.springframework.jdbc.core.JdbcTemplate;
 import org.springframework.stereotype.Repository;

 @Repository
+@ConditionalOnProperty(name="ledgerguard.outbox-publisher.enabled",havingValue="true")
 public class OutboxRepository {
-    public record OutboxEvent(UUID eventId, int envelopeVersion, UUID aggregateId, long aggregateVersion,
-                              String eventType, int schemaVersion, UUID correlationId, JsonNode payload, Instant occurredAt,
-                              int attempts) { }
-
+    public record Claimed(UUID id,String eventType,int schemaVersion,UUID aggregateId,long aggregateVersion,
+                          UUID correlationId,Instant occurredAt,JsonNode payload,int attempts) {
+        EventEnvelope envelope() {
+            return new EventEnvelope(id,eventType,schemaVersion,aggregateId,aggregateVersion,correlationId,occurredAt,payload);
+        }
+        ObjectNode evidence(ObjectMapper json) {
+            ObjectNode result=json.createObjectNode();
+            result.put("eventId",id.toString());result.put("eventType",eventType);result.put("schemaVersion",schemaVersion);
+            result.put("aggregateId",aggregateId.toString());result.put("aggregateVersion",aggregateVersion);
+            result.put("correlationId",correlationId.toString());result.put("occurredAt",occurredAt.toString());
+            result.set("payload",payload);return result;
+        }
+    }
     private final JdbcTemplate jdbc;
     private final ObjectMapper json;
+    public OutboxRepository(JdbcTemplate jdbc,ObjectMapper json){this.jdbc=jdbc;this.json=json;}

-    public OutboxRepository(JdbcTemplate jdbc, ObjectMapper json) {
-        this.jdbc = jdbc;
-        this.json = json;
+    public List<Claimed> claim(UUID owner,int limit,Duration lease) {
+        return jdbc.query("SELECT * FROM ledger.claim_outbox(?,?,?)",this::row,
+            owner,limit,Math.toIntExact(lease.toSeconds()));
     }

-    public List<OutboxEvent> claim(UUID owner, int limit, int leaseSeconds) {
-        return jdbc.query("SELECT * FROM ledger.claim_outbox(?,?,?)", this::row, owner, limit, leaseSeconds);
+    public void markPublished(UUID id,UUID owner) {
+        jdbc.query("SELECT ledger.mark_outbox_published(?,?)",ignored->null,id,owner);
     }

-    public boolean markPublished(UUID event, UUID owner) {
-        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT ledger.mark_outbox_published(?,?)", Boolean.class, event, owner));
+    public void retry(UUID id,UUID owner,Duration delay,String error) {
+        jdbc.query("SELECT ledger.retry_outbox(?,?,?,?)",ignored->null,
+            id,owner,Math.toIntExact(delay.toSeconds()),bounded(error));
     }

-    public boolean release(UUID event, UUID owner, String error, int delaySeconds) {
-        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT ledger.release_outbox(?,?,?,?)", Boolean.class,
-            event, owner, error, delaySeconds));
+    public UUID fail(Claimed claimed,UUID owner,String error) {
+        return jdbc.queryForObject("SELECT ledger.fail_outbox(?,?,?::jsonb,?,?)",UUID.class,
+            claimed.id(),owner,claimed.evidence(json).toString(),bounded(error),claimed.attempts());
     }

-    public int recoverStalledPayments(int staleSeconds, int limit) {
-        Integer count = jdbc.queryForObject("SELECT ledger.recover_stalled_payment_events(?,?)", Integer.class,
-            staleSeconds, limit);
-        return count == null ? 0 : count;
+    public int recoverPending(int ageSeconds,int limit) {
+        return jdbc.queryForObject("SELECT ledger.recover_pending_payments(?,?)",Integer.class,ageSeconds,limit);
     }

-    private OutboxEvent row(ResultSet rs, int row) throws SQLException {
+    private Claimed row(ResultSet rs,int ignored) throws SQLException {
         try {
-            return new OutboxEvent(rs.getObject("event_id", UUID.class), rs.getInt("envelope_version"),
-                rs.getObject("aggregate_id", UUID.class), rs.getLong("aggregate_version"),
-                rs.getString("event_type"), rs.getInt("schema_version"),
-                rs.getObject("correlation_id", UUID.class), json.readTree(rs.getString("payload")),
-                rs.getTimestamp("occurred_at").toInstant(), rs.getInt("attempts"));
-        } catch (JsonProcessingException invalid) {
-            throw new SQLException("Invalid persisted outbox JSON", "22023", invalid);
+            return new Claimed(rs.getObject("id",UUID.class),rs.getString("event_type"),rs.getInt("schema_version"),
+                rs.getObject("aggregate_id",UUID.class),rs.getLong("aggregate_version"),
+                rs.getObject("correlation_id",UUID.class),rs.getTimestamp("occurred_at").toInstant(),
+                json.readTree(rs.getString("payload")),rs.getInt("attempts"));
+        } catch (java.io.IOException invalid) {
+            throw new SQLException("Invalid outbox payload","22023",invalid);
         }
     }
+    private static String bounded(String value){
+        String result=value==null?"UNKNOWN":value.replaceAll("[\\r\\n\\t]+"," ");
+        return result.substring(0,Math.min(500,result.length()));
+    }
 }

```

### backend/src/main/java/lab/ledgerguard/messaging/PaymentProjectionListener.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.messaging;

import com.rabbitmq.client.Channel;
import java.io.IOException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("worker")
public class PaymentProjectionListener {
    private final ProjectionRepository projections;
    private final MessageDecoder decoder;
    private final ListenerFailures failures;

    public PaymentProjectionListener(ProjectionRepository projections, MessageDecoder decoder, ListenerFailures failures) {
        this.projections = projections;
        this.decoder = decoder;
        this.failures = failures;
    }

    @RabbitListener(id = "payment-projection-v1", queues = RabbitTopology.PROJECTION_QUEUE, ackMode = "MANUAL")
    public void project(Message message, Channel channel) throws IOException {
        EventEnvelope envelope = null;
        try {
            envelope = decoder.decode(message);
            EventEnvelope.PaymentSnapshot payment = envelope.paymentSnapshot();
            projections.apply(envelope.eventId(), payment.paymentId(), payment.version(), payment.state());
            channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
        } catch (Exception failure) {
            failures.reject("payment-projection-v1", message, channel, envelope, failure);
        }
    }
}

```

### backend/src/main/java/lab/ledgerguard/messaging/PaymentSettlementListener.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.messaging;

import com.rabbitmq.client.Channel;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import lab.ledgerguard.db.FinancialCommands;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("worker")
public class PaymentSettlementListener {
    private final FinancialCommands commands;
    private final MessageDecoder decoder;
    private final ListenerFailures failures;
    private final boolean crashAfterSettlement;
    private final AtomicBoolean crashFired = new AtomicBoolean();

    public PaymentSettlementListener(FinancialCommands commands, MessageDecoder decoder, ListenerFailures failures,
            @Value("${ledgerguard.test.crash-after-settlement:false}") boolean crashAfterSettlement) {
        this.commands = commands;
        this.decoder = decoder;
        this.failures = failures;
        this.crashAfterSettlement = crashAfterSettlement;
    }

    @RabbitListener(id = "payment-settlement-v1", queues = RabbitTopology.SETTLEMENT_QUEUE, ackMode = "MANUAL")
    public void settle(Message message, Channel channel) throws IOException {
        EventEnvelope envelope = null;
        try {
            envelope = decoder.decode(message);
            if (!"payment.requested".equals(envelope.eventType())) {
                throw new IllegalArgumentException("UNSUPPORTED_SETTLEMENT_EVENT");
            }
            EventEnvelope.PaymentSnapshot payment = envelope.paymentSnapshot();
            String outcome = commands.settle(envelope.eventId(), payment.paymentId(), envelope.correlationId());
            if (!("SETTLED".equals(outcome) || "FAILED".equals(outcome) || "CANCELLED".equals(outcome)
                    || "DUPLICATE".equals(outcome))) {
                throw new IllegalStateException("INVALID_SETTLEMENT_OUTCOME");
            }
            if (crashAfterSettlement && "SETTLED".equals(outcome) && crashFired.compareAndSet(false, true)) {
                Runtime.getRuntime().halt(77);
            }
            channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
        } catch (Exception failure) {
            failures.reject("payment-settlement-v1", message, channel, envelope, failure);
        }
    }
}

```

### backend/src/main/java/lab/ledgerguard/messaging/ProjectionRecovery.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.messaging;

import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@Profile("worker")
public class ProjectionRecovery {
    private static final System.Logger LOG = System.getLogger(ProjectionRecovery.class.getName());
    private final ProjectionRepository projections;

    public ProjectionRecovery(ProjectionRepository projections) {
        this.projections = projections;
    }

    @Scheduled(initialDelayString = "${ledgerguard.messaging.projection-recovery-initial-delay-ms:5000}",
               fixedDelayString = "${ledgerguard.messaging.projection-recovery-delay-ms:10000}")
    public void reconcile() {
        try {
            int rebuilt = projections.rebuild(100);
            if (rebuilt > 0) LOG.log(System.Logger.Level.INFO, "payment_projection_rebuilt count={0}", rebuilt);
        } catch (RuntimeException unavailable) {
            LOG.log(System.Logger.Level.WARNING, "payment_projection_rebuild_failed type={0}",
                unavailable.getClass().getSimpleName());
        }
    }
}

```

### backend/src/main/java/lab/ledgerguard/messaging/ProjectionRepository.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.messaging;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ProjectionRepository {
    private final JdbcTemplate jdbc;

    public ProjectionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public String apply(UUID event, UUID payment, long version, String state) {
        return jdbc.queryForObject("SELECT ledger.apply_payment_projection('payment-projection-v1',?,?,?,?)",
            String.class, event, payment, version, state);
    }

    public int rebuild(int limit) {
        Integer changed = jdbc.queryForObject("SELECT ledger.rebuild_payment_projections(?)", Integer.class, limit);
        return changed == null ? 0 : changed;
    }
}

```

### backend/src/main/java/lab/ledgerguard/messaging/RabbitTopology.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.messaging;

import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.annotation.EnableRabbit;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@Profile({"publisher", "worker"})
@EnableRabbit
@EnableScheduling
public class RabbitTopology {
    public static final String EVENT_EXCHANGE = "ledgerguard.events.v1";
    public static final String FAILED_EXCHANGE = "ledgerguard.failed.v1";
    public static final String SETTLEMENT_QUEUE = "ledgerguard.payment-settlement.v1";
    public static final String PROJECTION_QUEUE = "ledgerguard.payment-projection.v1";
    public static final String EVENT_LOG_QUEUE = "ledgerguard.event-log.v1";
    public static final String FAILED_QUEUE = "ledgerguard.failed-work.v1";

    @Bean
    TopicExchange ledgerEventExchange() {
        return ExchangeBuilder.topicExchange(EVENT_EXCHANGE).durable(true).build();
    }

    @Bean
    TopicExchange ledgerFailedExchange() {
        return ExchangeBuilder.topicExchange(FAILED_EXCHANGE).durable(true).build();
    }

    @Bean
    Queue paymentSettlementQueue() {
        return workQueue(SETTLEMENT_QUEUE, "payment-settlement-v1");
    }

    @Bean
    Queue paymentProjectionQueue() {
        return workQueue(PROJECTION_QUEUE, "payment-projection-v1");
    }

    @Bean
    Queue eventLogQueue() {
        return workQueue(EVENT_LOG_QUEUE, "event-log-v1");
    }

    @Bean
    Queue failedWorkQueue() {
        return QueueBuilder.durable(FAILED_QUEUE)
            .withArgument("x-max-length", 10000)
            .withArgument("x-overflow", "reject-publish")
            .build();
    }

    @Bean
    Binding settlementBinding(@Qualifier("paymentSettlementQueue") Queue paymentSettlementQueue,
                              @Qualifier("ledgerEventExchange") TopicExchange ledgerEventExchange) {
        return BindingBuilder.bind(paymentSettlementQueue).to(ledgerEventExchange).with("payment.requested");
    }

    @Bean
    Binding projectionBinding(@Qualifier("paymentProjectionQueue") Queue paymentProjectionQueue,
                              @Qualifier("ledgerEventExchange") TopicExchange ledgerEventExchange) {
        return BindingBuilder.bind(paymentProjectionQueue).to(ledgerEventExchange).with("payment.*");
    }

    @Bean
    Binding eventLogBinding(@Qualifier("eventLogQueue") Queue eventLogQueue,
                            @Qualifier("ledgerEventExchange") TopicExchange ledgerEventExchange) {
        return BindingBuilder.bind(eventLogQueue).to(ledgerEventExchange).with("#");
    }

    @Bean
    Binding failedWorkBinding(@Qualifier("failedWorkQueue") Queue failedWorkQueue,
                              @Qualifier("ledgerFailedExchange") TopicExchange ledgerFailedExchange) {
        return BindingBuilder.bind(failedWorkQueue).to(ledgerFailedExchange).with("#");
    }

    private static Queue workQueue(String name, String failedRoute) {
        return QueueBuilder.durable(name)
            .deadLetterExchange(FAILED_EXCHANGE)
            .deadLetterRoutingKey(failedRoute)
            .withArgument("x-max-length", 10000)
            .withArgument("x-overflow", "reject-publish")
            .build();
    }
}

```

### backend/src/main/java/lab/ledgerguard/payments/PaymentController.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/payments/PaymentController.java
+++ main-history/backend/src/main/java/lab/ledgerguard/payments/PaymentController.java
@@ -14,14 +14,11 @@
 @RequestMapping("/api/v1/payments")
 public class PaymentController {
     private final PaymentService payments;
+    public PaymentController(PaymentService payments) { this.payments = payments; }

-    public PaymentController(PaymentService payments) {
-        this.payments = payments;
-    }
-
-    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
+    @PostMapping(consumes=MediaType.APPLICATION_JSON_VALUE,produces=MediaType.APPLICATION_JSON_VALUE)
     public ResponseEntity<JsonNode> create(@AuthenticationPrincipal Identity identity,
-            @RequestHeader(name = "Idempotency-Key", required = false) String key,
+            @RequestHeader(name="Idempotency-Key",required=false) String key,
             @RequestBody PaymentService.CreatePayment request) {
         PaymentService.CommandResult result = payments.create(identity, key, request);
         var response = ResponseEntity.status(result.status())
@@ -33,13 +30,13 @@
     }

     @GetMapping("/{id}")
-    public PaymentService.Payment get(@AuthenticationPrincipal Identity identity, @PathVariable UUID id) {
-        return payments.get(identity, id);
+    public PaymentService.Payment get(@AuthenticationPrincipal Identity identity,@PathVariable UUID id) {
+        return payments.get(identity,id);
     }

     @GetMapping
     public Page<PaymentService.Payment> list(@AuthenticationPrincipal Identity identity,
-            @RequestParam(defaultValue = "50") int limit, @RequestParam(defaultValue = "0") int offset) {
-        return payments.list(identity, limit, offset);
+            @RequestParam(defaultValue="50") int limit,@RequestParam(defaultValue="0") int offset) {
+        return payments.list(identity,limit,offset);
     }
 }

```

### backend/src/main/java/lab/ledgerguard/payments/PaymentService.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/payments/PaymentService.java
+++ main-history/backend/src/main/java/lab/ledgerguard/payments/PaymentService.java
@@ -37,9 +37,11 @@
     }

     public record CreatePayment(String sourceId, String recipientRef, String amountMinor, String currency) { }
-    public record Payment(UUID id, String direction, UUID accountId, String counterpartyRef, String amountMinor,
-                          String currency, String state, String adjustmentState, UUID journalId, String failureCode,
-                          String version, Instant createdAt, Instant updatedAt) { }
+    public record Payment(UUID id, String direction, UUID accountId, String counterpartyRef,
+                          String amountMinor, String currency, String state, String version,
+                          String adjustmentState, UUID journalId, String failureCode,
+                          String projectionState, String projectionVersion,
+                          Instant createdAt, Instant updatedAt) { }
     public record CommandResult(int status, JsonNode body, boolean replayed, UUID paymentId) { }
     private record Normalized(UUID sourceId, String recipientRef, String amountMinor, String currency) { }

@@ -89,8 +91,8 @@
     }

     public Payment get(Identity identity, UUID id) {
-        var rows = jdbc.query(selectPayment() + ownership("p.id=?") , this::paymentRow,
-            identity.userId(), identity.userId(), identity.userId(), id, identity.userId(), identity.userId());
+        var rows = jdbc.query(selectPayment() + " WHERE p.id=? AND (s.owner_id=? OR d.owner_id=?)",
+            (rs, row) -> paymentRow(identity.userId(), rs), id, identity.userId(), identity.userId());
         if (rows.isEmpty()) {
             events.denied(identity.userId(), "ACCESS_DENIED");
             throw new ApiException(404, "NOT_FOUND");
@@ -100,32 +102,37 @@

     public Page<Payment> list(Identity identity, int limit, int offset) {
         Page.validate(limit, offset);
-        return Page.from(jdbc.query(selectPayment() + ownership("TRUE")
-                + " ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?", this::paymentRow,
-            identity.userId(), identity.userId(), identity.userId(), identity.userId(), identity.userId(), limit + 1, offset), limit, offset);
+        return Page.from(jdbc.query(selectPayment()
+            + " WHERE s.owner_id=? OR d.owner_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?",
+            (rs, row) -> paymentRow(identity.userId(), rs), identity.userId(), identity.userId(), limit + 1, offset),
+            limit, offset);
     }

-    private static String ownership(String predicate) {
-        return " WHERE " + predicate + " AND (p.actor_id=? OR destination.owner_id=?)";
-    }
-
-    private Payment paymentRow(ResultSet rs, int row) throws SQLException {
-        return new Payment(rs.getObject("id", UUID.class), rs.getString("direction"),
-            rs.getObject("account_id", UUID.class), rs.getString("counterparty_ref"), rs.getString("amount_minor"),
-            rs.getString("currency"), rs.getString("state"), rs.getString("adjustment_state"),
-            rs.getObject("journal_id", UUID.class), rs.getString("failure_code"), rs.getString("version"),
+    private Payment paymentRow(UUID actor, ResultSet rs) throws SQLException {
+        boolean outgoing = actor.equals(rs.getObject("source_owner", UUID.class));
+        long amount = rs.getLong("amount_minor");
+        long refunded = rs.getLong("refunded_minor");
+        boolean reversed = rs.getBoolean("reversed");
+        String adjustment = reversed ? "REVERSED" : refunded == 0 ? "NONE"
+            : refunded == amount ? "FULLY_REFUNDED" : "PARTIALLY_REFUNDED";
+        Object projectionValue = rs.getObject("projection_version");
+        return new Payment(rs.getObject("id", UUID.class), outgoing ? "OUTGOING" : "INCOMING",
+            rs.getObject(outgoing ? "source_id" : "destination_id", UUID.class),
+            rs.getString(outgoing ? "destination_ref" : "source_ref"), Long.toString(amount),
+            rs.getString("currency"), rs.getString("state"), Long.toString(rs.getLong("version")),
+            adjustment, rs.getObject("journal_id", UUID.class), rs.getString("failure_code"),
+            rs.getString("projection_state"), projectionValue == null ? null : projectionValue.toString(),
             rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
     }

     private static String selectPayment() {
-        return "SELECT p.id,CASE WHEN p.actor_id=? THEN 'OUTGOING' ELSE 'INCOMING' END AS direction,"
-            + "CASE WHEN p.actor_id=? THEN p.source_id ELSE p.destination_id END AS account_id,"
-            + "CASE WHEN p.actor_id=? THEN destination.public_ref ELSE source.public_ref END AS counterparty_ref,"
-            + "p.amount_minor::text,p.currency,p.state,CASE WHEN p.reversed THEN 'REVERSED' "
-            + "WHEN p.refunded_minor=p.amount_minor THEN 'FULLY_REFUNDED' WHEN p.refunded_minor>0 THEN 'PARTIALLY_REFUNDED' "
-            + "ELSE 'NONE' END AS adjustment_state,p.journal_id,p.failure_code,p.version::text,p.created_at,p.updated_at "
-            + "FROM ledger.payments p JOIN ledger.accounts source ON source.id=p.source_id "
-            + "JOIN ledger.accounts destination ON destination.id=p.destination_id";
+        return "SELECT p.id,p.source_id,p.destination_id,p.amount_minor,p.currency,p.state,p.refunded_minor,"
+            + "p.reversed,p.version,p.journal_id,p.failure_code,p.created_at,p.updated_at,"
+            + "s.owner_id AS source_owner,d.owner_id AS destination_owner,s.public_ref AS source_ref,"
+            + "d.public_ref AS destination_ref,pr.state AS projection_state,pr.aggregate_version AS projection_version "
+            + "FROM ledger.payments p JOIN ledger.accounts s ON s.id=p.source_id "
+            + "JOIN ledger.accounts d ON d.id=p.destination_id "
+            + "LEFT JOIN ledger.payment_projection pr ON pr.payment_id=p.id";
     }

     private static Normalized normalize(CreatePayment request) {
@@ -142,7 +149,8 @@
         if (!recipient.matches("LG-[a-fA-F0-9]{32}")) throw new ApiException(400, "INVALID_RECIPIENT");
         recipient = "LG-" + recipient.substring(3).toLowerCase(Locale.ROOT);
         String amount = request.amountMinor();
-        if (amount == null || !amount.matches("[1-9][0-9]{0,12}") || new BigInteger(amount).compareTo(MAX_AMOUNT) > 0) {
+        if (amount == null || !amount.matches("[1-9][0-9]{0,12}")
+            || new BigInteger(amount).compareTo(MAX_AMOUNT) > 0) {
             throw new ApiException(400, "INVALID_AMOUNT");
         }
         return new Normalized(source, recipient, amount, Inputs.currency(request.currency()));

```

### backend/src/main/resources/application-publisher.yml

PATH_NOT_IN_MAIN_HISTORY

```diff
spring:
  main:
    web-application-type: none
  flyway:
    enabled: false
  datasource:
    hikari:
      maximum-pool-size: ${LEDGER_DATABASE_POOL_SIZE:4}
      data-source-properties:
        ApplicationName: LedgerGuard-Outbox-Publisher
  rabbitmq:
    publisher-confirm-type: correlated
    publisher-returns: true
    template:
      mandatory: true
      retry:
        enabled: false
management:
  health:
    rabbit:
      enabled: true

```

### backend/src/main/resources/application-worker.yml

PATH_NOT_IN_MAIN_HISTORY

```diff
spring:
  main:
    web-application-type: none
  flyway:
    enabled: false
  datasource:
    hikari:
      maximum-pool-size: ${LEDGER_DATABASE_POOL_SIZE:8}
      data-source-properties:
        ApplicationName: LedgerGuard-Payment-Worker
  rabbitmq:
    listener:
      simple:
        auto-startup: true
        acknowledge-mode: manual
        prefetch: 16
        concurrency: 1
        max-concurrency: 1
        default-requeue-rejected: false
        missing-queues-fatal: true
      direct:
        auto-startup: false
management:
  health:
    rabbit:
      enabled: true

```

### backend/src/main/resources/application.yml

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/resources/application.yml
+++ main-history/backend/src/main/resources/application.yml
@@ -62,15 +62,15 @@
         liveness:
           include: livenessState
         readiness:
-          include: readinessState,ledgerDatabase
+          include: readinessState,ledgerDatabase,rabbit
   health:
     rabbit:
-      enabled: false
+      enabled: true

 info:
   app:
     name: LedgerGuard
-    version: 0.5.0-INCOMPLETE
+    version: 0.4.0-INCOMPLETE
     boundary: synthetic-money-only

 logging:

```

### backend/src/main/resources/db/migration/V7__p05_messaging_recovery.sql

PATH_NOT_IN_MAIN_HISTORY

```diff
SET search_path=ledger,pg_catalog;

-- Durable failed-work records are deliberately bounded and contain no credentials.
CREATE TABLE failed_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 consumer text NOT NULL CHECK(length(consumer) BETWEEN 1 AND 100),
 event_id uuid,
 message_id text CHECK(message_id IS NULL OR length(message_id) <= 200),
 event_type text CHECK(event_type IS NULL OR length(event_type) <= 100),
 exchange_name text NOT NULL CHECK(length(exchange_name) <= 200),
 routing_key text NOT NULL CHECK(length(routing_key) <= 200),
 body bytea NOT NULL CHECK(octet_length(body) <= 65536),
 headers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(octet_length(headers::text) <= 16384),
 reason_code text NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 200),
 occurrences integer NOT NULL DEFAULT 1 CHECK(occurrences > 0),
 first_failed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_failed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 replay_requested_at timestamptz,
 replayed_at timestamptz,
 requested_by uuid REFERENCES app_users(id),
 replay_reason text CHECK(replay_reason IS NULL OR length(replay_reason) BETWEEN 1 AND 500)
);
CREATE UNIQUE INDEX failed_event_reason ON failed_messages(consumer,event_id,reason_code) WHERE event_id IS NOT NULL;
CREATE INDEX failed_messages_recent ON failed_messages(last_failed_at DESC,id DESC);
CREATE INDEX failed_messages_replay ON failed_messages(replay_requested_at,id) WHERE replay_requested_at IS NOT NULL AND replayed_at IS NULL;

ALTER TABLE outbox_events
 ADD CONSTRAINT p05_outbox_event_type CHECK(length(event_type) BETWEEN 3 AND 100
  AND event_type ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$'),
 ADD CONSTRAINT p05_outbox_schema_version CHECK(schema_version=1),
 ADD CONSTRAINT p05_outbox_aggregate_version CHECK(aggregate_version>0),
 ADD CONSTRAINT p05_outbox_lease_pair CHECK((lease_owner IS NULL)=(lease_until IS NULL)),
 ADD CONSTRAINT p05_published_has_no_lease CHECK(published_at IS NULL OR lease_owner IS NULL);

-- Outbox mutation is available only through lease-aware SECURITY DEFINER functions.
CREATE FUNCTION claim_outbox(p_owner uuid,p_limit integer,p_lease_seconds integer)
RETURNS TABLE(event_id uuid,envelope_version integer,aggregate_id uuid,aggregate_version bigint,event_type text,
 schema_version integer,correlation_id uuid,payload jsonb,occurred_at timestamptz,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
BEGIN
 IF p_owner IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 1 AND 300 THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_OUTBOX_CLAIM';
 END IF;
 RETURN QUERY
 WITH due AS (
  SELECT e.id FROM ledger.outbox_events e
  WHERE e.published_at IS NULL AND e.available_at<=clock_timestamp()
    AND (e.lease_until IS NULL OR e.lease_until<clock_timestamp())
  ORDER BY e.available_at,e.id
  FOR UPDATE SKIP LOCKED LIMIT p_limit
 ), claimed AS (
  UPDATE ledger.outbox_events e SET lease_owner=p_owner,
   lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempts=e.attempts+1,last_error=NULL
  FROM due WHERE e.id=due.id
  RETURNING e.id,e.envelope_version,e.aggregate_id,e.aggregate_version,e.event_type,e.schema_version,
   e.correlation_id,e.payload,e.occurred_at,e.attempts
 )
 SELECT c.id,c.envelope_version,c.aggregate_id,c.aggregate_version,c.event_type,c.schema_version,
  c.correlation_id,c.payload,c.occurred_at,c.attempts FROM claimed c ORDER BY c.occurred_at,c.id;
END $$;

CREATE FUNCTION mark_outbox_published(p_event uuid,p_owner uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE changed boolean;
BEGIN
 UPDATE ledger.outbox_events SET published_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,last_error=NULL
 WHERE id=p_event AND published_at IS NULL AND lease_owner=p_owner AND lease_until>=clock_timestamp();
 changed:=FOUND;
 IF changed THEN
  UPDATE ledger.failed_messages SET replayed_at=clock_timestamp()
  WHERE event_id=p_event AND replay_requested_at IS NOT NULL AND replayed_at IS NULL;
 END IF;
 RETURN changed;
END $$;

CREATE FUNCTION release_outbox(p_event uuid,p_owner uuid,p_error text,p_delay_seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
BEGIN
 IF p_delay_seconds NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_RETRY_DELAY'; END IF;
 UPDATE ledger.outbox_events SET lease_owner=NULL,lease_until=NULL,
  available_at=clock_timestamp()+make_interval(secs=>p_delay_seconds),last_error=left(coalesce(p_error,'PUBLISH_FAILED'),1000)
 WHERE id=p_event AND published_at IS NULL AND lease_owner=p_owner;
 RETURN FOUND;
END $$;

-- Re-publication is safe: settlement is protected by event inbox identity and payment state.
CREATE FUNCTION recover_stalled_payment_events(p_stale_seconds integer,p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE changed integer;
BEGIN
 IF p_stale_seconds NOT BETWEEN 5 AND 86400 OR p_limit NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_RECOVERY_POLICY';
 END IF;
 WITH stalled AS (
  SELECT e.id FROM ledger.outbox_events e
  JOIN ledger.payments p ON p.id=e.aggregate_id
  JOIN ledger.holds h ON h.payment_id=p.id
  WHERE e.event_type='payment.requested' AND p.state='PENDING' AND h.state='ACTIVE'
    AND e.published_at IS NOT NULL
    AND e.published_at<clock_timestamp()-make_interval(secs=>p_stale_seconds)
    AND (e.lease_until IS NULL OR e.lease_until<clock_timestamp())
  ORDER BY e.published_at,e.id FOR UPDATE OF e SKIP LOCKED LIMIT p_limit
 )
 UPDATE ledger.outbox_events e SET published_at=NULL,available_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,
  last_error='RECOVERY_REPUBLISH_PENDING_PAYMENT' FROM stalled WHERE e.id=stalled.id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed;
END $$;

CREATE FUNCTION apply_payment_projection(p_consumer text,p_event uuid,p_payment uuid,p_version bigint,p_state text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE current ledger.payment_projection%ROWTYPE;
BEGIN
 IF p_consumer<>'payment-projection-v1' OR p_event IS NULL OR p_payment IS NULL OR p_version<1
    OR p_state NOT IN ('PENDING','SETTLED','FAILED','CANCELLED') THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_PROJECTION_EVENT';
 END IF;
 INSERT INTO ledger.consumer_inbox(consumer,event_id) VALUES(p_consumer,p_event) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN 'DUPLICATE'; END IF;
 SELECT * INTO current FROM ledger.payment_projection WHERE payment_id=p_payment FOR UPDATE;
 IF current.payment_id IS NULL THEN
  INSERT INTO ledger.payment_projection(payment_id,aggregate_version,state) VALUES(p_payment,p_version,p_state);
  RETURN 'APPLIED';
 END IF;
 IF p_version<=current.aggregate_version THEN RETURN 'STALE'; END IF;
 IF current.state<>'PENDING' AND p_state<>current.state THEN
  RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='PROJECTION_STATE_REGRESSION';
 END IF;
 UPDATE ledger.payment_projection SET aggregate_version=p_version,state=p_state,observed_at=clock_timestamp()
 WHERE payment_id=p_payment;
 RETURN 'APPLIED';
END $$;

CREATE FUNCTION observe_event(p_consumer text,p_event uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
BEGIN
 IF p_consumer<>'event-log-v1' OR p_event IS NULL OR NOT EXISTS(SELECT 1 FROM ledger.outbox_events WHERE id=p_event) THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_OBSERVED_EVENT';
 END IF;
 INSERT INTO ledger.consumer_inbox(consumer,event_id) VALUES(p_consumer,p_event) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;

CREATE FUNCTION record_failed_message(p_consumer text,p_event uuid,p_message text,p_type text,p_exchange text,p_route text,
 p_body bytea,p_headers jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE result uuid;
BEGIN
 IF p_consumer IS NULL OR length(p_consumer) NOT BETWEEN 1 AND 100 OR p_exchange IS NULL OR p_route IS NULL
  OR p_body IS NULL OR octet_length(p_body)>65536 OR p_headers IS NULL OR octet_length(p_headers::text)>16384
  OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_FAILED_MESSAGE';
 END IF;
 IF p_event IS NOT NULL THEN
  INSERT INTO ledger.failed_messages(consumer,event_id,message_id,event_type,exchange_name,routing_key,body,headers,reason_code)
  VALUES(p_consumer,p_event,left(p_message,200),left(p_type,100),left(p_exchange,200),left(p_route,200),p_body,p_headers,p_reason)
  ON CONFLICT(consumer,event_id,reason_code) WHERE event_id IS NOT NULL DO UPDATE
  SET occurrences=ledger.failed_messages.occurrences+1,last_failed_at=clock_timestamp(),body=EXCLUDED.body,headers=EXCLUDED.headers,
      replay_requested_at=NULL,replayed_at=NULL,requested_by=NULL,replay_reason=NULL
  RETURNING id INTO result;
 ELSE
  INSERT INTO ledger.failed_messages(consumer,message_id,event_type,exchange_name,routing_key,body,headers,reason_code)
  VALUES(p_consumer,left(p_message,200),left(p_type,100),left(p_exchange,200),left(p_route,200),p_body,p_headers,p_reason)
  RETURNING id INTO result;
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION request_failed_replay(p_failed uuid,p_actor uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE failed ledger.failed_messages%ROWTYPE; event ledger.outbox_events%ROWTYPE; operation uuid:=gen_random_uuid();
BEGIN
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500
  OR NOT EXISTS(SELECT 1 FROM ledger.app_users WHERE id=p_actor AND role='ADMIN' AND enabled) THEN
  RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='REPLAY_AUTHORITY_REQUIRED';
 END IF;
 SELECT * INTO failed FROM ledger.failed_messages WHERE id=p_failed FOR UPDATE;
 IF failed.id IS NULL OR failed.event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_REPLAYABLE'; END IF;
 SELECT * INTO event FROM ledger.outbox_events WHERE id=failed.event_id FOR UPDATE;
 IF event.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_REPLAYABLE'; END IF;
 UPDATE ledger.outbox_events SET published_at=NULL,available_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,
  last_error='ADMIN_REPLAY_REQUESTED' WHERE id=event.id;
 UPDATE ledger.failed_messages SET replay_requested_at=clock_timestamp(),replayed_at=NULL,requested_by=p_actor,replay_reason=btrim(p_reason)
 WHERE id=failed.id;
 PERFORM ledger._audit(p_actor,'FAILED_WORK_REPLAY_REQUESTED',event.aggregate_id,operation,event.aggregate_version,event.correlation_id,btrim(p_reason));
 RETURN event.id;
END $$;

CREATE FUNCTION rebuild_payment_projections(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE changed integer;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_PROJECTION_REBUILD'; END IF;
 WITH lagged AS (
  SELECT p.id,p.version,p.state FROM ledger.payments p LEFT JOIN ledger.payment_projection x ON x.payment_id=p.id
  WHERE x.payment_id IS NULL OR x.aggregate_version<p.version
  ORDER BY p.updated_at,p.id LIMIT p_limit
 )
 INSERT INTO ledger.payment_projection(payment_id,aggregate_version,state,observed_at)
 SELECT id,version,state,clock_timestamp() FROM lagged
 ON CONFLICT(payment_id) DO UPDATE SET aggregate_version=EXCLUDED.aggregate_version,state=EXCLUDED.state,observed_at=EXCLUDED.observed_at
 WHERE EXCLUDED.aggregate_version>ledger.payment_projection.aggregate_version;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed;
END $$;

REVOKE UPDATE ON ledger.outbox_events FROM ledger_runtime;
REVOKE INSERT,UPDATE ON ledger.payment_projection FROM ledger_runtime;
REVOKE ALL ON ledger.failed_messages FROM PUBLIC;
GRANT SELECT ON ledger.failed_messages TO ledger_runtime;
GRANT EXECUTE ON FUNCTION claim_outbox(uuid,integer,integer),mark_outbox_published(uuid,uuid),
 release_outbox(uuid,uuid,text,integer),recover_stalled_payment_events(integer,integer),
 apply_payment_projection(text,uuid,uuid,bigint,text),observe_event(text,uuid),
 record_failed_message(text,uuid,text,text,text,text,bytea,jsonb,text),request_failed_replay(uuid,uuid,text),
 rebuild_payment_projections(integer) TO ledger_runtime;

```

### backend/src/main/resources/openapi/p05.json

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/resources/openapi/p05.json
+++ main-history/backend/src/main/resources/openapi/p05.json
@@ -1 +1,2091 @@
-{"openapi":"3.0.3","info":{"title":"LedgerGuard asynchronous payment reliability API","version":"0.5.0","description":"Synthetic money only. P05 adds asynchronously settled payments with atomic fund reservations, PostgreSQL transactional outbox publication, durable RabbitMQ delivery, inbox deduplication, two restartable workers, version-aware status projection, bounded recovery and administrator failed-work replay. Money is represented as decimal integer strings. Payment acceptance returns 202 only after the PENDING payment, ACTIVE hold, audit, idempotency outcome and payment.requested outbox event commit atomically. Messaging is at-least-once; committed financial effects are protected against duplication. The API remains available when RabbitMQ is unavailable, while accepted payments remain pending until recovery."},"servers":[{"url":"/"}],"security":[{"SessionCookie":[]}],"paths":{"/api/v1/auth/csrf":{"get":{"operationId":"acquireCsrf","security":[],"responses":{"200":{"description":"CSRF token","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Csrf"}}}}}}},"/api/v1/auth/register":{"post":{"operationId":"registerCustomer","security":[{"CsrfHeader":[]}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/Registration"}}}},"responses":{"201":{"description":"Registered CUSTOMER","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Registered"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"403":{"$ref":"#/components/responses/Forbidden"},"409":{"description":"Registration rejected","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/auth/login":{"post":{"operationId":"login","security":[{"CsrfHeader":[]}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/Login"}}}},"responses":{"200":{"description":"Session issued only in HttpOnly cookie","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Session"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/auth/me":{"get":{"operationId":"currentUser","responses":{"200":{"description":"Current session identity","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Session"}}}},"401":{"$ref":"#/components/responses/Unauthorized"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/auth/logout":{"post":{"operationId":"logout","security":[{"SessionCookie":[],"CsrfHeader":[]}],"responses":{"204":{"description":"Persisted session revoked; empty body"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/accounts":{"get":{"operationId":"listOwnedAccounts","parameters":[{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"responses":{"200":{"description":"Owned accounts","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AccountPage"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"503":{"$ref":"#/components/responses/Unavailable"}}},"post":{"operationId":"createAccount","security":[{"SessionCookie":[],"CsrfHeader":[]}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/CreateAccount"}}}},"responses":{"201":{"description":"Zero-balance owned wallet","headers":{"Location":{"schema":{"type":"string"}}},"content":{"application/json":{"schema":{"$ref":"#/components/schemas/Account"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/accounts/{id}":{"parameters":[{"$ref":"#/components/parameters/AccountId"}],"get":{"operationId":"getOwnedAccount","responses":{"200":{"description":"Owned account","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Account"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"404":{"$ref":"#/components/responses/NotFound"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/accounts/{id}/entries":{"parameters":[{"$ref":"#/components/parameters/AccountId"},{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"get":{"operationId":"listOwnedEntries","responses":{"200":{"description":"Owner-scoped entry lines","content":{"application/json":{"schema":{"$ref":"#/components/schemas/EntryPage"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"404":{"$ref":"#/components/responses/NotFound"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/accounts/{id}/transactions":{"parameters":[{"$ref":"#/components/parameters/AccountId"},{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"get":{"operationId":"listOwnedTransactions","responses":{"200":{"description":"Owner-scoped economic effects","content":{"application/json":{"schema":{"$ref":"#/components/schemas/TransactionPage"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"404":{"$ref":"#/components/responses/NotFound"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/recipients/{publicRef}":{"get":{"operationId":"resolveRecipient","parameters":[{"name":"publicRef","in":"path","required":true,"schema":{"type":"string","pattern":"^LG-[a-fA-F0-9]{32}$"}}],"responses":{"200":{"description":"Minimal public routing data","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Recipient"}}}},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"404":{"$ref":"#/components/responses/NotFound"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/transfers":{"get":{"operationId":"listOwnedTransfers","description":"Outgoing immediate transfers created by the authenticated actor only. Stable order: created_at descending, id descending.","parameters":[{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"responses":{"200":{"description":"Owned transfer records","content":{"application/json":{"schema":{"$ref":"#/components/schemas/TransferPage"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"503":{"$ref":"#/components/responses/Unavailable"}}},"post":{"operationId":"createImmediateTransfer","description":"Atomically post one balanced immediate transfer, financial audit record, idempotency outcome and outbox event. Source ownership comes from the authenticated principal. Deterministic business rejections are stored/replayed as the same minimal code envelope.","security":[{"SessionCookie":[],"CsrfHeader":[]}],"parameters":[{"$ref":"#/components/parameters/IdempotencyKey"}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/TransferIntent"}}}},"responses":{"201":{"description":"Transfer committed. An identical replay returns this same status/body/resource.","headers":{"Location":{"schema":{"type":"string"}},"Idempotency-Replayed":{"schema":{"type":"string","enum":["false","true"]}}},"content":{"application/json":{"schema":{"$ref":"#/components/schemas/TransferReceipt"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"404":{"$ref":"#/components/responses/NotFound"},"409":{"description":"Same scoped key with different normalized intent","headers":{"Idempotency-Replayed":{"schema":{"type":"string","enum":["false"]}}},"content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}}}},"413":{"description":"Body exceeds 16384 bytes","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"422":{"description":"Durable business rejection such as insufficient funds or cross-currency/self transfer. Identical replay returns the same status/body.","headers":{"Idempotency-Replayed":{"schema":{"type":"string","enum":["false","true"]}}},"content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}}}},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/transfers/{id}":{"parameters":[{"$ref":"#/components/parameters/TransferId"}],"get":{"operationId":"getOwnedTransfer","description":"Returns an outgoing transfer only to its authenticated creator. Destination account UUID, owner and balance are never exposed.","responses":{"200":{"description":"Owned immediate transfer","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Transfer"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"404":{"$ref":"#/components/responses/NotFound"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/admin/security-events":{"get":{"operationId":"listSecurityEvents","parameters":[{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"responses":{"200":{"description":"Append-only security events","content":{"application/json":{"schema":{"$ref":"#/components/schemas/SecurityEventPage"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/openapi/p04.json":{"get":{"operationId":"openApiP04","security":[],"responses":{"200":{"description":"This versioned OpenAPI document","content":{"application/json":{"schema":{"type":"object"}}}}},"description":"Current P04 OpenAPI contract. The unversioned /api/v1/openapi.json remains the immutable P03 compatibility snapshot."}},"/api/v1/payments":{"get":{"operationId":"listRelevantPayments","description":"Outgoing payments created by the authenticated customer and incoming payments to an account they own. Stable order: created_at descending, id descending.","parameters":[{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"responses":{"200":{"description":"Owner-relevant payments","content":{"application/json":{"schema":{"$ref":"#/components/schemas/PaymentPage"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"503":{"$ref":"#/components/responses/Unavailable"}}},"post":{"operationId":"createPayment","description":"Atomically accepts a payment intent, reserves funds, records idempotency/audit and emits payment.requested. Settlement remains asynchronous.","security":[{"SessionCookie":[],"CsrfHeader":[]}],"parameters":[{"$ref":"#/components/parameters/PaymentIdempotencyKey"}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/PaymentIntent"}}}},"responses":{"202":{"description":"Durably accepted PENDING payment","headers":{"Location":{"schema":{"type":"string"}},"Idempotency-Replayed":{"schema":{"type":"string","enum":["false","true"]}}},"content":{"application/json":{"schema":{"$ref":"#/components/schemas/PaymentReceipt"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"409":{"description":"Same idempotency key with different normalized intent","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}}},"headers":{"Idempotency-Replayed":{"schema":{"type":"string","enum":["false"]}}}},"422":{"description":"Durably replayable business rejection","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}}},"headers":{"Idempotency-Replayed":{"schema":{"type":"string","enum":["false","true"]}}}},"503":{"$ref":"#/components/responses/Unavailable"},"404":{"$ref":"#/components/responses/NotFound"},"413":{"description":"Body exceeds 16384 bytes","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/payments/{id}":{"parameters":[{"$ref":"#/components/parameters/PaymentId"}],"get":{"operationId":"getRelevantPayment","responses":{"200":{"description":"Current authoritative payment state","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Payment"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"404":{"$ref":"#/components/responses/NotFound"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/admin/failed-work":{"get":{"operationId":"listFailedWork","parameters":[{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"responses":{"200":{"description":"Redacted durable failed-work records","content":{"application/json":{"schema":{"$ref":"#/components/schemas/FailedWorkPage"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/admin/failed-work/{id}":{"parameters":[{"$ref":"#/components/parameters/FailedWorkId"}],"get":{"operationId":"getFailedWork","responses":{"200":{"description":"One redacted failed-work record","content":{"application/json":{"schema":{"$ref":"#/components/schemas/FailedWork"}}}},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"404":{"$ref":"#/components/responses/NotFound"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/admin/failed-work/{id}/replay":{"parameters":[{"$ref":"#/components/parameters/FailedWorkId"}],"post":{"operationId":"requestFailedWorkReplay","security":[{"SessionCookie":[],"CsrfHeader":[]}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/ReplayRequest"}}}},"responses":{"202":{"description":"Original outbox event queued for safe re-publication","content":{"application/json":{"schema":{"$ref":"#/components/schemas/ReplayAccepted"}}}},"400":{"$ref":"#/components/responses/BadRequest"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Forbidden"},"404":{"$ref":"#/components/responses/NotFound"},"503":{"$ref":"#/components/responses/Unavailable"}}}},"/api/v1/openapi/p05.json":{"get":{"operationId":"openApiP05","security":[],"description":"Current P05 OpenAPI contract. Older versioned contracts remain immutable compatibility snapshots.","responses":{"200":{"description":"This versioned OpenAPI document","content":{"application/json":{"schema":{"type":"object"}}}}}}}},"components":{"securitySchemes":{"SessionCookie":{"type":"apiKey","in":"cookie","name":"__Host-LG-SESSION","description":"HttpOnly, Secure, SameSite=Strict, Path=/, no Domain. Explicit loopback sandbox uses LG-SESSION."},"CsrfHeader":{"type":"apiKey","in":"header","name":"X-XSRF-TOKEN","description":"Masked token returned by /auth/csrf; matching HttpOnly CSRF cookie is also required."}},"parameters":{"AccountId":{"name":"id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}},"TransferId":{"name":"id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}},"IdempotencyKey":{"name":"Idempotency-Key","in":"header","required":true,"description":"8..128 characters matching ^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$. Scoped by authenticated actor and TRANSFER operation.","schema":{"type":"string","minLength":8,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"}},"Limit":{"name":"limit","in":"query","schema":{"type":"integer","minimum":1,"maximum":100,"default":50}},"Offset":{"name":"offset","in":"query","schema":{"type":"integer","minimum":0,"maximum":10000,"default":0}},"PaymentId":{"name":"id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}},"FailedWorkId":{"name":"id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}},"PaymentIdempotencyKey":{"name":"Idempotency-Key","in":"header","required":true,"description":"8..128 characters matching ^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$. Scoped by authenticated actor and PAYMENT operation. Preserve the exact key and normalized intent after an uncertain response.","schema":{"type":"string","minLength":8,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"}}},"responses":{"BadRequest":{"description":"Malformed JSON, unknown field, invalid command/key/value or pagination","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"Unauthorized":{"description":"Missing, invalid, expired or revoked session","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"Forbidden":{"description":"Role, CSRF or origin boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"NotFound":{"description":"Absent or not disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"Unavailable":{"description":"Temporary dependency failure or uncertain outcome. For a submitted idempotent command, retain and replay the same key/intent.","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}},"schemas":{"Minor":{"type":"string","pattern":"^(0|[1-9][0-9]*)$","description":"Exact integer minor units"},"PositiveMinor":{"type":"string","pattern":"^[1-9][0-9]{0,12}$","description":"1 through 1000000000000 minor units"},"Currency":{"type":"string","enum":["CAD","USD","JPY","KWD"]},"Problem":{"type":"object","additionalProperties":false,"required":["type","title","status","code","correlationId","validation"],"properties":{"type":{"type":"string"},"title":{"type":"string"},"status":{"type":"integer"},"code":{"type":"string"},"correlationId":{"type":"string","format":"uuid"},"validation":{"type":"object","additionalProperties":{"type":"string"}}}},"CommandRejection":{"type":"object","additionalProperties":false,"required":["code"],"properties":{"code":{"type":"string","description":"Durably replayed business rejection code"}}},"Csrf":{"type":"object","additionalProperties":false,"required":["headerName","token"],"properties":{"headerName":{"type":"string","enum":["X-XSRF-TOKEN"]},"token":{"type":"string"}}},"Registration":{"type":"object","additionalProperties":false,"required":["email","password","displayName"],"properties":{"email":{"type":"string","maxLength":300},"password":{"type":"string","minLength":12,"maxLength":72,"writeOnly":true},"displayName":{"type":"string","minLength":1,"maxLength":80}}},"Login":{"type":"object","additionalProperties":false,"required":["email","password"],"properties":{"email":{"type":"string","maxLength":300},"password":{"type":"string","minLength":12,"maxLength":72,"writeOnly":true}}},"Registered":{"type":"object","additionalProperties":false,"required":["id","email","displayName","role"],"properties":{"id":{"type":"string","format":"uuid"},"email":{"type":"string"},"displayName":{"type":"string"},"role":{"type":"string","enum":["CUSTOMER"]}}},"Session":{"type":"object","additionalProperties":false,"required":["id","email","displayName","role","expiresAt"],"properties":{"id":{"type":"string","format":"uuid"},"email":{"type":"string"},"displayName":{"type":"string"},"role":{"type":"string","enum":["CUSTOMER","ADMIN"]},"expiresAt":{"type":"string","format":"date-time"}}},"CreateAccount":{"type":"object","additionalProperties":false,"required":["name","currency"],"properties":{"name":{"type":"string","minLength":1,"maxLength":80},"currency":{"$ref":"#/components/schemas/Currency"}}},"Account":{"type":"object","additionalProperties":false,"required":["id","publicRef","name","currency","postedMinor","reservedMinor","availableMinor","version","updatedAt"],"properties":{"id":{"type":"string","format":"uuid"},"publicRef":{"type":"string"},"name":{"type":"string"},"currency":{"$ref":"#/components/schemas/Currency"},"postedMinor":{"$ref":"#/components/schemas/Minor"},"reservedMinor":{"$ref":"#/components/schemas/Minor"},"availableMinor":{"$ref":"#/components/schemas/Minor"},"version":{"type":"string","pattern":"^[1-9][0-9]*$"},"updatedAt":{"type":"string","format":"date-time"}}},"Entry":{"type":"object","additionalProperties":false,"required":["id","journalId","operationId","kind","side","amountMinor","currency","createdAt"],"properties":{"id":{"type":"string"},"journalId":{"type":"string","format":"uuid"},"operationId":{"type":"string","format":"uuid"},"kind":{"type":"string"},"side":{"type":"string","enum":["DEBIT","CREDIT"]},"amountMinor":{"$ref":"#/components/schemas/PositiveMinor"},"currency":{"$ref":"#/components/schemas/Currency"},"createdAt":{"type":"string","format":"date-time"}}},"Transaction":{"type":"object","additionalProperties":false,"required":["journalId","operationId","kind","effectMinor","currency","createdAt"],"properties":{"journalId":{"type":"string","format":"uuid"},"operationId":{"type":"string","format":"uuid"},"kind":{"type":"string"},"effectMinor":{"type":"string","pattern":"^-?(0|[1-9][0-9]*)$"},"currency":{"$ref":"#/components/schemas/Currency"},"createdAt":{"type":"string","format":"date-time"}}},"Recipient":{"type":"object","additionalProperties":false,"required":["publicRef","currency"],"properties":{"publicRef":{"type":"string","pattern":"^LG-[a-f0-9]{32}$"},"currency":{"$ref":"#/components/schemas/Currency"}}},"SecurityEvent":{"type":"object","additionalProperties":false,"required":["id","actorId","eventType","correlationId","occurredAt"],"properties":{"id":{"type":"string"},"actorId":{"type":"string","format":"uuid","nullable":true},"eventType":{"type":"string"},"correlationId":{"type":"string","format":"uuid"},"occurredAt":{"type":"string","format":"date-time"}}},"TransferIntent":{"type":"object","additionalProperties":false,"required":["sourceId","recipientRef","amountMinor","currency"],"properties":{"sourceId":{"type":"string","format":"uuid"},"recipientRef":{"type":"string","pattern":"^LG-[a-fA-F0-9]{32}$"},"amountMinor":{"$ref":"#/components/schemas/PositiveMinor"},"currency":{"$ref":"#/components/schemas/Currency"}}},"TransferReceipt":{"type":"object","additionalProperties":false,"required":["id","kind","state","journalId","amountMinor","currency"],"properties":{"id":{"type":"string","format":"uuid"},"kind":{"type":"string","enum":["TRANSFER"]},"state":{"type":"string","enum":["SETTLED"]},"journalId":{"type":"string","format":"uuid"},"amountMinor":{"$ref":"#/components/schemas/PositiveMinor"},"currency":{"$ref":"#/components/schemas/Currency"}}},"Transfer":{"type":"object","additionalProperties":false,"required":["id","sourceId","recipientRef","amountMinor","currency","state","journalId","createdAt"],"properties":{"id":{"type":"string","format":"uuid"},"sourceId":{"type":"string","format":"uuid","description":"The authenticated owner's source account"},"recipientRef":{"type":"string","pattern":"^LG-[a-f0-9]{32}$","description":"Public routing reference only; private destination account/owner data is not exposed"},"amountMinor":{"$ref":"#/components/schemas/PositiveMinor"},"currency":{"$ref":"#/components/schemas/Currency"},"state":{"type":"string","enum":["SETTLED"]},"journalId":{"type":"string","format":"uuid"},"createdAt":{"type":"string","format":"date-time"}}},"AccountPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Account"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"EntryPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Entry"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"TransactionPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Transaction"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"SecurityEventPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/SecurityEvent"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"TransferPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Transfer"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"PaymentIntent":{"type":"object","additionalProperties":false,"required":["sourceId","recipientRef","amountMinor","currency"],"properties":{"sourceId":{"type":"string","format":"uuid"},"recipientRef":{"type":"string","pattern":"^LG-[a-fA-F0-9]{32}$"},"amountMinor":{"$ref":"#/components/schemas/PositiveMinor"},"currency":{"$ref":"#/components/schemas/Currency"}}},"PaymentReceipt":{"type":"object","additionalProperties":false,"required":["id","kind","state","amountMinor","currency"],"properties":{"id":{"type":"string","format":"uuid"},"kind":{"type":"string","enum":["PAYMENT"]},"state":{"type":"string","enum":["PENDING"]},"amountMinor":{"$ref":"#/components/schemas/PositiveMinor"},"currency":{"$ref":"#/components/schemas/Currency"}}},"Payment":{"type":"object","additionalProperties":false,"required":["id","direction","accountId","counterpartyRef","amountMinor","currency","state","adjustmentState","version","createdAt","updatedAt"],"properties":{"id":{"type":"string","format":"uuid"},"direction":{"type":"string","enum":["OUTGOING","INCOMING"]},"accountId":{"type":"string","format":"uuid"},"counterpartyRef":{"type":"string","pattern":"^LG-[a-f0-9]{32}$"},"amountMinor":{"$ref":"#/components/schemas/PositiveMinor"},"currency":{"$ref":"#/components/schemas/Currency"},"state":{"type":"string","enum":["PENDING","SETTLED","FAILED","CANCELLED"]},"adjustmentState":{"type":"string","enum":["NONE","PARTIALLY_REFUNDED","FULLY_REFUNDED","REVERSED"]},"journalId":{"type":"string","format":"uuid","nullable":true},"failureCode":{"type":"string","nullable":true},"version":{"type":"string","pattern":"^[1-9][0-9]*$"},"createdAt":{"type":"string","format":"date-time"},"updatedAt":{"type":"string","format":"date-time"}}},"PaymentPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Payment"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"FailedWork":{"type":"object","additionalProperties":false,"required":["id","consumer","reasonCode","occurrences","firstFailedAt","lastFailedAt"],"properties":{"id":{"type":"string","format":"uuid"},"consumer":{"type":"string"},"eventId":{"type":"string","format":"uuid","nullable":true},"messageId":{"type":"string","nullable":true},"eventType":{"type":"string","nullable":true},"reasonCode":{"type":"string"},"occurrences":{"type":"integer","minimum":1},"firstFailedAt":{"type":"string","format":"date-time"},"lastFailedAt":{"type":"string","format":"date-time"},"replayRequestedAt":{"type":"string","format":"date-time","nullable":true},"replayedAt":{"type":"string","format":"date-time","nullable":true}}},"FailedWorkPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/FailedWork"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"ReplayRequest":{"type":"object","additionalProperties":false,"required":["reason"],"properties":{"reason":{"type":"string","minLength":1,"maxLength":500}}},"ReplayAccepted":{"type":"object","additionalProperties":false,"required":["failedWorkId","eventId","status"],"properties":{"failedWorkId":{"type":"string","format":"uuid"},"eventId":{"type":"string","format":"uuid"},"status":{"type":"string","enum":["REPLAY_QUEUED"]}}}}}}
+{
+  "openapi": "3.0.3",
+  "info": {
+    "title": "LedgerGuard asynchronous payment reliability API",
+    "version": "0.5.0",
+    "description": "Synthetic money only. P05 adds accepted asynchronous payments with atomic fund reservations, a PostgreSQL transactional outbox, confirmed durable RabbitMQ publication, manual-ack workers, inbox deduplication, monotonic status projection, failed-work inspection and audited replay. Delivery is at least once; each payment has at most one committed settlement effect. Cancellation, refund, reversal, schedules, webhooks and the React product interface remain later milestones."
+  },
+  "servers": [
+    {
+      "url": "/"
+    }
+  ],
+  "security": [
+    {
+      "SessionCookie": []
+    }
+  ],
+  "paths": {
+    "/api/v1/auth/csrf": {
+      "get": {
+        "operationId": "acquireCsrf",
+        "security": [],
+        "responses": {
+          "200": {
+            "description": "CSRF token",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Csrf"
+                }
+              }
+            }
+          }
+        }
+      }
+    },
+    "/api/v1/auth/register": {
+      "post": {
+        "operationId": "registerCustomer",
+        "security": [
+          {
+            "CsrfHeader": []
+          }
+        ],
+        "requestBody": {
+          "required": true,
+          "content": {
+            "application/json": {
+              "schema": {
+                "$ref": "#/components/schemas/Registration"
+              }
+            }
+          }
+        },
+        "responses": {
+          "201": {
+            "description": "Registered CUSTOMER",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Registered"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "409": {
+            "description": "Registration rejected",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/auth/login": {
+      "post": {
+        "operationId": "login",
+        "security": [
+          {
+            "CsrfHeader": []
+          }
+        ],
+        "requestBody": {
+          "required": true,
+          "content": {
+            "application/json": {
+              "schema": {
+                "$ref": "#/components/schemas/Login"
+              }
+            }
+          }
+        },
+        "responses": {
+          "200": {
+            "description": "Session issued only in HttpOnly cookie",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Session"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/auth/me": {
+      "get": {
+        "operationId": "currentUser",
+        "responses": {
+          "200": {
+            "description": "Current session identity",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Session"
+                }
+              }
+            }
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/auth/logout": {
+      "post": {
+        "operationId": "logout",
+        "security": [
+          {
+            "SessionCookie": [],
+            "CsrfHeader": []
+          }
+        ],
+        "responses": {
+          "204": {
+            "description": "Persisted session revoked; empty body"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/accounts": {
+      "get": {
+        "operationId": "listOwnedAccounts",
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/Limit"
+          },
+          {
+            "$ref": "#/components/parameters/Offset"
+          }
+        ],
+        "responses": {
+          "200": {
+            "description": "Owned accounts",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/AccountPage"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      },
+      "post": {
+        "operationId": "createAccount",
+        "security": [
+          {
+            "SessionCookie": [],
+            "CsrfHeader": []
+          }
+        ],
+        "requestBody": {
+          "required": true,
+          "content": {
+            "application/json": {
+              "schema": {
+                "$ref": "#/components/schemas/CreateAccount"
+              }
+            }
+          }
+        },
+        "responses": {
+          "201": {
+            "description": "Zero-balance owned wallet",
+            "headers": {
+              "Location": {
+                "schema": {
+                  "type": "string"
+                }
+              }
+            },
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Account"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/accounts/{id}": {
+      "parameters": [
+        {
+          "$ref": "#/components/parameters/AccountId"
+        }
+      ],
+      "get": {
+        "operationId": "getOwnedAccount",
+        "responses": {
+          "200": {
+            "description": "Owned account",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Account"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "404": {
+            "$ref": "#/components/responses/NotFound"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/accounts/{id}/entries": {
+      "parameters": [
+        {
+          "$ref": "#/components/parameters/AccountId"
+        },
+        {
+          "$ref": "#/components/parameters/Limit"
+        },
+        {
+          "$ref": "#/components/parameters/Offset"
+        }
+      ],
+      "get": {
+        "operationId": "listOwnedEntries",
+        "responses": {
+          "200": {
+            "description": "Owner-scoped entry lines",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/EntryPage"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "404": {
+            "$ref": "#/components/responses/NotFound"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/accounts/{id}/transactions": {
+      "parameters": [
+        {
+          "$ref": "#/components/parameters/AccountId"
+        },
+        {
+          "$ref": "#/components/parameters/Limit"
+        },
+        {
+          "$ref": "#/components/parameters/Offset"
+        }
+      ],
+      "get": {
+        "operationId": "listOwnedTransactions",
+        "responses": {
+          "200": {
+            "description": "Owner-scoped economic effects",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/TransactionPage"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "404": {
+            "$ref": "#/components/responses/NotFound"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/recipients/{publicRef}": {
+      "get": {
+        "operationId": "resolveRecipient",
+        "parameters": [
+          {
+            "name": "publicRef",
+            "in": "path",
+            "required": true,
+            "schema": {
+              "type": "string",
+              "pattern": "^LG-[a-fA-F0-9]{32}$"
+            }
+          }
+        ],
+        "responses": {
+          "200": {
+            "description": "Minimal public routing data",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Recipient"
+                }
+              }
+            }
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "404": {
+            "$ref": "#/components/responses/NotFound"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/transfers": {
+      "get": {
+        "operationId": "listOwnedTransfers",
+        "description": "Outgoing immediate transfers created by the authenticated actor only. Stable order: created_at descending, id descending.",
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/Limit"
+          },
+          {
+            "$ref": "#/components/parameters/Offset"
+          }
+        ],
+        "responses": {
+          "200": {
+            "description": "Owned transfer records",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/TransferPage"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      },
+      "post": {
+        "operationId": "createImmediateTransfer",
+        "description": "Atomically post one balanced immediate transfer, financial audit record, idempotency outcome and outbox event. Source ownership comes from the authenticated principal. Deterministic business rejections are stored/replayed as the same minimal code envelope.",
+        "security": [
+          {
+            "SessionCookie": [],
+            "CsrfHeader": []
+          }
+        ],
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/IdempotencyKey"
+          }
+        ],
+        "requestBody": {
+          "required": true,
+          "content": {
+            "application/json": {
+              "schema": {
+                "$ref": "#/components/schemas/TransferIntent"
+              }
+            }
+          }
+        },
+        "responses": {
+          "201": {
+            "description": "Transfer committed. An identical replay returns this same status/body/resource.",
+            "headers": {
+              "Location": {
+                "schema": {
+                  "type": "string"
+                }
+              },
+              "Idempotency-Replayed": {
+                "schema": {
+                  "type": "string",
+                  "enum": [
+                    "false",
+                    "true"
+                  ]
+                }
+              }
+            },
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/TransferReceipt"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "404": {
+            "$ref": "#/components/responses/NotFound"
+          },
+          "409": {
+            "description": "Same scoped key with different normalized intent",
+            "headers": {
+              "Idempotency-Replayed": {
+                "schema": {
+                  "type": "string",
+                  "enum": [
+                    "false"
+                  ]
+                }
+              }
+            },
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/CommandRejection"
+                }
+              }
+            }
+          },
+          "413": {
+            "description": "Body exceeds 16384 bytes",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "422": {
+            "description": "Durable business rejection such as insufficient funds or cross-currency/self transfer. Identical replay returns the same status/body.",
+            "headers": {
+              "Idempotency-Replayed": {
+                "schema": {
+                  "type": "string",
+                  "enum": [
+                    "false",
+                    "true"
+                  ]
+                }
+              }
+            },
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/CommandRejection"
+                }
+              }
+            }
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/transfers/{id}": {
+      "parameters": [
+        {
+          "$ref": "#/components/parameters/TransferId"
+        }
+      ],
+      "get": {
+        "operationId": "getOwnedTransfer",
+        "description": "Returns an outgoing transfer only to its authenticated creator. Destination account UUID, owner and balance are never exposed.",
+        "responses": {
+          "200": {
+            "description": "Owned immediate transfer",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Transfer"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "404": {
+            "$ref": "#/components/responses/NotFound"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/admin/security-events": {
+      "get": {
+        "operationId": "listSecurityEvents",
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/Limit"
+          },
+          {
+            "$ref": "#/components/parameters/Offset"
+          }
+        ],
+        "responses": {
+          "200": {
+            "description": "Append-only security events",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/SecurityEventPage"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/openapi/p04.json": {
+      "get": {
+        "operationId": "openApiP04",
+        "security": [],
+        "responses": {
+          "200": {
+            "description": "This versioned OpenAPI document",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "type": "object"
+                }
+              }
+            }
+          }
+        },
+        "description": "Current P04 OpenAPI contract. The unversioned /api/v1/openapi.json remains the immutable P03 compatibility snapshot."
+      }
+    },
+    "/api/v1/payments": {
+      "get": {
+        "operationId": "listVisiblePayments",
+        "description": "Owner-scoped outgoing and incoming payments. Stable order: created_at descending, id descending. The projection is observational only and never spending authority.",
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/Limit"
+          },
+          {
+            "$ref": "#/components/parameters/Offset"
+          }
+        ],
+        "responses": {
+          "200": {
+            "description": "Owner-visible payment records",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/PaymentPage"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      },
+      "post": {
+        "operationId": "createAsynchronousPayment",
+        "description": "Atomically accept one payment intent, create a PENDING payment and ACTIVE hold, persist idempotency/audit and write payment.requested to the transactional outbox. No journal is posted at acceptance. Returns 202 even when RabbitMQ is unavailable because publication and settlement are independent durable work.",
+        "security": [
+          {
+            "SessionCookie": [],
+            "CsrfHeader": []
+          }
+        ],
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/PaymentIdempotencyKey"
+          }
+        ],
+        "requestBody": {
+          "required": true,
+          "content": {
+            "application/json": {
+              "schema": {
+                "$ref": "#/components/schemas/PaymentIntent"
+              }
+            }
+          }
+        },
+        "responses": {
+          "202": {
+            "description": "Payment durably accepted. Identical replay returns this same status/body/resource.",
+            "headers": {
+              "Location": {
+                "schema": {
+                  "type": "string"
+                }
+              },
+              "Idempotency-Replayed": {
+                "schema": {
+                  "type": "string",
+                  "enum": [
+                    "false",
+                    "true"
+                  ]
+                }
+              }
+            },
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/PaymentReceipt"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "404": {
+            "$ref": "#/components/responses/NotFound"
+          },
+          "409": {
+            "description": "Same scoped key with changed normalized intent",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/CommandRejection"
+                }
+              }
+            }
+          },
+          "422": {
+            "description": "Payment rejected before acceptance",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/CommandRejection"
+                }
+              }
+            }
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/payments/{id}": {
+      "parameters": [
+        {
+          "$ref": "#/components/parameters/PaymentId"
+        }
+      ],
+      "get": {
+        "operationId": "getVisiblePayment",
+        "description": "Visible to the payer or recipient owner without disclosing the counterparty private account UUID or owner identity.",
+        "responses": {
+          "200": {
+            "description": "Payment state and observational projection",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Payment"
+                }
+              }
+            }
+          },
+          "400": {
+            "$ref": "#/components/responses/BadRequest"
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "404": {
+            "$ref": "#/components/responses/NotFound"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/admin/failed-work": {
+      "get": {
+        "operationId": "listFailedWork",
+        "description": "ADMIN-only inspection of bounded poison/exhausted messaging work. Envelope contents are deliberately not returned by this list.",
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/Limit"
+          },
+          {
+            "$ref": "#/components/parameters/Offset"
+          }
+        ],
+        "responses": {
+          "200": {
+            "description": "Failed work",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/FailedWorkPage"
+                }
+              }
+            }
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/admin/failed-work/{id}": {
+      "parameters": [
+        {
+          "$ref": "#/components/parameters/FailedWorkId"
+        }
+      ],
+      "get": {
+        "operationId": "getFailedWork",
+        "responses": {
+          "200": {
+            "description": "Failed-work metadata",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/FailedWork"
+                }
+              }
+            }
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "404": {
+            "$ref": "#/components/responses/NotFound"
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/admin/failed-work/{id}/replay": {
+      "parameters": [
+        {
+          "$ref": "#/components/parameters/FailedWorkId"
+        }
+      ],
+      "post": {
+        "operationId": "requestFailedWorkReplay",
+        "description": "Request audited republication of the original stable event identity. Replay never constitutes a new payment.",
+        "security": [
+          {
+            "SessionCookie": [],
+            "CsrfHeader": []
+          }
+        ],
+        "responses": {
+          "202": {
+            "description": "Replay request durably accepted",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "type": "object",
+                  "additionalProperties": false,
+                  "required": [
+                    "id",
+                    "state"
+                  ],
+                  "properties": {
+                    "id": {
+                      "type": "string",
+                      "format": "uuid"
+                    },
+                    "state": {
+                      "type": "string",
+                      "enum": [
+                        "REPLAY_REQUESTED"
+                      ]
+                    }
+                  }
+                }
+              }
+            }
+          },
+          "401": {
+            "$ref": "#/components/responses/Unauthorized"
+          },
+          "403": {
+            "$ref": "#/components/responses/Forbidden"
+          },
+          "404": {
+            "$ref": "#/components/responses/NotFound"
+          },
+          "409": {
+            "description": "Replay already pending",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "503": {
+            "$ref": "#/components/responses/Unavailable"
+          }
+        }
+      }
+    },
+    "/api/v1/openapi/p05.json": {
+      "get": {
+        "operationId": "openApiP05",
+        "security": [],
+        "description": "Current P05 OpenAPI contract. Earlier versioned contracts remain compatibility snapshots.",
+        "responses": {
+          "200": {
+            "description": "This versioned OpenAPI document",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "type": "object"
+                }
+              }
+            }
+          }
+        }
+      }
+    }
+  },
+  "components": {
+    "securitySchemes": {
+      "SessionCookie": {
+        "type": "apiKey",
+        "in": "cookie",
+        "name": "__Host-LG-SESSION",
+        "description": "HttpOnly, Secure, SameSite=Strict, Path=/, no Domain. Explicit loopback sandbox uses LG-SESSION."
+      },
+      "CsrfHeader": {
+        "type": "apiKey",
+        "in": "header",
+        "name": "X-XSRF-TOKEN",
+        "description": "Masked token returned by /auth/csrf; matching HttpOnly CSRF cookie is also required."
+      }
+    },
+    "parameters": {
+      "AccountId": {
+        "name": "id",
+        "in": "path",
+        "required": true,
+        "schema": {
+          "type": "string",
+          "format": "uuid"
+        }
+      },
+      "TransferId": {
+        "name": "id",
+        "in": "path",
+        "required": true,
+        "schema": {
+          "type": "string",
+          "format": "uuid"
+        }
+      },
+      "IdempotencyKey": {
+        "name": "Idempotency-Key",
+        "in": "header",
+        "required": true,
+        "description": "8..128 characters matching ^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$. Scoped by authenticated actor and TRANSFER operation.",
+        "schema": {
+          "type": "string",
+          "minLength": 8,
+          "maxLength": 128,
+          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"
+        }
+      },
+      "Limit": {
+        "name": "limit",
+        "in": "query",
+        "schema": {
+          "type": "integer",
+          "minimum": 1,
+          "maximum": 100,
+          "default": 50
+        }
+      },
+      "Offset": {
+        "name": "offset",
+        "in": "query",
+        "schema": {
+          "type": "integer",
+          "minimum": 0,
+          "maximum": 10000,
+          "default": 0
+        }
+      },
+      "PaymentId": {
+        "name": "id",
+        "in": "path",
+        "required": true,
+        "schema": {
+          "type": "string",
+          "format": "uuid"
+        }
+      },
+      "FailedWorkId": {
+        "name": "id",
+        "in": "path",
+        "required": true,
+        "schema": {
+          "type": "string",
+          "format": "uuid"
+        }
+      },
+      "PaymentIdempotencyKey": {
+        "name": "Idempotency-Key",
+        "in": "header",
+        "required": true,
+        "description": "8..128 characters. Scoped by authenticated actor and PAYMENT operation. Preserve the same normalized intent and key after a timeout or 5xx.",
+        "schema": {
+          "type": "string",
+          "minLength": 8,
+          "maxLength": 128,
+          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"
+        }
+      }
+    },
+    "responses": {
+      "BadRequest": {
+        "description": "Malformed JSON, unknown field, invalid command/key/value or pagination",
+        "content": {
+          "application/problem+json": {
+            "schema": {
+              "$ref": "#/components/schemas/Problem"
+            }
+          }
+        }
+      },
+      "Unauthorized": {
+        "description": "Missing, invalid, expired or revoked session",
+        "content": {
+          "application/problem+json": {
+            "schema": {
+              "$ref": "#/components/schemas/Problem"
+            }
+          }
+        }
+      },
+      "Forbidden": {
+        "description": "Role, CSRF or origin boundary rejected the request",
+        "content": {
+          "application/problem+json": {
+            "schema": {
+              "$ref": "#/components/schemas/Problem"
+            }
+          }
+        }
+      },
+      "NotFound": {
+        "description": "Absent or not disclosable to this principal",
+        "content": {
+          "application/problem+json": {
+            "schema": {
+              "$ref": "#/components/schemas/Problem"
+            }
+          }
+        }
+      },
+      "Unavailable": {
+        "description": "Temporary dependency failure or uncertain outcome. For a submitted idempotent command, retain and replay the same key/intent.",
+        "content": {
+          "application/problem+json": {
+            "schema": {
+              "$ref": "#/components/schemas/Problem"
+            }
+          }
+        }
+      }
+    },
+    "schemas": {
+      "Minor": {
+        "type": "string",
+        "pattern": "^(0|[1-9][0-9]*)$",
+        "description": "Exact integer minor units"
+      },
+      "PositiveMinor": {
+        "type": "string",
+        "pattern": "^[1-9][0-9]{0,12}$",
+        "description": "1 through 1000000000000 minor units"
+      },
+      "Currency": {
+        "type": "string",
+        "enum": [
+          "CAD",
+          "USD",
+          "JPY",
+          "KWD"
+        ]
+      },
+      "Problem": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "type",
+          "title",
+          "status",
+          "code",
+          "correlationId",
+          "validation"
+        ],
+        "properties": {
+          "type": {
+            "type": "string"
+          },
+          "title": {
+            "type": "string"
+          },
+          "status": {
+            "type": "integer"
+          },
+          "code": {
+            "type": "string"
+          },
+          "correlationId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "validation": {
+            "type": "object",
+            "additionalProperties": {
+              "type": "string"
+            }
+          }
+        }
+      },
+      "CommandRejection": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "code"
+        ],
+        "properties": {
+          "code": {
+            "type": "string",
+            "description": "Durably replayed business rejection code"
+          }
+        }
+      },
+      "Csrf": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "headerName",
+          "token"
+        ],
+        "properties": {
+          "headerName": {
+            "type": "string",
+            "enum": [
+              "X-XSRF-TOKEN"
+            ]
+          },
+          "token": {
+            "type": "string"
+          }
+        }
+      },
+      "Registration": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "email",
+          "password",
+          "displayName"
+        ],
+        "properties": {
+          "email": {
+            "type": "string",
+            "maxLength": 300
+          },
+          "password": {
+            "type": "string",
+            "minLength": 12,
+            "maxLength": 72,
+            "writeOnly": true
+          },
+          "displayName": {
+            "type": "string",
+            "minLength": 1,
+            "maxLength": 80
+          }
+        }
+      },
+      "Login": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "email",
+          "password"
+        ],
+        "properties": {
+          "email": {
+            "type": "string",
+            "maxLength": 300
+          },
+          "password": {
+            "type": "string",
+            "minLength": 12,
+            "maxLength": 72,
+            "writeOnly": true
+          }
+        }
+      },
+      "Registered": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "id",
+          "email",
+          "displayName",
+          "role"
+        ],
+        "properties": {
+          "id": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "email": {
+            "type": "string"
+          },
+          "displayName": {
+            "type": "string"
+          },
+          "role": {
+            "type": "string",
+            "enum": [
+              "CUSTOMER"
+            ]
+          }
+        }
+      },
+      "Session": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "id",
+          "email",
+          "displayName",
+          "role",
+          "expiresAt"
+        ],
+        "properties": {
+          "id": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "email": {
+            "type": "string"
+          },
+          "displayName": {
+            "type": "string"
+          },
+          "role": {
+            "type": "string",
+            "enum": [
+              "CUSTOMER",
+              "ADMIN"
+            ]
+          },
+          "expiresAt": {
+            "type": "string",
+            "format": "date-time"
+          }
+        }
+      },
+      "CreateAccount": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "name",
+          "currency"
+        ],
+        "properties": {
+          "name": {
+            "type": "string",
+            "minLength": 1,
+            "maxLength": 80
+          },
+          "currency": {
+            "$ref": "#/components/schemas/Currency"
+          }
+        }
+      },
+      "Account": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "id",
+          "publicRef",
+          "name",
+          "currency",
+          "postedMinor",
+          "reservedMinor",
+          "availableMinor",
+          "version",
+          "updatedAt"
+        ],
+        "properties": {
+          "id": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "publicRef": {
+            "type": "string"
+          },
+          "name": {
+            "type": "string"
+          },
+          "currency": {
+            "$ref": "#/components/schemas/Currency"
+          },
+          "postedMinor": {
+            "$ref": "#/components/schemas/Minor"
+          },
+          "reservedMinor": {
+            "$ref": "#/components/schemas/Minor"
+          },
+          "availableMinor": {
+            "$ref": "#/components/schemas/Minor"
+          },
+          "version": {
+            "type": "string",
+            "pattern": "^[1-9][0-9]*$"
+          },
+          "updatedAt": {
+            "type": "string",
+            "format": "date-time"
+          }
+        }
+      },
+      "Entry": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "id",
+          "journalId",
+          "operationId",
+          "kind",
+          "side",
+          "amountMinor",
+          "currency",
+          "createdAt"
+        ],
+        "properties": {
+          "id": {
+            "type": "string"
+          },
+          "journalId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "operationId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "kind": {
+            "type": "string"
+          },
+          "side": {
+            "type": "string",
+            "enum": [
+              "DEBIT",
+              "CREDIT"
+            ]
+          },
+          "amountMinor": {
+            "$ref": "#/components/schemas/PositiveMinor"
+          },
+          "currency": {
+            "$ref": "#/components/schemas/Currency"
+          },
+          "createdAt": {
+            "type": "string",
+            "format": "date-time"
+          }
+        }
+      },
+      "Transaction": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "journalId",
+          "operationId",
+          "kind",
+          "effectMinor",
+          "currency",
+          "createdAt"
+        ],
+        "properties": {
+          "journalId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "operationId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "kind": {
+            "type": "string"
+          },
+          "effectMinor": {
+            "type": "string",
+            "pattern": "^-?(0|[1-9][0-9]*)$"
+          },
+          "currency": {
+            "$ref": "#/components/schemas/Currency"
+          },
+          "createdAt": {
+            "type": "string",
+            "format": "date-time"
+          }
+        }
+      },
+      "Recipient": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "publicRef",
+          "currency"
+        ],
+        "properties": {
+          "publicRef": {
+            "type": "string",
+            "pattern": "^LG-[a-f0-9]{32}$"
+          },
+          "currency": {
+            "$ref": "#/components/schemas/Currency"
+          }
+        }
+      },
+      "SecurityEvent": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "id",
+          "actorId",
+          "eventType",
+          "correlationId",
+          "occurredAt"
+        ],
+        "properties": {
+          "id": {
+            "type": "string"
+          },
+          "actorId": {
+            "type": "string",
+            "format": "uuid",
+            "nullable": true
+          },
+          "eventType": {
+            "type": "string"
+          },
+          "correlationId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "occurredAt": {
+            "type": "string",
+            "format": "date-time"
+          }
+        }
+      },
+      "TransferIntent": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "sourceId",
+          "recipientRef",
+          "amountMinor",
+          "currency"
+        ],
+        "properties": {
+          "sourceId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "recipientRef": {
+            "type": "string",
+            "pattern": "^LG-[a-fA-F0-9]{32}$"
+          },
+          "amountMinor": {
+            "$ref": "#/components/schemas/PositiveMinor"
+          },
+          "currency": {
+            "$ref": "#/components/schemas/Currency"
+          }
+        }
+      },
+      "TransferReceipt": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "id",
+          "kind",
+          "state",
+          "journalId",
+          "amountMinor",
+          "currency"
+        ],
+        "properties": {
+          "id": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "kind": {
+            "type": "string",
+            "enum": [
+              "TRANSFER"
+            ]
+          },
+          "state": {
+            "type": "string",
+            "enum": [
+              "SETTLED"
+            ]
+          },
+          "journalId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "amountMinor": {
+            "$ref": "#/components/schemas/PositiveMinor"
+          },
+          "currency": {
+            "$ref": "#/components/schemas/Currency"
+          }
+        }
+      },
+      "Transfer": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "id",
+          "sourceId",
+          "recipientRef",
+          "amountMinor",
+          "currency",
+          "state",
+          "journalId",
+          "createdAt"
+        ],
+        "properties": {
+          "id": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "sourceId": {
+            "type": "string",
+            "format": "uuid",
+            "description": "The authenticated owner's source account"
+          },
+          "recipientRef": {
+            "type": "string",
+            "pattern": "^LG-[a-f0-9]{32}$",
+            "description": "Public routing reference only; private destination account/owner data is not exposed"
+          },
+          "amountMinor": {
+            "$ref": "#/components/schemas/PositiveMinor"
+          },
+          "currency": {
+            "$ref": "#/components/schemas/Currency"
+          },
+          "state": {
+            "type": "string",
+            "enum": [
+              "SETTLED"
+            ]
+          },
+          "journalId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "createdAt": {
+            "type": "string",
+            "format": "date-time"
+          }
+        }
+      },
+      "AccountPage": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "items",
+          "limit",
+          "offset",
+          "hasMore"
+        ],
+        "properties": {
+          "items": {
+            "type": "array",
+            "items": {
+              "$ref": "#/components/schemas/Account"
+            }
+          },
+          "limit": {
+            "type": "integer"
+          },
+          "offset": {
+            "type": "integer"
+          },
+          "hasMore": {
+            "type": "boolean"
+          }
+        }
+      },
+      "EntryPage": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "items",
+          "limit",
+          "offset",
+          "hasMore"
+        ],
+        "properties": {
+          "items": {
+            "type": "array",
+            "items": {
+              "$ref": "#/components/schemas/Entry"
+            }
+          },
+          "limit": {
+            "type": "integer"
+          },
+          "offset": {
+            "type": "integer"
+          },
+          "hasMore": {
+            "type": "boolean"
+          }
+        }
+      },
+      "TransactionPage": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "items",
+          "limit",
+          "offset",
+          "hasMore"
+        ],
+        "properties": {
+          "items": {
+            "type": "array",
+            "items": {
+              "$ref": "#/components/schemas/Transaction"
+            }
+          },
+          "limit": {
+            "type": "integer"
+          },
+          "offset": {
+            "type": "integer"
+          },
+          "hasMore": {
+            "type": "boolean"
+          }
+        }
+      },
+      "SecurityEventPage": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "items",
+          "limit",
+          "offset",
+          "hasMore"
+        ],
+        "properties": {
+          "items": {
+            "type": "array",
+            "items": {
+              "$ref": "#/components/schemas/SecurityEvent"
+            }
+          },
+          "limit": {
+            "type": "integer"
+          },
+          "offset": {
+            "type": "integer"
+          },
+          "hasMore": {
+            "type": "boolean"
+          }
+        }
+      },
+      "TransferPage": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "items",
+          "limit",
+          "offset",
+          "hasMore"
+        ],
+        "properties": {
+          "items": {
+            "type": "array",
+            "items": {
+              "$ref": "#/components/schemas/Transfer"
+            }
+          },
+          "limit": {
+            "type": "integer"
+          },
+          "offset": {
+            "type": "integer"
+          },
+          "hasMore": {
+            "type": "boolean"
+          }
+        }
+      },
+      "PaymentIntent": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "sourceId",
+          "recipientRef",
+          "amountMinor",
+          "currency"
+        ],
+        "properties": {
+          "sourceId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "recipientRef": {
+            "type": "string",
+            "pattern": "^LG-[a-fA-F0-9]{32}$"
+          },
+          "amountMinor": {
+            "$ref": "#/components/schemas/PositiveMinor"
+          },
+          "currency": {
+            "$ref": "#/components/schemas/Currency"
+          }
+        }
+      },
+      "PaymentReceipt": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "id",
+          "kind",
+          "state",
+          "amountMinor",
+          "currency"
+        ],
+        "properties": {
+          "id": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "kind": {
+            "type": "string",
+            "enum": [
+              "PAYMENT"
+            ]
+          },
+          "state": {
+            "type": "string",
+            "enum": [
+              "PENDING"
+            ]
+          },
+          "amountMinor": {
+            "$ref": "#/components/schemas/PositiveMinor"
+          },
+          "currency": {
+            "$ref": "#/components/schemas/Currency"
+          }
+        }
+      },
+      "Payment": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "id",
+          "direction",
+          "accountId",
+          "counterpartyRef",
+          "amountMinor",
+          "currency",
+          "state",
+          "version",
+          "adjustmentState",
+          "createdAt",
+          "updatedAt"
+        ],
+        "properties": {
+          "id": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "direction": {
+            "type": "string",
+            "enum": [
+              "OUTGOING",
+              "INCOMING"
+            ]
+          },
+          "accountId": {
+            "type": "string",
+            "format": "uuid",
+            "description": "The authenticated owner’s account only"
+          },
+          "counterpartyRef": {
+            "type": "string",
+            "pattern": "^LG-[a-f0-9]{32}$"
+          },
+          "amountMinor": {
+            "$ref": "#/components/schemas/PositiveMinor"
+          },
+          "currency": {
+            "$ref": "#/components/schemas/Currency"
+          },
+          "state": {
+            "type": "string",
+            "enum": [
+              "PENDING",
+              "SETTLED",
+              "FAILED",
+              "CANCELLED"
+            ]
+          },
+          "version": {
+            "type": "string",
+            "pattern": "^[1-9][0-9]*$"
+          },
+          "adjustmentState": {
+            "type": "string",
+            "enum": [
+              "NONE",
+              "PARTIALLY_REFUNDED",
+              "FULLY_REFUNDED",
+              "REVERSED"
+            ]
+          },
+          "journalId": {
+            "type": "string",
+            "format": "uuid",
+            "nullable": true
+          },
+          "failureCode": {
+            "type": "string",
+            "nullable": true
+          },
+          "projectionState": {
+            "type": "string",
+            "enum": [
+              "PENDING",
+              "SETTLED",
+              "FAILED",
+              "CANCELLED"
+            ],
+            "nullable": true,
+            "description": "Observational only; never spending authority"
+          },
+          "projectionVersion": {
+            "type": "string",
+            "pattern": "^[1-9][0-9]*$",
+            "nullable": true
+          },
+          "createdAt": {
+            "type": "string",
+            "format": "date-time"
+          },
+          "updatedAt": {
+            "type": "string",
+            "format": "date-time"
+          }
+        }
+      },
+      "FailedWork": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "id",
+          "consumer",
+          "eventId",
+          "exchangeName",
+          "routingKey",
+          "envelope",
+          "failureCode",
+          "attempts",
+          "state",
+          "createdAt",
+          "updatedAt"
+        ],
+        "properties": {
+          "id": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "consumer": {
+            "type": "string"
+          },
+          "eventId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "exchangeName": {
+            "type": "string"
+          },
+          "routingKey": {
+            "type": "string"
+          },
+          "envelope": {
+            "type": "object",
+            "additionalProperties": true,
+            "description": "Bounded original event envelope or a bounded raw-message evidence wrapper"
+          },
+          "failureCode": {
+            "type": "string"
+          },
+          "attempts": {
+            "type": "integer"
+          },
+          "state": {
+            "type": "string",
+            "enum": [
+              "FAILED",
+              "REPLAY_REQUESTED",
+              "REPUBLISHING",
+              "REPUBLISHED"
+            ]
+          },
+          "replayRequestedBy": {
+            "type": "string",
+            "format": "uuid",
+            "nullable": true
+          },
+          "replayRequestedAt": {
+            "type": "string",
+            "format": "date-time",
+            "nullable": true
+          },
+          "createdAt": {
+            "type": "string",
+            "format": "date-time"
+          },
+          "updatedAt": {
+            "type": "string",
+            "format": "date-time"
+          },
+          "republishedAt": {
+            "type": "string",
+            "format": "date-time",
+            "nullable": true
+          }
+        }
+      },
+      "PaymentPage": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "items",
+          "limit",
+          "offset",
+          "hasMore"
+        ],
+        "properties": {
+          "items": {
+            "type": "array",
+            "items": {
+              "$ref": "#/components/schemas/Payment"
+            }
+          },
+          "limit": {
+            "type": "integer"
+          },
+          "offset": {
+            "type": "integer"
+          },
+          "hasMore": {
+            "type": "boolean"
+          }
+        }
+      },
+      "FailedWorkPage": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": [
+          "items",
+          "limit",
+          "offset",
+          "hasMore"
+        ],
+        "properties": {
+          "items": {
+            "type": "array",
+            "items": {
+              "$ref": "#/components/schemas/FailedWork"
+            }
+          },
+          "limit": {
+            "type": "integer"
+          },
+          "offset": {
+            "type": "integer"
+          },
+          "hasMore": {
+            "type": "boolean"
+          }
+        }
+      }
+    }
+  }
+}

```

### backend/src/test/java/lab/ledgerguard/PaymentMessagingIT.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import io.restassured.response.Response;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.sql.*;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import lab.ledgerguard.messaging.EventEnvelope;
import lab.ledgerguard.messaging.RabbitTopology;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/** Real P05 HTTP, PostgreSQL outbox, RabbitMQ confirms and two restartable worker JVMs. */
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PaymentMessagingIT {
    private static final String RABBIT_USER = "ledgerguard";
    private static final String RABBIT_PASSWORD = UUID.randomUUID().toString();
    private static final String RABBIT_VHOST = "/ledgerguard";
    private static final String USER_PASSWORD = "A-real-test-password-123!";

    @Container static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:17.11-bookworm")
        .withDatabaseName("ledgerpayment").withUsername("postgres").withPassword(UUID.randomUUID().toString());
    @Container static final RabbitMQContainer RABBIT = new RabbitMQContainer("rabbitmq:4.3.5-management-alpine")
        .withEnv("RABBITMQ_DEFAULT_USER", RABBIT_USER)
        .withEnv("RABBITMQ_DEFAULT_PASS", RABBIT_PASSWORD)
        .withEnv("RABBITMQ_DEFAULT_VHOST", RABBIT_VHOST);

    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();
    private static final String OWNER = UUID.randomUUID().toString();
    private static final String RUNTIME = UUID.randomUUID().toString();
    private static final byte[] AUTH_KEY = new byte[64];
    private static final Path EVIDENCE = Path.of("target/payment-messaging-evidence");
    private static App api, publisher, workerA, workerB;
    private static Fixture fixture;
    private static Browser alice, bob, carol, admin;
    private static UUID firstPayment, firstEvent;

    record App(Process process, String role, Path log, int port) { }
    record Fixture(UUID alice, UUID bob, UUID carol, UUID admin, UUID asset, UUID source, UUID destination, String recipientRef) { }

    static final class Browser {
        final int port;
        final Map<String, String> cookies = new HashMap<>();
        String csrf;
        Browser(int port) { this.port = port; }
        Response call(String method, String path, Object body) { return call(method, path, body, Map.of()); }
        Response call(String method, String path, Object body, Map<String, String> headers) {
            var request = given().baseUri("http://127.0.0.1").port(port).redirects().follow(false)
                .cookies(cookies).headers(headers).accept("application/json");
            if (csrf != null) request.header("X-XSRF-TOKEN", csrf);
            if (body != null) request.contentType("application/json").body(body);
            Response response = request.request(method, "/api/v1" + path);
            response.detailedCookies().forEach(cookie -> {
                if (cookie.getMaxAge() == 0) cookies.remove(cookie.getName());
                else cookies.put(cookie.getName(), cookie.getValue());
            });
            return response;
        }
        void csrf() {
            Response response = call("GET", "/auth/csrf", null);
            assertEquals(200, response.statusCode());
            csrf = response.jsonPath().getString("token");
            assertNotNull(csrf);
        }
        void login(String email) {
            csrf();
            assertEquals(200, call("POST", "/auth/login", Map.of("email", email, "password", USER_PASSWORD)).statusCode());
            csrf();
        }
    }

    @BeforeAll
    static void start() throws Exception {
        new SecureRandom().nextBytes(AUTH_KEY);
        Files.createDirectories(EVIDENCE);
        try (Connection connection = DriverManager.getConnection(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword());
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE ROLE ledger_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" + OWNER + "'");
            statement.execute("CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" + RUNTIME + "'");
            statement.execute("GRANT CREATE ON DATABASE ledgerpayment TO ledger_owner");
            statement.execute("GRANT USAGE,CREATE ON SCHEMA public TO ledger_owner");
        }
        Flyway.configure().dataSource(PG.getJdbcUrl(), "ledger_owner", OWNER).defaultSchema("public")
            .locations("classpath:db/migration").load().migrate();
        fixture = fixture();
        api = launchApi();
        alice = new Browser(api.port()); alice.login("alice-p05@example.test");
        bob = new Browser(api.port()); bob.login("bob-p05@example.test");
        carol = new Browser(api.port()); carol.login("carol-p05@example.test");
        admin = new Browser(api.port()); admin.login("admin-p05@example.test");
    }

    @AfterAll
    static void stopAll() throws Exception {
        stop(workerA); stop(workerB); stop(publisher); stop(api);
    }

    @Test @Order(1)
    void P0501_atomicAcceptanceReplayAndRealSettlement() throws Exception {
        String key = "p05-atomic-" + UUID.randomUUID();
        Map<String, String> intent = paymentIntent(2500);
        Response accepted = alice.call("POST", "/payments", intent, Map.of("Idempotency-Key", key));
        assertEquals(202, accepted.statusCode());
        assertEquals("PENDING", accepted.jsonPath().getString("state"));
        firstPayment = UUID.fromString(accepted.jsonPath().getString("id"));
        firstEvent = uuid("SELECT id FROM ledger.outbox_events WHERE aggregate_id=? AND event_type='payment.requested'", firstPayment);

        assertEquals("PENDING", text("SELECT state FROM ledger.payments WHERE id=?", firstPayment));
        assertEquals("ACTIVE", text("SELECT state FROM ledger.holds WHERE payment_id=?", firstPayment));
        assertEquals(2500, scalar("SELECT reserved_minor FROM ledger.account_balances WHERE account_id=?", fixture.source()));
        assertEquals(0, scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?", firstPayment));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.outbox_events WHERE id=? AND published_at IS NULL", firstEvent));

        Response replay = alice.call("POST", "/payments", intent, Map.of("Idempotency-Key", key));
        assertEquals(202, replay.statusCode());
        assertEquals(firstPayment.toString(), replay.jsonPath().getString("id"));
        assertEquals("true", replay.header("Idempotency-Replayed"));
        Map<String, String> changed = new HashMap<>(intent); changed.put("amountMinor", "2501");
        assertEquals(409, alice.call("POST", "/payments", changed, Map.of("Idempotency-Key", key)).statusCode());

        startMessaging();
        await("first payment settlement", Duration.ofSeconds(45), () -> "SETTLED".equals(textQuiet("SELECT state FROM ledger.payments WHERE id=?", firstPayment)));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?", firstPayment));
        assertEquals("CONSUMED", text("SELECT state FROM ledger.holds WHERE payment_id=?", firstPayment));
        assertEquals(0, scalar("SELECT reserved_minor FROM ledger.account_balances WHERE account_id=?", fixture.source()));
        await("settled payment projection", Duration.ofSeconds(30), () -> scalarQuiet(
            "SELECT count(*) FROM ledger.payment_projection WHERE payment_id=? AND state='SETTLED' AND aggregate_version=2", firstPayment) == 1);
        assertEquals("SETTLED", text("SELECT state FROM ledger.payment_projection WHERE payment_id=?", firstPayment));
        assertEquals(2, scalar("SELECT aggregate_version FROM ledger.payment_projection WHERE payment_id=?", firstPayment));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.consumer_inbox WHERE consumer='payment-settler-v1' AND event_id=?", firstEvent));
        assertEquals(200, alice.call("GET", "/payments/" + firstPayment, null).statusCode());
        Response incoming = bob.call("GET", "/payments/" + firstPayment, null);
        assertEquals(200, incoming.statusCode());
        assertEquals("INCOMING", incoming.jsonPath().getString("direction"));
        assertTrue(workerA.process().isAlive() && workerB.process().isAlive(), "Both independent workers must remain active");
    }

    @Test @Order(2)
    void P0502_duplicateAndDifferentMessageIdentityCannotDuplicateMoney() throws Exception {
        byte[] original = envelope(firstEvent, null, null);
        publish("payment.requested", firstEvent, original);
        UUID logicalDuplicate = UUID.randomUUID();
        publish("payment.requested", logicalDuplicate, envelope(firstEvent, logicalDuplicate, null));
        await("logical duplicate inbox", Duration.ofSeconds(20), () -> scalarQuiet(
            "SELECT count(*) FROM ledger.consumer_inbox WHERE consumer='payment-settler-v1' AND event_id=?", logicalDuplicate) == 1);
        assertEquals(1, scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?", firstPayment));
        assertEquals("SETTLED", text("SELECT state FROM ledger.payments WHERE id=?", firstPayment));
        assertEquals("SETTLED", text("SELECT state FROM ledger.payment_projection WHERE payment_id=?", firstPayment));
    }

    @Test @Order(3)
    void P0503_brokerOutageDoesNotTakeDownApiAndBacklogRecovers() throws Exception {
        assertEquals(0, RABBIT.execInContainer("rabbitmqctl", "stop_app").getExitCode());
        String key = "p05-outage-" + UUID.randomUUID();
        Response accepted = alice.call("POST", "/payments", paymentIntent(1100), Map.of("Idempotency-Key", key));
        assertEquals(202, accepted.statusCode());
        UUID payment = UUID.fromString(accepted.jsonPath().getString("id"));
        assertEquals("PENDING", text("SELECT state FROM ledger.payments WHERE id=?", payment));
        Response transfer = alice.call("POST", "/transfers", paymentIntent(100),
            Map.of("Idempotency-Key", "p05-outage-transfer-" + UUID.randomUUID()));
        assertEquals(201, transfer.statusCode(), "Immediate PostgreSQL transfer must remain available during broker outage");
        assertEquals(0, RABBIT.execInContainer("rabbitmqctl", "start_app").getExitCode());
        awaitRabbit(Duration.ofSeconds(30));
        await("outage payment recovery", Duration.ofSeconds(70), () -> "SETTLED".equals(textQuiet(
            "SELECT state FROM ledger.payments WHERE id=?", payment)));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?", payment));
    }

    @Test @Order(4)
    void P0504_workerDeathAfterCommitBeforeAckRedeliversWithoutSecondPosting() throws Exception {
        stop(workerA); stop(workerB); workerA = null; workerB = null;
        App crashWorker = launch("worker-crash", "worker", 0, List.of("--ledgerguard.test.crash-after-settlement=true"));
        String key = "p05-worker-crash-" + UUID.randomUUID();
        Response accepted = alice.call("POST", "/payments", paymentIntent(900), Map.of("Idempotency-Key", key));
        UUID payment = UUID.fromString(accepted.jsonPath().getString("id"));
        await("crash worker exit", Duration.ofSeconds(30), () -> !crashWorker.process().isAlive());
        assertEquals(77, crashWorker.process().exitValue());
        assertEquals("SETTLED", text("SELECT state FROM ledger.payments WHERE id=?", payment));
        workerA = launch("worker-a-restarted", "worker", 0, List.of());
        workerB = launch("worker-b-restarted", "worker", 0, List.of());
        await("redelivery acknowledgement", Duration.ofSeconds(30), () -> queueMessages(RabbitTopology.SETTLEMENT_QUEUE) == 0);
        assertEquals(1, scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?", payment));
    }

    @Test @Order(5)
    void P0505_publisherDeathAfterConfirmBeforeMarkCausesSafeRepublish() throws Exception {
        await("existing outbox drain", Duration.ofSeconds(30), () -> scalarQuiet(
            "SELECT count(*) FROM ledger.outbox_events WHERE published_at IS NULL") == 0);
        stop(publisher); publisher = null;
        App crashPublisher = launch("publisher-crash", "publisher", 0, List.of(
            "--ledgerguard.messaging.publisher-lease-seconds=2",
            "--ledgerguard.test.crash-after-publish-confirm=true"));
        String key = "p05-publisher-crash-" + UUID.randomUUID();
        Response accepted = alice.call("POST", "/payments", paymentIntent(800), Map.of("Idempotency-Key", key));
        UUID payment = UUID.fromString(accepted.jsonPath().getString("id"));
        UUID event = uuid("SELECT id FROM ledger.outbox_events WHERE aggregate_id=? AND event_type='payment.requested'", payment);
        await("crash publisher exit", Duration.ofSeconds(30), () -> !crashPublisher.process().isAlive());
        assertEquals(78, crashPublisher.process().exitValue());
        await("payment committed from confirmed delivery", Duration.ofSeconds(30), () -> "SETTLED".equals(textQuiet(
            "SELECT state FROM ledger.payments WHERE id=?", payment)));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.outbox_events WHERE id=? AND published_at IS NULL", event));
        Thread.sleep(2500);
        publisher = launch("publisher-restarted", "publisher", 0, List.of(
            "--ledgerguard.messaging.publisher-lease-seconds=2",
            "--ledgerguard.messaging.recovery-stale-seconds=5"));
        await("outbox marked after safe duplicate publish", Duration.ofSeconds(30), () -> scalarQuiet(
            "SELECT count(*) FROM ledger.outbox_events WHERE id=? AND published_at IS NOT NULL AND attempts>=2", event) == 1);
        assertEquals(1, scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?", payment));
    }

    @Test @Order(6)
    void P0506_poisonInspectionAndAuditedReplayPreserveOriginalIdentity() throws Exception {
        UUID poison = UUID.randomUUID();
        publish("payment.requested", poison, "{not-json".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        await("poison failed-work records", Duration.ofSeconds(20), () -> scalarQuiet(
            "SELECT count(*) FROM ledger.failed_messages WHERE event_id=?", poison) >= 2);
        Response failed = admin.call("GET", "/admin/failed-work?limit=100", null);
        assertEquals(200, failed.statusCode());
        assertTrue(failed.jsonPath().getList("items.eventId", String.class).contains(poison.toString()));

        JsonNode corrupted = JSON.readTree(envelope(firstEvent, null, null));
        ((com.fasterxml.jackson.databind.node.ObjectNode) corrupted.path("payload")).put("state", "BROKEN");
        publish("payment.requested", firstEvent, JSON.writeValueAsBytes(corrupted));
        await("replayable failed-work record", Duration.ofSeconds(20), () -> scalarQuiet(
            "SELECT count(*) FROM ledger.failed_messages WHERE event_id=? AND consumer='payment-settlement-v1'", firstEvent) == 1);
        UUID failedId = uuid("SELECT id FROM ledger.failed_messages WHERE event_id=? AND consumer='payment-settlement-v1'", firstEvent);
        Response replay = admin.call("POST", "/admin/failed-work/" + failedId + "/replay",
            Map.of("reason", "Verified replay after correcting event validation"));
        assertEquals(202, replay.statusCode());
        assertEquals(firstEvent.toString(), replay.jsonPath().getString("eventId"));
        await("audited replay publication", Duration.ofSeconds(30), () -> scalarQuiet(
            "SELECT count(*) FROM ledger.failed_messages WHERE id=? AND replayed_at IS NOT NULL", failedId) == 1);
        assertEquals(1, scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?", firstPayment));
        assertEquals(1, scalar("SELECT count(*) FROM ledger.audit_records WHERE aggregate_id=? AND action='FAILED_WORK_REPLAY_REQUESTED'", firstPayment));
    }

    @Test @Order(7)
    void P0507_contractAuthorizationAndRestrictedMessagingState() throws Exception {
        Browser anonymous = new Browser(api.port());
        assertEquals(401, anonymous.call("GET", "/payments", null).statusCode());
        assertEquals(400, alice.call("POST", "/payments", paymentIntent(50)).statusCode());
        assertEquals(400, alice.call("POST", "/payments", paymentIntent(50),
            Map.of("Idempotency-Key", "bad")).statusCode());

        Map<String, Object> injected = new HashMap<>(paymentIntent(50));
        injected.put("state", "SETTLED");
        String unknownKey = "p05-unknown-field-" + UUID.randomUUID();
        assertEquals(400, alice.call("POST", "/payments", injected,
            Map.of("Idempotency-Key", unknownKey)).statusCode());
        assertEquals(0, scalar("SELECT count(*) FROM ledger.idempotency_records WHERE actor_id=? AND key=?",
            fixture.alice(), unknownKey));

        alice.csrf = null;
        assertEquals(403, alice.call("POST", "/payments", paymentIntent(50),
            Map.of("Idempotency-Key", "p05-missing-csrf-" + UUID.randomUUID())).statusCode());
        alice.csrf();
        assertEquals(403, admin.call("POST", "/payments", paymentIntent(50),
            Map.of("Idempotency-Key", "p05-admin-spend-" + UUID.randomUUID())).statusCode());
        assertEquals(404, carol.call("GET", "/payments/" + firstPayment, null).statusCode());
        assertTrue(carol.call("GET", "/payments", null).jsonPath().getList("items").isEmpty());

        Response specResponse = anonymous.call("GET", "/openapi/p05.json", null);
        assertEquals(200, specResponse.statusCode());
        JsonNode spec = JSON.readTree(specResponse.asString());
        assertTrue(spec.path("paths").has("/api/v1/payments"));
        assertTrue(spec.path("paths").has("/api/v1/payments/{id}"));
        assertTrue(spec.path("paths").has("/api/v1/admin/failed-work/{id}/replay"));

        try (Connection connection = runtime(); Statement statement = connection.createStatement()) {
            assertEquals("42501", assertThrows(SQLException.class, () ->
                statement.execute("UPDATE ledger.outbox_events SET last_error='forged' WHERE false")).getSQLState());
            assertEquals("42501", assertThrows(SQLException.class, () ->
                statement.execute("INSERT INTO ledger.consumer_inbox(consumer,event_id) VALUES('forged',gen_random_uuid())")).getSQLState());
            assertEquals("42501", assertThrows(SQLException.class, () ->
                statement.execute("UPDATE ledger.payment_projection SET state='FAILED' WHERE false")).getSQLState());
            assertEquals("42501", assertThrows(SQLException.class, () ->
                statement.execute("INSERT INTO ledger.failed_messages(consumer,exchange_name,routing_key,body,reason_code) "
                    + "VALUES('forged','','',decode('00','hex'),'FORGED')")).getSQLState());
        }
        assertTrue(workerA.process().isAlive() && workerB.process().isAlive());
    }

    private static synchronized void startMessaging() throws Exception {
        if (publisher == null) p
```

### compose.yaml

REVIEW_DIFFERENCE

```diff
--- branch/compose.yaml
+++ main-history/compose.yaml
@@ -1,27 +1,27 @@
 name: ${COMPOSE_PROJECT_NAME:-ledgerguard}

-x-ledger-runtime-environment: &ledger-runtime-environment
+x-ledger-runtime: &ledger-runtime
+  LEDGER_SANDBOX_HTTP: "true"
+  LEDGER_AUTH_KEY: ${LEDGER_AUTH_KEY:?LEDGER_AUTH_KEY is required}
   LEDGER_DATABASE_URL: jdbc:postgresql://postgres:5432/${POSTGRES_DB:-ledgerguard}
-  LEDGER_MIGRATION_URL: jdbc:postgresql://postgres:5432/${POSTGRES_DB:-ledgerguard}
-  LEDGER_OWNER_USER: ledger_owner
-  LEDGER_OWNER_PASSWORD: ${LEDGER_OWNER_PASSWORD:?LEDGER_OWNER_PASSWORD is required}
   LEDGER_RUNTIME_USER: ledger_runtime
   LEDGER_RUNTIME_PASSWORD: ${LEDGER_RUNTIME_PASSWORD:?LEDGER_RUNTIME_PASSWORD is required}
-  LEDGER_AUTH_KEY: ${LEDGER_AUTH_KEY:?LEDGER_AUTH_KEY is required}
+
+x-ledger-rabbit: &ledger-rabbit
   LEDGER_RABBIT_HOST: rabbitmq
   LEDGER_RABBIT_PORT: 5672
   LEDGER_RABBIT_USER: ${RABBITMQ_DEFAULT_USER:-ledgerguard}
   LEDGER_RABBIT_PASSWORD: ${RABBITMQ_DEFAULT_PASS:?RABBITMQ_DEFAULT_PASS is required}
   LEDGER_RABBIT_VHOST: ${RABBITMQ_DEFAULT_VHOST:-/ledgerguard}

-x-ledger-process: &ledger-process
-  image: ${LEDGER_IMAGE:-ledgerguard-local:dev}
-  restart: unless-stopped
+x-service-security: &service-security
   read_only: true
   tmpfs:
     - /tmp
   security_opt:
     - no-new-privileges:true
+  restart: unless-stopped
+  stop_grace_period: 25s
   networks:
     - ledgerguard

@@ -73,15 +73,20 @@
       - ledgerguard

   api:
-    <<: *ledger-process
+    <<: *service-security
     build:
       context: .
       dockerfile: infra/docker/Dockerfile.backend
     environment:
-      <<: *ledger-runtime-environment
+      <<: *ledger-runtime
       SPRING_PROFILES_ACTIVE: sandbox
-      LEDGER_SANDBOX_HTTP: "true"
-      LEDGER_AUTH_KEY: ${LEDGER_AUTH_KEY:?LEDGER_AUTH_KEY is required}
+      LEDGER_PROCESS_NAME: LedgerGuard-API
+      LEDGER_MIGRATION_URL: jdbc:postgresql://postgres:5432/${POSTGRES_DB:-ledgerguard}
+      LEDGER_OWNER_USER: ledger_owner
+      LEDGER_OWNER_PASSWORD: ${LEDGER_OWNER_PASSWORD:?LEDGER_OWNER_PASSWORD is required}
+      LEDGER_MESSAGING_ENABLED: "false"
+      LEDGER_OUTBOX_PUBLISHER_ENABLED: "false"
+      LEDGER_PAYMENT_WORKER_ENABLED: "false"
     ports:
       - "127.0.0.1:${LEDGER_HTTP_PORT:-8080}:8080"
     depends_on:
@@ -94,13 +99,21 @@
       retries: 30
       start_period: 20s

-  publisher:
-    <<: *ledger-process
+  outbox-publisher:
+    <<: *service-security
+    build:
+      context: .
+      dockerfile: infra/docker/Dockerfile.backend
     environment:
-      <<: *ledger-runtime-environment
-      SPRING_PROFILES_ACTIVE: publisher
-      LEDGER_DATABASE_POOL_SIZE: 4
-      LEDGER_INSTANCE_ID: publisher-1
+      <<: [*ledger-runtime, *ledger-rabbit]
+      SPRING_PROFILES_ACTIVE: sandbox
+      SPRING_MAIN_WEB_APPLICATION_TYPE: none
+      LEDGER_PROCESS_NAME: LedgerGuard-Outbox
+      LEDGER_FLYWAY_ENABLED: "false"
+      LEDGER_MESSAGING_ENABLED: "true"
+      LEDGER_OUTBOX_PUBLISHER_ENABLED: "true"
+      LEDGER_PAYMENT_WORKER_ENABLED: "false"
+      LEDGER_DATABASE_POOL_SIZE: 6
     depends_on:
       api:
         condition: service_healthy
@@ -108,12 +121,20 @@
         condition: service_healthy

   payment-worker-a:
-    <<: *ledger-process
+    <<: *service-security
+    build:
+      context: .
+      dockerfile: infra/docker/Dockerfile.backend
     environment:
-      <<: *ledger-runtime-environment
-      SPRING_PROFILES_ACTIVE: worker
+      <<: [*ledger-runtime, *ledger-rabbit]
+      SPRING_PROFILES_ACTIVE: sandbox
+      SPRING_MAIN_WEB_APPLICATION_TYPE: none
+      LEDGER_PROCESS_NAME: LedgerGuard-Worker-A
+      LEDGER_FLYWAY_ENABLED: "false"
+      LEDGER_MESSAGING_ENABLED: "true"
+      LEDGER_OUTBOX_PUBLISHER_ENABLED: "false"
+      LEDGER_PAYMENT_WORKER_ENABLED: "true"
       LEDGER_DATABASE_POOL_SIZE: 8
-      LEDGER_INSTANCE_ID: payment-worker-a
     depends_on:
       api:
         condition: service_healthy
@@ -121,12 +142,20 @@
         condition: service_healthy

   payment-worker-b:
-    <<: *ledger-process
+    <<: *service-security
+    build:
+      context: .
+      dockerfile: infra/docker/Dockerfile.backend
     environment:
-      <<: *ledger-runtime-environment
-      SPRING_PROFILES_ACTIVE: worker
+      <<: [*ledger-runtime, *ledger-rabbit]
+      SPRING_PROFILES_ACTIVE: sandbox
+      SPRING_MAIN_WEB_APPLICATION_TYPE: none
+      LEDGER_PROCESS_NAME: LedgerGuard-Worker-B
+      LEDGER_FLYWAY_ENABLED: "false"
+      LEDGER_MESSAGING_ENABLED: "true"
+      LEDGER_OUTBOX_PUBLISHER_ENABLED: "false"
+      LEDGER_PAYMENT_WORKER_ENABLED: "true"
       LEDGER_DATABASE_POOL_SIZE: 8
-      LEDGER_INSTANCE_ID: payment-worker-b
     depends_on:
       api:
         condition: service_healthy

```

### docs/architecture/adr/0014-p05-asynchronous-payments.md

REVIEW_DIFFERENCE

```diff
--- branch/docs/architecture/adr/0014-p05-asynchronous-payments.md
+++ main-history/docs/architecture/adr/0014-p05-asynchronous-payments.md
@@ -1,114 +1,41 @@
-# ADR 0014 — P05 asynchronous payments, transactional outbox and recoverable workers
+# ADR 0014 — P05 asynchronous payment, outbox and worker boundary

-- Status: Accepted for P05
-- Date: 2026-09-26
-- Scope: payment acceptance, RabbitMQ publication/consumption, settlement, projection and failed-work recovery
-- Boundary: synthetic money laboratory; not a production payment processor
-
-## Context
-
-P04 proved immediate PostgreSQL transactions and durable HTTP idempotency. P05 adds an intentionally asynchronous path without weakening PostgreSQL as the only spending authority. The accepted HTTP request must survive API, publisher, broker and worker failures. RabbitMQ delivery is not exactly once, so duplicate delivery is expected and must be harmless.
-
-The V1/V2 schema already contained the economic primitives: `payments`, `holds`, `outbox_events`, `consumer_inbox`, `payment_projection`, protected posting and `settle_event`. P05 activates those primitives through separate application processes and adds missing lease/recovery and failed-work controls in additive migration V7. Historical migrations V1–V6 remain immutable.
+Status: implemented candidate; verification evidence must come from the P05 GitHub Actions lane before this decision is marked verified. The full product remains NO_GO.

 ## Decision

-### Acceptance transaction
+Payment acceptance remains a synchronous PostgreSQL transaction, while settlement is asynchronous durable work. `POST /api/v1/payments` calls the protected `PAYMENT` command through the same restricted JDBC adapter used by immediate transfers. Acceptance creates one `PENDING` payment, one `ACTIVE` hold, the durable idempotency response, financial audit and a `payment.requested` outbox row atomically. It returns `202` only after commit and does not create a journal.

-`POST /api/v1/payments` calls the protected PostgreSQL command boundary. One commit creates:
+The API does not connect its readiness to RabbitMQ. Authentication, account reads, immediate transfers and durable payment acceptance remain available while the broker is down. RabbitMQ connectivity belongs to separately restartable publisher/worker processes.

-1. a canonical `PENDING` payment;
-2. an `ACTIVE` hold and matching increase in `reserved_minor`;
-3. the durable idempotency result;
-4. an append-only audit record; and
-5. a `payment.requested` outbox event with a stable event ID.
+## Publication

-The API returns `202 Accepted` only after that commit. No payment journal exists yet. A broker outage therefore cannot lose accepted intent and does not make authentication, account reads or immediate transfers unavailable.
+An independent outbox process claims bounded due rows with PostgreSQL `FOR UPDATE SKIP LOCKED`, a unique lease owner and an expiring lease. It publishes a stable full-snapshot envelope using the outbox UUID as the RabbitMQ message ID, persistent delivery mode, a durable exchange/queue topology, mandatory routing and correlated publisher confirms. `published_at` is written only after broker acknowledgement and the absence of a returned/unroutable message.

-### Process separation
+Death after confirmation but before the database mark leaves the claim leased. Expiry permits republication with the same event ID. This intentionally provides at-least-once delivery rather than claiming exactly-once RabbitMQ delivery.

-The same immutable application image runs with three roles:
+## Consumption and financial authority

-- `sandbox`: HTTP API and Flyway migration owner boundary;
-- `publisher`: non-web outbox publisher; and
-- `worker`: non-web RabbitMQ consumers.
+Two independent worker services compete on the same settlement queue with bounded prefetch and manual acknowledgement. The worker calls the existing protected `settle_event` transaction. That transaction locks the payment, inserts `(payment-settler-v1,event_id)` into the consumer inbox, consumes the hold, posts through the protected double-entry function, changes the payment to `SETTLED`, writes audit/outbox state and commits as one unit. A duplicate event ID returns `DUPLICATE`; a logically repeated message with a different event ID observes the non-`PENDING` payment and cannot post again.

-Compose runs one publisher and two independently restartable worker instances. The API depends on PostgreSQL only. Publisher and workers depend on RabbitMQ and the migrated API boundary.
+The Rabbit delivery is acknowledged only after the PostgreSQL transaction returns from commit. Process death after commit but before acknowledgement therefore causes a safe redelivery and never a second journal. Permanent pre-posting business failure releases the hold and records `FAILED`; transport or broker failures do not relabel an already committed payment.

-### Outbox claim and publication
+## Retry, poison work and replay

-Publishers claim due rows through `ledger.claim_outbox` using:
+Transient consumer failures are republished with confirms to consumer-specific durable delay queues. Retry count and delay are bounded; main queues do not use an immediate nack/requeue loop for application failures. Malformed or exhausted work is stored in `failed_work`, rejected to a durable dead-letter queue and exposed to ADMIN inspection.

-- a bounded batch;
-- `FOR UPDATE SKIP LOCKED`;
-- a random process lease owner;
-- an expiring lease; and
-- an incremented attempt counter.
+An administrator may request replay through a protected API. The request and completion are append-only audited. The publisher republishes the retained event/message identity; replay is not a new payment instruction. A replay failure returns the work to `FAILED` rather than looping indefinitely.

-Messages use the outbox UUID as `message_id`, a versioned full event envelope, persistent delivery mode, a durable topic exchange and durable bounded queues. The publisher requires correlated broker confirmation and mandatory routing. `published_at` is set only when the broker confirms and the message was routable.
+## Projection and recovery

-A crash after confirmation but before `published_at` intentionally permits republishing the same event ID after lease expiry. This is at-least-once transport, not exactly-once transport.
+The payment projection is explicitly observational and cannot authorize spending. Its consumer deduplicates in the same database transaction as projection update. Full snapshots apply only when aggregate version increases; older events and invalid terminal-state transitions cannot regress state.

-### Settlement consumer
+Periodic recovery scans bounded stale `PENDING` payments. It reactivates the original `payment.requested` outbox row—preserving its event ID—or reconstructs a missing row from authoritative payment state. Expired publisher/replay leases are reclaimable. Recovery may reschedule durable work but never invent balances, delete history or post outside the protected financial command.

-The settlement queue receives `payment.requested`. Workers validate the envelope and call `ledger.settle_event` in a fresh PostgreSQL transaction. That transaction:
+## Proof boundary

-- locks the payment and balances in the established order;
-- inserts `(consumer,event_id)` into `consumer_inbox`;
-- consumes the active hold;
-- removes the reservation;
-- posts exactly one balanced payment journal;
-- advances the payment to `SETTLED` or records a durable pre-posting `FAILED` result;
-- appends audit; and
-- writes the next outbox event.
+The P05 lane must exercise real PostgreSQL, RabbitMQ, the API, one publisher and two workers. Required proofs include broker-down acceptance, publisher death after confirm, worker death after commit, duplicate delivery with another message ID, stale projection delivery, poison-message inspection/replay and independent reconciliation. Unit tests or mocked broker calls alone are not sufficient.

-The RabbitMQ delivery is manually acknowledged only after the database transaction returns from commit. A process death after commit but before acknowledgement causes redelivery; the inbox identity and payment state prevent another posting. A logically repeated command with a different message ID is also harmless because only `PENDING` can settle.
+## Limits

-### Projection
-
-Payment events are full snapshots. `payment_projection` accepts only a strictly higher aggregate version and never overwrites a terminal state with a different state. Duplicate and lower-version events are recorded/ignored transactionally. Projection data is read-model evidence only and is never consulted for balance, hold or posting authority.
-
-Two workers also run bounded projection repair from the authoritative `payments` table. Repair can advance a missing/lagging projection but cannot change financial state.
-
-### Poison work and replay
-
-Consumers never use a hot `nack/requeue` loop. Invalid messages are:
-
-1. recorded in bounded `failed_messages` metadata/body storage;
-2. rejected with `requeue=false`; and
-3. dead-lettered to the durable failed-work queue.
-
-The ADMIN API exposes redacted metadata, not raw bodies or headers. An authorized replay requires a reason, resets the original outbox event for publication, preserves the original event/payment identity and appends an audit record. Replay is not a new payment command.
-
-### Recovery
-
-Recovery covers:
-
-- expired publisher leases;
-- transient publisher failures with bounded exponential delay;
-- a published `payment.requested` event whose payment remains `PENDING` beyond the configured threshold;
-- duplicate/redelivered consumer work; and
-- missing/lagging payment projections.
-
-Recovery may republish durable work. It never invents balances, edits journals or deletes history.
-
-## Invariants
-
-- `posted_minor >= reserved_minor >= 0`.
-- An accepted pending payment has exactly one active hold and no journal.
-- A settled payment has a consumed hold and exactly one payment journal whose operation ID is the payment ID.
-- A failed/cancelled pre-settlement payment has a released hold and no payment journal.
-- Event IDs remain stable across outbox republishing.
-- A consumer acknowledges only after its durable database effect commits.
-- A duplicate event or logical duplicate cannot create a second committed financial effect.
-- Older projection versions cannot overwrite newer versions.
-- The API remains ready when RabbitMQ is unavailable.
-- Runtime credentials cannot directly mutate outbox, inbox, projection or failed-work tables.
-
-## Verification
-
-`PaymentMessagingIT` uses real PostgreSQL and RabbitMQ containers plus separate API, publisher and worker JVMs. It proves atomic acceptance/replay, real settlement, duplicate identities, broker outage/recovery, worker death after commit, publisher death after confirmation, projection ordering, poison inspection, audited replay, authorization and restricted-role enforcement. Compose then repeats an end-to-end payment journey through one publisher and two workers before independent reconciliation.
-
-## Consequences
-
-The design favors explicit, auditable PostgreSQL functions and a small number of restartable processes over a microservice fleet. Temporary broker failure increases payment latency but not loss or double spending. Duplicate messages and repeat publication are normal operating cases. P06 may add cancellation/refund/reversal races on top of this boundary, but must preserve these identities, lock order and acknowledgement rules.
+P05 does not complete cancellation/refund/reversal HTTP workflows, schedules, signed webhooks, React/browser journeys, the seeded defect/fault laboratory, performance/security release lanes or final evidence/video. Those remain P06–P11.

```

### docs/implementation/P05_REQUIREMENTS.json

REVIEW_DIFFERENCE

```diff
--- branch/docs/implementation/P05_REQUIREMENTS.json
+++ main-history/docs/implementation/P05_REQUIREMENTS.json
@@ -1,79 +1,186 @@
 {
   "phase": "P05",
   "sourceContract": "docs/implementation/MASTER_SPEC.md",
-  "scope": "Asynchronous payment acceptance and fund reservation, leased PostgreSQL outbox publication, durable RabbitMQ transport, two restartable settlement workers, consumer inbox deduplication, version-aware status projection, broker/worker/publisher recovery, poison-message inspection and audited replay. Cancellation, refunds and reversal remain P06.",
+  "scope": "Asynchronous payment acceptance and holds, PostgreSQL transactional outbox, durable RabbitMQ publication, two restartable manual-ack workers, inbox/business deduplication, monotonic status projection, recovery, failed-work inspection and audited replay. P06 adjustments and P07-P11 remain later phases.",
   "requirements": [
     {
       "id": "P05-R01",
-      "sections": ["3", "8", "9", "14"],
-      "statement": "An authenticated CUSTOMER payment command atomically commits one PENDING payment, ACTIVE hold, idempotency outcome, audit record and payment.requested outbox event before returning 202 and a stable Location.",
-      "tests": {"PaymentMessagingIT": ["P0501"]}
+      "sections": [
+        "3",
+        "8",
+        "9"
+      ],
+      "statement": "An authenticated CUSTOMER payment command atomically persists one PENDING payment, ACTIVE hold, idempotency outcome, audit record and payment.requested outbox event, returns 202/Location, and posts no journal at acceptance.",
+      "tests": {
+        "TransferReliabilityIT": [
+          "P0501"
+        ],
+        "payment-client": [
+          "P05TS01"
+        ],
+        "compose": [
+          "payment-accepted-without-publisher",
+          "acceptance-reserves-without-posting",
+          "acceptance-atomic-artifacts"
+        ]
+      }
     },
     {
       "id": "P05-R02",
-      "sections": ["8", "9"],
-      "statement": "Identical payment intent and key replay the original accepted resource while changed economic intent returns conflict without creating another payment or reservation.",
-      "tests": {"PaymentMessagingIT": ["P0501"]}
+      "sections": [
+        "7",
+        "8",
+        "9"
+      ],
+      "statement": "Payment intent is durably replayable by actor/kind/key and normalized economics; changed intent conflicts and concurrent reservations cannot exceed available funds.",
+      "tests": {
+        "TransferReliabilityIT": [
+          "P0501",
+          "P0502",
+          "P0503"
+        ],
+        "payment-client": [
+          "P05TS02",
+          "P05TS03"
+        ]
+      }
     },
     {
       "id": "P05-R03",
-      "sections": ["10"],
-      "statement": "Independent publishers claim bounded outbox batches with expiring leases, publish persistent stable event identities through a durable topology, require broker confirmation/routing, and mark publication only after confirmation.",
-      "tests": {"PaymentMessagingIT": ["P0501", "P0505"]}
+      "sections": [
+        "10"
+      ],
+      "statement": "A leased outbox publisher uses persistent routed messages and broker confirms, marks publication only after confirmation, and safely republishes the stable event ID after process death between confirmation and database marking.",
+      "tests": {
+        "compose": [
+          "publisher-process-died-after-confirm",
+          "crash-after-confirm-republish-one-effect"
+        ]
+      }
     },
     {
       "id": "P05-R04",
-      "sections": ["9", "10"],
-      "statement": "Settlement consumes the hold, posts exactly one balanced journal, updates payment state and audit/outbox data in one PostgreSQL transaction, then acknowledges RabbitMQ only after commit.",
-      "tests": {"PaymentMessagingIT": ["P0501", "P0504"]}
+      "sections": [
+        "9",
+        "10"
+      ],
+      "statement": "Workers acknowledge only after the settlement transaction commits; death after commit but before acknowledgement redelivers safely through the consumer inbox and payment identity without a second journal.",
+      "tests": {
+        "PostgresFinancialIT": [
+          "PG06"
+        ],
+        "compose": [
+          "worker-process-died-after-commit",
+          "worker-redelivery-one-financial-effect"
+        ]
+      }
     },
     {
       "id": "P05-R05",
-      "sections": ["10"],
-      "statement": "A worker crash after PostgreSQL commit but before broker acknowledgement produces safe redelivery and no second journal or financial effect.",
-      "tests": {"PaymentMessagingIT": ["P0504"]}
+      "sections": [
+        "4",
+        "10"
+      ],
+      "statement": "RabbitMQ outage does not take down the PostgreSQL-backed API or immediate transfers; accepted payment work remains pending and drains after broker recovery.",
+      "tests": {
+        "TransferReliabilityIT": [
+          "P0504"
+        ],
+        "compose": [
+          "api-ready-during-broker-outage",
+          "durable-payment-during-broker-outage",
+          "immediate-transfer-during-broker-outage",
+          "broker-recovery-drains-backlog"
+        ]
+      }
     },
     {
       "id": "P05-R06",
-      "sections": ["10"],
-      "statement": "A publisher crash after broker confirmation but before marking the outbox row sent recovers its lease and republishes the same stable event identity without duplicating settlement.",
-      "tests": {"PaymentMessagingIT": ["P0505"]}
+      "sections": [
+        "10"
+      ],
+      "statement": "Duplicate delivery and a logically repeated command carrying a different message ID cannot create another committed payment effect.",
+      "tests": {
+        "PostgresFinancialIT": [
+          "PG06"
+        ],
+        "compose": [
+          "different-message-id-cannot-repeat-payment"
+        ]
+      }
     },
     {
       "id": "P05-R07",
-      "sections": ["4", "10", "17"],
-      "statement": "RabbitMQ loss does not make the database-backed API or immediate transfers unavailable; accepted payments retain their durable holds and settle after broker recovery.",
-      "tests": {"PaymentMessagingIT": ["P0503"]}
+      "sections": [
+        "10"
+      ],
+      "statement": "The payment-status projection applies full snapshots by aggregate version, deduplicates events and cannot be regressed by an older or invalid transition.",
+      "tests": {
+        "PostgresFinancialIT": [
+          "PG12"
+        ],
+        "compose": [
+          "rabbit-settlement-and-projection",
+          "old-event-cannot-regress-projection"
+        ]
+      }
     },
     {
       "id": "P05-R08",
-      "sections": ["10"],
-      "statement": "Duplicate deliveries and logically repeated settlement commands carrying a different message identity cannot create a second financial posting.",
-      "tests": {"PaymentMessagingIT": ["P0502", "P0504", "P0505"]}
+      "sections": [
+        "10",
+        "13"
+      ],
+      "statement": "Malformed or retry-exhausted messages are bounded and inspectable; ADMIN replay is authorized, audited and republishes the original event identity rather than creating a new payment.",
+      "tests": {
+        "PostgresFinancialIT": [
+          "PG13"
+        ],
+        "compose": [
+          "poison-work-admin-inspection",
+          "audited-replay-request",
+          "poison-replay-remains-bounded"
+        ]
+      }
     },
     {
       "id": "P05-R09",
-      "sections": ["10"],
-      "statement": "The asynchronous payment projection applies full snapshots by aggregate version, ignores duplicate/older events, cannot regress a terminal state, and is not used as spending authority.",
-      "tests": {"PaymentMessagingIT": ["P0501", "P0502"]}
+      "sections": [
+        "4",
+        "7",
+        "10"
+      ],
+      "statement": "The real Compose topology runs an independently restartable publisher and at least two competing payment workers against durable PostgreSQL and RabbitMQ infrastructure.",
+      "tests": {
+        "compose": [
+          "two-independent-workers-running",
+          "worker-a-settles-independently",
+          "worker-b-settles-independently",
+          "rabbit-settlement-and-projection"
+        ]
+      }
     },
     {
       "id": "P05-R10",
-      "sections": ["10", "13"],
-      "statement": "Malformed or unsupported work is durably recorded and dead-lettered without a hot requeue loop; administrators can inspect and audit a replay that preserves the original event/payment identity.",
-      "tests": {"PaymentMessagingIT": ["P0506"]}
-    },
-    {
-      "id": "P05-R11",
-      "sections": ["6", "9", "13"],
-      "statement": "Payment reads are payer/recipient scoped, ADMIN cannot spend as a customer, and the restricted runtime role cannot directly mutate protected outbox, inbox, projection or failed-work state.",
-      "tests": {"PaymentMessagingIT": ["P0501", "P0507"]}
-    },
-    {
-      "id": "P05-R12",
-      "sections": ["14", "15", "24"],
-      "statement": "The P05 OpenAPI contract and executable Compose topology expose exact-string money, asynchronous payment resources, failed-work replay, one publisher and at least two independent workers while preserving all P01-P04 regressions.",
-      "tests": {"PaymentMessagingIT": ["P0507"]}
+      "sections": [
+        "13",
+        "14",
+        "15"
+      ],
+      "statement": "Payment reads are owner/relevant-party scoped without private counterparty UUID disclosure, runtime SQL cannot forge payments, and the P05 OpenAPI/client preserve exact string money and uncertain intent.",
+      "tests": {
+        "TransferReliabilityIT": [
+          "P0505"
+        ],
+        "payment-client": [
+          "P05TS04",
+          "P05TS05"
+        ],
+        "compose": [
+          "recipient-can-read-payment-without-private-source-id",
+          "administrator-cannot-create-payment"
+        ]
+      }
     }
   ]
 }

```

### scripts/assert-p05-evidence

REVIEW_DIFFERENCE

```diff
--- branch/scripts/assert-p05-evidence
+++ main-history/scripts/assert-p05-evidence
@@ -1,127 +1,87 @@
 #!/usr/bin/env python3
-"""Require passing P01-P05 suites and derive traceability from executed XML."""
-from __future__ import annotations
-
+"""Require passing P01-P05 suites and bind scoped requirements to executed evidence."""
 import json
 import subprocess
 import xml.etree.ElementTree as ET
-from datetime import datetime, timezone
+from datetime import datetime,timezone
 from pathlib import Path

-ROOT = Path(__file__).resolve().parent.parent
-REQUIRED = {
-    "backend/target/surefire-reports/TEST-lab.ledgerguard.CoreTest.xml": ("CoreTest", 120),
-    "backend/target/surefire-reports/TEST-lab.ledgerguard.SecuritySettingsTest.xml": ("SecuritySettingsTest", 13),
-    "backend/target/failsafe-reports/TEST-lab.ledgerguard.PostgresFinancialIT.xml": ("PostgresFinancialIT", 11),
-    "backend/target/failsafe-reports/TEST-lab.ledgerguard.AuthenticationAccountsIT.xml": ("AuthenticationAccountsIT", 58),
-    "backend/target/failsafe-reports/TEST-lab.ledgerguard.TransferReliabilityIT.xml": ("TransferReliabilityIT", 20),
-    "backend/target/failsafe-reports/TEST-lab.ledgerguard.PaymentMessagingIT.xml": ("PaymentMessagingIT", 7),
-    ".evidence/client/results.xml": ("client", 44),
-    ".evidence/client/auth-results.xml": ("auth-client", 6),
-    ".evidence/client/transfer-results.xml": ("transfer-client", 7),
+ROOT=Path(__file__).resolve().parent.parent
+REQUIRED={
+ "backend/target/surefire-reports/TEST-lab.ledgerguard.CoreTest.xml":("CoreTest",120),
+ "backend/target/surefire-reports/TEST-lab.ledgerguard.SecuritySettingsTest.xml":("SecuritySettingsTest",13),
+ "backend/target/failsafe-reports/TEST-lab.ledgerguard.PostgresFinancialIT.xml":("PostgresFinancialIT",13),
+ "backend/target/failsafe-reports/TEST-lab.ledgerguard.AuthenticationAccountsIT.xml":("AuthenticationAccountsIT",58),
+ "backend/target/failsafe-reports/TEST-lab.ledgerguard.TransferReliabilityIT.xml":("TransferReliabilityIT",28),
+ ".evidence/client/results.xml":("client",44),
+ ".evidence/client/auth-results.xml":("auth-client",6),
+ ".evidence/client/transfer-results.xml":("transfer-client",7),
+ ".evidence/client/payment-results.xml":("payment-client",5),
 }
+rows=[];executed={}
+for relative,(suite_name,minimum) in REQUIRED.items():
+ path=ROOT/relative
+ if not path.is_file():raise SystemExit(f"Missing required test result: {relative}")
+ suite=ET.parse(path).getroot();counts={key:int(suite.get(key,"0")) for key in ("tests","failures","errors","skipped")};cases=suite.findall(".//testcase")
+ if counts["tests"]<minimum or len(cases)!=counts["tests"]:raise SystemExit(f"Missing expected discovery: {relative}: {counts}, cases={len(cases)}")
+ if any(counts[key] for key in ("failures","errors","skipped")):raise SystemExit(f"Required suite did not pass without skips: {relative}: {counts}")
+ for case in cases:
+  if any(case.find(tag) is not None for tag in ("failure","error","skipped")):raise SystemExit(f"Non-passing test case: {relative}: {case.get('name')}")
+ executed[suite_name]=[case.get("name","") for case in cases];rows.append({"suite":relative,**counts})

-rows: list[dict[str, object]] = []
-executed: dict[str, list[str]] = {}
-for relative, (suite_name, minimum) in REQUIRED.items():
-    path = ROOT / relative
-    if not path.is_file():
-        raise SystemExit(f"Missing required test result: {relative}")
-    suite = ET.parse(path).getroot()
-    counts = {key: int(suite.get(key, "0")) for key in ("tests", "failures", "errors", "skipped")}
-    cases = suite.findall(".//testcase")
-    if counts["tests"] < minimum or len(cases) != counts["tests"]:
-        raise SystemExit(f"Missing expected discovery: {relative}: {counts}, cases={len(cases)}")
-    if any(counts[key] for key in ("failures", "errors", "skipped")):
-        raise SystemExit(f"Required suite did not pass without skips: {relative}: {counts}")
-    for case in cases:
-        if any(case.find(tag) is not None for tag in ("failure", "error", "skipped")):
-            raise SystemExit(f"Non-passing test case: {relative}: {case.get('name')}")
-    executed[suite_name] = [case.get("name", "") for case in cases]
-    rows.append({"suite": relative, **counts})
+compose_path=ROOT/".evidence/payment-compose/results.json"
+if not compose_path.is_file():raise SystemExit("Missing real P05 Compose evidence")
+compose=json.loads(compose_path.read_text(encoding="utf-8"))
+if not compose.get("checks") or any(item.get("status")!="PASS" for item in compose["checks"]):raise SystemExit("P05 Compose evidence contains non-passing checks")
+executed["compose"]=[item["test"] for item in compose["checks"]]
+rows.append({"suite":str(compose_path.relative_to(ROOT)),"tests":len(executed["compose"]),"failures":0,"errors":0,"skipped":0})

-traceability: list[dict[str, object]] = []
-for manifest_name in ("P03_REQUIREMENTS.json", "P04_REQUIREMENTS.json", "P05_REQUIREMENTS.json"):
-    manifest = json.loads((ROOT / "docs/implementation" / manifest_name).read_text(encoding="utf-8"))
-    if not (ROOT / manifest["sourceContract"]).is_file():
-        raise SystemExit(f"Missing source contract for {manifest_name}")
-    seen: set[str] = set()
-    for requirement in manifest["requirements"]:
-        identity = requirement["id"]
-        if identity in seen:
-            raise SystemExit(f"Duplicate requirement in {manifest_name}: {identity}")
-        seen.add(identity)
-        matches = []
-        for suite_name, prefixes in requirement["tests"].items():
-            for prefix in prefixes:
-                actual = [name for name in executed.get(suite_name, [])
-                          if name.startswith(prefix + "_") or name.startswith(prefix + "-")]
-                if not actual:
-                    raise SystemExit(f"No executed oracle for {identity}: {suite_name}/{prefix}")
-                matches.extend({"suite": suite_name, "test": name} for name in actual)
-        traceability.append({"id": identity, "phase": manifest["phase"], "statement": requirement["statement"],
-                             "status": "VERIFIED_PASS", "tests": matches})
+def match(prefix,name):return name==prefix or name.startswith(prefix+"_") or name.startswith(prefix+"-") or name.startswith(prefix+"[")
+traceability=[]
+for manifest_name in ("P03_REQUIREMENTS.json","P04_REQUIREMENTS.json","P05_REQUIREMENTS.json"):
+ manifest=json.loads((ROOT/"docs/implementation"/manifest_name).read_text(encoding="utf-8"))
+ if not (ROOT/manifest["sourceContract"]).is_file():raise SystemExit(f"Missing source contract for {manifest_name}")
+ seen=set()
+ for requirement in manifest["requirements"]:
+  identity=requirement["id"]
+  if identity in seen:raise SystemExit(f"Duplicate requirement in {manifest_name}: {identity}")
+  seen.add(identity);matches=[]
+  for suite_name,prefixes in requirement["tests"].items():
+   for prefix in prefixes:
+    actual=[name for name in executed.get(suite_name,[]) if match(prefix,name)]
+    if not actual:raise SystemExit(f"No executed oracle for {identity}: {suite_name}/{prefix}")
+    matches.extend({"suite":suite_name,"test":name} for name in actual)
+  traceability.append({"id":identity,"phase":manifest["phase"],"statement":requirement["statement"],"status":"VERIFIED_PASS","tests":matches})

-spec = json.loads((ROOT / "backend/src/main/resources/openapi/p05.json").read_text(encoding="utf-8"))
-required_paths = {
-    "/api/v1/payments", "/api/v1/payments/{id}", "/api/v1/admin/failed-work",
-    "/api/v1/admin/failed-work/{id}", "/api/v1/admin/failed-work/{id}/replay",
-}
-missing_paths = sorted(required_paths - set(spec.get("paths", {})))
-if missing_paths:
-    raise SystemExit(f"P05 OpenAPI missing paths: {missing_paths}")
-if spec.get("info", {}).get("version") != "0.5.0":
-    raise SystemExit("P05 OpenAPI version must be 0.5.0")
-
+p04=json.loads((ROOT/"backend/src/main/resources/openapi/p04.json").read_text(encoding="utf-8"))
+if "/api/v1/payments" in p04["paths"]:raise SystemExit("P04 compatibility contract must not claim P05")
+spec=json.loads((ROOT/"backend/src/main/resources/openapi/p05.json").read_text(encoding="utf-8"))
+for path in ("/api/v1/payments","/api/v1/payments/{id}","/api/v1/admin/failed-work","/api/v1/admin/failed-work/{id}/replay"):
+ if path not in spec["paths"]:raise SystemExit(f"P05 OpenAPI missing {path}")
 def validate_refs(value):
-    if isinstance(value, dict):
-        ref = value.get("$ref")
-        if ref:
-            if not ref.startswith("#/"):
-                raise SystemExit(f"Unexpected external OpenAPI reference: {ref}")
-            target = spec
-            for part in ref[2:].split("/"):
-                target = target[part.replace("~1", "/").replace("~0", "~")]
-        for child in value.values():
-            validate_refs(child)
-    elif isinstance(value, list):
-        for child in value:
-            validate_refs(child)
+ if isinstance(value,dict):
+  ref=value.get("$ref")
+  if ref:
+   if not ref.startswith("#/"):raise SystemExit(f"Unexpected external OpenAPI reference: {ref}")
+   target=spec
+   for part in ref[2:].split("/"):target=target[part.replace("~1","/").replace("~0","~")]
+  for child in value.values():validate_refs(child)
+ elif isinstance(value,list):
+  for child in value:validate_refs(child)
 validate_refs(spec)

-for migration in range(1, 8):
-    candidates = list((ROOT / "backend/src/main/resources/db/migration").glob(f"V{migration}__*.sql"))
-    if len(candidates) != 1:
-        raise SystemExit(f"Expected exactly one V{migration} migration, found {len(candidates)}")
-
-compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
-for service in ("publisher:", "payment-worker-a:", "payment-worker-b:"):
-    if f"  {service}" not in compose:
-        raise SystemExit(f"Compose missing P05 service: {service[:-1]}")
-if "depends_on:\n      rabbitmq:" in compose.split("  api:", 1)[1].split("  publisher:", 1)[0]:
-    raise SystemExit("P05 API must not depend on RabbitMQ readiness")
-
-sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
-dirty = bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"],
-                                     cwd=ROOT, text=True).strip())
-report = {
-    "sourceSha": sha,
-    "trackedTreeDirty": dirty,
-    "timestamp": datetime.now(timezone.utc).isoformat(),
-    "status": "VERIFIED_PASS",
-    "suites": rows,
-    "requirements": traceability,
-    "scope": "P01-P05 fast-lane regressions and asynchronous payment reliability; not P06-P11 or release readiness",
-}
-out = ROOT / ".evidence/p05"
-out.mkdir(parents=True, exist_ok=True)
-(out / "test-summary.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
-matrix = ["# Executed P03/P04/P05 requirements", "", f"Source: `{sha}`; tracked tree dirty: `{dirty}`.", "",
-          "| Requirement | Phase | Executed cases | Result |", "|---|---|---:|---|"]
-for item in traceability:
-    matrix.append(f"| {item['id']} | {item['phase']} | {len(item['tests'])} | {item['status']} |")
-matrix.extend(["", "Exact case names and source identity are in test-summary.json.",
-               "Requirements share tests; counts must not be summed as unique cases."])
-(out / "requirements-matrix.md").write_text("\n".join(matrix) + "\n", encoding="utf-8")
-print(json.dumps({key: value for key, value in report.items() if key != "requirements"}, indent=2))
-print(f"Verified {len(traceability)} scoped requirements against executed test cases.")
+for relative in (
+ "backend/src/main/java/lab/ledgerguard/messaging/OutboxPublisher.java",
+ "backend/src/main/java/lab/ledgerguard/messaging/ReliableEventConsumers.java",
+ "backend/src/main/resources/db/migration/V7__p05_async_payment_reliability.sql",
+):
+ if not (ROOT/relative).is_file():raise SystemExit(f"Missing P05 implementation source: {relative}")
+sha=subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()
+dirty=bool(subprocess.check_output(["git","status","--porcelain","--untracked-files=no"],cwd=ROOT,text=True).strip())
+report={"sourceSha":sha,"trackedTreeDirty":dirty,"timestamp":datetime.now(timezone.utc).isoformat(),"status":"VERIFIED_PASS","suites":rows,"requirements":traceability,"scope":"P01-P05 fast lane with real Compose outbox/RabbitMQ/two-worker crash, duplicate, projection and replay proofs; not P06-P11 or release readiness"}
+out=ROOT/".evidence/p05";out.mkdir(parents=True,exist_ok=True);(out/"test-summary.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
+matrix=["# Executed P03/P04/P05 requirements","",f"Source: `{sha}`; tracked tree dirty: `{dirty}`.","","| Requirement | Phase | Executed cases/checks | Result |","|---|---|---:|---|"]
+for item in traceability:matrix.append(f"| {item['id']} | {item['phase']} | {len(item['tests'])} | {item['status']} |")
+matrix.extend(["","Exact case/check names and source identity are in test-summary.json.","Requirements share tests; counts must not be summed as unique cases."])
+(out/"requirements-matrix.md").write_text("\n".join(matrix)+"\n",encoding="utf-8")
+print(json.dumps({key:value for key,value in report.items() if key!="requirements"},indent=2));print(f"Verified {len(traceability)} scoped requirements against executed evidence.")

```

### scripts/lab

REVIEW_DIFFERENCE

```diff
--- branch/scripts/lab
+++ main-history/scripts/lab
@@ -33,14 +33,12 @@
   ./scripts/lab test database
   ./scripts/lab test auth
   ./scripts/lab test transfer
-  ./scripts/lab test payment
   ./scripts/lab test pr
   ./scripts/lab reconcile
   ./scripts/lab evidence

-P05 provides authentication, accounts, immediate transfers and asynchronous payments
-through a leased PostgreSQL outbox, RabbitMQ and two restartable workers. Adjustments,
-webhooks, schedules, React and release-laboratory phases remain explicit blockers.
+P04 provides authentication, accounts and immediate transfers. Later payment worker,
+webhook, schedule, React and release-laboratory phases remain explicit blockers.
 """

 def run(command: list[str], *, check: bool = True, capture: bool = False, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
@@ -98,17 +96,6 @@
         except (urllib.error.URLError,OSError,json.JSONDecodeError) as failure: latest=f"{type(failure).__name__}: {failure}"
         time.sleep(2)
     raise RuntimeError(f"LedgerGuard did not become ready: {latest}")
-
-def wait_for_services(required: set[str], seconds: int = 90) -> None:
-    deadline=time.monotonic()+seconds; latest=set()
-    while time.monotonic()<deadline:
-        result=compose("ps","--status","running","--services",check=False,capture=True)
-        if result.returncode==0:
-            latest={line.strip() for line in (result.stdout or "").splitlines() if line.strip()}
-            if required.issubset(latest): return
-        time.sleep(1)
-    raise RuntimeError(f"LedgerGuard processes did not remain running: missing={sorted(required-latest)}")
-
 def reconcile() -> None:
     values=ensure_environment(); sql=(ROOT/"tests/database/reconcile.sql").read_text(encoding="utf-8")
     compose("exec","-T","-e",f"PGPASSWORD={values['LEDGER_OWNER_PASSWORD']}","postgres","psql","-X","-v","ON_ERROR_STOP=1","-h","127.0.0.1","-U","ledger_owner","-d",values["POSTGRES_DB"],input_text=sql)
@@ -120,15 +107,9 @@
 def command_up() -> int:
     if not compose_available() or not docker_ready(): print("BLOCKED: Docker Engine and Docker Compose are required.",file=sys.stderr); return 2
     ensure_environment()
-    try:
-        compose("up","-d","--build","postgres","rabbitmq","api","publisher","payment-worker-a","payment-worker-b")
-        system=wait_for_readiness()
-        wait_for_services({"api","publisher","payment-worker-a","payment-worker-b","postgres","rabbitmq"})
-        compose("run","--rm","seed")
-        reconcile()
-    except (subprocess.CalledProcessError,RuntimeError) as failure:
-        capture_logs(); print(f"STARTUP FAILED: {failure}",file=sys.stderr); return 1
-    base=api_base_url(); print("LedgerGuard P05 API and asynchronous payment workers are ready (synthetic money only; no React UI yet)."); print(f"API health: {base}/actuator/health/readiness"); print(f"System boundary: {base}/api/v1/system"); print(f"Current OpenAPI: {base}/api/v1/openapi/p05.json"); print(f"P04 compatibility OpenAPI: {base}/api/v1/openapi/p04.json"); print(f"Database runtime role: {system.get('databaseRole')}"); print("Messaging boundary: at-least-once RabbitMQ delivery with durable inbox deduplication and at-most-once committed financial effects."); print("Sandbox identities: alice@example.test, bob@example.test, merchant@example.test, admin@example.test."); print("Their generated password is LEDGER_DEMO_PASSWORD in private .ledgerguard/runtime.env; it is not printed in CI logs."); print("Acquire CSRF before login and again after login/logout. Money commands require a stable Idempotency-Key."); return 0
+    try: compose("up","-d","--build","postgres","rabbitmq","api"); system=wait_for_readiness(); compose("run","--rm","seed"); reconcile()
+    except (subprocess.CalledProcessError,RuntimeError) as failure: capture_logs(); print(f"STARTUP FAILED: {failure}",file=sys.stderr); return 1
+    base=api_base_url(); print("LedgerGuard P04 API is ready (synthetic money only; no React UI yet)."); print(f"API health: {base}/actuator/health/readiness"); print(f"System boundary: {base}/api/v1/system"); print(f"Current OpenAPI: {base}/api/v1/openapi/p04.json"); print(f"P03 compatibility OpenAPI: {base}/api/v1/openapi.json"); print(f"Database runtime role: {system.get('databaseRole')}"); print("Sandbox identities: alice@example.test, bob@example.test, merchant@example.test, admin@example.test."); print("Their generated password is LEDGER_DEMO_PASSWORD in private .ledgerguard/runtime.env; it is not printed in CI logs."); print("Acquire CSRF before login and again after login/logout. Money commands require a stable Idempotency-Key."); return 0
 def command_down() -> int:
     if not ENV_FILE.exists() or not compose_available(): print("LedgerGuard environment is not initialized."); return 0
     capture_logs(); return compose("down","--remove-orphans",check=False).returncode
@@ -148,12 +129,12 @@
             result=run([executable],check=False)
             if result.returncode: return result.returncode
         return 0
-    if target in {"database","auth","transfer","payment"}:
+    if target in {"database","auth","transfer"}:
         if not docker_ready(): print("BLOCKED: a working Docker daemon is required by Testcontainers.",file=sys.stderr); return 2
-        return maven_verify({"database":None,"auth":"AuthenticationAccountsIT","transfer":"TransferReliabilityIT","payment":"PaymentMessagingIT"}[target])
+        return maven_verify({"database":None,"auth":"AuthenticationAccountsIT","transfer":"TransferReliabilityIT"}[target])
     if target=="pr":
         if not docker_ready(): print("BLOCKED: PR verification requires Docker.",file=sys.stderr); return 2
-        commands=[["npm","ci","--prefix","frontend"],["./scripts/lab","test","unit"],["./mvnw","-B","-ntp","-f","backend/pom.xml","verify"],["python3","scripts/assert-p05-evidence"],["./scripts/scan-secrets"],["docker","compose","--env-file",".env.example","-f","compose.yaml","config","--quiet"]]
+        commands=[["npm","ci","--prefix","frontend"],["./scripts/lab","test","unit"],["./mvnw","-B","-ntp","-f","backend/pom.xml","verify"],["python3","scripts/assert-p04-evidence"],["./scripts/scan-secrets"],["docker","compose","--env-file",".env.example","-f","compose.yaml","config","--quiet"]]
         for command in commands:
             result=run(command,check=False)
             if result.returncode: return result.returncode

```

### scripts/smoke-payment

PATH_NOT_IN_MAIN_HISTORY

```diff
#!/usr/bin/env python3
"""Live Compose P05 payment/outbox/RabbitMQ smoke without exposing credentials."""
from __future__ import annotations

import http.cookiejar
import json
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VALUES = dict(line.split("=", 1) for line in (ROOT / ".ledgerguard/runtime.env").read_text().splitlines()
              if line and not line.startswith("#"))
BASE = "http://127.0.0.1:" + VALUES.get("LEDGER_HTTP_PORT", "8080") + "/api/v1"
SOURCE = "10000000-0000-0000-0000-000000000001"
DESTINATION = "20000000-0000-0000-0000-000000000001"
RECIPIENT = "LG-20000000000000000000000000000001"
AMOUNT = 700


class Browser:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.token: str | None = None

    def call(self, path, body=None, method=None, headers=None):
        request_headers = {"Accept": "application/json", **(headers or {})}
        if self.token:
            request_headers["X-XSRF-TOKEN"] = self.token
        data = None
        if body is not None:
            request_headers["Content-Type"] = "application/json"
            data = json.dumps(body, separators=(",", ":")).encode()
        request = urllib.request.Request(BASE + path, data=data, headers=request_headers,
                                         method=method or ("POST" if body is not None else "GET"))
        try:
            response = self.opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None, dict(response.headers.items())

    def csrf(self):
        status, body, _ = self.call("/auth/csrf")
        assert status == 200
        self.token = body["token"]

    def login(self, email):
        self.csrf()
        status, _, _ = self.call("/auth/login", {"email": email, "password": VALUES["LEDGER_DEMO_PASSWORD"]})
        assert status == 200
        self.csrf()


def header(headers, name):
    target = name.lower()
    return next((value for key, value in headers.items() if key.lower() == target), None)


checks = []
def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append({"test": name, "status": "PASS"})


alice = Browser(); alice.login("alice@example.test")
bob = Browser(); bob.login("bob@example.test")
admin = Browser(); admin.login("admin@example.test")

status, source_before, _ = alice.call("/accounts/" + SOURCE)
check("payment-source-readable", status == 200)
status, destination_before, _ = bob.call("/accounts/" + DESTINATION)
check("payment-destination-readable", status == 200)

intent = {"sourceId": SOURCE, "recipientRef": RECIPIENT, "amountMinor": str(AMOUNT), "currency": "CAD"}
status, receipt, headers = alice.call("/payments", intent,
                                      headers={"Idempotency-Key": "compose-smoke-payment-v1"})
check("asynchronous-payment-accepted", status == 202 and receipt["kind"] == "PAYMENT"
      and receipt["state"] == "PENDING" and receipt["amountMinor"] == str(AMOUNT))
payment_id = receipt["id"]
first_replayed = (header(headers, "Idempotency-Replayed") or "").lower() == "true"
check("payment-location", (header(headers, "Location") or "").endswith("/api/v1/payments/" + payment_id))

status2, replay, replay_headers = alice.call("/payments", intent,
    headers={"Idempotency-Key": "compose-smoke-payment-v1"})
check("durable-payment-replay", status2 == 202 and replay == receipt
      and (header(replay_headers, "Idempotency-Replayed") or "").lower() == "true")

changed = dict(intent); changed["amountMinor"] = str(AMOUNT + 1)
check("payment-idempotency-conflict", alice.call("/payments", changed,
      headers={"Idempotency-Key": "compose-smoke-payment-v1"})[0] == 409)

payment = None
deadline = time.monotonic() + 90
while time.monotonic() < deadline:
    status, payment, _ = alice.call("/payments/" + payment_id)
    if status == 200 and payment["state"] == "SETTLED" and payment["version"] == "2":
        break
    time.sleep(0.25)
check("rabbitmq-worker-settlement", payment is not None and payment["state"] == "SETTLED"
      and payment["journalId"] and payment["adjustmentState"] == "NONE")
check("owner-payment-view", payment["direction"] == "OUTGOING" and payment["accountId"] == SOURCE
      and payment["counterpartyRef"] == RECIPIENT)

status, incoming, _ = bob.call("/payments/" + payment_id)
check("recipient-payment-view", status == 200 and incoming["direction"] == "INCOMING"
      and incoming["accountId"] == DESTINATION
      and incoming["counterpartyRef"] == "LG-10000000000000000000000000000001")

status, source_after, _ = alice.call("/accounts/" + SOURCE)
status_bob, destination_after, _ = bob.call("/accounts/" + DESTINATION)
check("payment-hold-consumed", status == 200 and source_after["reservedMinor"] == "0")
if first_replayed:
    check("replayed-payment-no-second-effect",
          source_after["postedMinor"] == source_before["postedMinor"]
          and destination_after["postedMinor"] == destination_before["postedMinor"])
else:
    check("single-payment-balance-effect",
          int(source_after["postedMinor"]) == int(source_before["postedMinor"]) - AMOUNT
          and int(destination_after["postedMinor"]) == int(destination_before["postedMinor"]) + AMOUNT)

check("customer-failed-work-denial", alice.call("/admin/failed-work")[0] == 403)
check("admin-failed-work-inspection", admin.call("/admin/failed-work")[0] == 200)
status, spec, _ = Browser().call("/openapi/p05.json")
check("p05-openapi-published", status == 200 and "/api/v1/payments" in spec["paths"]
      and "/api/v1/admin/failed-work/{id}/replay" in spec["paths"])

report = {
    "sourceSha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "scope": "real Docker Compose P05 API, outbox, RabbitMQ and two-worker smoke",
    "paymentId": payment_id,
    "checks": checks,
}
out = ROOT / ".evidence/payment-compose"
out.mkdir(parents=True, exist_ok=True)
(out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))

```

### tests/database/reconcile.sql

REVIEW_DIFFERENCE

```diff
--- branch/tests/database/reconcile.sql
+++ main-history/tests/database/reconcile.sql
@@ -42,23 +42,6 @@
        SELECT coalesce(sum(a.amount_minor::numeric),0)
        FROM ledger.adjustments a WHERE a.payment_id=p.id AND a.kind='REFUND'
      )
-), payment_event_problems AS (
-  SELECT 'PAYMENT_EVENT'::text AS kind,p.id::text AS identity
-  FROM ledger.payments p
-  LEFT JOIN ledger.outbox_events e ON e.aggregate_id=p.id AND e.aggregate_version=1
-    AND e.event_type='payment.requested'
-  WHERE e.id IS NULL
-     OR e.payload->>'paymentId'<>p.id::text
-     OR e.payload->>'version'<>'1'
-     OR e.payload->>'state'<>'PENDING'
-     OR (p.state='SETTLED' AND NOT EXISTS (
-       SELECT 1 FROM ledger.journals j WHERE j.id=p.journal_id AND j.operation_id=p.id AND j.kind='PAYMENT'
-     ))
-), projection_problems AS (
-  SELECT 'PROJECTION'::text AS kind,x.payment_id::text AS identity
-  FROM ledger.payment_projection x JOIN ledger.payments p ON p.id=x.payment_id
-  WHERE x.aggregate_version>p.version
-     OR (x.aggregate_version=p.version AND x.state<>p.state)
 ), idempotency_problems AS (
   SELECT 'IDEMPOTENCY'::text AS kind,
          concat_ws(':',actor_id,operation_kind,parent_scope,key) AS identity
@@ -67,8 +50,6 @@
   SELECT * FROM balance_problems
   UNION ALL SELECT * FROM journal_problems
   UNION ALL SELECT * FROM payment_problems
-  UNION ALL SELECT * FROM payment_event_problems
-  UNION ALL SELECT * FROM projection_problems
   UNION ALL SELECT * FROM idempotency_problems
 )
 SELECT (count(*) > 0) AS has_discrepancies,

```

## p06-payment-adjustments

`578650fe2e3ba0d4cefc4a1be92ed40f5018d941`; unique commits: 3.

{"REVIEW_DIFFERENCE": 12, "EXACT_CONTENT_IN_MAIN_HISTORY": 1, "IDENTICAL_TO_MAIN": 1, "PATH_NOT_IN_MAIN_HISTORY": 2}

Archive checksum matches historical workflow: True. Actual: `d430738edfef21b4ad069a390419e6bd99a60a2df46f36825dd44f47afef5c37`.

### backend/src/main/java/lab/ledgerguard/config/FoundationSecurityConfiguration.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/config/FoundationSecurityConfiguration.java
+++ main-history/backend/src/main/java/lab/ledgerguard/config/FoundationSecurityConfiguration.java
@@ -52,11 +52,6 @@
                 .requestMatchers(HttpMethod.GET,"/actuator/health/**","/actuator/info","/api/v1/system","/api/v1/openapi.json","/api/v1/openapi/**","/api/v1/auth/csrf").permitAll()
                 .requestMatchers(HttpMethod.POST,"/api/v1/auth/register","/api/v1/auth/login").permitAll()
                 .requestMatchers("/api/v1/auth/me","/api/v1/auth/logout").authenticated()
-                .requestMatchers(HttpMethod.POST,"/api/v1/payments/*/reversal").hasRole("ADMIN")
-                .requestMatchers(HttpMethod.POST,"/api/v1/payments/*/cancel","/api/v1/payments/*/refunds")
-                    .hasAnyRole("CUSTOMER","ADMIN")
-                .requestMatchers(HttpMethod.GET,"/api/v1/payments/*/adjustments","/api/v1/payments/*/adjustments/*")
-                    .hasAnyRole("CUSTOMER","ADMIN")
                 .requestMatchers("/api/v1/accounts","/api/v1/accounts/**","/api/v1/recipients/**",
                     "/api/v1/transfers","/api/v1/transfers/**","/api/v1/payments","/api/v1/payments/**").hasRole("CUSTOMER")
                 .requestMatchers("/api/v1/admin/**","/actuator/metrics","/actuator/metrics/**").hasRole("ADMIN")

```

### backend/src/main/java/lab/ledgerguard/messaging/MessagingTopology.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/messaging/MessagingTopology.java
+++ main-history/backend/src/main/java/lab/ledgerguard/messaging/MessagingTopology.java
@@ -40,9 +40,6 @@
             BindingBuilder.bind(payments).to(events).with("payment.requested"),
             BindingBuilder.bind(projection).to(events).with("payment.requested"),
             BindingBuilder.bind(projection).to(events).with("payment.updated"),
-            BindingBuilder.bind(projection).to(events).with("payment.cancelled"),
-            BindingBuilder.bind(projection).to(events).with("payment.refunded"),
-            BindingBuilder.bind(projection).to(events).with("payment.reversed"),
             BindingBuilder.bind(observation).to(events).with("transfer.settled"),
             BindingBuilder.bind(paymentRetry).to(retry).with(PAYMENT_RETRY_KEY),
             BindingBuilder.bind(projectionRetry).to(retry).with(PROJECTION_RETRY_KEY),

```

### backend/src/main/java/lab/ledgerguard/messaging/ReliableEventConsumers.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/messaging/ReliableEventConsumers.java
+++ main-history/backend/src/main/java/lab/ledgerguard/messaging/ReliableEventConsumers.java
@@ -49,7 +49,7 @@
     @RabbitListener(id="payment-projection",queues=MessagingTopology.PROJECTION_QUEUE)
     public void project(Message message,Channel channel) throws Exception {
         consume("payment-projection-v1",MessagingTopology.PROJECTION_RETRY_KEY,"payment.updated",message,channel,event->{
-            if(!event.eventType().matches("payment\\.(requested|updated|cancelled|refunded|reversed)"))
+            if(!event.eventType().matches("payment\\.(requested|updated)"))
                 throw new IllegalArgumentException("UNSUPPORTED_PROJECTION_EVENT");
             database.project(event);
         });
@@ -114,7 +114,7 @@
     }

     @FunctionalInterface private interface Processor { void process(EventEnvelope event) throws Exception; }
-    private static String receivedRouting(Message message,String fallback){String routing=message.getMessageProperties().getReceivedRoutingKey();return routing!=null&&routing.matches("(payment\\.(requested|updated|cancelled|refunded|reversed)|transfer\\.settled)")?routing:fallback;}
+    private static String receivedRouting(Message message,String fallback){String routing=message.getMessageProperties().getReceivedRoutingKey();return routing!=null&&routing.matches("(payment\\.(requested|updated)|transfer\\.settled)")?routing:fallback;}
     private static int retry(Message message){Object value=message.getMessageProperties().getHeaders().get("x-ledger-retry");return value instanceof Number n?n.intValue():0;}
     private static Duration backoff(int attempt){return Duration.ofSeconds(Math.min(60,1L<<Math.min(6,Math.max(0,attempt-1))));}
     private static UUID stableMessageId(Message message,byte[] body){

```

### backend/src/main/java/lab/ledgerguard/payments/PaymentController.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/payments/PaymentController.java
+++ main-history/backend/src/main/java/lab/ledgerguard/payments/PaymentController.java
@@ -20,28 +20,37 @@
     public ResponseEntity<JsonNode> create(@AuthenticationPrincipal Identity identity,
             @RequestHeader(name="Idempotency-Key",required=false) String key,
             @RequestBody PaymentService.CreatePayment request) {
-        return response(payments.create(identity,key,request));
+        PaymentService.CommandResult result = payments.create(identity, key, request);
+        URI location = result.resourceId() == null ? null : URI.create("/api/v1/payments/" + result.resourceId());
+        return response(result, location);
     }

     @PostMapping(path="/{id}/cancel",consumes=MediaType.APPLICATION_JSON_VALUE,produces=MediaType.APPLICATION_JSON_VALUE)
     public ResponseEntity<JsonNode> cancel(@AuthenticationPrincipal Identity identity,@PathVariable UUID id,
             @RequestHeader(name="Idempotency-Key",required=false) String key,
             @RequestBody(required=false) PaymentService.CancelPayment request) {
-        return response(payments.cancel(identity,id,key,request));
+        PaymentService.CommandResult result = payments.cancel(identity, id, key, request);
+        return response(result, URI.create("/api/v1/payments/" + id));
     }

     @PostMapping(path="/{id}/refunds",consumes=MediaType.APPLICATION_JSON_VALUE,produces=MediaType.APPLICATION_JSON_VALUE)
     public ResponseEntity<JsonNode> refund(@AuthenticationPrincipal Identity identity,@PathVariable UUID id,
             @RequestHeader(name="Idempotency-Key",required=false) String key,
             @RequestBody PaymentService.RefundPayment request) {
-        return response(payments.refund(identity,id,key,request));
+        PaymentService.CommandResult result = payments.refund(identity, id, key, request);
+        URI location = result.resourceId() == null ? null
+            : URI.create("/api/v1/payments/" + id + "/adjustments/" + result.resourceId());
+        return response(result, location);
     }

     @PostMapping(path="/{id}/reversal",consumes=MediaType.APPLICATION_JSON_VALUE,produces=MediaType.APPLICATION_JSON_VALUE)
     public ResponseEntity<JsonNode> reverse(@AuthenticationPrincipal Identity identity,@PathVariable UUID id,
             @RequestHeader(name="Idempotency-Key",required=false) String key,
-            @RequestBody(required=false) PaymentService.ReversePayment request) {
-        return response(payments.reverse(identity,id,key,request));
+            @RequestBody PaymentService.ReversePayment request) {
+        PaymentService.CommandResult result = payments.reverse(identity, id, key, request);
+        URI location = result.resourceId() == null ? null
+            : URI.create("/api/v1/payments/" + id + "/adjustments/" + result.resourceId());
+        return response(result, location);
     }

     @GetMapping("/{id}")
@@ -68,12 +77,12 @@
         return payments.getAdjustment(identity,id,adjustmentId);
     }

-    private static ResponseEntity<JsonNode> response(PaymentService.CommandResult result) {
-        var builder=ResponseEntity.status(result.status())
-            .header("Idempotency-Replayed",Boolean.toString(result.replayed()))
-            .header("Cache-Control","no-store")
+    private static ResponseEntity<JsonNode> response(PaymentService.CommandResult result, URI location) {
+        var response = ResponseEntity.status(result.status())
+            .header("Idempotency-Replayed", Boolean.toString(result.replayed()))
+            .header("Cache-Control", "no-store")
             .contentType(MediaType.APPLICATION_JSON);
-        if(result.location()!=null) builder.location(URI.create(result.location()));
-        return builder.body(result.body());
+        if (location != null && result.status() < 300) response.location(location);
+        return response.body(result.body());
     }
 }

```

### backend/src/main/java/lab/ledgerguard/payments/PaymentService.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/payments/PaymentService.java
+++ main-history/backend/src/main/java/lab/ledgerguard/payments/PaymentService.java
@@ -8,7 +8,6 @@
 import java.sql.SQLException;
 import java.time.Instant;
 import java.util.Locale;
-import java.util.Set;
 import java.util.UUID;
 import lab.ledgerguard.accounts.Page;
 import lab.ledgerguard.auth.Identity;
@@ -25,8 +24,6 @@
 @Service
 public class PaymentService {
     private static final BigInteger MAX_AMOUNT = new BigInteger("1000000000000");
-    private static final Set<String> ADJUSTMENT_STATES = Set.of(
-        "NONE", "PARTIALLY_REFUNDED", "FULLY_REFUNDED", "REVERSED");
     private final FinancialCommands commands;
     private final JdbcTemplate jdbc;
     private final ObjectMapper json;
@@ -50,9 +47,9 @@
                           Instant createdAt, Instant updatedAt) { }
     public record Adjustment(UUID id, UUID paymentId, String kind, String amountMinor, String currency,
                              UUID journalId, String reason, Instant createdAt) { }
-    public record CommandResult(int status, JsonNode body, boolean replayed, String location) { }
+    public record CommandResult(int status, JsonNode body, boolean replayed, UUID resourceId) { }
     private record Normalized(UUID sourceId, String recipientRef, String amountMinor, String currency) { }
-    private record DurableResult(FinancialCommands.Result result, JsonNode body) { }
+    private record Authority(UUID payerId, UUID recipientOwnerId) { }

     public CommandResult create(Identity identity, String idempotencyKey, CreatePayment request) {
         String key = key(idempotencyKey);
@@ -62,76 +59,73 @@
         payload.put("recipientRef", intent.recipientRef());
         payload.put("amountMinor", intent.amountMinor());
         payload.put("currency", intent.currency());
-        DurableResult durable = execute(identity, "PAYMENT", null, key, payload);
+        FinancialCommands.Result result = execute(identity, "PAYMENT", null, key, payload);
+        JsonNode body = body(result);
         UUID paymentId = null;
-        if (durable.result().status() < 300) {
-            paymentId = uuid(durable.body(), "id");
-            if (durable.result().status() != 202 || !"PAYMENT".equals(durable.body().path("kind").asText())
-                || !"PENDING".equals(durable.body().path("state").asText())
-                || !intent.amountMinor().equals(durable.body().path("amountMinor").asText())
-                || !intent.currency().equals(durable.body().path("currency").asText())) {
+        if (result.status() < 300) {
+            paymentId = uuid(body, "id");
+            if (result.status() != 202 || !"PAYMENT".equals(body.path("kind").asText())
+                || !"PENDING".equals(body.path("state").asText())
+                || !intent.amountMinor().equals(body.path("amountMinor").asText())
+                || !intent.currency().equals(body.path("currency").asText())) {
                 throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
             }
-        }
-        return new CommandResult(durable.result().status(), durable.body(), durable.result().replayed(),
-            paymentId == null ? null : "/api/v1/payments/" + paymentId);
+        } else {
+            requireRejection(body);
+        }
+        return new CommandResult(result.status(), body, result.replayed(), paymentId);
     }

     public CommandResult cancel(Identity identity, UUID paymentId, String idempotencyKey, CancelPayment request) {
-        String key = key(idempotencyKey);
-        String reason = reason(request == null ? null : request.reason(), "ADMIN".equals(identity.role()));
+        authorize(identity, paymentId, "CANCEL");
         ObjectNode payload = json.createObjectNode();
-        if (reason != null) payload.put("reason", reason);
-        DurableResult durable = execute(identity, "CANCEL", paymentId, key, payload);
-        if (durable.result().status() < 300) {
-            verifyCommandReceipt(durable.body(), paymentId, "CANCEL", "CANCELLED", "NONE");
-            if (durable.result().status() != 200 || durable.body().path("journalId").isValueNode()) {
+        putOptionalReason(payload, request == null ? null : request.reason());
+        FinancialCommands.Result result = execute(identity, "CANCEL", paymentId, key(idempotencyKey), payload);
+        JsonNode body = body(result);
+        if (result.status() < 300) {
+            if (result.status() != 200 || !paymentId.equals(uuid(body, "id"))
+                || !"CANCELLED".equals(body.path("state").asText())) {
                 throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
             }
-        }
-        return new CommandResult(durable.result().status(), durable.body(), durable.result().replayed(),
-            durable.result().status() < 300 ? "/api/v1/payments/" + paymentId : null);
+        } else {
+            requireRejection(body);
+        }
+        return new CommandResult(result.status(), body, result.replayed(), paymentId);
     }

     public CommandResult refund(Identity identity, UUID paymentId, String idempotencyKey, RefundPayment request) {
+        authorize(identity, paymentId, "REFUND");
         if (request == null) throw new ApiException(400, "INVALID_REFUND");
-        String key = key(idempotencyKey);
         String amount = amount(request.amountMinor());
-        String reason = reason(request.reason(), false);
         ObjectNode payload = json.createObjectNode();
         payload.put("amountMinor", amount);
-        if (reason != null) payload.put("reason", reason);
-        DurableResult durable = execute(identity, "REFUND", paymentId, key, payload);
+        putOptionalReason(payload, request.reason());
+        FinancialCommands.Result result = execute(identity, "REFUND", paymentId, key(idempotencyKey), payload);
+        JsonNode body = body(result);
         UUID adjustmentId = null;
-        if (durable.result().status() < 300) {
-            adjustmentId = verifyCommandReceipt(durable.body(), paymentId, "REFUND", "SETTLED", null);
-            if (durable.result().status() != 201 || !amount.equals(durable.body().path("amountMinor").asText())
-                || !Set.of("PARTIALLY_REFUNDED", "FULLY_REFUNDED").contains(
-                    durable.body().path("adjustmentState").asText())
-                || durable.body().path("journalId").asText().isBlank()) {
-                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
-            }
-        }
-        return new CommandResult(durable.result().status(), durable.body(), durable.result().replayed(),
-            adjustmentId == null ? null : adjustmentLocation(paymentId, adjustmentId));
+        if (result.status() < 300) {
+            adjustmentId = validateAdjustment(body, result.status(), paymentId, "REFUND", amount);
+        } else {
+            requireRejection(body);
+        }
+        return new CommandResult(result.status(), body, result.replayed(), adjustmentId);
     }

     public CommandResult reverse(Identity identity, UUID paymentId, String idempotencyKey, ReversePayment request) {
-        String key = key(idempotencyKey);
-        String reason = reason(request == null ? null : request.reason(), true);
+        authorize(identity, paymentId, "REVERSAL");
+        if (request == null) throw new ApiException(400, "INVALID_REVERSAL");
+        String reason = requiredReason(request.reason());
         ObjectNode payload = json.createObjectNode();
         payload.put("reason", reason);
-        DurableResult durable = execute(identity, "REVERSAL", paymentId, key, payload);
+        FinancialCommands.Result result = execute(identity, "REVERSAL", paymentId, key(idempotencyKey), payload);
+        JsonNode body = body(result);
         UUID adjustmentId = null;
-        if (durable.result().status() < 300) {
-            adjustmentId = verifyCommandReceipt(durable.body(), paymentId, "REVERSAL", "SETTLED", "REVERSED");
-            if (durable.result().status() != 201 || !validAmount(durable.body().path("amountMinor").asText())
-                || durable.body().path("journalId").asText().isBlank()) {
-                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
-            }
-        }
-        return new CommandResult(durable.result().status(), durable.body(), durable.result().replayed(),
-            adjustmentId == null ? null : adjustmentLocation(paymentId, adjustmentId));
+        if (result.status() < 300) {
+            adjustmentId = validateAdjustment(body, result.status(), paymentId, "REVERSAL", null);
+        } else {
+            requireRejection(body);
+        }
+        return new CommandResult(result.status(), body, result.replayed(), adjustmentId);
     }

     public Payment get(Identity identity, UUID id) {
@@ -153,37 +147,26 @@
     }

     public Adjustment getAdjustment(Identity identity, UUID paymentId, UUID adjustmentId) {
+        ensureVisible(identity, paymentId, true);
         var rows = jdbc.query(selectAdjustment()
-            + " WHERE a.payment_id=? AND a.id=? AND (?='ADMIN' OR s.owner_id=? OR d.owner_id=?)",
-            this::adjustmentRow, paymentId, adjustmentId, identity.role(), identity.userId(), identity.userId());
-        if (rows.isEmpty()) {
-            denied(identity);
-            throw new ApiException(404, "NOT_FOUND");
-        }
+            + " WHERE a.payment_id=? AND a.id=?", this::adjustmentRow, paymentId, adjustmentId);
+        if (rows.isEmpty()) throw new ApiException(404, "NOT_FOUND");
         return rows.getFirst();
     }

     public Page<Adjustment> listAdjustments(Identity identity, UUID paymentId, int limit, int offset) {
         Page.validate(limit, offset);
-        if (!visible(identity, paymentId)) {
-            denied(identity);
-            throw new ApiException(404, "NOT_FOUND");
-        }
+        ensureVisible(identity, paymentId, true);
         return Page.from(jdbc.query(selectAdjustment()
             + " WHERE a.payment_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?",
             this::adjustmentRow, paymentId, limit + 1, offset), limit, offset);
     }

-    private DurableResult execute(Identity identity, String operation, UUID parent, String key, ObjectNode payload) {
-        try {
-            FinancialCommands.Result result = commands.execute(identity.userId(), operation, parent, key,
+    private FinancialCommands.Result execute(Identity identity, String operation, UUID parent,
+                                               String key, ObjectNode payload) {
+        try {
+            return commands.execute(identity.userId(), operation, parent, key,
                 json.writeValueAsString(payload), ApiProblems.correlation());
-            JsonNode body = json.readTree(result.json());
-            if (body == null || !body.isObject() || result.status() < 200 || result.status() > 599
-                || (result.status() >= 300 && body.path("code").asText().isBlank())) {
-                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
-            }
-            return new DurableResult(result, body);
         } catch (ApiException failure) {
             throw failure;
         } catch (Exception failure) {
@@ -192,18 +175,77 @@
         }
     }

-    private static UUID verifyCommandReceipt(JsonNode body, UUID paymentId, String kind,
-                                              String state, String adjustmentState) {
-        UUID id = uuid(body, "id");
-        if (!id.equals(uuid(body, "operationId")) || !paymentId.equals(uuid(body, "paymentId"))
-            || !kind.equals(body.path("kind").asText()) || !state.equals(body.path("state").asText())
-            || !ADJUSTMENT_STATES.contains(body.path("adjustmentState").asText())
-            || (adjustmentState != null && !adjustmentState.equals(body.path("adjustmentState").asText()))
-            || !validAmount(body.path("amountMinor").asText())
-            || !body.path("currency").asText().matches("CAD|USD|JPY|KWD")) {
+    private JsonNode body(FinancialCommands.Result result) {
+        try {
+            JsonNode body = json.readTree(result.json());
+            if (body == null || !body.isObject() || result.status() < 200 || result.status() > 599) {
+                throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
+            }
+            return body;
+        } catch (ApiException failure) {
+            throw failure;
+        } catch (Exception failure) {
             throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
         }
-        return id;
+    }
+
+    private static UUID validateAdjustment(JsonNode body, int status, UUID paymentId,
+                                           String expectedKind, String expectedAmount) {
+        UUID adjustmentId = uuid(body, "id");
+        if (status != 201 || !paymentId.equals(uuid(body, "paymentId"))
+            || !expectedKind.equals(body.path("kind").asText())
+            || body.path("currency").asText().isBlank()
+            || body.path("journalId").asText().isBlank()) {
+            throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
+        }
+        uuid(body, "journalId");
+        if (expectedAmount != null && !expectedAmount.equals(body.path("amountMinor").asText())) {
+            throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
+        }
+        return adjustmentId;
+    }
+
+    private void authorize(Identity identity, UUID paymentId, String operation) {
+        boolean admin = "ADMIN".equals(identity.role());
+        if ("REVERSAL".equals(operation) && !admin) {
+            denied(identity);
+            throw new ApiException(403, "FORBIDDEN");
+        }
+        Authority authority = authority(paymentId);
+        if (authority == null) throw new ApiException(404, "NOT_FOUND");
+        if (admin) return;
+        if ("CANCEL".equals(operation)) {
+            if (!identity.userId().equals(authority.payerId())) {
+                denied(identity);
+                throw new ApiException(404, "NOT_FOUND");
+            }
+            return;
+        }
+        if ("REFUND".equals(operation)) {
+            if (identity.userId().equals(authority.recipientOwnerId())) return;
+            denied(identity);
+            if (identity.userId().equals(authority.payerId())) throw new ApiException(403, "FORBIDDEN");
+            throw new ApiException(404, "NOT_FOUND");
+        }
+    }
+
+    private Authority authority(UUID paymentId) {
+        var rows = jdbc.query("SELECT p.actor_id,d.owner_id FROM ledger.payments p "
+                + "JOIN ledger.accounts d ON d.id=p.destination_id WHERE p.id=?",
+            (rs, row) -> new Authority(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class)), paymentId);
+        return rows.isEmpty() ? null : rows.getFirst();
+    }
+
+    private void ensureVisible(Identity identity, UUID paymentId, boolean adminAllowed) {
+        boolean admin = adminAllowed && "ADMIN".equals(identity.role());
+        Integer found = jdbc.query("SELECT 1 FROM ledger.payments p "
+                + "JOIN ledger.accounts s ON s.id=p.source_id JOIN ledger.accounts d ON d.id=p.destination_id "
+                + "WHERE p.id=? AND (? OR s.owner_id=? OR d.owner_id=?)",
+            rs -> rs.next() ? 1 : null, paymentId, admin, identity.userId(), identity.userId());
+        if (found == null) {
+            denied(identity);
+            throw new ApiException(404, "NOT_FOUND");
+        }
     }

     private Payment paymentRow(UUID actor, ResultSet rs) throws SQLException {
@@ -223,19 +265,11 @@
             rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
     }

-    private Adjustment adjustmentRow(ResultSet rs, int ignored) throws SQLException {
+    private Adjustment adjustmentRow(ResultSet rs, int row) throws SQLException {
         return new Adjustment(rs.getObject("id", UUID.class), rs.getObject("payment_id", UUID.class),
-            rs.getString("kind"), Long.toString(rs.getLong("amount_minor")), rs.getString("currency"),
+            rs.getString("kind"), rs.getString("amount_minor"), rs.getString("currency"),
             rs.getObject("journal_id", UUID.class), rs.getString("reason"),
             rs.getTimestamp("created_at").toInstant());
-    }
-
-    private boolean visible(Identity identity, UUID paymentId) {
-        Integer count = jdbc.queryForObject("SELECT count(*) FROM ledger.payments p "
-            + "JOIN ledger.accounts s ON s.id=p.source_id JOIN ledger.accounts d ON d.id=p.destination_id "
-            + "WHERE p.id=? AND (?='ADMIN' OR s.owner_id=? OR d.owner_id=?)", Integer.class,
-            paymentId, identity.role(), identity.userId(), identity.userId());
-        return count != null && count == 1;
     }

     private static String selectPayment() {
@@ -249,9 +283,8 @@
     }

     private static String selectAdjustment() {
-        return "SELECT a.id,a.payment_id,a.kind,a.amount_minor,p.currency,a.journal_id,a.reason,a.created_at "
-            + "FROM ledger.adjustments a JOIN ledger.payments p ON p.id=a.payment_id "
-            + "JOIN ledger.accounts s ON s.id=p.source_id JOIN ledger.accounts d ON d.id=p.destination_id";
+        return "SELECT a.id,a.payment_id,a.kind,a.amount_minor::text,p.currency,a.journal_id,a.reason,a.created_at "
+            + "FROM ledger.adjustments a JOIN ledger.payments p ON p.id=a.payment_id";
     }

     private static Normalized normalize(CreatePayment request) {
@@ -279,25 +312,22 @@
     }

     private static String amount(String value) {
-        if (!validAmount(value)) throw new ApiException(400, "INVALID_AMOUNT");
+        if (value == null || !value.matches("[1-9][0-9]{0,12}")
+            || new BigInteger(value).compareTo(MAX_AMOUNT) > 0) {
+            throw new ApiException(400, "INVALID_AMOUNT");
+        }
         return value;
     }

-    private static boolean validAmount(String value) {
-        return value != null && value.matches("[1-9][0-9]{0,12}")
-            && new BigInteger(value).compareTo(MAX_AMOUNT) <= 0;
-    }
-
-    private static String reason(String value, boolean required) {
-        if (value == null) {
-            if (required) throw new ApiException(400, "INVALID_REASON");
-            return null;
-        }
+    private static void putOptionalReason(ObjectNode payload, String value) {
+        if (value == null) return;
+        payload.put("reason", requiredReason(value));
+    }
+
+    private static String requiredReason(String value) {
+        if (value == null) throw new ApiException(400, "INVALID_REASON");
         String normalized = value.strip();
-        boolean control = normalized.codePoints().anyMatch(Character::isISOControl);
-        if (normalized.isEmpty() || normalized.length() > 500 || control) {
-            throw new ApiException(400, "INVALID_REASON");
-        }
+        if (normalized.isEmpty() || normalized.length() > 500) throw new ApiException(400, "INVALID_REASON");
         return normalized;
     }

@@ -309,12 +339,12 @@
         }
     }

-    private static String adjustmentLocation(UUID paymentId, UUID adjustmentId) {
-        return "/api/v1/payments/" + paymentId + "/adjustments/" + adjustmentId;
+    private static void requireRejection(JsonNode body) {
+        if (body.path("code").asText().isBlank()) throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
     }

     private void denied(Identity identity) {
-        events.denied(identity == null ? null : identity.userId(), "ACCESS_DENIED");
+        events.denied(identity.userId(), "ACCESS_DENIED");
     }

     private static ApiException publicFailure(Throwable failure) {
@@ -330,7 +360,7 @@
             return new ApiException(503, "DEPENDENCY_UNAVAILABLE");
         }
         return switch (state) {
-            case "P4000" -> new ApiException(400, "INVALID_PAYMENT_COMMAND");
+            case "P4000" -> new ApiException(400, "INVALID_PAYMENT");
             case "P4030" -> new ApiException(403, "FORBIDDEN");
             case "P4040" -> new ApiException(404, "NOT_FOUND");
             case "P4090" -> new ApiException(409, "PAYMENT_CONFLICT");

```

### backend/src/test/java/lab/ledgerguard/TransferReliabilityIT.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/test/java/lab/ledgerguard/TransferReliabilityIT.java
+++ main-history/backend/src/test/java/lab/ledgerguard/TransferReliabilityIT.java
@@ -22,7 +22,7 @@
 import static io.restassured.RestAssured.given;
 import static org.junit.jupiter.api.Assertions.*;

-/** Real P04-P06 HTTP through two JVMs and PostgreSQL. Broker-independent commands are exercised here; live RabbitMQ publication is exercised by the Compose lane. */
+/** Real P04/P05 HTTP through two JVMs and PostgreSQL. Broker-independent acceptance is exercised here; live RabbitMQ settlement is exercised by the Compose lane. */
 @Testcontainers
 class TransferReliabilityIT {
     @Container static final PostgreSQLContainer<?> PG=new PostgreSQLContainer<>("postgres:17.11-bookworm")
@@ -109,14 +109,7 @@
     static Map<String,String> intent(String source,String recipient,String amount,String currency){return new LinkedHashMap<>(Map.of("sourceId",source,"recipientRef",recipient,"amountMinor",amount,"currency",currency));}
     static Response transfer(Browser browser,String key,Object body){return browser.call("POST","/transfers",body,Map.of("Idempotency-Key",key));}
     static Response payment(Browser browser,String key,Object body){return browser.call("POST","/payments",body,Map.of("Idempotency-Key",key));}
-    static Response cancel(Browser browser,UUID payment,String key,Object body){return browser.call("POST","/payments/"+payment+"/cancel",body,Map.of("Idempotency-Key",key));}
-    static Response refund(Browser browser,UUID payment,String key,Object body){return browser.call("POST","/payments/"+payment+"/refunds",body,Map.of("Idempotency-Key",key));}
-    static Response reversal(Browser browser,UUID payment,String key,Object body){return browser.call("POST","/payments/"+payment+"/reversal",body,Map.of("Idempotency-Key",key));}
-    static User admin() throws SQLException{User user=user();try(Connection c=owner();PreparedStatement p=c.prepareStatement("UPDATE ledger.app_users SET role='ADMIN' WHERE id=?")){p.setObject(1,user.id);assertEquals(1,p.executeUpdate());}return user;}
-    static UUID accepted(User payer,String source,String destination,long amount,String key) throws Exception{Response response=payment(payer.browser,key,intent(source,ref(destination),Long.toString(amount),"CAD"));status(202,response);return UUID.fromString(response.jsonPath().getString("id"));}
-    static String settle(UUID payment) throws SQLException{try(Connection c=runtime();PreparedStatement p=c.prepareStatement("SELECT ledger.settle_event(?,?,?)")){p.setObject(1,UUID.randomUUID());p.setObject(2,payment);p.setObject(3,UUID.randomUUID());try(ResultSet rows=p.executeQuery()){assertTrue(rows.next());return rows.getString(1);}}}
     static void reconciled(String account) throws SQLException{assertEquals(0,scalar("SELECT count(*) FROM ledger.account_balances b JOIN ledger.accounts a ON a.id=b.account_id WHERE a.id=? AND b.posted_minor<>(SELECT coalesce(sum(CASE WHEN side='CREDIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) FROM ledger.journal_entries e WHERE e.account_id=a.id)",UUID.fromString(account)));}
-    static void consistent(String account) throws SQLException{UUID id=UUID.fromString(account);reconciled(account);assertEquals(scalar("SELECT reserved_minor FROM ledger.account_balances WHERE account_id=?",id),scalar("SELECT coalesce(sum(amount_minor),0) FROM ledger.holds WHERE account_id=? AND state='ACTIVE'",id));assertEquals(0,scalar("SELECT count(*) FROM ledger.account_balances WHERE account_id=? AND (posted_minor<0 OR reserved_minor<0 OR reserved_minor>posted_minor)",id));}

     @Test void P0401_createReplayReadAndPrivacy() throws Exception {
         User alice=user(),bob=user();String source=account(alice,"Source","CAD"),destination=account(bob,"Private destination","CAD");fund(source,10000,"CAD");String key="transfer-key-0401";Map<String,String> body=intent(source,ref(destination),"2500","CAD");
@@ -204,75 +197,4 @@
         Browser anonymous=new Browser(first.port);status(401,anonymous.call("GET","/payments",null));User alice=user(),bob=user();String source=account(alice,"P05 source","CAD"),target=account(bob,"P05 target","CAD");fund(source,5000,"CAD");Map<String,String> body=intent(source,ref(target),"100","CAD");status(400,alice.browser.call("POST","/payments",body));Map<String,Object> injected=new HashMap<>(body);injected.put("state","SETTLED");status(400,payment(alice.browser,"payment-mass-assignment",injected));for(int i=0;i<3;i++)status(202,payment(alice.browser,"payment-list-"+i,body));Response page=alice.browser.call("GET","/payments?limit=2&offset=0",null);status(200,page);assertTrue(page.jsonPath().getBoolean("hasMore"));assertFalse(page.asString().contains(target));Response specResponse=anonymous.call("GET","/openapi/p05.json",null);status(200,specResponse);var spec=JSON.readTree(specResponse.asString());assertTrue(spec.path("paths").has("/api/v1/payments"));assertTrue(spec.path("paths").has("/api/v1/admin/failed-work/{id}/replay"));try(Connection c=runtime();Statement statement=c.createStatement()){assertEquals("42501",assertThrows(SQLException.class,()->statement.execute("INSERT INTO ledger.payments(id,actor_id,source_id,destination_id,amount_minor,currency) VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,'CAD')")).getSQLState());}
     }

-    @Test void P0601_payerCancellationReleasesHoldOnceWithoutJournalAndReplays() throws Exception {
-        User payer=user(),recipient=user();String source=account(payer,"P06 cancel source","CAD"),target=account(recipient,"P06 cancel target","CAD");fund(source,10000,"CAD");UUID id=accepted(payer,source,target,2500,"p06-cancel-create-01");String key="p06-cancel-command-01";
-        Response first=cancel(payer.browser,id,key,Map.of()),again=cancel(payer.browser,id,key,Map.of());
-        status(200,first);status(200,again);assertEquals(first.asString(),again.asString());assertEquals("false",first.header("Idempotency-Replayed"));assertEquals("true",again.header("Idempotency-Replayed"));assertEquals("/api/v1/payments/"+id,first.header("Location"));assertEquals("CANCEL",first.jsonPath().getString("kind"));assertEquals("CANCELLED",first.jsonPath().getString("state"));assertEquals("NONE",first.jsonPath().getString("adjustmentState"));assertNull(first.jsonPath().get("journalId"));
-        UUID operation=UUID.fromString(first.jsonPath().getString("operationId"));assertEquals("CANCELLED",settle(id));assertEquals(1,scalar("SELECT count(*) FROM ledger.payments WHERE id=? AND state='CANCELLED' AND version=2",id));assertEquals(1,scalar("SELECT count(*) FROM ledger.holds WHERE payment_id=? AND state='RELEASED'",id));assertEquals(0,scalar("SELECT reserved_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(10000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(0,scalar("SELECT count(*) FROM ledger.journals WHERE operation_id IN (?,?)",id,operation));assertEquals(0,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",id));assertEquals(1,scalar("SELECT count(*) FROM ledger.audit_records WHERE aggregate_id=? AND action='PAYMENT_CANCELLED'",id));assertEquals(1,scalar("SELECT count(*) FROM ledger.outbox_events WHERE aggregate_id=? AND event_type='payment.cancelled'",id));consistent(source);consistent(target);
-    }
-
-    @Test void P0602_cancellationAuthorizationAdminReasonAndNonDisclosure() throws Exception {
-        User payer=user(),recipient=user(),stranger=user(),administrator=admin();String source=account(payer,"P06 auth source","CAD"),target=account(recipient,"P06 auth target","CAD");fund(source,4000,"CAD");UUID id=accepted(payer,source,target,1000,"p06-cancel-create-02");
-        status(404,cancel(stranger.browser,id,"p06-foreign-cancel",Map.of()));assertEquals(0,scalar("SELECT count(*) FROM ledger.idempotency_records WHERE actor_id=? AND key='p06-foreign-cancel'",stranger.id));status(400,cancel(administrator.browser,id,"p06-admin-no-reason",Map.of()));assertEquals(0,scalar("SELECT count(*) FROM ledger.idempotency_records WHERE actor_id=? AND key='p06-admin-no-reason'",administrator.id));
-        administrator.browser.csrf=null;status(403,cancel(administrator.browser,id,"p06-admin-no-csrf",Map.of("reason","Support correction")));administrator.browser.csrf();Response cancelled=cancel(administrator.browser,id,"p06-admin-cancel",Map.of("reason","  Support correction  "));status(200,cancelled);assertEquals("CANCELLED",cancelled.jsonPath().getString("state"));assertEquals(1,scalar("SELECT count(*) FROM ledger.audit_records WHERE aggregate_id=? AND action='PAYMENT_CANCELLED' AND canonical_body LIKE '%Support correction%'",id));status(403,reversal(payer.browser,id,"p06-payer-reversal",Map.of("reason","Not allowed")));consistent(source);
-    }
-
-    @Test void P0603_cancellationVersusSettlementHasExactlyOneEconomicWinner() throws Exception {
-        User payer=user(),recipient=user();String source=account(payer,"P06 race source","CAD"),target=account(recipient,"P06 race target","CAD");fund(source,10000,"CAD");UUID id=accepted(payer,source,target,4000,"p06-race-create-03");CyclicBarrier gate=new CyclicBarrier(2);Response cancelled;String settled;
-        try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> cancelFuture=pool.submit(()->{gate.await();return cancel(payer.browser.copy(first.port),id,"p06-race-cancel-03",Map.of());});Future<String> settleFuture=pool.submit(()->{gate.await();return settle(id);});cancelled=cancelFuture.get(15,TimeUnit.SECONDS);settled=settleFuture.get(15,TimeUnit.SECONDS);}
-        assertTrue(cancelled.statusCode()==200||cancelled.statusCode()==409,cancelled.asString());String authority=text("SELECT state FROM ledger.payments WHERE id=?",id);if(cancelled.statusCode()==200){assertEquals("CANCELLED",settled);assertEquals("CANCELLED",authority);assertEquals(0,scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?",id));assertEquals(10000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals("RELEASED",text("SELECT state FROM ledger.holds WHERE payment_id=?",id));}else{assertEquals("INVALID_PAYMENT_STATE",cancelled.jsonPath().getString("code"));assertEquals("SETTLED",settled);assertEquals("SETTLED",authority);assertEquals(1,scalar("SELECT count(*) FROM ledger.journals WHERE operation_id=?",id));assertEquals(6000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(4000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(target)));assertEquals("CONSUMED",text("SELECT state FROM ledger.holds WHERE payment_id=?",id));}assertEquals(0,scalar("SELECT reserved_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));consistent(source);consistent(target);
-    }
-
-    @Test void P0604_partialThenFullRefundPreservesSettlementAndExposesImmutableAdjustments() throws Exception {
-        User payer=user(),recipient=user(),administrator=admin();String source=account(payer,"P06 refund source","CAD"),target=account(recipient,"P06 refund target","CAD");fund(source,10000,"CAD");UUID id=accepted(payer,source,target,10000,"p06-refund-create-04");assertEquals("SETTLED",settle(id));UUID originalJournal=UUID.fromString(text("SELECT journal_id::text FROM ledger.payments WHERE id=?",id));
-        Response partial=refund(recipient.browser,id,"p06-refund-partial-04",Map.of("amountMinor","3000","reason","Partial return")),partialReplay=refund(recipient.browser,id,"p06-refund-partial-04",Map.of("amountMinor","3000","reason","Partial return"));status(201,partial);status(201,partialReplay);assertEquals(partial.asString(),partialReplay.asString());assertEquals("true",partialReplay.header("Idempotency-Replayed"));assertEquals("PARTIALLY_REFUNDED",partial.jsonPath().getString("adjustmentState"));UUID partialId=UUID.fromString(partial.jsonPath().getString("id"));assertEquals("/api/v1/payments/"+id+"/adjustments/"+partialId,partial.header("Location"));
-        Response full=refund(recipient.browser,id,"p06-refund-full-04",Map.of("amountMinor","7000","reason","Final return"));status(201,full);assertEquals("FULLY_REFUNDED",full.jsonPath().getString("adjustmentState"));UUID fullId=UUID.fromString(full.jsonPath().getString("id"));Response payerView=payer.browser.call("GET","/payments/"+id,null),recipientView=recipient.browser.call("GET","/payments/"+id,null);status(200,payerView);status(200,recipientView);assertEquals("SETTLED",payerView.jsonPath().getString("state"));assertEquals("FULLY_REFUNDED",payerView.jsonPath().getString("adjustmentState"));assertEquals(originalJournal.toString(),payerView.jsonPath().getString("journalId"));
-        Response list=payer.browser.call("GET","/payments/"+id+"/adjustments?limit=10&offset=0",null),one=recipient.browser.call("GET","/payments/"+id+"/adjustments/"+partialId,null),adminRead=administrator.browser.call("GET","/payments/"+id+"/adjustments/"+fullId,null);status(200,list);status(200,one);status(200,adminRead);assertEquals(2,(int)list.jsonPath().getList("items").size());assertEquals("REFUND",one.jsonPath().getString("kind"));assertEquals(2,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=? AND kind='REFUND'",id));assertEquals(3,scalar("SELECT count(*) FROM ledger.journals j WHERE j.operation_id=? OR j.operation_id IN (SELECT id FROM ledger.adjustments WHERE payment_id=?)",id,id));assertEquals(10000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(0,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(target)));assertEquals(2,scalar("SELECT count(*) FROM ledger.audit_records WHERE aggregate_id=? AND action='PAYMENT_REFUNDED'",id));assertEquals(2,scalar("SELECT count(*) FROM ledger.outbox_events WHERE aggregate_id=? AND event_type='payment.refunded'",id));assertEquals(0,scalar("SELECT count(*) FROM ledger.journals WHERE id=? AND operation_id<>?",originalJournal,id));consistent(source);consistent(target);
-    }
-
-    @Test void P0605_refundAuthorityInsufficientFundsAndDurableRejection() throws Exception {
-        User payer=user(),recipient=user(),stranger=user(),administrator=admin(),third=user();String source=account(payer,"P06 refund auth source","CAD"),target=account(recipient,"P06 refund auth target","CAD"),sink=account(third,"P06 sink","CAD");fund(source,5000,"CAD");UUID id=accepted(payer,source,target,2500,"p06-refund-create-05");assertEquals("SETTLED",settle(id));
-        status(404,refund(payer.browser,id,"p06-payer-refund-05",Map.of("amountMinor","100")));status(404,refund(stranger.browser,id,"p06-stranger-refund-05",Map.of("amountMinor","100")));assertEquals(0,scalar("SELECT count(*) FROM ledger.idempotency_records WHERE key IN ('p06-payer-refund-05','p06-stranger-refund-05')"));Response adminRefund=refund(administrator.browser,id,"p06-admin-refund-05",Map.of("amountMinor","500","reason","Administrative accommodation"));status(201,adminRefund);
-        status(201,transfer(recipient.browser,"p06-recipient-spend-05",intent(target,ref(sink),"2000","CAD")));String rejectionKey="p06-insufficient-refund-05";Response rejected=refund(recipient.browser,id,rejectionKey,Map.of("amountMinor","2000")),replay=refund(recipient.browser,id,rejectionKey,Map.of("amountMinor","2000"));status(422,rejected);status(422,replay);assertEquals("INSUFFICIENT_FUNDS",rejected.jsonPath().getString("code"));assertEquals(rejected.asString(),replay.asString());assertEquals("true",replay.header("Idempotency-Replayed"));assertEquals(1,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",id));assertEquals(500,scalar("SELECT refunded_minor FROM ledger.payments WHERE id=?",id));consistent(source);consistent(target);consistent(sink);
-    }
-
-    @Test void P0606_concurrentPartialRefundsCannotExceedOriginalSettlement() throws Exception {
-        User payer=user(),recipient=user();String source=account(payer,"P06 concurrent refund source","CAD"),target=account(recipient,"P06 concurrent refund target","CAD");fund(source,10000,"CAD");UUID id=accepted(payer,source,target,10000,"p06-refund-create-06");assertEquals("SETTLED",settle(id));CyclicBarrier gate=new CyclicBarrier(2);List<Response> results;
-        try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> a=pool.submit(()->{gate.await();return refund(recipient.browser.copy(first.port),id,"p06-concurrent-refund-a",Map.of("amountMinor","8000"));});Future<Response> b=pool.submit(()->{gate.await();return refund(recipient.browser.copy(second.port),id,"p06-concurrent-refund-b",Map.of("amountMinor","8000"));});results=List.of(a.get(15,TimeUnit.SECONDS),b.get(15,TimeUnit.SECONDS));}
-        assertEquals(List.of(201,422),results.stream().map(Response::statusCode).sorted().toList());assertEquals("EXCESS_REFUND",results.stream().filter(r->r.statusCode()==422).findFirst().orElseThrow().jsonPath().getString("code"));assertEquals(1,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",id));assertEquals(8000,scalar("SELECT refunded_minor FROM ledger.payments WHERE id=?",id));assertEquals(8000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(2000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(target)));consistent(source);consistent(target);
-    }
-
-    @Test void P0607_concurrentSameRefundKeyCreatesOneAdjustmentAndChangedIntentConflicts() throws Exception {
-        User payer=user(),recipient=user();String source=account(payer,"P06 same key source","CAD"),target=account(recipient,"P06 same key target","CAD");fund(source,5000,"CAD");UUID id=accepted(payer,source,target,5000,"p06-refund-create-07");assertEquals("SETTLED",settle(id));String key="p06-same-refund-key-07";Map<String,String> body=Map.of("amountMinor","1000","reason","Same instruction");CyclicBarrier gate=new CyclicBarrier(2);Response left,right;
-        try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> a=pool.submit(()->{gate.await();return refund(recipient.browser.copy(first.port),id,key,body);});Future<Response> b=pool.submit(()->{gate.await();return refund(recipient.browser.copy(second.port),id,key,body);});left=a.get(15,TimeUnit.SECONDS);right=b.get(15,TimeUnit.SECONDS);}
-        status(201,left);status(201,right);assertEquals(left.asString(),right.asString());assertEquals(Set.of("true","false"),Set.of(left.header("Idempotency-Replayed"),right.header("Idempotency-Replayed")));Response conflict=refund(recipient.browser,id,key,Map.of("amountMinor","1001","reason","Same instruction"));status(409,conflict);assertEquals("IDEMPOTENCY_CONFLICT",conflict.jsonPath().getString("code"));assertEquals(1,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",id));assertEquals(1000,scalar("SELECT refunded_minor FROM ledger.payments WHERE id=?",id));consistent(source);consistent(target);
-    }
-
-    @Test void P0608_adminFullReversalIsImmutableIdempotentAndFinal() throws Exception {
-        User payer=user(),recipient=user(),administrator=admin(),stranger=user();String source=account(payer,"P06 reversal source","CAD"),target=account(recipient,"P06 reversal target","CAD");fund(source,4000,"CAD");UUID id=accepted(payer,source,target,4000,"p06-reversal-create-08");assertEquals("SETTLED",settle(id));String key="p06-reversal-command-08";Map<String,String> body=Map.of("reason","Administrative correction");Response first=reversal(administrator.browser,id,key,body),replay=reversal(administrator.browser,id,key,body);status(201,first);status(201,replay);assertEquals(first.asString(),replay.asString());assertEquals("true",replay.header("Idempotency-Replayed"));assertEquals("REVERSED",first.jsonPath().getString("adjustmentState"));UUID adjustment=UUID.fromString(first.jsonPath().getString("id"));
-        Response paymentView=payer.browser.call("GET","/payments/"+id,null),adminView=administrator.browser.call("GET","/payments/"+id+"/adjustments/"+adjustment,null);status(200,paymentView);status(200,adminView);assertEquals("SETTLED",paymentView.jsonPath().getString("state"));assertEquals("REVERSED",paymentView.jsonPath().getString("adjustmentState"));status(404,stranger.browser.call("GET","/payments/"+id+"/adjustments/"+adjustment,null));Response second=reversal(administrator.browser,id,"p06-second-reversal-08",body),refundAfter=refund(recipient.browser,id,"p06-refund-after-reversal-08",Map.of("amountMinor","1"));status(409,second);status(409,refundAfter);assertEquals(1,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=? AND kind='REVERSAL'",id));assertEquals(4000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(0,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(target)));consistent(source);consistent(target);
-    }
-
-    @Test void P0609_reversalAfterAnyRefundAndRefundAfterFullRefundAreRejected() throws Exception {
-        User payer=user(),recipient=user(),administrator=admin();String source=account(payer,"P06 transition source","CAD"),target=account(recipient,"P06 transition target","CAD");fund(source,4000,"CAD");UUID id=accepted(payer,source,target,4000,"p06-transition-create-09");assertEquals("SETTLED",settle(id));status(201,refund(recipient.browser,id,"p06-transition-refund-09",Map.of("amountMinor","1")));Response reverse=reversal(administrator.browser,id,"p06-transition-reversal-09",Map.of("reason","Should be forbidden"));status(409,reverse);assertEquals("REVERSAL_FORBIDDEN",reverse.jsonPath().getString("code"));status(201,refund(recipient.browser,id,"p06-transition-full-09",Map.of("amountMinor","3999")));Response excess=refund(recipient.browser,id,"p06-transition-excess-09",Map.of("amountMinor","1"));status(422,excess);assertEquals("EXCESS_REFUND",excess.jsonPath().getString("code"));assertEquals(2,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=? AND kind='REFUND'",id));assertEquals(0,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=? AND kind='REVERSAL'",id));assertEquals("SETTLED",text("SELECT state FROM ledger.payments WHERE id=?",id));assertEquals(4000,scalar("SELECT refunded_minor FROM ledger.payments WHERE id=?",id));consistent(source);consistent(target);
-    }
-
-    @Test void P0610_reversalVersusRecipientSpendingHasExactlyOneWinner() throws Exception {
-        User payer=user(),recipient=user(),administrator=admin(),third=user();String source=account(payer,"P06 reversal race source","CAD"),target=account(recipient,"P06 reversal race target","CAD"),sink=account(third,"P06 reversal race sink","CAD");fund(source,5000,"CAD");UUID id=accepted(payer,source,target,5000,"p06-reversal-race-create-10");assertEquals("SETTLED",settle(id));CyclicBarrier gate=new CyclicBarrier(2);Response reverse,spend;
-        try(ExecutorService pool=Executors.newFixedThreadPool(2)){Future<Response> a=pool.submit(()->{gate.await();return reversal(administrator.browser.copy(first.port),id,"p06-reversal-race-10",Map.of("reason","Concurrent review"));});Future<Response> b=pool.submit(()->{gate.await();return transfer(recipient.browser.copy(second.port),"p06-recipient-race-spend-10",intent(target,ref(sink),"5000","CAD"));});reverse=a.get(15,TimeUnit.SECONDS);spend=b.get(15,TimeUnit.SECONDS);}
-        assertEquals(List.of(201,422),List.of(reverse.statusCode(),spend.statusCode()).stream().sorted().toList());assertEquals(5000,scalar("SELECT coalesce(sum(posted_minor),0) FROM ledger.account_balances WHERE account_id IN (?,?,?)",UUID.fromString(source),UUID.fromString(target),UUID.fromString(sink)));if(reverse.statusCode()==201){assertEquals("REVERSED",text("SELECT CASE WHEN reversed THEN 'REVERSED' ELSE 'NONE' END FROM ledger.payments WHERE id=?",id));assertEquals(5000,scalar("SELECT posted_minor FROM ledger.account_balances WHERE account_id=?",UUID.fromString(source)));assertEquals(0,scalar("SELECT count(*) FROM ledger.transfers WHERE source_id=?",UUID.fromString(target)));}else{assertEquals("INSUFFICIENT_FUNDS",reverse.jsonPath().getString("code"));assertEquals(1,scalar("SELECT count(*) FROM ledger.transfers WHERE source_id=?",UUID.fromString(target)));assertEquals(0,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",id));}consistent(source);consistent(target);consistent(sink);
-    }
-
-    @Test void P0611_lostRefundResponseReplaysOriginalAdjustment() throws Exception {
-        User payer=user(),recipient=user();String source=account(payer,"P06 lost response source","CAD"),target=account(recipient,"P06 lost response target","CAD");fund(source,3000,"CAD");UUID id=accepted(payer,source,target,3000,"p06-lost-refund-create-11");assertEquals("SETTLED",settle(id));String key="p06-lost-refund-command-11",body=JSON.writeValueAsString(Map.of("amountMinor","1000","reason","Response may be lost"));
-        try(DropAfterCommitProxy proxy=new DropAfterCommitProxy(first.port)){HttpRequest request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+proxy.port()+"/api/v1/payments/"+id+"/refunds")).timeout(Duration.ofSeconds(10)).header("Accept","application/json").header("Content-Type","application/json").header("Cookie",recipient.browser.cookieHeader()).header("X-XSRF-TOKEN",recipient.browser.csrf).header("Idempotency-Key",key).POST(HttpRequest.BodyPublishers.ofString(body)).build();HttpClient client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();assertThrows(IOException.class,()->client.send(request,HttpResponse.BodyHandlers.ofString()));assertEquals(201,proxy.status());}
-        UUID committed=UUID.fromString(text("SELECT id::text FROM ledger.adjustments WHERE payment_id=?",id));Response replay=refund(recipient.browser,id,key,body);status(201,replay);assertEquals("true",replay.header("Idempotency-Replayed"));assertEquals(committed.toString(),replay.jsonPath().getString("id"));assertEquals(1,scalar("SELECT count(*) FROM ledger.adjustments WHERE payment_id=?",id));consistent(source);consistent(target);
-    }
-
-    @Test void P0612_adjustmentContractValidationCsrfAndRestrictedRuntime() throws Exception {
-        Browser anonymous=new Browser(first.port);User payer=user(),recipient=user(),administrator=admin();String source=account(payer,"P06 contract source","CAD"),target=account(recipient,"P06 contract target","CAD");fund(source,2000,"CAD");UUID id=accepted(payer,source,target,2000,"p06-contract-create-12");assertEquals("SETTLED",settle(id));status(401,anonymous.call("GET","/payments/"+id+"/adjustments",null));anonymous.csrf();status(401,anonymous.call("POST","/payments/"+id+"/refunds",Map.of("amountMinor","1"),Map.of("Idempotency-Key","p06-anonymous-refund")));
-        Map<String,Object> injected=new HashMap<>();injected.put("amountMinor","1");injected.put("paymentId",id.toString());status(400,refund(recipient.browser,id,"p06-refund-mass-assignment",injected));assertEquals(0,scalar("SELECT count(*) FROM ledger.idempotency_records WHERE actor_id=? AND key='p06-refund-mass-assignment'",recipient.id));recipient.browser.csrf=null;status(403,refund(recipient.browser,id,"p06-refund-no-csrf",Map.of("amountMinor","1")));recipient.browser.csrf();status(400,reversal(administrator.browser,id,"p06-reversal-control-reason",Map.of("reason","bad\nreason")));
-        Response specResponse=anonymous.call("GET","/openapi/p06.json",null);status(200,specResponse);var spec=JSON.readTree(specResponse.asString());for(String path:List.of("/api/v1/payments/{id}/cancel","/api/v1/payments/{id}/refunds","/api/v1/payments/{id}/reversal","/api/v1/payments/{id}/adjustments","/api/v1/payments/{id}/adjustments/{adjustmentId}"))assertTrue(spec.path("paths").has(path),path);try(Connection c=runtime();Statement statement=c.createStatement()){assertEquals("42501",assertThrows(SQLException.class,()->statement.execute("INSERT INTO ledger.adjustments(id,payment_id,actor_id,kind,amount_minor,journal_id,reason) VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'REFUND',1,gen_random_uuid(),'forged')")).getSQLState());assertEquals("42501",assertThrows(SQLException.class,()->statement.execute("SELECT ledger._payment_command_event(gen_random_uuid(),gen_random_uuid(),'payment.refunded',gen_random_uuid(),'forged')")).getSQLState());}assertEquals(8,scalar("SELECT count(*) FROM public.flyway_schema_history WHERE success AND version IS NOT NULL"));consistent(source);consistent(target);
-    }
-
 }

```

### frontend/package.json

REVIEW_DIFFERENCE

```diff
--- branch/frontend/package.json
+++ main-history/frontend/package.json
@@ -1,11 +1,11 @@
 {
   "name": "ledgerguard-client-core",
-  "version": "0.3.0",
+  "version": "0.2.0",
   "private": true,
   "type": "commonjs",
   "scripts": {
     "typecheck": "tsc --project tsconfig.core.json",
-    "test": "cd .. && node tests/contracts/client.test.cjs && node tests/contracts/auth-client.test.cjs && node tests/contracts/transfer-client.test.cjs && node tests/contracts/payment-client.test.cjs && node tests/contracts/payment-adjustment-client.test.cjs",
+    "test": "cd .. && node tests/contracts/client.test.cjs && node tests/contracts/auth-client.test.cjs && node tests/contracts/transfer-client.test.cjs && node tests/contracts/payment-client.test.cjs && node tests/contracts/payment-adjustment-client.test.cjs && node tests/contracts/webhook-client.test.cjs",
     "verify": "npm run typecheck && npm test"
   },
   "devDependencies": {

```

### frontend/src/api.ts

REVIEW_DIFFERENCE

```diff
--- branch/frontend/src/api.ts
+++ main-history/frontend/src/api.ts
@@ -13,9 +13,6 @@
 export interface TransferRecord { id: string; sourceId: string; recipientRef: string; amountMinor: string; currency: Currency; state: 'SETTLED'; journalId: string; createdAt: string; }
 export interface PaymentReceipt { id: string; kind: 'PAYMENT'; state: 'PENDING'; amountMinor: string; currency: Currency; }
 export interface PaymentRecord { id: string; direction: 'OUTGOING' | 'INCOMING'; accountId: string; counterpartyRef: string; amountMinor: string; currency: Currency; state: 'PENDING' | 'SETTLED' | 'FAILED' | 'CANCELLED'; version: string; adjustmentState: 'NONE' | 'PARTIALLY_REFUNDED' | 'FULLY_REFUNDED' | 'REVERSED'; journalId?: string; failureCode?: string; projectionState?: 'PENDING' | 'SETTLED' | 'FAILED' | 'CANCELLED'; projectionVersion?: string; createdAt: string; updatedAt: string; }
-export type PaymentAdjustmentState = 'NONE' | 'PARTIALLY_REFUNDED' | 'FULLY_REFUNDED' | 'REVERSED';
-export interface PaymentCommandReceipt { id: string; operationId: string; paymentId: string; kind: 'CANCEL' | 'REFUND' | 'REVERSAL'; state: 'CANCELLED' | 'SETTLED'; adjustmentState: PaymentAdjustmentState; amountMinor: string; currency: Currency; journalId?: string; }
-export interface PaymentAdjustment { id: string; paymentId: string; kind: 'REFUND' | 'REVERSAL'; amountMinor: string; currency: Currency; journalId: string; reason: string; createdAt: string; }
 export interface CommandResponse<T> { status: number; body: T; replayed: boolean; }
 export class ApiError extends Error {
   constructor(readonly status: number, readonly problem: Problem) { super(problem.message); this.name = 'ApiError'; }
@@ -36,20 +33,6 @@
   return Object.freeze({ ...normalized, recipientRef: `LG-${normalized.recipientRef.slice(3).toLowerCase()}` });
 }
 export const normalizePaymentIntent = normalizeTransferIntent;
-
-function paymentIdentity(value: string): string {
-  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new TypeError('Invalid payment identity');
-  return value.toLowerCase();
-}
-function commandReason(value: string | undefined, required: boolean): string | undefined {
-  if (value === undefined) {
-    if (required) throw new TypeError('Reason required');
-    return undefined;
-  }
-  const normalized = value.trim();
-  if (!normalized || normalized.length > 500 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new TypeError('Invalid reason');
-  return normalized;
-}

 export class ApiClient {
   private csrf: { headerName: string; token: string } | undefined;
@@ -102,33 +85,6 @@
     if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new TypeError('Invalid pagination');
     return this.get<Page<PaymentRecord>>(`/payments?limit=${limit}&offset=${offset}`);
   }
-  cancelPayment(id: string, key: string, reason?: string): Promise<CommandResponse<PaymentCommandReceipt>> {
-    const paymentId = paymentIdentity(id);
-    const normalizedReason = commandReason(reason, false);
-    return this.command<PaymentCommandReceipt>(`/payments/${paymentId}/cancel`, normalizedReason === undefined ? {} : { reason: normalizedReason }, key);
-  }
-  refundPayment(id: string, amountMinor: string, key: string, reason?: string): Promise<CommandResponse<PaymentCommandReceipt>> {
-    const paymentId = paymentIdentity(id);
-    const amount = minor(amountMinor, MAX_TRANSACTION);
-    if (amount === 0n) throw new TypeError('Invalid refund amount');
-    const normalizedReason = commandReason(reason, false);
-    const body: { amountMinor: string; reason?: string } = { amountMinor: amount.toString() };
-    if (normalizedReason !== undefined) body.reason = normalizedReason;
-    return this.command<PaymentCommandReceipt>(`/payments/${paymentId}/refunds`, body, key);
-  }
-  reversePayment(id: string, reason: string, key: string): Promise<CommandResponse<PaymentCommandReceipt>> {
-    const paymentId = paymentIdentity(id);
-    return this.command<PaymentCommandReceipt>(`/payments/${paymentId}/reversal`, { reason: commandReason(reason, true) }, key);
-  }
-  paymentAdjustments(id: string, limit = 50, offset = 0): Promise<Page<PaymentAdjustment>> {
-    const paymentId = paymentIdentity(id);
-    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new TypeError('Invalid pagination');
-    return this.get<Page<PaymentAdjustment>>(`/payments/${paymentId}/adjustments?limit=${limit}&offset=${offset}`);
-  }
-  paymentAdjustment(id: string, adjustmentId: string): Promise<PaymentAdjustment> {
-    const paymentId = paymentIdentity(id);
-    return this.get<PaymentAdjustment>(`/payments/${paymentId}/adjustments/${paymentIdentity(adjustmentId)}`);
-  }
   async command<T>(path: string, body: unknown, key?: string): Promise<CommandResponse<T>> {
     if (!this.csrf) await this.csrfToken();
     return this.request<T>(path, 'POST', body, key);

```

### frontend/tsconfig.core.json

REVIEW_DIFFERENCE

```diff
--- branch/frontend/tsconfig.core.json
+++ main-history/frontend/tsconfig.core.json
@@ -16,6 +16,8 @@
     "src/money.ts",
     "src/api.ts",
     "src/intent-store.ts",
-    "src/adjustment-store.ts"
+    "src/p08b-core.ts",
+    "src/webhook-api.ts",
+    "src/p08c-core.ts"
   ]
 }

```

### scripts/test-client

REVIEW_DIFFERENCE

```diff
--- branch/scripts/test-client
+++ main-history/scripts/test-client
@@ -5,6 +5,5 @@
 node tests/contracts/client.test.cjs
 node tests/contracts/auth-client.test.cjs
 node tests/contracts/transfer-client.test.cjs
-
 node tests/contracts/payment-client.test.cjs
 node tests/contracts/payment-adjustment-client.test.cjs

```

### backend/src/main/resources/db/migration/V8__p06_payment_adjustments.sql

PATH_NOT_IN_MAIN_HISTORY

```diff
-- P06 exposes and hardens cancellation, refund and administrative reversal commands.
-- V1-V7 remain immutable; this migration replaces only the protected command boundary
-- and adds an internal event helper for adjustment-specific durable events.
SET search_path=ledger,pg_catalog;

CREATE FUNCTION _payment_command_event(
 p_payment uuid,
 p_operation uuid,
 p_type text,
 p_correlation uuid,
 p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ledger,pg_temp AS $$
DECLARE
 payment ledger.payments%ROWTYPE;
 adjustment ledger.adjustments%ROWTYPE;
 adjustment_state text;
 payload jsonb;
BEGIN
 IF p_payment IS NULL OR p_operation IS NULL OR p_correlation IS NULL
 OR p_type NOT IN ('payment.cancelled','payment.refunded','payment.reversed') THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_PAYMENT_COMMAND_EVENT';
 END IF;
 SELECT * INTO STRICT payment FROM ledger.payments WHERE id=p_payment;
 adjustment_state:=CASE
  WHEN payment.reversed THEN 'REVERSED'
  WHEN payment.refunded_minor=0 THEN 'NONE'
  WHEN payment.refunded_minor=payment.amount_minor THEN 'FULLY_REFUNDED'
  ELSE 'PARTIALLY_REFUNDED'
 END;
 IF p_type IN ('payment.refunded','payment.reversed') THEN
  SELECT * INTO STRICT adjustment FROM ledger.adjustments
  WHERE id=p_operation AND payment_id=p_payment;
 END IF;
 payload:=jsonb_strip_nulls(jsonb_build_object(
  'paymentId',payment.id,
  'version',payment.version,
  'state',payment.state,
  'amountMinor',payment.amount_minor::text,
  'currency',payment.currency,
  'refundedMinor',payment.refunded_minor::text,
  'reversed',payment.reversed,
  'journalId',payment.journal_id,
  'adjustmentState',adjustment_state,
  'operationId',p_operation,
  'adjustmentId',adjustment.id,
  'adjustmentKind',adjustment.kind,
  'adjustmentAmountMinor',CASE WHEN adjustment.id IS NULL THEN NULL ELSE adjustment.amount_minor::text END,
  'adjustmentJournalId',adjustment.journal_id,
  'reason',nullif(btrim(coalesce(p_reason,'')),'')
 ));
 INSERT INTO ledger.outbox_events(
  aggregate_id,aggregate_version,event_type,correlation_id,payload
 ) VALUES(payment.id,payment.version,p_type,p_correlation,payload);
END $$;

CREATE OR REPLACE FUNCTION execute_command(
 p_actor uuid,
 p_kind text,
 p_parent uuid,
 p_key text,
 p_payload jsonb,
 p_correlation uuid
) RETURNS TABLE(http_status integer,body jsonb,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ledger,pg_temp AS $$
<<cmd>>
DECLARE
 scope text:=coalesce(p_parent::text,'');
 fingerprint text;
 prior ledger.idempotency_records%ROWTYPE;
 actor ledger.app_users%ROWTYPE;
 source ledger.accounts%ROWTYPE;
 destination ledger.accounts%ROWTYPE;
 payment ledger.payments%ROWTYPE;
 amount bigint;
 operation uuid:=gen_random_uuid();
 journal uuid;
 status integer;
 result jsonb;
 balance ledger.account_balances%ROWTYPE;
 reason text;
 destination_owner uuid;
 adjustment_state text;
BEGIN
 SELECT * INTO actor FROM ledger.app_users WHERE id=p_actor AND enabled;
 IF actor.id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='FORBIDDEN';
 END IF;
 IF p_kind NOT IN ('TRANSFER','PAYMENT','CANCEL','REFUND','REVERSAL') OR p_kind IS NULL
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
 OR octet_length(p_payload::text)>4096 OR p_correlation IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_COMMAND';
 END IF;
 IF (p_kind IN ('TRANSFER','PAYMENT') AND p_parent IS NOT NULL)
 OR (p_kind IN ('CANCEL','REFUND','REVERSAL') AND p_parent IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_PARENT';
 END IF;

 -- Unknown fields and malformed values are rejected before claiming an idempotency identity.
 IF (p_kind IN ('TRANSFER','PAYMENT') AND EXISTS(
      SELECT 1 FROM jsonb_object_keys(p_payload) key_name
      WHERE key_name NOT IN ('sourceId','recipientRef','amountMinor','currency')))
 OR (p_kind='REFUND' AND EXISTS(
      SELECT 1 FROM jsonb_object_keys(p_payload) key_name
      WHERE key_name NOT IN ('amountMinor','reason')))
 OR (p_kind IN ('CANCEL','REVERSAL') AND EXISTS(
      SELECT 1 FROM jsonb_object_keys(p_payload) key_name WHERE key_name<>'reason')) THEN
  RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='UNKNOWN_FIELD';
 END IF;
 IF p_payload ? 'reason' THEN
  IF jsonb_typeof(p_payload->'reason')<>'string'
  OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 500
  OR (p_payload->>'reason') ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_REASON';
  END IF;
  p_payload:=jsonb_set(p_payload,'{reason}',to_jsonb(btrim(p_payload->>'reason')));
 END IF;
 IF p_kind IN ('TRANSFER','PAYMENT','REFUND') THEN
  IF p_payload->>'amountMinor' IS NULL
  OR jsonb_typeof(p_payload->'amountMinor')<>'string'
  OR (p_payload->>'amountMinor') !~ '^[1-9][0-9]{0,12}$'
  OR (p_payload->>'amountMinor')::numeric>1000000000000 THEN
   RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_AMOUNT';
  END IF;
  amount:=(p_payload->>'amountMinor')::bigint;
 END IF;
 IF p_kind IN ('TRANSFER','PAYMENT') THEN
  IF p_payload->>'currency' IS NULL OR p_payload->>'currency' NOT IN ('CAD','USD','JPY','KWD')
  OR p_payload->>'sourceId' IS NULL OR p_payload->>'recipientRef' IS NULL
  OR jsonb_typeof(p_payload->'sourceId')<>'string'
  OR (p_payload->>'sourceId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR jsonb_typeof(p_payload->'recipientRef')<>'string'
  OR btrim(p_payload->>'recipientRef') !~ '^LG-[0-9a-f]{32}$'
  OR jsonb_typeof(p_payload->'currency')<>'string' THEN
   RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='INVALID_INTENT';
  END IF;
  p_payload:=jsonb_set(
   jsonb_set(p_payload,'{sourceId}',to_jsonb(lower(p_payload->>'sourceId'))),
   '{recipientRef}',to_jsonb(btrim(p_payload->>'recipientRef'))
  );
  SELECT * INTO source FROM ledger.accounts
  WHERE id=(p_payload->>'sourceId')::uuid AND owner_id=p_actor AND kind='WALLET_LIABILITY';
  IF source.id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND';
  END IF;
  IF actor.role<>'CUSTOMER' THEN
   RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='ADMIN_CANNOT_SPEND';
  END IF;
 END IF;
 IF p_kind='REFUND' AND NOT p_payload ? 'reason' THEN
  p_payload:=p_payload||jsonb_build_object('reason','Recipient refund');
 END IF;

 -- Parent authorization precedes idempotency claim, so guessed foreign IDs create no durable trace.
 IF p_kind IN ('CANCEL','REFUND','REVERSAL') THEN
  SELECT * INTO payment FROM ledger.payments WHERE id=p_parent FOR UPDATE;
  IF payment.id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND';
  END IF;
  SELECT owner_id INTO destination_owner FROM ledger.accounts WHERE id=payment.destination_id;
  IF p_kind='CANCEL' THEN
   IF payment.actor_id<>p_actor AND actor.role<>'ADMIN' THEN
    RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND';
   END IF;
   IF actor.role='ADMIN' AND NOT p_payload ? 'reason' THEN
    RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='ADMIN_REASON_REQUIRED';
   END IF;
  ELSIF p_kind='REFUND' THEN
   IF actor.role<>'ADMIN' AND destination_owner<>p_actor THEN
    RAISE EXCEPTION USING ERRCODE='P4040',MESSAGE='NOT_FOUND';
   END IF;
  ELSE
   IF actor.role<>'ADMIN' THEN
    RAISE EXCEPTION USING ERRCODE='P4030',MESSAGE='REVERSAL_AUTHORITY_REQUIRED';
   END IF;
   IF NOT p_payload ? 'reason' THEN
    RAISE EXCEPTION USING ERRCODE='P4000',MESSAGE='ADMIN_REASON_REQUIRED';
   END IF;
  END IF;
 END IF;

 fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
  'v',1,'actor',p_actor,'kind',p_kind,'parent',scope,'intent',p_payload
 )::text,'UTF8'),'sha256'),'hex');
 INSERT INTO ledger.idempotency_records(actor_id,operation_kind,parent_scope,key,fingerprint)
 VALUES(p_actor,p_kind,scope,p_key,fingerprint) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN
  SELECT * INTO prior FROM ledger.idempotency_records
  WHERE actor_id=p_actor AND operation_kind=p_kind AND parent_scope=scope AND key=p_key FOR UPDATE;
  IF prior.fingerprint<>fingerprint THEN
   RETURN QUERY SELECT 409,jsonb_build_object('code','IDEMPOTENCY_CONFLICT'),false;
   RETURN;
  END IF;
  IF prior.status IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INCOMPLETE_IDEMPOTENCY_RECORD';
  END IF;
  RETURN QUERY SELECT prior.status,prior.response,true;
  RETURN;
 END IF;

 BEGIN
  IF p_kind IN ('TRANSFER','PAYMENT') THEN
   SELECT destination_account.* INTO destination
   FROM ledger.accounts AS destination_account
   WHERE destination_account.public_ref=p_payload->>'recipientRef'
    AND destination_account.kind='WALLET_LIABILITY' AND destination_account.status='OPEN';
   IF destination.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='INVALID_RECIPIENT';
   END IF;
   IF source.status<>'OPEN' OR source.id=destination.id
   OR source.currency<>destination.currency OR source.currency<>p_payload->>'currency' THEN
    RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='INVALID_ACCOUNT_OR_CURRENCY';
   END IF;
   IF p_kind='TRANSFER' THEN
    journal:=ledger._post(operation,'TRANSFER',source.id,destination.id,amount,source.currency);
    INSERT INTO ledger.transfers(id,actor_id,source_id,destination_id,amount_minor,currency,journal_id)
    VALUES(operation,p_actor,source.id,destination.id,amount,source.currency,journal);
    PERFORM ledger._audit(p_actor,'TRANSFER',operation,operation,1,p_correlation,'');
    result:=jsonb_build_object(
     'id',operation,'kind','TRANSFER','state','SETTLED','journalId',journal,
     'amountMinor',amount::text,'currency',source.currency
    );
    INSERT INTO ledger.outbox_events(aggregate_id,aggregate_version,event_type,correlation_id,payload)
    VALUES(operation,1,'transfer.settled',p_correlation,result);
    status:=201;
   ELSE
    INSERT INTO ledger.payments(id,actor_id,source_id,destination_id,amount_minor,currency)
    VALUES(operation,p_actor,source.id,destination.id,amount,source.currency);
    PERFORM 1 FROM ledger.account_balances
    WHERE account_id IN (source.id,destination.id) ORDER BY account_id FOR UPDATE;
    SELECT * INTO balance FROM ledger.account_balances WHERE account_id=source.id;
    IF balance.posted_minor-balance.reserved_minor<amount THEN
     RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='INSUFFICIENT_FUNDS';
    END IF;
    UPDATE ledger.account_balances
    SET reserved_minor=reserved_minor+amount,version=version+1,updated_at=clock_timestamp()
    WHERE account_id=source.id;
    INSERT INTO ledger.holds(payment_id,account_id,amount_minor,state)
    VALUES(operation,source.id,amount,'ACTIVE');
    PERFORM ledger._audit(p_actor,'PAYMENT_ACCEPTED',operation,operation,1,p_correlation,'');
    PERFORM ledger._payment_event(operation,'payment.requested',p_correlation);
    result:=jsonb_build_object(
     'id',operation,'kind','PAYMENT','state','PENDING',
     'amountMinor',amount::text,'currency',source.currency
    );
    status:=202;
   END IF;
  ELSIF p_kind='CANCEL' THEN
   IF payment.state<>'PENDING' THEN
    RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='INVALID_PAYMENT_STATE';
   END IF;
   PERFORM 1 FROM ledger.account_balances
   WHERE account_id IN (payment.source_id,payment.destination_id) ORDER BY account_id FOR UPDATE;
   UPDATE ledger.holds SET state='RELEASED',updated_at=clock_timestamp()
   WHERE payment_id=payment.id AND state='ACTIVE';
   IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MISSING_ACTIVE_HOLD';
   END IF;
   UPDATE ledger.account_balances
   SET reserved_minor=reserved_minor-payment.amount_minor,version=version+1,updated_at=clock_timestamp()
   WHERE account_id=payment.source_id AND reserved_minor>=payment.amount_minor;
   IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='RESERVATION_UNDERFLOW';
   END IF;
   UPDATE ledger.payments
   SET state='CANCELLED',version=version+1,updated_at=clock_timestamp()
   WHERE id=payment.id;
   reason:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
   result:=jsonb_build_object(
    'id',operation,'operationId',operation,'paymentId',payment.id,'kind','CANCEL',
    'state','CANCELLED','adjustmentState','NONE',
    'amountMinor',payment.amount_minor::text,'currency',payment.currency
   );
   status:=200;
   PERFORM ledger._audit(p_actor,'PAYMENT_CANCELLED',payment.id,operation,payment.version+1,p_correlation,coalesce(reason,''));
   PERFORM ledger._payment_command_event(payment.id,operation,'payment.cancelled',p_correlation,reason);
  ELSE
   IF payment.state<>'SETTLED' THEN
    RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='INVALID_PAYMENT_STATE';
   END IF;
   IF payment.reversed THEN
    RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='ADJUSTMENT_FINAL';
   END IF;
   reason:=btrim(coalesce(p_payload->>'reason','Recipient refund'));
   IF p_kind='REVERSAL' THEN
    IF payment.refunded_minor<>0 THEN
     RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='REVERSAL_FORBIDDEN';
    END IF;
    amount:=payment.amount_minor;
   ELSIF amount>payment.amount_minor-payment.refunded_minor THEN
    RAISE EXCEPTION USING ERRCODE='P4220',MESSAGE='EXCESS_REFUND';
   END IF;
   journal:=ledger._post(operation,p_kind,payment.destination_id,payment.source_id,amount,payment.currency);
   INSERT INTO ledger.adjustments(id,payment_id,actor_id,kind,amount_minor,journal_id,reason)
   VALUES(operation,payment.id,p_actor,p_kind,amount,journal,reason);
   UPDATE ledger.payments
   SET refunded_minor=refunded_minor+CASE WHEN p_kind='REFUND' THEN amount ELSE 0 END,
       reversed=(p_kind='REVERSAL'),version=version+1,updated_at=clock_timestamp()
   WHERE id=payment.id;
   adjustment_state:=CASE
    WHEN p_kind='REVERSAL' THEN 'REVERSED'
    WHEN payment.refunded_minor+amount=payment.amount_minor THEN 'FULLY_REFUNDED'
    ELSE 'PARTIALLY_REFUNDED'
   END;
   result:=jsonb_build_object(
    'id',operation,'operationId',operation,'paymentId',payment.id,'kind',p_kind,
    'state','SETTLED','adjustmentState',adjustment_state,
    'amountMinor',amount::text,'currency',payment.currency,'journalId',journal
   );
   status:=201;
   PERFORM ledger._audit(
    p_actor,CASE WHEN p_kind='REFUND' THEN 'PAYMENT_REFUNDED' ELSE 'PAYMENT_REVERSED' END,
    payment.id,operation,payment.version+1,p_correlation,reason
   );
   PERFORM ledger._payment_command_event(
    payment.id,operation,
    CASE WHEN p_kind='REFUND' THEN 'payment.refunded' ELSE 'payment.reversed' END,
    p_correlation,reason
   );
  END IF;
 EXCEPTION
  WHEN SQLSTATE 'P4220' THEN status:=422;result:=jsonb_build_object('code',SQLERRM);
  WHEN SQLSTATE 'P4090' THEN status:=409;result:=jsonb_build_object('code',SQLERRM);
  WHEN SQLSTATE 'P4040' THEN status:=404;result:=jsonb_build_object('code','NOT_FOUND');
  WHEN SQLSTATE 'P4030' THEN status:=403;result:=jsonb_build_object('code','FORBIDDEN');
 END;

 UPDATE ledger.idempotency_records
 SET status=cmd.status,response=result,
     operation_id=CASE WHEN cmd.status<300 THEN operation ELSE NULL END
 WHERE actor_id=p_actor AND operation_kind=p_kind AND parent_scope=scope AND key=p_key;
 RETURN QUERY SELECT cmd.status,result,false;
END $$;

REVOKE ALL ON FUNCTION ledger._payment_command_event(uuid,uuid,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.execute_command(uuid,text,uuid,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ledger.execute_command(uuid,text,uuid,text,jsonb,uuid) TO ledger_runtime;

```

### backend/src/main/resources/openapi/p06.json

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/resources/openapi/p06.json
+++ main-history/backend/src/main/resources/openapi/p06.json
@@ -1,2753 +1 @@
-{
-  "openapi": "3.0.3",
-  "info": {
-    "title": "LedgerGuard payment adjustment reliability API",
-    "version": "0.6.0",
-    "description": "Synthetic money only. P06 exposes idempotent payment cancellation before settlement, recipient-authorized partial/full refunds, and reasoned ADMIN full reversal. Commands lock the authoritative payment before balances, preserve the original settlement journal, write immutable compensating journals/audit/outbox records atomically, and expose adjustment history. P01-P05 authentication, transfer, payment, messaging and recovery boundaries remain supported."
-  },
-  "servers": [
-    {
-      "url": "/"
-    }
-  ],
-  "security": [
-    {
-      "SessionCookie": []
-    }
-  ],
-  "paths": {
-    "/api/v1/auth/csrf": {
-      "get": {
-        "operationId": "acquireCsrf",
-        "security": [],
-        "responses": {
-          "200": {
-            "description": "CSRF token",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Csrf"
-                }
-              }
-            }
-          }
-        }
-      }
-    },
-    "/api/v1/auth/register": {
-      "post": {
-        "operationId": "registerCustomer",
-        "security": [
-          {
-            "CsrfHeader": []
-          }
-        ],
-        "requestBody": {
-          "required": true,
-          "content": {
-            "application/json": {
-              "schema": {
-                "$ref": "#/components/schemas/Registration"
-              }
-            }
-          }
-        },
-        "responses": {
-          "201": {
-            "description": "Registered CUSTOMER",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Registered"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "409": {
-            "description": "Registration rejected",
-            "content": {
-              "application/problem+json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Problem"
-                }
-              }
-            }
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/auth/login": {
-      "post": {
-        "operationId": "login",
-        "security": [
-          {
-            "CsrfHeader": []
-          }
-        ],
-        "requestBody": {
-          "required": true,
-          "content": {
-            "application/json": {
-              "schema": {
-                "$ref": "#/components/schemas/Login"
-              }
-            }
-          }
-        },
-        "responses": {
-          "200": {
-            "description": "Session issued only in HttpOnly cookie",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Session"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/auth/me": {
-      "get": {
-        "operationId": "currentUser",
-        "responses": {
-          "200": {
-            "description": "Current session identity",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Session"
-                }
-              }
-            }
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/auth/logout": {
-      "post": {
-        "operationId": "logout",
-        "security": [
-          {
-            "SessionCookie": [],
-            "CsrfHeader": []
-          }
-        ],
-        "responses": {
-          "204": {
-            "description": "Persisted session revoked; empty body"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/accounts": {
-      "get": {
-        "operationId": "listOwnedAccounts",
-        "parameters": [
-          {
-            "$ref": "#/components/parameters/Limit"
-          },
-          {
-            "$ref": "#/components/parameters/Offset"
-          }
-        ],
-        "responses": {
-          "200": {
-            "description": "Owned accounts",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/AccountPage"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      },
-      "post": {
-        "operationId": "createAccount",
-        "security": [
-          {
-            "SessionCookie": [],
-            "CsrfHeader": []
-          }
-        ],
-        "requestBody": {
-          "required": true,
-          "content": {
-            "application/json": {
-              "schema": {
-                "$ref": "#/components/schemas/CreateAccount"
-              }
-            }
-          }
-        },
-        "responses": {
-          "201": {
-            "description": "Zero-balance owned wallet",
-            "headers": {
-              "Location": {
-                "schema": {
-                  "type": "string"
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Account"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/accounts/{id}": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/AccountId"
-        }
-      ],
-      "get": {
-        "operationId": "getOwnedAccount",
-        "responses": {
-          "200": {
-            "description": "Owned account",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Account"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/accounts/{id}/entries": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/AccountId"
-        },
-        {
-          "$ref": "#/components/parameters/Limit"
-        },
-        {
-          "$ref": "#/components/parameters/Offset"
-        }
-      ],
-      "get": {
-        "operationId": "listOwnedEntries",
-        "responses": {
-          "200": {
-            "description": "Owner-scoped entry lines",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/EntryPage"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/accounts/{id}/transactions": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/AccountId"
-        },
-        {
-          "$ref": "#/components/parameters/Limit"
-        },
-        {
-          "$ref": "#/components/parameters/Offset"
-        }
-      ],
-      "get": {
-        "operationId": "listOwnedTransactions",
-        "responses": {
-          "200": {
-            "description": "Owner-scoped economic effects",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/TransactionPage"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/recipients/{publicRef}": {
-      "get": {
-        "operationId": "resolveRecipient",
-        "parameters": [
-          {
-            "name": "publicRef",
-            "in": "path",
-            "required": true,
-            "schema": {
-              "type": "string",
-              "pattern": "^LG-[a-fA-F0-9]{32}$"
-            }
-          }
-        ],
-        "responses": {
-          "200": {
-            "description": "Minimal public routing data",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Recipient"
-                }
-              }
-            }
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/transfers": {
-      "get": {
-        "operationId": "listOwnedTransfers",
-        "description": "Outgoing immediate transfers created by the authenticated actor only. Stable order: created_at descending, id descending.",
-        "parameters": [
-          {
-            "$ref": "#/components/parameters/Limit"
-          },
-          {
-            "$ref": "#/components/parameters/Offset"
-          }
-        ],
-        "responses": {
-          "200": {
-            "description": "Owned transfer records",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/TransferPage"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      },
-      "post": {
-        "operationId": "createImmediateTransfer",
-        "description": "Atomically post one balanced immediate transfer, financial audit record, idempotency outcome and outbox event. Source ownership comes from the authenticated principal. Deterministic business rejections are stored/replayed as the same minimal code envelope.",
-        "security": [
-          {
-            "SessionCookie": [],
-            "CsrfHeader": []
-          }
-        ],
-        "parameters": [
-          {
-            "$ref": "#/components/parameters/IdempotencyKey"
-          }
-        ],
-        "requestBody": {
-          "required": true,
-          "content": {
-            "application/json": {
-              "schema": {
-                "$ref": "#/components/schemas/TransferIntent"
-              }
-            }
-          }
-        },
-        "responses": {
-          "201": {
-            "description": "Transfer committed. An identical replay returns this same status/body/resource.",
-            "headers": {
-              "Location": {
-                "schema": {
-                  "type": "string"
-                }
-              },
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/TransferReceipt"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "409": {
-            "description": "Same scoped key with different normalized intent",
-            "headers": {
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/CommandRejection"
-                }
-              }
-            }
-          },
-          "413": {
-            "description": "Body exceeds 16384 bytes",
-            "content": {
-              "application/problem+json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Problem"
-                }
-              }
-            }
-          },
-          "422": {
-            "description": "Durable business rejection such as insufficient funds or cross-currency/self transfer. Identical replay returns the same status/body.",
-            "headers": {
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/CommandRejection"
-                }
-              }
-            }
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/transfers/{id}": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/TransferId"
-        }
-      ],
-      "get": {
-        "operationId": "getOwnedTransfer",
-        "description": "Returns an outgoing transfer only to its authenticated creator. Destination account UUID, owner and balance are never exposed.",
-        "responses": {
-          "200": {
-            "description": "Owned immediate transfer",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Transfer"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/admin/security-events": {
-      "get": {
-        "operationId": "listSecurityEvents",
-        "parameters": [
-          {
-            "$ref": "#/components/parameters/Limit"
-          },
-          {
-            "$ref": "#/components/parameters/Offset"
-          }
-        ],
-        "responses": {
-          "200": {
-            "description": "Append-only security events",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/SecurityEventPage"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/openapi/p04.json": {
-      "get": {
-        "operationId": "openApiP04",
-        "security": [],
-        "responses": {
-          "200": {
-            "description": "This versioned OpenAPI document",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "type": "object"
-                }
-              }
-            }
-          }
-        },
-        "description": "Current P04 OpenAPI contract. The unversioned /api/v1/openapi.json remains the immutable P03 compatibility snapshot."
-      }
-    },
-    "/api/v1/payments": {
-      "get": {
-        "operationId": "listVisiblePayments",
-        "description": "Owner-scoped outgoing and incoming payments. Stable order: created_at descending, id descending. The projection is observational only and never spending authority.",
-        "parameters": [
-          {
-            "$ref": "#/components/parameters/Limit"
-          },
-          {
-            "$ref": "#/components/parameters/Offset"
-          }
-        ],
-        "responses": {
-          "200": {
-            "description": "Owner-visible payment records",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/PaymentPage"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      },
-      "post": {
-        "operationId": "createAsynchronousPayment",
-        "description": "Atomically accept one payment intent, create a PENDING payment and ACTIVE hold, persist idempotency/audit and write payment.requested to the transactional outbox. No journal is posted at acceptance. Returns 202 even when RabbitMQ is unavailable because publication and settlement are independent durable work.",
-        "security": [
-          {
-            "SessionCookie": [],
-            "CsrfHeader": []
-          }
-        ],
-        "parameters": [
-          {
-            "$ref": "#/components/parameters/PaymentIdempotencyKey"
-          }
-        ],
-        "requestBody": {
-          "required": true,
-          "content": {
-            "application/json": {
-              "schema": {
-                "$ref": "#/components/schemas/PaymentIntent"
-              }
-            }
-          }
-        },
-        "responses": {
-          "202": {
-            "description": "Payment durably accepted. Identical replay returns this same status/body/resource.",
-            "headers": {
-              "Location": {
-                "schema": {
-                  "type": "string"
-                }
-              },
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/PaymentReceipt"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "409": {
-            "description": "Same scoped key with changed normalized intent",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/CommandRejection"
-                }
-              }
-            }
-          },
-          "422": {
-            "description": "Payment rejected before acceptance",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/CommandRejection"
-                }
-              }
-            }
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/payments/{id}": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/PaymentId"
-        }
-      ],
-      "get": {
-        "operationId": "getVisiblePayment",
-        "description": "Visible to the payer or recipient owner without disclosing the counterparty private account UUID or owner identity.",
-        "responses": {
-          "200": {
-            "description": "Payment state and observational projection",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Payment"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/admin/failed-work": {
-      "get": {
-        "operationId": "listFailedWork",
-        "description": "ADMIN-only inspection of bounded poison/exhausted messaging work. Envelope contents are deliberately not returned by this list.",
-        "parameters": [
-          {
-            "$ref": "#/components/parameters/Limit"
-          },
-          {
-            "$ref": "#/components/parameters/Offset"
-          }
-        ],
-        "responses": {
-          "200": {
-            "description": "Failed work",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/FailedWorkPage"
-                }
-              }
-            }
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/admin/failed-work/{id}": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/FailedWorkId"
-        }
-      ],
-      "get": {
-        "operationId": "getFailedWork",
-        "responses": {
-          "200": {
-            "description": "Failed-work metadata",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/FailedWork"
-                }
-              }
-            }
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/admin/failed-work/{id}/replay": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/FailedWorkId"
-        }
-      ],
-      "post": {
-        "operationId": "requestFailedWorkReplay",
-        "description": "Request audited republication of the original stable event identity. Replay never constitutes a new payment.",
-        "security": [
-          {
-            "SessionCookie": [],
-            "CsrfHeader": []
-          }
-        ],
-        "responses": {
-          "202": {
-            "description": "Replay request durably accepted",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "type": "object",
-                  "additionalProperties": false,
-                  "required": [
-                    "id",
-                    "state"
-                  ],
-                  "properties": {
-                    "id": {
-                      "type": "string",
-                      "format": "uuid"
-                    },
-                    "state": {
-                      "type": "string",
-                      "enum": [
-                        "REPLAY_REQUESTED"
-                      ]
-                    }
-                  }
-                }
-              }
-            }
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "409": {
-            "description": "Replay already pending",
-            "content": {
-              "application/problem+json": {
-                "schema": {
-                  "$ref": "#/components/schemas/Problem"
-                }
-              }
-            }
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/openapi/p05.json": {
-      "get": {
-        "operationId": "openApiP05",
-        "security": [],
-        "description": "Current P05 OpenAPI contract. Earlier versioned contracts remain compatibility snapshots.",
-        "responses": {
-          "200": {
-            "description": "This versioned OpenAPI document",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "type": "object"
-                }
-              }
-            }
-          }
-        }
-      }
-    },
-    "/api/v1/payments/{id}/cancel": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/PaymentId"
-        }
-      ],
-      "post": {
-        "operationId": "cancelPendingPayment",
-        "description": "Payer or ADMIN command. Locks the payment before balances. Only PENDING may become CANCELLED. Releases the ACTIVE hold exactly once and posts no journal. ADMIN must supply a reason.",
-        "security": [
-          {
-            "SessionCookie": [],
-            "CsrfHeader": []
-          }
-        ],
-        "parameters": [
-          {
-            "$ref": "#/components/parameters/AdjustmentIdempotencyKey"
-          }
-        ],
-        "requestBody": {
-          "required": true,
-          "content": {
-            "application/json": {
-              "schema": {
-                "$ref": "#/components/schemas/ReasonCommand"
-              }
-            }
-          }
-        },
-        "responses": {
-          "200": {
-            "description": "Payment cancelled. Location identifies the authoritative payment resource.",
-            "headers": {
-              "Location": {
-                "schema": {
-                  "type": "string"
-                }
-              },
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/PaymentCommandReceipt"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "409": {
-            "description": "Idempotency conflict or forbidden authoritative payment transition",
-            "headers": {
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/CommandRejection"
-                }
-              }
-            }
-          },
-          "422": {
-            "description": "Deterministic financial rejection such as excess refund or insufficient recipient availability",
-            "headers": {
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/CommandRejection"
-                }
-              }
-            }
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/payments/{id}/refunds": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/PaymentId"
-        }
-      ],
-      "post": {
-        "operationId": "createPaymentRefund",
-        "description": "Original recipient owner or ADMIN command. Creates one immutable partial/full compensating posting against SETTLED, subject to remaining refundable amount and current recipient availability. The original settlement journal remains unchanged.",
-        "security": [
-          {
-            "SessionCookie": [],
-            "CsrfHeader": []
-          }
-        ],
-        "parameters": [
-          {
-            "$ref": "#/components/parameters/AdjustmentIdempotencyKey"
-          }
-        ],
-        "requestBody": {
-          "required": true,
-          "content": {
-            "application/json": {
-              "schema": {
-                "$ref": "#/components/schemas/RefundCommand"
-              }
-            }
-          }
-        },
-        "responses": {
-          "201": {
-            "description": "Refund adjustment committed. Location identifies the immutable adjustment resource.",
-            "headers": {
-              "Location": {
-                "schema": {
-                  "type": "string"
-                }
-              },
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/PaymentCommandReceipt"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "409": {
-            "description": "Idempotency conflict or forbidden authoritative payment transition",
-            "headers": {
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/CommandRejection"
-                }
-              }
-            }
-          },
-          "422": {
-            "description": "Deterministic financial rejection such as excess refund or insufficient recipient availability",
-            "headers": {
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/CommandRejection"
-                }
-              }
-            }
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/payments/{id}/reversal": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/PaymentId"
-        }
-      ],
-      "post": {
-        "operationId": "reverseSettledPayment",
-        "description": "ADMIN-only reasoned full compensating posting for an otherwise unadjusted SETTLED payment. Rejected after any refund or prior reversal and subject to current recipient availability.",
-        "security": [
-          {
-            "SessionCookie": [],
-            "CsrfHeader": []
-          }
-        ],
-        "parameters": [
-          {
-            "$ref": "#/components/parameters/AdjustmentIdempotencyKey"
-          }
-        ],
-        "requestBody": {
-          "required": true,
-          "content": {
-            "application/json": {
-              "schema": {
-                "$ref": "#/components/schemas/ReversalCommand"
-              }
-            }
-          }
-        },
-        "responses": {
-          "201": {
-            "description": "Administrative reversal committed. Location identifies the immutable adjustment resource.",
-            "headers": {
-              "Location": {
-                "schema": {
-                  "type": "string"
-                }
-              },
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/PaymentCommandReceipt"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "409": {
-            "description": "Idempotency conflict or forbidden authoritative payment transition",
-            "headers": {
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/CommandRejection"
-                }
-              }
-            }
-          },
-          "422": {
-            "description": "Deterministic financial rejection such as excess refund or insufficient recipient availability",
-            "headers": {
-              "Idempotency-Replayed": {
-                "schema": {
-                  "type": "string",
-                  "enum": [
-                    "false",
-                    "true"
-                  ]
-                }
-              }
-            },
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/CommandRejection"
-                }
-              }
-            }
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/payments/{id}/adjustments": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/PaymentId"
-        }
-      ],
-      "get": {
-        "operationId": "listVisiblePaymentAdjustments",
-        "description": "Payer, recipient owner, or ADMIN view of immutable refund/reversal records. Cancellation is represented by the payment state and audit history, not an adjustment journal.",
-        "parameters": [
-          {
-            "$ref": "#/components/parameters/Limit"
-          },
-          {
-            "$ref": "#/components/parameters/Offset"
-          }
-        ],
-        "responses": {
-          "200": {
-            "description": "Visible immutable adjustments",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/PaymentAdjustmentPage"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/payments/{id}/adjustments/{adjustmentId}": {
-      "parameters": [
-        {
-          "$ref": "#/components/parameters/PaymentId"
-        },
-        {
-          "$ref": "#/components/parameters/AdjustmentId"
-        }
-      ],
-      "get": {
-        "operationId": "getVisiblePaymentAdjustment",
-        "description": "Fetch one immutable refund/reversal record for a relevant payment party or ADMIN.",
-        "responses": {
-          "200": {
-            "description": "Immutable adjustment",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "$ref": "#/components/schemas/PaymentAdjustment"
-                }
-              }
-            }
-          },
-          "400": {
-            "$ref": "#/components/responses/BadRequest"
-          },
-          "401": {
-            "$ref": "#/components/responses/Unauthorized"
-          },
-          "403": {
-            "$ref": "#/components/responses/Forbidden"
-          },
-          "404": {
-            "$ref": "#/components/responses/NotFound"
-          },
-          "503": {
-            "$ref": "#/components/responses/Unavailable"
-          }
-        }
-      }
-    },
-    "/api/v1/openapi/p06.json": {
-      "get": {
-        "operationId": "getP06OpenApi",
-        "security": [],
-        "responses": {
-          "200": {
-            "description": "This OpenAPI document",
-            "content": {
-              "application/json": {
-                "schema": {
-                  "type": "object"
-                }
-              }
-            }
-          }
-        }
-      }
-    }
-  },
-  "components": {
-    "securitySchemes": {
-      "SessionCookie": {
-        "type": "apiKey",
-        "in": "cookie",
-        "name": "__Host-LG-SESSION",
-        "description": "HttpOnly, Secure, SameSite=Strict, Path=/, no Domain. Explicit loopback sandbox uses LG-SESSION."
-      },
-      "CsrfHeader": {
-        "type": "apiKey",
-        "in": "header",
-        "name": "X-XSRF-TOKEN",
-        "description": "Masked token returned by /auth/csrf; matching HttpOnly CSRF cookie is also required."
-      }
-    },
-    "parameters": {
-      "AccountId": {
-        "name": "id",
-        "in": "path",
-        "required": true,
-        "schema": {
-          "type": "string",
-          "format": "uuid"
-        }
-      },
-      "TransferId": {
-        "name": "id",
-        "in": "path",
-        "required": true,
-        "schema": {
-          "type": "string",
-          "format": "uuid"
-        }
-      },
-      "IdempotencyKey": {
-        "name": "Idempotency-Key",
-        "in": "header",
-        "required": true,
-        "description": "8..128 characters matching ^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$. Scoped by authenticated actor and TRANSFER operation.",
-        "schema": {
-          "type": "string",
-          "minLength": 8,
-          "maxLength": 128,
-          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"
-        }
-      },
-      "Limit": {
-        "name": "limit",
-        "in": "query",
-        "schema": {
-          "type": "integer",
-          "minimum": 1,
-          "maximum": 100,
-          "default": 50
-        }
-      },
-      "Offset": {
-        "name": "offset",
-        "in": "query",
-        "schema": {
-          "type": "integer",
-          "minimum": 0,
-          "maximum": 10000,
-          "default": 0
-        }
-      },
-      "PaymentId": {
-        "name": "id",
-        "in": "path",
-        "required": true,
-        "schema": {
-          "type": "string",
-          "format": "uuid"
-        }
-      },
-      "FailedWorkId": {
-        "name": "id",
-        "in": "path",
-        "required": true,
-        "schema": {
-          "type": "string",
-          "format": "uuid"
-        }
-      },
-      "PaymentIdempotencyKey": {
-        "name": "Idempotency-Key",
-        "in": "header",
-        "required": true,
-        "description": "8..128 characters. Scoped by authenticated actor and PAYMENT operation. Preserve the same normalized intent and key after a timeout or 5xx.",
-        "schema": {
-          "type": "string",
-          "minLength": 8,
-          "maxLength": 128,
-          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"
-        }
-      },
-      "AdjustmentId": {
-        "name": "adjustmentId",
-        "in": "path",
-        "required": true,
-        "schema": {
-          "type": "string",
-          "format": "uuid"
-        }
-      },
-      "AdjustmentIdempotencyKey": {
-        "name": "Idempotency-Key",
-        "in": "header",
-        "required": true,
-        "description": "8..128 characters. Scoped by authenticated actor, command kind and parent payment. Reuse the identical key and normalized command after timeout or 5xx.",
-        "schema": {
-          "type": "string",
-          "minLength": 8,
-          "maxLength": 128,
-          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"
-        }
-      }
-    },
-    "responses": {
-      "BadRequest": {
-        "description": "Malformed JSON, unknown field, invalid command/key/value or pagination",
-        "content": {
-          "application/problem+json": {
-            "schema": {
-              "$ref": "#/components/schemas/Problem"
-            }
-          }
-        }
-      },
-      "Unauthorized": {
-        "description": "Missing, invalid, expired or revoked session",
-        "content": {
-          "application/problem+json": {
-            "schema": {
-              "$ref": "#/components/schemas/Problem"
-            }
-          }
-        }
-      },
-      "Forbidden": {
-        "description": "Role, CSRF or origin boundary rejected the request",
-        "content": {
-          "application/problem+json": {
-            "schema": {
-              "$ref": "#/components/schemas/Problem"
-            }
-          }
-        }
-      },
-      "NotFound": {
-        "description": "Absent or not disclosable to this principal",
-        "content": {
-          "application/problem+json": {
-            "schema": {
-              "$ref": "#/components/schemas/Problem"
-            }
-          }
-        }
-      },
-      "Unavailable": {
-        "description": "Temporary dependency failure or uncertain outcome. For a submitted idempotent command, retain and replay the same key/intent.",
-        "content": {
-          "application/problem+json": {
-            "schema": {
-              "$ref": "#/components/schemas/Problem"
-            }
-          }
-        }
-      }
-    },
-    "schemas": {
-      "Minor": {
-        "type": "string",
-        "pattern": "^(0|[1-9][0-9]*)$",
-        "description": "Exact integer minor units"
-      },
-      "PositiveMinor": {
-        "type": "string",
-        "pattern": "^[1-9][0-9]{0,12}$",
-        "description": "1 through 1000000000000 minor units"
-      },
-      "Currency": {
-        "type": "string",
-        "enum": [
-          "CAD",
-          "USD",
-          "JPY",
-          "KWD"
-        ]
-      },
-      "Problem": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "type",
-          "title",
-          "status",
-          "code",
-          "correlationId",
-          "validation"
-        ],
-        "properties": {
-          "type": {
-            "type": "string"
-          },
-          "title": {
-            "type": "string"
-          },
-          "status": {
-            "type": "integer"
-          },
-          "code": {
-            "type": "string"
-          },
-          "correlationId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "validation": {
-            "type": "object",
-            "additionalProperties": {
-              "type": "string"
-            }
-          }
-        }
-      },
-      "CommandRejection": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "code"
-        ],
-        "properties": {
-          "code": {
-            "type": "string",
-            "description": "Durably replayed business rejection code"
-          }
-        }
-      },
-      "Csrf": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "headerName",
-          "token"
-        ],
-        "properties": {
-          "headerName": {
-            "type": "string",
-            "enum": [
-              "X-XSRF-TOKEN"
-            ]
-          },
-          "token": {
-            "type": "string"
-          }
-        }
-      },
-      "Registration": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "email",
-          "password",
-          "displayName"
-        ],
-        "properties": {
-          "email": {
-            "type": "string",
-            "maxLength": 300
-          },
-          "password": {
-            "type": "string",
-            "minLength": 12,
-            "maxLength": 72,
-            "writeOnly": true
-          },
-          "displayName": {
-            "type": "string",
-            "minLength": 1,
-            "maxLength": 80
-          }
-        }
-      },
-      "Login": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "email",
-          "password"
-        ],
-        "properties": {
-          "email": {
-            "type": "string",
-            "maxLength": 300
-          },
-          "password": {
-            "type": "string",
-            "minLength": 12,
-            "maxLength": 72,
-            "writeOnly": true
-          }
-        }
-      },
-      "Registered": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "email",
-          "displayName",
-          "role"
-        ],
-        "properties": {
-          "id": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "email": {
-            "type": "string"
-          },
-          "displayName": {
-            "type": "string"
-          },
-          "role": {
-            "type": "string",
-            "enum": [
-              "CUSTOMER"
-            ]
-          }
-        }
-      },
-      "Session": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "email",
-          "displayName",
-          "role",
-          "expiresAt"
-        ],
-        "properties": {
-          "id": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "email": {
-            "type": "string"
-          },
-          "displayName": {
-            "type": "string"
-          },
-          "role": {
-            "type": "string",
-            "enum": [
-              "CUSTOMER",
-              "ADMIN"
-            ]
-          },
-          "expiresAt": {
-            "type": "string",
-            "format": "date-time"
-          }
-        }
-      },
-      "CreateAccount": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "name",
-          "currency"
-        ],
-        "properties": {
-          "name": {
-            "type": "string",
-            "minLength": 1,
-            "maxLength": 80
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          }
-        }
-      },
-      "Account": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "publicRef",
-          "name",
-          "currency",
-          "postedMinor",
-          "reservedMinor",
-          "availableMinor",
-          "version",
-          "updatedAt"
-        ],
-        "properties": {
-          "id": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "publicRef": {
-            "type": "string"
-          },
-          "name": {
-            "type": "string"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          },
-          "postedMinor": {
-            "$ref": "#/components/schemas/Minor"
-          },
-          "reservedMinor": {
-            "$ref": "#/components/schemas/Minor"
-          },
-          "availableMinor": {
-            "$ref": "#/components/schemas/Minor"
-          },
-          "version": {
-            "type": "string",
-            "pattern": "^[1-9][0-9]*$"
-          },
-          "updatedAt": {
-            "type": "string",
-            "format": "date-time"
-          }
-        }
-      },
-      "Entry": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "journalId",
-          "operationId",
-          "kind",
-          "side",
-          "amountMinor",
-          "currency",
-          "createdAt"
-        ],
-        "properties": {
-          "id": {
-            "type": "string"
-          },
-          "journalId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "operationId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "kind": {
-            "type": "string"
-          },
-          "side": {
-            "type": "string",
-            "enum": [
-              "DEBIT",
-              "CREDIT"
-            ]
-          },
-          "amountMinor": {
-            "$ref": "#/components/schemas/PositiveMinor"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          },
-          "createdAt": {
-            "type": "string",
-            "format": "date-time"
-          }
-        }
-      },
-      "Transaction": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "journalId",
-          "operationId",
-          "kind",
-          "effectMinor",
-          "currency",
-          "createdAt"
-        ],
-        "properties": {
-          "journalId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "operationId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "kind": {
-            "type": "string"
-          },
-          "effectMinor": {
-            "type": "string",
-            "pattern": "^-?(0|[1-9][0-9]*)$"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          },
-          "createdAt": {
-            "type": "string",
-            "format": "date-time"
-          }
-        }
-      },
-      "Recipient": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "publicRef",
-          "currency"
-        ],
-        "properties": {
-          "publicRef": {
-            "type": "string",
-            "pattern": "^LG-[a-f0-9]{32}$"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          }
-        }
-      },
-      "SecurityEvent": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "actorId",
-          "eventType",
-          "correlationId",
-          "occurredAt"
-        ],
-        "properties": {
-          "id": {
-            "type": "string"
-          },
-          "actorId": {
-            "type": "string",
-            "format": "uuid",
-            "nullable": true
-          },
-          "eventType": {
-            "type": "string"
-          },
-          "correlationId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "occurredAt": {
-            "type": "string",
-            "format": "date-time"
-          }
-        }
-      },
-      "TransferIntent": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "sourceId",
-          "recipientRef",
-          "amountMinor",
-          "currency"
-        ],
-        "properties": {
-          "sourceId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "recipientRef": {
-            "type": "string",
-            "pattern": "^LG-[a-fA-F0-9]{32}$"
-          },
-          "amountMinor": {
-            "$ref": "#/components/schemas/PositiveMinor"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          }
-        }
-      },
-      "TransferReceipt": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "kind",
-          "state",
-          "journalId",
-          "amountMinor",
-          "currency"
-        ],
-        "properties": {
-          "id": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "kind": {
-            "type": "string",
-            "enum": [
-              "TRANSFER"
-            ]
-          },
-          "state": {
-            "type": "string",
-            "enum": [
-              "SETTLED"
-            ]
-          },
-          "journalId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "amountMinor": {
-            "$ref": "#/components/schemas/PositiveMinor"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          }
-        }
-      },
-      "Transfer": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "sourceId",
-          "recipientRef",
-          "amountMinor",
-          "currency",
-          "state",
-          "journalId",
-          "createdAt"
-        ],
-        "properties": {
-          "id": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "sourceId": {
-            "type": "string",
-            "format": "uuid",
-            "description": "The authenticated owner's source account"
-          },
-          "recipientRef": {
-            "type": "string",
-            "pattern": "^LG-[a-f0-9]{32}$",
-            "description": "Public routing reference only; private destination account/owner data is not exposed"
-          },
-          "amountMinor": {
-            "$ref": "#/components/schemas/PositiveMinor"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          },
-          "state": {
-            "type": "string",
-            "enum": [
-              "SETTLED"
-            ]
-          },
-          "journalId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "createdAt": {
-            "type": "string",
-            "format": "date-time"
-          }
-        }
-      },
-      "AccountPage": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "items",
-          "limit",
-          "offset",
-          "hasMore"
-        ],
-        "properties": {
-          "items": {
-            "type": "array",
-            "items": {
-              "$ref": "#/components/schemas/Account"
-            }
-          },
-          "limit": {
-            "type": "integer"
-          },
-          "offset": {
-            "type": "integer"
-          },
-          "hasMore": {
-            "type": "boolean"
-          }
-        }
-      },
-      "EntryPage": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "items",
-          "limit",
-          "offset",
-          "hasMore"
-        ],
-        "properties": {
-          "items": {
-            "type": "array",
-            "items": {
-              "$ref": "#/components/schemas/Entry"
-            }
-          },
-          "limit": {
-            "type": "integer"
-          },
-          "offset": {
-            "type": "integer"
-          },
-          "hasMore": {
-            "type": "boolean"
-          }
-        }
-      },
-      "TransactionPage": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "items",
-          "limit",
-          "offset",
-          "hasMore"
-        ],
-        "properties": {
-          "items": {
-            "type": "array",
-            "items": {
-              "$ref": "#/components/schemas/Transaction"
-            }
-          },
-          "limit": {
-            "type": "integer"
-          },
-          "offset": {
-            "type": "integer"
-          },
-          "hasMore": {
-            "type": "boolean"
-          }
-        }
-      },
-      "SecurityEventPage": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "items",
-          "limit",
-          "offset",
-          "hasMore"
-        ],
-        "properties": {
-          "items": {
-            "type": "array",
-            "items": {
-              "$ref": "#/components/schemas/SecurityEvent"
-            }
-          },
-          "limit": {
-            "type": "integer"
-          },
-          "offset": {
-            "type": "integer"
-          },
-          "hasMore": {
-            "type": "boolean"
-          }
-        }
-      },
-      "TransferPage": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "items",
-          "limit",
-          "offset",
-          "hasMore"
-        ],
-        "properties": {
-          "items": {
-            "type": "array",
-            "items": {
-              "$ref": "#/components/schemas/Transfer"
-            }
-          },
-          "limit": {
-            "type": "integer"
-          },
-          "offset": {
-            "type": "integer"
-          },
-          "hasMore": {
-            "type": "boolean"
-          }
-        }
-      },
-      "PaymentIntent": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "sourceId",
-          "recipientRef",
-          "amountMinor",
-          "currency"
-        ],
-        "properties": {
-          "sourceId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "recipientRef": {
-            "type": "string",
-            "pattern": "^LG-[a-fA-F0-9]{32}$"
-          },
-          "amountMinor": {
-            "$ref": "#/components/schemas/PositiveMinor"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          }
-        }
-      },
-      "PaymentReceipt": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "kind",
-          "state",
-          "amountMinor",
-          "currency"
-        ],
-        "properties": {
-          "id": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "kind": {
-            "type": "string",
-            "enum": [
-              "PAYMENT"
-            ]
-          },
-          "state": {
-            "type": "string",
-            "enum": [
-              "PENDING"
-            ]
-          },
-          "amountMinor": {
-            "$ref": "#/components/schemas/PositiveMinor"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          }
-        }
-      },
-      "Payment": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "direction",
-          "accountId",
-          "counterpartyRef",
-          "amountMinor",
-          "currency",
-          "state",
-          "version",
-          "adjustmentState",
-          "createdAt",
-          "updatedAt"
-        ],
-        "properties": {
-          "id": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "direction": {
-            "type": "string",
-            "enum": [
-              "OUTGOING",
-              "INCOMING"
-            ]
-          },
-          "accountId": {
-            "type": "string",
-            "format": "uuid",
-            "description": "The authenticated owner\u2019s account only"
-          },
-          "counterpartyRef": {
-            "type": "string",
-            "pattern": "^LG-[a-f0-9]{32}$"
-          },
-          "amountMinor": {
-            "$ref": "#/components/schemas/PositiveMinor"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          },
-          "state": {
-            "type": "string",
-            "enum": [
-              "PENDING",
-              "SETTLED",
-              "FAILED",
-              "CANCELLED"
-            ]
-          },
-          "version": {
-            "type": "string",
-            "pattern": "^[1-9][0-9]*$"
-          },
-          "adjustmentState": {
-            "type": "string",
-            "enum": [
-              "NONE",
-              "PARTIALLY_REFUNDED",
-              "FULLY_REFUNDED",
-              "REVERSED"
-            ]
-          },
-          "journalId": {
-            "type": "string",
-            "format": "uuid",
-            "nullable": true
-          },
-          "failureCode": {
-            "type": "string",
-            "nullable": true
-          },
-          "projectionState": {
-            "type": "string",
-            "enum": [
-              "PENDING",
-              "SETTLED",
-              "FAILED",
-              "CANCELLED"
-            ],
-            "nullable": true,
-            "description": "Observational only; never spending authority"
-          },
-          "projectionVersion": {
-            "type": "string",
-            "pattern": "^[1-9][0-9]*$",
-            "nullable": true
-          },
-          "createdAt": {
-            "type": "string",
-            "format": "date-time"
-          },
-          "updatedAt": {
-            "type": "string",
-            "format": "date-time"
-          }
-        }
-      },
-      "FailedWork": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "consumer",
-          "eventId",
-          "exchangeName",
-          "routingKey",
-          "envelope",
-          "failureCode",
-          "attempts",
-          "state",
-          "createdAt",
-          "updatedAt"
-        ],
-        "properties": {
-          "id": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "consumer": {
-            "type": "string"
-          },
-          "eventId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "exchangeName": {
-            "type": "string"
-          },
-          "routingKey": {
-            "type": "string"
-          },
-          "envelope": {
-            "type": "object",
-            "additionalProperties": true,
-            "description": "Bounded original event envelope or a bounded raw-message evidence wrapper"
-          },
-          "failureCode": {
-            "type": "string"
-          },
-          "attempts": {
-            "type": "integer"
-          },
-          "state": {
-            "type": "string",
-            "enum": [
-              "FAILED",
-              "REPLAY_REQUESTED",
-              "REPUBLISHING",
-              "REPUBLISHED"
-            ]
-          },
-          "replayRequestedBy": {
-            "type": "string",
-            "format": "uuid",
-            "nullable": true
-          },
-          "replayRequestedAt": {
-            "type": "string",
-            "format": "date-time",
-            "nullable": true
-          },
-          "createdAt": {
-            "type": "string",
-            "format": "date-time"
-          },
-          "updatedAt": {
-            "type": "string",
-            "format": "date-time"
-          },
-          "republishedAt": {
-            "type": "string",
-            "format": "date-time",
-            "nullable": true
-          }
-        }
-      },
-      "PaymentPage": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "items",
-          "limit",
-          "offset",
-          "hasMore"
-        ],
-        "properties": {
-          "items": {
-            "type": "array",
-            "items": {
-              "$ref": "#/components/schemas/Payment"
-            }
-          },
-          "limit": {
-            "type": "integer"
-          },
-          "offset": {
-            "type": "integer"
-          },
-          "hasMore": {
-            "type": "boolean"
-          }
-        }
-      },
-      "FailedWorkPage": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "items",
-          "limit",
-          "offset",
-          "hasMore"
-        ],
-        "properties": {
-          "items": {
-            "type": "array",
-            "items": {
-              "$ref": "#/components/schemas/FailedWork"
-            }
-          },
-          "limit": {
-            "type": "integer"
-          },
-          "offset": {
-            "type": "integer"
-          },
-          "hasMore": {
-            "type": "boolean"
-          }
-        }
-      },
-      "ReasonCommand": {
-        "type": "object",
-        "additionalProperties": false,
-        "properties": {
-          "reason": {
-            "type": "string",
-            "minLength": 1,
-            "maxLength": 500,
-            "description": "Required for ADMIN cancellation; optional for payer cancellation."
-          }
-        }
-      },
-      "RefundCommand": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "amountMinor"
-        ],
-        "properties": {
-          "amountMinor": {
-            "$ref": "#/components/schemas/PositiveMinor"
-          },
-          "reason": {
-            "type": "string",
-            "minLength": 1,
-            "maxLength": 500
-          }
-        }
-      },
-      "ReversalCommand": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "reason"
-        ],
-        "properties": {
-          "reason": {
-            "type": "string",
-            "minLength": 1,
-            "maxLength": 500
-          }
-        }
-      },
-      "PaymentCommandReceipt": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "operationId",
-          "paymentId",
-          "kind",
-          "state",
-          "adjustmentState",
-          "amountMinor",
-          "currency"
-        ],
-        "properties": {
-          "id": {
-            "type": "string",
-            "format": "uuid",
-            "description": "Immutable command/adjustment operation identity"
-          },
-          "operationId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "paymentId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "kind": {
-            "type": "string",
-            "enum": [
-              "CANCEL",
-              "REFUND",
-              "REVERSAL"
-            ]
-          },
-          "state": {
-            "type": "string",
-            "enum": [
-              "CANCELLED",
-              "SETTLED"
-            ],
-            "description": "Authoritative base payment state after the command"
-          },
-          "adjustmentState": {
-            "type": "string",
-            "enum": [
-              "NONE",
-              "PARTIALLY_REFUNDED",
-              "FULLY_REFUNDED",
-              "REVERSED"
-            ]
-          },
-          "amountMinor": {
-            "$ref": "#/components/schemas/PositiveMinor"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          },
-          "journalId": {
-            "type": "string",
-            "format": "uuid",
-            "description": "Present for refund/reversal compensating postings; absent for cancellation"
-          }
-        }
-      },
-      "PaymentAdjustment": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "id",
-          "paymentId",
-          "kind",
-          "amountMinor",
-          "currency",
-          "journalId",
-          "reason",
-          "createdAt"
-        ],
-        "properties": {
-          "id": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "paymentId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "kind": {
-            "type": "string",
-            "enum": [
-              "REFUND",
-              "REVERSAL"
-            ]
-          },
-          "amountMinor": {
-            "$ref": "#/components/schemas/PositiveMinor"
-          },
-          "currency": {
-            "$ref": "#/components/schemas/Currency"
-          },
-          "journalId": {
-            "type": "string",
-            "format": "uuid"
-          },
-          "reason": {
-            "type": "string",
-            "minLength": 1,
-            "maxLength": 500
-          },
-          "createdAt": {
-            "type": "string",
-            "format": "date-time"
-          }
-        }
-      },
-      "PaymentAdjustmentPage": {
-        "type": "object",
-        "additionalProperties": false,
-        "required": [
-          "items",
-          "limit",
-          "offset",
-          "hasMore"
-        ],
-        "properties": {
-          "items": {
-            "type": "array",
-            "items": {
-              "$ref": "#/components/schemas/PaymentAdjustment"
-            }
-          },
-          "limit": {
-            "type": "integer"
-          },
-          "offset": {
-            "type": "integer"
-          },
-          "hasMore": {
-            "type": "boolean"
-          }
-        }
-      }
-    }
-  }
-}
+{"openapi":"3.0.3","info":{"title":"LedgerGuard payment adjustment reliability API","version":"0.6.0","description":"Synthetic money only. P06 preserves P01-P05 and adds payer/ADMIN cancellation before settlement, recipient/ADMIN partial or full refunds, ADMIN full reversal, immutable adjustment resources, durable idempotency and race-proof PostgreSQL accounting. This is not a bank or production payment processor."},"servers":[{"url":"/"}],"security":[{"SessionCookie":[]}],"paths":{"/api/v1/auth/csrf":{"get":{"operationId":"acquireCsrf","security":[],"responses":{"200":{"description":"Masked CSRF token","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Csrf"}}}}}}},"/api/v1/auth/register":{"post":{"operationId":"registerCustomer","security":[{"CsrfHeader":[]}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/Registration"}}}},"responses":{"201":{"description":"Registered CUSTOMER","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Registered"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"409":{"description":"Idempotency conflict or forbidden state transition","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}},"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/auth/login":{"post":{"operationId":"login","security":[{"CsrfHeader":[]}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/Login"}}}},"responses":{"200":{"description":"Session issued in an HttpOnly cookie","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Session"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/auth/me":{"get":{"operationId":"currentUser","responses":{"200":{"description":"Current database-backed session identity","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Session"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/auth/logout":{"post":{"operationId":"logout","security":[{"SessionCookie":[],"CsrfHeader":[]}],"responses":{"204":{"description":"Persisted session revoked; empty body"},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/accounts":{"get":{"operationId":"listOwnedAccounts","parameters":[{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"responses":{"200":{"description":"Owned accounts","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AccountPage"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}},"post":{"operationId":"createAccount","security":[{"SessionCookie":[],"CsrfHeader":[]}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/CreateAccount"}}}},"responses":{"201":{"description":"Zero-balance owned wallet","headers":{"Location":{"schema":{"type":"string"}}},"content":{"application/json":{"schema":{"$ref":"#/components/schemas/Account"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/accounts/{id}":{"parameters":[{"$ref":"#/components/parameters/AccountId"}],"get":{"operationId":"getOwnedAccount","responses":{"200":{"description":"Owned account","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Account"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/accounts/{id}/entries":{"parameters":[{"$ref":"#/components/parameters/AccountId"},{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"get":{"operationId":"listOwnedEntries","responses":{"200":{"description":"Owner-scoped immutable entry lines","content":{"application/json":{"schema":{"$ref":"#/components/schemas/EntryPage"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/accounts/{id}/transactions":{"parameters":[{"$ref":"#/components/parameters/AccountId"},{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"get":{"operationId":"listOwnedTransactions","responses":{"200":{"description":"Owner-scoped economic effects","content":{"application/json":{"schema":{"$ref":"#/components/schemas/TransactionPage"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/recipients/{publicRef}":{"get":{"operationId":"resolveRecipient","parameters":[{"name":"publicRef","in":"path","required":true,"schema":{"type":"string","pattern":"^LG-[a-fA-F0-9]{32}$"}}],"responses":{"200":{"description":"Minimal public routing data","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Recipient"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/transfers":{"get":{"operationId":"listOwnedTransfers","parameters":[{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"responses":{"200":{"description":"Owned immediate transfers","content":{"application/json":{"schema":{"$ref":"#/components/schemas/TransferPage"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}},"post":{"operationId":"createImmediateTransfer","security":[{"SessionCookie":[],"CsrfHeader":[]}],"parameters":[{"$ref":"#/components/parameters/IdempotencyKey"}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/PaymentIntent"}}}},"responses":{"201":{"description":"Balanced transfer committed; identical replay returns the original status/body","headers":{"Idempotency-Replayed":{"schema":{"type":"string","enum":["false","true"]}},"Location":{"schema":{"type":"string"}}},"content":{"application/json":{"schema":{"$ref":"#/components/schemas/TransferReceipt"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"409":{"description":"Idempotency conflict or forbidden state transition","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}},"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"413":{"description":"Request body exceeds the bounded API limit","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"422":{"description":"Deterministic financial business rejection","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}},"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/transfers/{id}":{"parameters":[{"$ref":"#/components/parameters/TransferId"}],"get":{"operationId":"getOwnedTransfer","responses":{"200":{"description":"Owned immediate transfer","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Transfer"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/payments":{"get":{"operationId":"listVisiblePayments","parameters":[{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"responses":{"200":{"description":"Payer- or recipient-visible payments","content":{"application/json":{"schema":{"$ref":"#/components/schemas/PaymentPage"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}},"post":{"operationId":"createAsynchronousPayment","security":[{"SessionCookie":[],"CsrfHeader":[]}],"parameters":[{"$ref":"#/components/parameters/IdempotencyKey"}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/PaymentIntent"}}}},"responses":{"202":{"description":"Payment and hold durably accepted without posting a journal","headers":{"Idempotency-Replayed":{"schema":{"type":"string","enum":["false","true"]}},"Location":{"schema":{"type":"string"}}},"content":{"application/json":{"schema":{"$ref":"#/components/schemas/PaymentReceipt"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"409":{"description":"Idempotency conflict or forbidden state transition","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}},"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"413":{"description":"Request body exceeds the bounded API limit","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"422":{"description":"Deterministic financial business rejection","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}},"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/payments/{id}":{"parameters":[{"$ref":"#/components/parameters/PaymentId"}],"get":{"operationId":"getVisiblePayment","responses":{"200":{"description":"Authoritative payment state and derived adjustment state","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Payment"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/payments/{id}/cancel":{"parameters":[{"$ref":"#/components/parameters/PaymentId"}],"post":{"operationId":"cancelPendingPayment","description":"The payer or ADMIN may cancel only while PENDING. The winning transaction releases the hold once and posts no journal. ADMIN requires a reason.","security":[{"SessionCookie":[],"CsrfHeader":[]}],"parameters":[{"$ref":"#/components/parameters/IdempotencyKey"}],"requestBody":{"required":false,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/CancellationIntent"}}}},"responses":{"200":{"description":"Payment cancelled; identical replay returns the original response","headers":{"Idempotency-Replayed":{"schema":{"type":"string","enum":["false","true"]}},"Location":{"schema":{"type":"string"}}},"content":{"application/json":{"schema":{"$ref":"#/components/schemas/CancellationReceipt"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"409":{"description":"Idempotency conflict or forbidden state transition","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}},"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"413":{"description":"Request body exceeds the bounded API limit","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/payments/{id}/refunds":{"parameters":[{"$ref":"#/components/parameters/PaymentId"}],"post":{"operationId":"refundSettledPayment","description":"The original recipient owner or ADMIN creates a partial/full compensating posting. The original payment journal remains immutable and base state remains SETTLED.","security":[{"SessionCookie":[],"CsrfHeader":[]}],"parameters":[{"$ref":"#/components/parameters/IdempotencyKey"}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/RefundIntent"}}}},"responses":{"201":{"description":"Immutable refund adjustment committed","headers":{"Idempotency-Replayed":{"schema":{"type":"string","enum":["false","true"]}},"Location":{"schema":{"type":"string"}}},"content":{"application/json":{"schema":{"$ref":"#/components/schemas/AdjustmentReceipt"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"409":{"description":"Idempotency conflict or forbidden state transition","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}},"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"413":{"description":"Request body exceeds the bounded API limit","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"422":{"description":"Deterministic financial business rejection","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}},"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/payments/{id}/reversal":{"parameters":[{"$ref":"#/components/parameters/PaymentId"}],"post":{"operationId":"reverseSettledPayment","description":"ADMIN-only full compensating posting for an otherwise unadjusted SETTLED payment. A bounded reason and sufficient recipient availability are required.","security":[{"SessionCookie":[],"CsrfHeader":[]}],"parameters":[{"$ref":"#/components/parameters/IdempotencyKey"}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/ReversalIntent"}}}},"responses":{"201":{"description":"Immutable full reversal committed","headers":{"Idempotency-Replayed":{"schema":{"type":"string","enum":["false","true"]}},"Location":{"schema":{"type":"string"}}},"content":{"application/json":{"schema":{"$ref":"#/components/schemas/AdjustmentReceipt"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"409":{"description":"Idempotency conflict or forbidden state transition","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}},"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"413":{"description":"Request body exceeds the bounded API limit","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"422":{"description":"Deterministic financial business rejection","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}},"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/payments/{id}/adjustments":{"parameters":[{"$ref":"#/components/parameters/PaymentId"},{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"get":{"operationId":"listPaymentAdjustments","description":"Visible to the payer, original recipient owner, or ADMIN. Stable order: created_at descending, id descending.","responses":{"200":{"description":"Immutable refund/reversal history","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AdjustmentPage"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/payments/{id}/adjustments/{adjustmentId}":{"parameters":[{"$ref":"#/components/parameters/PaymentId"},{"$ref":"#/components/parameters/AdjustmentId"}],"get":{"operationId":"getPaymentAdjustment","responses":{"200":{"description":"One immutable refund/reversal record","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Adjustment"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/admin/security-events":{"get":{"operationId":"listSecurityEvents","parameters":[{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"responses":{"200":{"description":"ADMIN-only append-only security events","content":{"application/json":{"schema":{"$ref":"#/components/schemas/GenericPage"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/admin/failed-work":{"get":{"operationId":"listFailedWork","parameters":[{"$ref":"#/components/parameters/Limit"},{"$ref":"#/components/parameters/Offset"}],"responses":{"200":{"description":"ADMIN-only failed messaging work","content":{"application/json":{"schema":{"$ref":"#/components/schemas/GenericPage"}}}},"400":{"description":"Malformed input, missing or invalid idempotency key, or unknown field","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/admin/failed-work/{id}":{"parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}}],"get":{"operationId":"getFailedWork","responses":{"200":{"description":"Failed-work metadata","content":{"application/json":{"schema":{"type":"object","additionalProperties":true}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/admin/failed-work/{id}/replay":{"parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}}],"post":{"operationId":"requestFailedWorkReplay","security":[{"SessionCookie":[],"CsrfHeader":[]}],"responses":{"202":{"description":"Audited replay request accepted","content":{"application/json":{"schema":{"type":"object","additionalProperties":true}}}},"401":{"description":"Authentication required","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"403":{"description":"CSRF, role, origin or authorization boundary rejected the request","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"404":{"description":"Resource absent or intentionally non-disclosable to this principal","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"409":{"description":"Idempotency conflict or forbidden state transition","content":{"application/json":{"schema":{"$ref":"#/components/schemas/CommandRejection"}},"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}},"503":{"description":"Temporary dependency failure or uncertain commit outcome","content":{"application/problem+json":{"schema":{"$ref":"#/components/schemas/Problem"}}}}}}},"/api/v1/openapi/p06.json":{"get":{"operationId":"openApiP06","security":[],"responses":{"200":{"description":"This P06 OpenAPI document","content":{"application/json":{"schema":{"type":"object"}}}}}}}},"components":{"securitySchemes":{"SessionCookie":{"type":"apiKey","in":"cookie","name":"__Host-LG-SESSION"},"CsrfHeader":{"type":"apiKey","in":"header","name":"X-XSRF-TOKEN"}},"parameters":{"AccountId":{"name":"id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}},"TransferId":{"name":"id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}},"PaymentId":{"name":"id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}},"AdjustmentId":{"name":"adjustmentId","in":"path","required":true,"schema":{"type":"string","format":"uuid"}},"IdempotencyKey":{"name":"Idempotency-Key","in":"header","required":true,"description":"8..128 bounded characters; scope includes authenticated actor, command kind and parent payment where applicable. Reuse the same key and normalized intent after an uncertain response.","schema":{"type":"string","minLength":8,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"}},"Limit":{"name":"limit","in":"query","schema":{"type":"integer","minimum":1,"maximum":100,"default":50}},"Offset":{"name":"offset","in":"query","schema":{"type":"integer","minimum":0,"maximum":10000,"default":0}}},"schemas":{"Problem":{"type":"object","additionalProperties":false,"required":["type","title","status","code","correlationId","validation"],"properties":{"type":{"type":"string"},"title":{"type":"string"},"status":{"type":"integer"},"code":{"type":"string"},"correlationId":{"type":"string","format":"uuid"},"validation":{"type":"object","additionalProperties":{"type":"string"}}}},"CommandRejection":{"type":"object","additionalProperties":false,"required":["code"],"properties":{"code":{"type":"string"}}},"Csrf":{"type":"object","additionalProperties":false,"required":["headerName","token"],"properties":{"headerName":{"type":"string","enum":["X-XSRF-TOKEN"]},"token":{"type":"string"}}},"Registration":{"type":"object","additionalProperties":false,"required":["email","password","displayName"],"properties":{"email":{"type":"string","maxLength":300},"password":{"type":"string","minLength":12,"maxLength":72,"writeOnly":true},"displayName":{"type":"string","minLength":1,"maxLength":80}}},"Login":{"type":"object","additionalProperties":false,"required":["email","password"],"properties":{"email":{"type":"string","maxLength":300},"password":{"type":"string","minLength":12,"maxLength":72,"writeOnly":true}}},"Registered":{"type":"object","additionalProperties":false,"required":["id","email","displayName","role"],"properties":{"id":{"type":"string","format":"uuid"},"email":{"type":"string"},"displayName":{"type":"string"},"role":{"type":"string","enum":["CUSTOMER"]}}},"Session":{"type":"object","additionalProperties":false,"required":["id","email","displayName","role","expiresAt"],"properties":{"id":{"type":"string","format":"uuid"},"email":{"type":"string"},"displayName":{"type":"string"},"role":{"type":"string","enum":["CUSTOMER","ADMIN"]},"expiresAt":{"type":"string","format":"date-time"}}},"Currency":{"type":"string","enum":["CAD","USD","JPY","KWD"]},"CreateAccount":{"type":"object","additionalProperties":false,"required":["name","currency"],"properties":{"name":{"type":"string","minLength":1,"maxLength":80},"currency":{"$ref":"#/components/schemas/Currency"}}},"Account":{"type":"object","additionalProperties":false,"required":["id","publicRef","name","currency","postedMinor","reservedMinor","availableMinor","version","updatedAt"],"properties":{"id":{"type":"string","format":"uuid"},"publicRef":{"type":"string","pattern":"^LG-[a-f0-9]{32}$"},"name":{"type":"string"},"currency":{"$ref":"#/components/schemas/Currency"},"postedMinor":{"type":"string","pattern":"^(0|[1-9][0-9]*)$"},"reservedMinor":{"type":"string","pattern":"^(0|[1-9][0-9]*)$"},"availableMinor":{"type":"string","pattern":"^(0|[1-9][0-9]*)$"},"version":{"type":"string","pattern":"^[1-9][0-9]*$"},"updatedAt":{"type":"string","format":"date-time"}}},"Recipient":{"type":"object","additionalProperties":false,"required":["publicRef","currency"],"properties":{"publicRef":{"type":"string","pattern":"^LG-[a-f0-9]{32}$"},"currency":{"$ref":"#/components/schemas/Currency"}}},"Entry":{"type":"object","additionalProperties":true},"Transaction":{"type":"object","additionalProperties":true},"PaymentIntent":{"type":"object","additionalProperties":false,"required":["sourceId","recipientRef","amountMinor","currency"],"properties":{"sourceId":{"type":"string","format":"uuid"},"recipientRef":{"type":"string","pattern":"^LG-[a-fA-F0-9]{32}$"},"amountMinor":{"type":"string","pattern":"^[1-9][0-9]{0,12}$"},"currency":{"$ref":"#/components/schemas/Currency"}}},"TransferReceipt":{"type":"object","additionalProperties":false,"required":["id","kind","state","journalId","amountMinor","currency"],"properties":{"id":{"type":"string","format":"uuid"},"kind":{"type":"string","enum":["TRANSFER"]},"state":{"type":"string","enum":["SETTLED"]},"journalId":{"type":"string","format":"uuid"},"amountMinor":{"type":"string","pattern":"^[1-9][0-9]{0,12}$"},"currency":{"$ref":"#/components/schemas/Currency"}}},"Transfer":{"type":"object","additionalProperties":false,"required":["id","sourceId","recipientRef","amountMinor","currency","state","journalId","createdAt"],"properties":{"id":{"type":"string","format":"uuid"},"sourceId":{"type":"string","format":"uuid"},"recipientRef":{"type":"string"},"amountMinor":{"type":"string","pattern":"^[1-9][0-9]{0,12}$"},"currency":{"$ref":"#/components/schemas/Currency"},"state":{"type":"string","enum":["SETTLED"]},"journalId":{"type":"string","format":"uuid"},"createdAt":{"type":"string","format":"date-time"}}},"PaymentReceipt":{"type":"object","additionalProperties":false,"required":["id","kind","state","amountMinor","currency"],"properties":{"id":{"type":"string","format":"uuid"},"kind":{"type":"string","enum":["PAYMENT"]},"state":{"type":"string","enum":["PENDING"]},"amountMinor":{"type":"string","pattern":"^[1-9][0-9]{0,12}$"},"currency":{"$ref":"#/components/schemas/Currency"}}},"Payment":{"type":"object","additionalProperties":false,"required":["id","direction","accountId","counterpartyRef","amountMinor","currency","state","version","adjustmentState","createdAt","updatedAt"],"properties":{"id":{"type":"string","format":"uuid"},"direction":{"type":"string","enum":["OUTGOING","INCOMING"]},"accountId":{"type":"string","format":"uuid"},"counterpartyRef":{"type":"string","pattern":"^LG-[a-f0-9]{32}$"},"amountMinor":{"type":"string","pattern":"^[1-9][0-9]{0,12}$"},"currency":{"$ref":"#/components/schemas/Currency"},"state":{"type":"string","enum":["PENDING","SETTLED","FAILED","CANCELLED"]},"version":{"type":"string","pattern":"^[1-9][0-9]*$"},"adjustmentState":{"type":"string","enum":["NONE","PARTIALLY_REFUNDED","FULLY_REFUNDED","REVERSED"]},"journalId":{"type":"string","format":"uuid","nullable":true},"failureCode":{"type":"string","nullable":true},"projectionState":{"type":"string","enum":["PENDING","SETTLED","FAILED","CANCELLED"],"nullable":true},"projectionVersion":{"type":"string","nullable":true},"createdAt":{"type":"string","format":"date-time"},"updatedAt":{"type":"string","format":"date-time"}}},"CancellationIntent":{"type":"object","additionalProperties":false,"properties":{"reason":{"type":"string","minLength":1,"maxLength":500}}},"RefundIntent":{"type":"object","additionalProperties":false,"required":["amountMinor"],"properties":{"amountMinor":{"type":"string","pattern":"^[1-9][0-9]{0,12}$"},"reason":{"type":"string","minLength":1,"maxLength":500}}},"ReversalIntent":{"type":"object","additionalProperties":false,"required":["reason"],"properties":{"reason":{"type":"string","minLength":1,"maxLength":500}}},"CancellationReceipt":{"type":"object","additionalProperties":false,"required":["id","state"],"properties":{"id":{"type":"string","format":"uuid"},"state":{"type":"string","enum":["CANCELLED"]}}},"AdjustmentReceipt":{"type":"object","additionalProperties":false,"required":["id","paymentId","kind","amountMinor","currency","journalId"],"properties":{"id":{"type":"string","format":"uuid"},"paymentId":{"type":"string","format":"uuid"},"kind":{"type":"string","enum":["REFUND","REVERSAL"]},"amountMinor":{"type":"string","pattern":"^[1-9][0-9]{0,12}$"},"currency":{"$ref":"#/components/schemas/Currency"},"journalId":{"type":"string","format":"uuid"}}},"Adjustment":{"type":"object","additionalProperties":false,"required":["id","paymentId","kind","amountMinor","currency","journalId","reason","createdAt"],"properties":{"id":{"type":"string","format":"uuid"},"paymentId":{"type":"string","format":"uuid"},"kind":{"type":"string","enum":["REFUND","REVERSAL"]},"amountMinor":{"type":"string","pattern":"^[1-9][0-9]{0,12}$"},"currency":{"$ref":"#/components/schemas/Currency"},"journalId":{"type":"string","format":"uuid"},"reason":{"type":"string","minLength":1,"maxLength":500},"createdAt":{"type":"string","format":"date-time"}}},"AccountPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Account"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"EntryPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Entry"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"TransactionPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Transaction"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"TransferPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Transfer"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"PaymentPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Payment"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"AdjustmentPage":{"type":"object","additionalProperties":false,"required":["items","limit","offset","hasMore"],"properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Adjustment"}},"limit":{"type":"integer"},"offset":{"type":"integer"},"hasMore":{"type":"boolean"}}},"GenericPage":{"type":"object","additionalProperties":true}}}}

```

### frontend/src/adjustment-store.ts

PATH_NOT_IN_MAIN_HISTORY

```diff
import { ApiClient, ApiError, OutcomeUnknown, type CommandResponse, type PaymentCommandReceipt } from './api.js';

export type AdjustmentCommandKind = 'CANCEL' | 'REFUND' | 'REVERSAL';
export type AdjustmentIntentState = 'PREPARED' | 'UNCERTAIN' | 'CONFIRMED' | 'REJECTED';
export interface AdjustmentIntent {
  paymentId: string;
  kind: AdjustmentCommandKind;
  amountMinor?: string;
  reason?: string;
}
export interface StoredAdjustmentIntent extends AdjustmentIntent {
  ownerId: string;
  key: string;
  state: AdjustmentIntentState;
  createdAt: string;
}

function identity(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new TypeError('Invalid identity');
  return value.toLowerCase();
}
function normalizeReason(value: string | undefined, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) throw new TypeError('Reason required');
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 500 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new TypeError('Invalid reason');
  return normalized;
}
function normalize(input: AdjustmentIntent): AdjustmentIntent {
  const result: AdjustmentIntent = { paymentId: identity(input.paymentId), kind: input.kind };
  if (!['CANCEL', 'REFUND', 'REVERSAL'].includes(input.kind)) throw new TypeError('Invalid adjustment kind');
  if (input.kind === 'REFUND') {
    if (input.amountMinor === undefined || !/^[1-9][0-9]{0,12}$/.test(input.amountMinor)
      || BigInt(input.amountMinor) > 1_000_000_000_000n) throw new TypeError('Invalid refund amount');
    result.amountMinor = input.amountMinor;
  } else if (input.amountMinor !== undefined) {
    throw new TypeError('Unexpected adjustment amount');
  }
  const reason = normalizeReason(input.reason, input.kind === 'REVERSAL');
  if (reason !== undefined) result.reason = reason;
  return Object.freeze(result);
}

/** Persists only one owner-scoped unresolved financial adjustment. No session or CSRF material is stored. */
export class AdjustmentIntentStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, private readonly ownerId: string) {
    this.ownerId = identity(ownerId);
  }
  private get slot(): string { return `ledgerguard.adjustment.v1.${this.ownerId}`; }
  current(): StoredAdjustmentIntent | undefined {
    const text = this.storage.getItem(this.slot);
    if (!text) return undefined;
    if (text.length > 4096) throw new TypeError('Stored adjustment too large');
    const stored = JSON.parse(text) as StoredAdjustmentIntent;
    if (stored.ownerId !== this.ownerId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(stored.key)
      || !['PREPARED', 'UNCERTAIN', 'CONFIRMED', 'REJECTED'].includes(stored.state)
      || !Number.isFinite(Date.parse(stored.createdAt))) throw new TypeError('Invalid stored adjustment');
    return { ...normalize(stored), ownerId: stored.ownerId, key: stored.key, state: stored.state, createdAt: stored.createdAt };
  }
  prepare(input: AdjustmentIntent, newKey: () => string = () => crypto.randomUUID()): StoredAdjustmentIntent {
    const previous = this.current();
    if (previous && ['PREPARED', 'UNCERTAIN'].includes(previous.state)) throw new Error('Resolve the previous adjustment before creating another one.');
    const command = normalize(input);
    const key = newKey();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) throw new TypeError('Invalid generated key');
    const record: StoredAdjustmentIntent = { ...command, ownerId: this.ownerId, key, state: 'PREPARED', createdAt: new Date().toISOString() };
    this.storage.setItem(this.slot, JSON.stringify(record));
    return record;
  }
  transition(state: Exclude<AdjustmentIntentState, 'PREPARED'>): StoredAdjustmentIntent {
    const current = this.current();
    if (!current || !['PREPARED', 'UNCERTAIN'].includes(current.state)) throw new Error('No unresolved adjustment.');
    const updated = { ...current, state };
    this.storage.setItem(this.slot, JSON.stringify(updated));
    return updated;
  }
  async execute(api: ApiClient, input: AdjustmentIntent,
      newKey: () => string = () => crypto.randomUUID()): Promise<CommandResponse<PaymentCommandReceipt>> {
    return this.send(api, this.prepare(input, newKey));
  }
  async retry(api: ApiClient): Promise<CommandResponse<PaymentCommandReceipt>> {
    const current = this.current();
    if (!current || !['PREPARED', 'UNCERTAIN'].includes(current.state)) throw new Error('No unresolved adjustment.');
    return this.send(api, current);
  }
  private async send(api: ApiClient, record: StoredAdjustmentIntent): Promise<CommandResponse<PaymentCommandReceipt>> {
    try {
      let response: CommandResponse<PaymentCommandReceipt>;
      if (record.kind === 'CANCEL') response = await api.cancelPayment(record.paymentId, record.key, record.reason);
      else if (record.kind === 'REFUND') response = await api.refundPayment(record.paymentId, record.amountMinor!, record.key, record.reason);
      else response = await api.reversePayment(record.paymentId, record.reason!, record.key);
      this.transition('CONFIRMED');
      return response;
    } catch (failure) {
      if (failure instanceof OutcomeUnknown) this.transition('UNCERTAIN');
      else if (failure instanceof ApiError && failure.status < 500) this.transition('REJECTED');
      throw failure;
    }
  }
  forgetConfirmed(): void {
    const current = this.current();
    if (current && !['CONFIRMED', 'REJECTED'].includes(current.state)) throw new Error('Cannot forget an uncertain adjustment.');
    this.storage.removeItem(this.slot);
  }
}

```

### tests/contracts/payment-adjustment-client.test.cjs

REVIEW_DIFFERENCE

```diff
--- branch/tests/contracts/payment-adjustment-client.test.cjs
+++ main-history/tests/contracts/payment-adjustment-client.test.cjs
@@ -1,30 +1,32 @@
-// P06 cancellation/refund/reversal client behavior using compiled production modules.
+// P06 cancellation/refund/reversal client behavior with compiled production modules and injected Fetch transport.
 const assert=require('node:assert/strict');
 const fs=require('node:fs');
 const {ApiClient,ApiError,OutcomeUnknown}=require('../../.evidence/ts/api.js');
-const {AdjustmentIntentStore}=require('../../.evidence/ts/adjustment-store.js');
+const {IntentStore}=require('../../.evidence/ts/intent-store.js');
 const cases=[];const test=(id,run)=>cases.push({id,run});
 const alice='00000000-0000-0000-0000-000000000001';
 const payment='e0000000-0000-0000-0000-000000000001';
-const adjustment='e0000000-0000-0000-0000-000000000002';
+const adjustment='a0000000-0000-0000-0000-000000000001';
 const journal='f0000000-0000-0000-0000-000000000001';
 const csrf=token=>Response.json({headerName:'X-XSRF-TOKEN',token});
 const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
-const receipt=(kind,state,adjustmentState,amount='1000')=>({id:adjustment,operationId:adjustment,paymentId:payment,kind,state,adjustmentState,amountMinor:amount,currency:'CAD',...(kind==='CANCEL'?{}:{journalId:journal})});
+const refundReceipt={id:adjustment,paymentId:payment,kind:'REFUND',amountMinor:'1250',currency:'CAD',journalId:journal};

-test('P06TS01-cancel-normalizes-reason-and-preserves-key',async()=>{let observed;const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('p06-1');observed={url,body:JSON.parse(options.body),key:options.headers.get('Idempotency-Key')};return Response.json(receipt('CANCEL','CANCELLED','NONE','2500'),{status:200})});const result=await api.cancelPayment(payment.toUpperCase(),'cancel-key-0001','  duplicate order  ');assert.equal(result.status,200);assert.deepEqual(observed,{url:`/api/v1/payments/${payment}/cancel`,body:{reason:'duplicate order'},key:'cancel-key-0001'});});
+test('P06TS01-cancellation-normalizes-reason-and-preserves-key',async()=>{let observed;const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('p06-1');observed={url,body:JSON.parse(options.body),key:options.headers.get('Idempotency-Key')};return Response.json({id:payment,state:'CANCELLED'},{status:200,headers:{'Idempotency-Replayed':'false'}})});const result=await api.cancelPayment(payment.toUpperCase(),'cancel-key-0601','  duplicate order  ');assert.equal(result.status,200);assert.deepEqual(observed,{url:`/api/v1/payments/${payment}/cancel`,body:{reason:'duplicate order'},key:'cancel-key-0601'});});

-test('P06TS02-refund-timeout-reuses-identical-intent',async()=>{const mem=storage();let attempts=0;const requests=[];const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('p06-2');requests.push([url,options.headers.get('Idempotency-Key'),options.body]);if(++attempts===1)throw new TypeError('response lost');return Response.json(receipt('REFUND','SETTLED','PARTIALLY_REFUNDED'),{status:201,headers:{'Idempotency-Replayed':'true'}})});const store=new AdjustmentIntentStore(mem,alice);await assert.rejects(store.execute(api,{paymentId:payment,kind:'REFUND',amountMinor:'1000',reason:'  returned item '},()=> 'refund-key-0002'),OutcomeUnknown);assert.equal(store.current().state,'UNCERTAIN');const result=await store.retry(api);assert.equal(result.replayed,true);assert.equal(store.current().state,'CONFIRMED');assert.deepEqual(requests[0],requests[1]);});
+test('P06TS02-refund-keeps-exact-minor-units',async()=>{let observed;const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('p06-2');observed={url,body:JSON.parse(options.body)};return Response.json(refundReceipt,{status:201})});assert.throws(()=>api.refundPayment(payment,'001250','refund-key-0602','  returned item  '));assert.equal(observed,undefined);const valid=await api.refundPayment(payment,'1250','refund-key-0602','  returned item  ');assert.equal(valid.body.amountMinor,'1250');assert.deepEqual(observed,{url:`/api/v1/payments/${payment}/refunds`,body:{amountMinor:'1250',reason:'returned item'}});});

-test('P06TS03-deterministic-rejection-is-final',async()=>{const store=new AdjustmentIntentStore(storage(),alice);const api=new ApiClient(async url=>url.endsWith('/auth/csrf')?csrf('p06-3'):Response.json({code:'EXCESS_REFUND'},{status:422}));await assert.rejects(store.execute(api,{paymentId:payment,kind:'REFUND',amountMinor:'2000'},()=> 'refund-key-0003'),e=>e instanceof ApiError&&e.status===422);assert.equal(store.current().state,'REJECTED');});
+test('P06TS03-reversal-requires-bounded-reason',async()=>{const api=new ApiClient(async(url,options)=>url.endsWith('/auth/csrf')?csrf('p06-3'):Response.json({...refundReceipt,kind:'REVERSAL',amountMinor:'2500'},{status:201}));assert.throws(()=>api.reversePayment(payment,'   ','reverse-key-0603'),TypeError);const response=await api.reversePayment(payment,'Administrative correction','reverse-key-0603');assert.equal(response.body.kind,'REVERSAL');});

-test('P06TS04-reversal-requires-reason-and-exact-route',async()=>{let path;const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('p06-4');path=[url,JSON.parse(options.body),options.headers.get('Idempotency-Key')];return Response.json(receipt('REVERSAL','SETTLED','REVERSED','2500'),{status:201})});assert.throws(()=>api.reversePayment(payment,'   ','reverse-key-0004'));await api.reversePayment(payment,'Administrative correction','reverse-key-0004');assert.deepEqual(path,[`/api/v1/payments/${payment}/reversal`,{reason:'Administrative correction'},'reverse-key-0004']);});
+test('P06TS04-unknown-refund-outcome-retains-identical-intent-and-key',async()=>{const mem=storage();let attempts=0;const requests=[];const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('p06-4');requests.push([url,options.headers.get('Idempotency-Key'),options.body]);if(++attempts===1)throw new TypeError('response lost');return Response.json(refundReceipt,{status:201,headers:{'Idempotency-Replayed':'true'}})});const store=new IntentStore(mem,alice);await assert.rejects(store.executeRefund(api,{paymentId:payment,amountMinor:'1250',reason:'Return'},()=> 'refund-key-0604'),OutcomeUnknown);assert.equal(store.current().state,'UNCERTAIN');const replay=await store.retryRefund(api);assert.equal(replay.replayed,true);assert.equal(store.current().state,'CONFIRMED');assert.deepEqual(requests[0],requests[1]);});

-test('P06TS05-adjustment-resources-use-bounded-pagination',async()=>{const record={id:adjustment,paymentId:payment,kind:'REFUND',amountMinor:'1000',currency:'CAD',journalId:journal,reason:'return',createdAt:'2026-09-27T00:00:00Z'};const paths=[];const api=new ApiClient(async url=>{paths.push(url);return Response.json(url.includes('?')?{items:[record],limit:1,offset:0,hasMore:false}:record)});assert.equal((await api.paymentAdjustments(payment,1,0)).items[0].amountMinor,'1000');assert.equal((await api.paymentAdjustment(payment,adjustment)).journalId,journal);assert.deepEqual(paths,[`/api/v1/payments/${payment}/adjustments?limit=1&offset=0`,`/api/v1/payments/${payment}/adjustments/${adjustment}`]);assert.throws(()=>api.paymentAdjustments(payment,0,0));});
+test('P06TS05-deterministic-adjustment-rejection-is-final',async()=>{const store=new IntentStore(storage(),alice);const api=new ApiClient(async url=>url.endsWith('/auth/csrf')?csrf('p06-5'):Response.json({code:'INSUFFICIENT_FUNDS'},{status:422}));await assert.rejects(store.executeRefund(api,{paymentId:payment,amountMinor:'1250'},()=> 'refund-key-0605'),e=>e instanceof ApiError&&e.status===422);assert.equal(store.current().state,'REJECTED');});

-test('P06TS06-unresolved-adjustment-blocks-new-command',()=>{const store=new AdjustmentIntentStore(storage(),alice);store.prepare({paymentId:payment,kind:'CANCEL'},()=> 'cancel-key-0006');store.transition('UNCERTAIN');assert.throws(()=>store.prepare({paymentId:payment,kind:'REFUND',amountMinor:'1'},()=> 'refund-key-0006'));});
+test('P06TS06-adjustment-read-and-list-use-owned-payment-path',async()=>{const record={...refundReceipt,reason:'Return',createdAt:'2026-09-27T00:00:00Z'};const paths=[];const api=new ApiClient(async url=>{paths.push(url);return Response.json(url.includes('?')?{items:[record],limit:1,offset:0,hasMore:false}:record)});assert.equal((await api.paymentAdjustment(payment,adjustment)).journalId,journal);assert.equal((await api.paymentAdjustments(payment,1,0)).items[0].kind,'REFUND');assert.deepEqual(paths,[`/api/v1/payments/${payment}/adjustments/${adjustment}`,`/api/v1/payments/${payment}/adjustments?limit=1&offset=0`]);});

-test('P06TS07-client-rejects-invalid-money-identities-and-control-reasons',()=>{const api=new ApiClient();assert.throws(()=>api.refundPayment(payment,'0','refund-key-0007'));assert.throws(()=>api.refundPayment('not-a-uuid','1','refund-key-0007'));assert.throws(()=>api.cancelPayment(payment,'cancel-key-0007','bad\nreason'));assert.throws(()=>new AdjustmentIntentStore(storage(),'not-a-user'));});
+test('P06TS07-invalid-identities-and-amounts-never-reach-network',async()=>{let calls=0;const api=new ApiClient(async()=>{calls++;return csrf('p06-7')});assert.throws(()=>api.cancelPayment('not-a-uuid','cancel-key-0607'),TypeError);assert.throws(()=>api.refundPayment(payment,'0','refund-key-0607'),TypeError);assert.throws(()=>api.paymentAdjustment(payment,'not-a-uuid'),TypeError);assert.equal(calls,0);});
+
+test('P06TS08-new-command-blocked-until-uncertain-adjustment-resolves',async()=>{const store=new IntentStore(storage(),alice);store.prepare('payment-reversals',{paymentId:payment,reason:'Correction'},()=> 'reverse-key-0608');store.transition('UNCERTAIN');assert.throws(()=>store.prepare('payments',{sourceId:alice,recipientRef:'LG-20000000000000000000000000000001',amountMinor:'1',currency:'CAD'},()=> 'payment-key-after-uncertain'));});

 const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 (async()=>{let failures=0;const rows=[];for(const c of cases){try{await c.run();console.log('PASS',c.id);rows.push(`<testcase name="${c.id}"/>`)}catch(e){failures++;console.error('FAIL',c.id,e.stack||e.message);rows.push(`<testcase name="${c.id}"><failure message="${escape(e.message)}"/></testcase>`)}}fs.mkdirSync('.evidence/client',{recursive:true});fs.writeFileSync('.evidence/client/payment-adjustment-results.xml',`<testsuite name="p06-payment-adjustment-client" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${rows.join('\n')}</testsuite>`);console.log(`P06_CLIENT_SUMMARY tests=${cases.length} failures=${failures}`);process.exitCode=failures?1:0})();

```

## p07a-source-export

`3b36983a9476839d77f681d4cd0fbe1699f82c48`; unique commits: 3.

{}

## p08c-materialize

`5a55f738c05a6914652d31672bb23a623ce6dbcd`; unique commits: 1.

{"REVIEW_DIFFERENCE": 7, "PATH_NOT_IN_MAIN_HISTORY": 2}

Archive checksum matches historical workflow: False. Actual: `7663c5a464f31fdf2fa1d0fbc0de5746b72989f0eadeca8d6cb37e01e031f734`.

### .github/workflows/pr.yml

REVIEW_DIFFERENCE

```diff
--- branch/.github/workflows/pr.yml
+++ main-history/.github/workflows/pr.yml
@@ -11,9 +11,9 @@

 jobs:
   verify:
-    name: Build, payment adjustments, browser accessibility, signed webhooks and financial invariants
+    name: Build, refunds and reversals, browser accessibility, signed webhooks and financial invariants
     runs-on: ubuntu-latest
-    timeout-minutes: 180
+    timeout-minutes: 165
     steps:
       - name: Check out candidate
         uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09
@@ -50,10 +50,6 @@
         run: npm exec --prefix frontend -- playwright install --with-deps chromium
       - name: Start, migrate, seed and reconcile the P08C topology
         run: ./scripts/lab up
-      - name: Configure isolated browser-campaign authentication budgets
-        run: |
-          printf '\nLEDGERGUARD_AUTH_IP_LIMIT=500\nLEDGERGUARD_AUTH_IDENTITY_LIMIT=100\n' >> .ledgerguard/runtime.env
-          docker compose --env-file .ledgerguard/runtime.env -f compose.yaml up -d --force-recreate --no-deps --wait api web
       - name: Preserve P05 payment, RabbitMQ, duplicate-delivery and process-death proofs
         run: python3 scripts/smoke-auth
       - name: Preserve P06 cancellation, refund, reversal and adjustment proofs
@@ -65,7 +61,11 @@
         run: python3 scripts/smoke-schedules
       - name: Exercise P07B encrypted secrets, signatures, retries, restart and authorization
         run: python3 scripts/smoke-webhooks
-      - name: Exercise P08A-P08C customer/admin journeys, uncertainty recovery, responsive UI and axe checks
+      - name: Apply isolated browser fixture IP budget (normal identity limits retained)
+        run: |
+          docker compose --env-file .ledgerguard/runtime.env -f compose.yaml -f compose.p07.yaml -f compose.p08c-test.yaml up -d --no-deps --wait api
+          docker compose --env-file .ledgerguard/runtime.env -f compose.yaml restart web
+      - name: Exercise P08A-P08C customer and administrator journeys, uncertainty recovery and accessibility
         run: npm --prefix frontend run test:e2e
       - name: Verify live status and repeatable reconciliation
         run: |
@@ -101,6 +101,8 @@
             backend/target/auth-http-evidence/
             backend/target/transfer-http-evidence/
             backend/target/payment-adjustment-http-evidence/
+            !.evidence/playwright/results/**/trace.zip
+            !frontend/playwright-report/data/*.zip

   gate:
     name: Required P08C gate

```

### README.md

REVIEW_DIFFERENCE

```diff
--- branch/README.md
+++ main-history/README.md
@@ -1,11 +1,11 @@
 # LedgerGuard
 ## Financial Transaction Reliability Laboratory

-**Synthetic money only. P01–P08B are exact-SHA verified development milestones. P08C—the recipient refund and administrator full-reversal product journey—is implemented as a source candidate and must not be called verified until its permanent exact-SHA gate succeeds. Schedule, webhook, broader administrator and lab-console interfaces, the complete fault/defect laboratory, later test lanes and final release evidence remain incomplete. Overall status: INCOMPLETE / NO_GO.**
+**Synthetic money only. P01–P08A are exact-SHA verified development milestones. P08A delivers the first real React customer journey. Later customer/admin interfaces, the complete fault laboratory, later test lanes and final release evidence remain incomplete. Overall status: INCOMPLETE / NO_GO.**

 LedgerGuard is a compact transaction system built to expose and test duplicate intent, ambiguous outcomes, concurrent spending, accounting invariants, asynchronous delivery, crash recovery, compensating financial adjustments, time-dependent execution and unreliable external notification. It is not a bank, payment processor, compliance product or production-ready financial service.

-## Run the current candidate topology
+## Run the verified P08A topology

 From a clean clone with Docker Engine and Docker Compose:

@@ -15,41 +15,29 @@

 The command generates private sandbox secrets, builds the locked Java 21 and React/TypeScript applications, starts PostgreSQL and RabbitMQ, applies Flyway migrations as `ledger_owner`, runs application queries as restricted `ledger_runtime`, seeds balanced fictional fixtures, performs independent reconciliation and starts the loopback-only same-origin product UI.

-Default URLs:
+It prints the actual URLs. The defaults are:

 - Product UI: `http://127.0.0.1:3000`
 - API: `http://127.0.0.1:8080`

-The topology contains the non-root frontend proxy, one API process, one independently restartable transactional-outbox publisher and two competing payment workers. Session and CSRF material are not stored in local storage.
+The default topology contains the non-root frontend proxy, one API process, one independently restartable transactional-outbox publisher and two competing payment-worker processes. The browser uses the same origin for UI and API requests; session and CSRF material are not stored in local storage.

-## Current product boundary
+P08A provides:

-The exact-SHA-verified P08B baseline provides:
+- Registration, login, logout, authenticated bootstrap and explicit session-expiry recovery.
+- A real customer dashboard showing posted, reserved and available balances, balance version and update time.
+- Zero-balance wallet creation without synthetic money creation.
+- Deterministically paginated account history.
+- Immutable customer-safe transaction detail containing only the selected wallet’s economic lines.
+- Deliberate loading, empty, validation, permission, authentication and dependency-outage states.
+- Responsive layouts verified at 1440×900, 768×1024 and 390×844.
+- Twelve Chromium Playwright journeys and authenticated axe WCAG A/AA checks.

-- Registration, login, logout and session-expiry recovery.
-- Real posted, reserved and available balances plus zero-balance wallet creation.
-- Deterministic account history and owner-safe immutable transaction detail.
-- Immediate transfers with explicit confirmation and authoritative settled receipts.
-- Preserved normalized economic intent and original idempotency key after response loss.
-- Asynchronous payment creation with honest `PENDING` state, owner-visible history/detail and bounded authoritative polling.
-- Race-safe pending-payment cancellation.
-- Responsive desktop/tablet/mobile Chromium journeys and authenticated axe checks.
+The transfer/payment, adjustment, schedule, webhook and administrator interfaces remain later P08 slices; no inert buttons or fabricated versions of those interfaces are shown.

-The P08C source candidate adds:
+## Activate the verified P07 topology

-- Owner-scoped exact adjustment summaries: original settlement, refunded amount, remaining refundable amount, immutable references and conservative action eligibility.
-- Recipient-authorized partial/full refund forms with exact currency parsing and explicit confirmation.
-- Administrator-only full reversal with required recorded reason and no generic balance-edit capability.
-- Same-key refund/reversal replay after uncertain responses and blocking of conflicting replacement commands.
-- Immutable adjustment timelines and receipts with separate compensating-journal identity.
-- Explicit payer/customer denial states, reversal-after-refund and refund-after-reversal handling.
-- Four additional critical browser journeys across all three viewport projects, six responsive screenshots and authenticated accessibility checks.
-
-The original settlement journal is never edited. Refunds and reversals are separate balanced compensating postings enforced by the protected PostgreSQL command boundary.
-
-## Activate verified schedule/webhook infrastructure
-
-After the default topology is running:
+After the default topology is running, apply the opt-in overlay:

 ```bash
 docker compose --env-file .ledgerguard/runtime.env \
@@ -59,24 +47,30 @@
   webhook-dispatcher-a webhook-dispatcher-b
 ```

-P07A provides duplicate-safe one-time/daily/weekly schedules with DST-aware recurrence. P07B provides owner-managed signed webhook endpoints, encrypted/versioned secrets, durable bounded retries, competing dispatchers and receiver deduplication. Webhook failure never changes settled money or blocks payment workers.
+The overlay activates the verified P07A schedule schema and verified P07B webhook schema. It starts two schedule workers, two webhook dispatchers and a signed sandbox receiver.

-Fictional identities are `alice@example.test`, `bob@example.test`, `merchant@example.test` and `admin@example.test`; the generated password is stored privately as `LEDGER_DEMO_PASSWORD` in ignored `.ledgerguard/runtime.env`.
+P07A provides customer-owned one-time, daily and weekly schedules; versioned edit/pause/resume/cancel commands; immutable occurrence history; DST-aware local-wall-time recurrence; a 24-hour catch-up window; and stable duplicate-safe occurrence execution.

-## Contracts
+P07B provides owner-managed approved webhook endpoints, one-time secret disclosure, AES-256-GCM encrypted and versioned secrets, exact-byte HMAC-SHA256 signatures, a five-minute replay window, endpoint/event logical uniqueness, immutable attempt history, persisted leases, two competing dispatchers, eight-attempt bounded retry cycles, audited manual retry, strict destination controls and durable receiver deduplication. Webhook failure never changes settled money or blocks payment workers.
+
+The API also provides immediate settled transfers, asynchronously processed payments with fund reservations, cancellation before settlement, recipient/ADMIN partial or full refunds, ADMIN full reversal and administrator failed-work inspection/replay.
+
+All money-changing and schedule-lifecycle commands require CSRF and `Idempotency-Key`. Identical replay returns the original operation; changed economic intent returns `409` without another financial effect. Payment acceptance returns `202` only after PostgreSQL atomically records payment, hold, idempotency outcome, audit and outbox event.
+
+Fictional identities are `alice@example.test`, `bob@example.test`, `merchant@example.test` and `admin@example.test`; their generated password is stored privately as `LEDGER_DEMO_PASSWORD` in ignored `.ledgerguard/runtime.env`.
+
+Scoped contracts:

 - `/api/v1/openapi/p06.json` — verified P06 compatibility contract.
 - `/api/v1/openapi/p07a-schedules.json` — verified P07A schedule contract.
 - `/api/v1/openapi/p07b-webhooks.json` — verified P07B webhook contract.
 - `/api/v1/openapi/p08a-ui.json` — verified P08A customer-interface contract.
-- `/api/v1/openapi/p08b-ui.json` — verified P08B money-movement contract.
-- `/api/v1/openapi/p08c-ui.json` — P08C candidate adjustment contract, served from the committed resource.

-## Verification status
+## Current verification status

-P08B source `5d6d883444845bc5de3364d0c682c3df26005d8e` passed permanent workflow run `36355379901`; verification job `108721959438` and required gate `108723219635` succeeded. Durable provenance is in `docs/evidence/p08b-5d6d883.md` and `.json`.
+P08A implementation source `d675db096b8f023469e253737ade80a2b8b3b0fa` passed permanent workflow run `36345292129`. Verification job `108693127471` and required gate `108694570086` both succeeded. Durable provenance is in `docs/evidence/p08a-d675db0.md` and `docs/evidence/p08a-d675db0.json`.

-P08C remains `IMPLEMENTED_UNVERIFIED` until GitHub Actions verifies the exact final source SHA. Its gate preserves the complete P01–P08B campaign and additionally requires nine production-client cases, 36 total Chromium journeys across three viewport projects, authenticated accessibility analysis, committed-response-loss refund replay with one effect, changed-intent conflict, recipient/payer/admin authorization, partial/full refund and full reversal journeys, six screenshots, live Compose adjustment proofs and repeatable reconciliation.
+The exact-SHA gate preserved the complete P01–P07B campaign and additionally passed the locked production frontend build, six P08A client-contract cases, twelve real Chromium journeys across three viewport projects, authenticated accessibility analysis, the customer-safe detail boundary, three responsive screenshots, repeatable reconciliation and a 305-file literal-secret scan with no findings.

 Useful commands:

@@ -97,9 +91,10 @@
 ## Inspection paths

 - [Progress and next executable action](docs/implementation/PROGRESS.md)
-- [P08C scoped requirements](docs/implementation/P08C_REQUIREMENTS.json)
-- [P08C architecture decision](docs/architecture/adr/0020-p08c-replay-safe-payment-adjustments.md)
-- [P08B durable evidence](docs/evidence/p08b-5d6d883.md)
+- [P08A durable evidence](docs/evidence/p08a-d675db0.md)
+- [P08A scoped requirements](docs/implementation/P08A_REQUIREMENTS.json)
+- [P08A architecture decision](docs/architecture/adr/0018-p08a-same-origin-customer-interface.md)
+- [P07B durable evidence](docs/evidence/p07b-cc6b3ca.md)
 - [Delivery provenance](docs/implementation/DELIVERY.md)
 - [Financial boundary](docs/architecture/FINANCIAL_BOUNDARY.md)
 - [Testing strategy](docs/testing/STRATEGY.md)

```

### backend/src/main/java/lab/ledgerguard/http/OpenApiController.java

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/java/lab/ledgerguard/http/OpenApiController.java
+++ main-history/backend/src/main/java/lab/ledgerguard/http/OpenApiController.java
@@ -46,9 +46,8 @@
     public Resource p08bUserInterfaceSpecification() {
         return new ClassPathResource("openapi/p08b-ui.json");
     }
-
     @GetMapping(value = "/api/v1/openapi/p08c-ui.json", produces = "application/json")
-    public Resource p08cPaymentAdjustmentSpecification() {
+    public Resource p08cAdjustmentInterfaceSpecification() {
         return new ClassPathResource("openapi/p08c-ui.json");
     }
 }

```

### backend/src/main/java/lab/ledgerguard/payments/PaymentAdjustmentSummaryController.java

PATH_NOT_IN_MAIN_HISTORY

```diff
package lab.ledgerguard.payments;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.UUID;
import lab.ledgerguard.auth.Identity;
import lab.ledgerguard.auth.SecurityEvents;
import lab.ledgerguard.http.ApiException;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PaymentAdjustmentSummaryController {
    private final JdbcTemplate jdbc;
    private final SecurityEvents events;

    public PaymentAdjustmentSummaryController(JdbcTemplate jdbc, SecurityEvents events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    public record Summary(
            UUID paymentId,
            String direction,
            UUID accountId,
            String counterpartyRef,
            String sourceRef,
            String destinationRef,
            String amountMinor,
            String refundedMinor,
            String remainingRefundableMinor,
            String currency,
            String state,
            String adjustmentState,
            String version,
            UUID journalId,
            Instant createdAt,
            Instant updatedAt,
            boolean canRefund,
            boolean canReverse) { }

    private record Row(
            UUID paymentId,
            UUID sourceId,
            UUID destinationId,
            UUID sourceOwner,
            UUID destinationOwner,
            String sourceRef,
            String destinationRef,
            long amountMinor,
            long refundedMinor,
            String currency,
            String state,
            boolean reversed,
            long version,
            UUID journalId,
            Instant createdAt,
            Instant updatedAt) { }

    @GetMapping("/api/v1/payments/{paymentId}/adjustment-summary")
    public ResponseEntity<Summary> customerSummary(
            @AuthenticationPrincipal Identity identity,
            @PathVariable UUID paymentId) {
        return noStore(summary(identity, paymentId, false));
    }

    @GetMapping("/api/v1/admin/payments/{paymentId}/adjustment-summary")
    public ResponseEntity<Summary> administratorSummary(
            @AuthenticationPrincipal Identity identity,
            @PathVariable UUID paymentId) {
        return noStore(summary(identity, paymentId, true));
    }

    private Summary summary(Identity identity, UUID paymentId, boolean administratorEndpoint) {
        boolean administrator = "ADMIN".equals(identity.role());
        if (administratorEndpoint && !administrator) {
            denied(identity);
            throw new ApiException(403, "FORBIDDEN");
        }

        var rows = jdbc.query("""
            SELECT p.id,p.source_id,p.destination_id,p.amount_minor,p.refunded_minor,p.currency,
                   p.state,p.reversed,p.version,p.journal_id,p.created_at,p.updated_at,
                   s.owner_id AS source_owner,d.owner_id AS destination_owner,
                   s.public_ref AS source_ref,d.public_ref AS destination_ref
              FROM ledger.payments p
              JOIN ledger.accounts s ON s.id=p.source_id
              JOIN ledger.accounts d ON d.id=p.destination_id
             WHERE p.id=?
            """, this::row, paymentId);
        if (rows.isEmpty()) throw new ApiException(404, "NOT_FOUND");
        Row row = rows.getFirst();

        boolean sourceOwned = identity.userId().equals(row.sourceOwner());
        boolean destinationOwned = identity.userId().equals(row.destinationOwner());
        if (!administratorEndpoint && !sourceOwned && !destinationOwned) {
            denied(identity);
            throw new ApiException(404, "NOT_FOUND");
        }

        if (row.amountMinor() <= 0L || row.refundedMinor() < 0L
                || row.refundedMinor() > row.amountMinor()) {
            throw new ApiException(503, "DURABLE_OUTCOME_INVALID");
        }
        long unrefunded = Math.subtractExact(row.amountMinor(), row.refundedMinor());
        long remaining = row.reversed() ? 0L : unrefunded;
        String adjustmentState = row.reversed() ? "REVERSED"
            : row.refundedMinor() == 0L ? "NONE"
            : row.refundedMinor() == row.amountMinor() ? "FULLY_REFUNDED"
            : "PARTIALLY_REFUNDED";
        boolean settled = "SETTLED".equals(row.state());
        boolean canRefund = settled && !row.reversed() && remaining > 0L
            && (administrator || destinationOwned);
        boolean canReverse = administrator && settled && !row.reversed() && row.refundedMinor() == 0L;

        String direction;
        UUID accountId;
        String counterpartyRef;
        if (administratorEndpoint) {
            direction = "ADMIN";
            accountId = null;
            counterpartyRef = null;
        } else if (sourceOwned) {
            direction = "OUTGOING";
            accountId = row.sourceId();
            counterpartyRef = row.destinationRef();
        } else {
            direction = "INCOMING";
            accountId = row.destinationId();
            counterpartyRef = row.sourceRef();
        }

        return new Summary(
            row.paymentId(), direction, accountId, counterpartyRef,
            row.sourceRef(), row.destinationRef(),
            Long.toString(row.amountMinor()), Long.toString(row.refundedMinor()), Long.toString(remaining),
            row.currency(), row.state(), adjustmentState, Long.toString(row.version()),
            row.journalId(), row.createdAt(), row.updatedAt(), canRefund, canReverse);
    }

    private Row row(ResultSet rs, int rowNumber) throws SQLException {
        return new Row(
            rs.getObject("id", UUID.class),
            rs.getObject("source_id", UUID.class),
            rs.getObject("destination_id", UUID.class),
            rs.getObject("source_owner", UUID.class),
            rs.getObject("destination_owner", UUID.class),
            rs.getString("source_ref"),
            rs.getString("destination_ref"),
            rs.getLong("amount_minor"),
            rs.getLong("refunded_minor"),
            rs.getString("currency"),
            rs.getString("state"),
            rs.getBoolean("reversed"),
            rs.getLong("version"),
            rs.getObject("journal_id", UUID.class),
            rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("updated_at").toInstant());
    }

    private static ResponseEntity<Summary> noStore(Summary body) {
        return ResponseEntity.ok()
            .cacheControl(CacheControl.noStore())
            .body(body);
    }

    private void denied(Identity identity) {
        events.denied(identity.userId(), "ACCESS_DENIED");
    }
}

```

### backend/src/main/resources/openapi/p08c-ui.json

REVIEW_DIFFERENCE

```diff
--- branch/backend/src/main/resources/openapi/p08c-ui.json
+++ main-history/backend/src/main/resources/openapi/p08c-ui.json
@@ -1,151 +1,1069 @@
 {
   "openapi": "3.1.0",
   "info": {
-    "title": "LedgerGuard P08C payment-adjustment contract",
+    "title": "LedgerGuard P08C adjustment interface",
     "version": "0.8.3",
-    "description": "Scoped same-origin contract for owner-visible adjustment summaries, recipient-authorized partial/full refunds, administrator full reversal, replay-safe uncertainty resolution and immutable adjustment receipts. Synthetic money only."
+    "description": "Synthetic money only. Scoped real customer refunds and ADMIN full reversals; preserves immutable settlement and exact-SHA verification boundary. NOT a production financial service. CAD/USD 2 decimals, JPY 0, KWD 3; no conversion."
   },
-  "servers": [{ "url": "/api/v1" }],
-  "security": [{ "SessionCookie": [] }],
+  "servers": [
+    {
+      "url": "/api/v1"
+    }
+  ],
+  "security": [
+    {
+      "SandboxSession": []
+    },
+    {
+      "SecureSession": []
+    }
+  ],
   "paths": {
-    "/payments/{paymentId}/adjustment-summary": {
+    "/payments/{paymentId}/adjustment-context": {
       "get": {
-        "operationId": "customerPaymentAdjustmentSummary",
-        "description": "Returns a payment-party-scoped exact adjustment summary. The returned eligibility is advisory; the command transaction remains authoritative.",
-        "parameters": [{ "$ref": "#/components/parameters/PaymentId" }],
+        "operationId": "customerPaymentAdjustmentContext",
+        "description": "CUSTOMER participant only. Recipient may refund; payer may inspect without recipient balances or refund authority.",
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/PaymentId"
+          }
+        ],
         "responses": {
-          "200": { "description": "Owner-visible exact adjustment summary", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/AdjustmentSummary" } } } },
-          "401": { "$ref": "#/components/responses/Problem" },
-          "404": { "$ref": "#/components/responses/Problem" }
+          "200": {
+            "description": "Authoritative authorized review snapshot",
+            "headers": {
+              "Cache-Control": {
+                "schema": {
+                  "type": "string"
+                },
+                "description": "Contains no-store; this contract does not require a particular directive ordering."
+              }
+            },
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/AdjustmentContext"
+                }
+              }
+            }
+          },
+          "400": {
+            "description": "Malformed ID, amount, key, reason or pagination.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "401": {
+            "description": "Session absent, expired or revoked. Retain any previously uncertain instruction.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "403": {
+            "description": "Role/owner not authorized, invalid CSRF, or missing required administrative reason.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "404": {
+            "description": "Missing payment/adjustment, unrelated owner, or mismatched parent resource.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "503": {
+            "description": "Dependency unavailable; outcome may require same-key resolution.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          }
         }
       }
     },
-    "/admin/payments/{paymentId}/adjustment-summary": {
+    "/admin/payments/{paymentId}/adjustment-context": {
       "get": {
-        "operationId": "administratorPaymentAdjustmentSummary",
-        "description": "Returns an administrator-scoped exact adjustment summary for explicit reversal review.",
-        "parameters": [{ "$ref": "#/components/parameters/PaymentId" }],
+        "operationId": "adminPaymentAdjustmentContext",
+        "description": "ADMIN-only narrow payment review.",
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/PaymentId"
+          }
+        ],
         "responses": {
-          "200": { "description": "Administrator adjustment summary", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/AdjustmentSummary" } } } },
-          "401": { "$ref": "#/components/responses/Problem" },
-          "403": { "$ref": "#/components/responses/Problem" },
-          "404": { "$ref": "#/components/responses/Problem" }
+          "200": {
+            "description": "Authoritative authorized review snapshot",
+            "headers": {
+              "Cache-Control": {
+                "schema": {
+                  "type": "string"
+                },
+                "description": "Contains no-store; this contract does not require a particular directive ordering."
+              }
+            },
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/AdjustmentContext"
+                }
+              }
+            }
+          },
+          "400": {
+            "description": "Malformed ID, amount, key, reason or pagination.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "401": {
+            "description": "Session absent, expired or revoked. Retain any previously uncertain instruction.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "403": {
+            "description": "Role/owner not authorized, invalid CSRF, or missing required administrative reason.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "404": {
+            "description": "Missing payment/adjustment, unrelated owner, or mismatched parent resource.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "503": {
+            "description": "Dependency unavailable; outcome may require same-key resolution.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          }
         }
       }
     },
     "/payments/{paymentId}/refunds": {
       "post": {
-        "operationId": "createPaymentRefund",
-        "description": "Creates one partial or full compensating refund for the original recipient owner or an administrator. Same scope/key/fingerprint replays the original 201 response; changed intent conflicts without another posting.",
-        "parameters": [{ "$ref": "#/components/parameters/PaymentId" }, { "$ref": "#/components/parameters/IdempotencyKey" }, { "$ref": "#/components/parameters/CsrfHeader" }],
-        "requestBody": { "required": true, "content": { "application/json": { "schema": { "$ref": "#/components/schemas/RefundRequest" } } } },
+        "operationId": "refundPayment",
+        "description": "Original recipient owner or ADMIN. Partial/full refund; total cannot exceed settled amount; no refunds after reversal. Recipient availability is locked and rechecked.",
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/PaymentId"
+          },
+          {
+            "$ref": "#/components/parameters/IdempotencyKey"
+          },
+          {
+            "$ref": "#/components/parameters/CsrfHeader"
+          }
+        ],
+        "requestBody": {
+          "required": true,
+          "content": {
+            "application/json": {
+              "schema": {
+                "$ref": "#/components/schemas/Refund"
+              }
+            }
+          }
+        },
         "responses": {
-          "201": { "description": "Immutable refund receipt", "headers": { "Idempotency-Replayed": { "$ref": "#/components/headers/IdempotencyReplayed" }, "Location": { "$ref": "#/components/headers/Location" } }, "content": { "application/json": { "schema": { "$ref": "#/components/schemas/AdjustmentReceipt" } } } },
-          "400": { "$ref": "#/components/responses/Problem" },
-          "401": { "$ref": "#/components/responses/Problem" },
-          "403": { "$ref": "#/components/responses/Problem" },
-          "404": { "$ref": "#/components/responses/Problem" },
-          "409": { "$ref": "#/components/responses/Problem" },
-          "422": { "$ref": "#/components/responses/Problem" },
-          "503": { "$ref": "#/components/responses/UncertainProblem" }
+          "201": {
+            "description": "Committed immutable compensating posting or exact original replay. Base state remains SETTLED.",
+            "headers": {
+              "Cache-Control": {
+                "schema": {
+                  "type": "string"
+                },
+                "description": "Contains no-store; this contract does not require a particular directive ordering."
+              },
+              "Idempotency-Replayed": {
+                "schema": {
+                  "type": "string",
+                  "enum": [
+                    "true",
+                    "false"
+                  ]
+                }
+              },
+              "Location": {
+                "schema": {
+                  "type": "string"
+                },
+                "description": "/api/v1/payments/{paymentId}/adjustments/{adjustmentId}"
+              }
+            },
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/AdjustmentReceipt"
+                }
+              }
+            }
+          },
+          "400": {
+            "description": "Malformed ID, amount, key, reason or pagination.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "401": {
+            "description": "Session absent, expired or revoked. Retain any previously uncertain instruction.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "403": {
+            "description": "Role/owner not authorized, invalid CSRF, or missing required administrative reason.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "404": {
+            "description": "Missing payment/adjustment, unrelated owner, or mismatched parent resource.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "409": {
+            "description": "Conflicting idempotency intent or forbidden adjustment transition. IDEMPOTENCY_CONFLICT does not resolve the original uncertain instruction.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "422": {
+            "description": "EXCESS_REFUND or INSUFFICIENT_FUNDS; no partial posting.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "429": {
+            "description": "Rate limited; retain original request/key.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "503": {
+            "description": "Dependency unavailable; outcome may require same-key resolution.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          }
         }
       }
     },
     "/payments/{paymentId}/reversal": {
       "post": {
-        "operationId": "createAdministrativePaymentReversal",
-        "description": "Creates one full compensating reversal. Requires ADMIN, a recorded reason, no prior successful adjustment and sufficient recipient availability.",
-        "parameters": [{ "$ref": "#/components/parameters/PaymentId" }, { "$ref": "#/components/parameters/IdempotencyKey" }, { "$ref": "#/components/parameters/CsrfHeader" }],
-        "requestBody": { "required": true, "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ReversalRequest" } } } },
+        "operationId": "reversePayment",
+        "description": "ADMIN only; mandatory reason; full amount; otherwise unadjusted SETTLED payment; reject after any refund/reversal. Recipient availability is locked and rechecked. No generic balance editing.",
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/PaymentId"
+          },
+          {
+            "$ref": "#/components/parameters/IdempotencyKey"
+          },
+          {
+            "$ref": "#/components/parameters/CsrfHeader"
+          }
+        ],
+        "requestBody": {
+          "required": true,
+          "content": {
+            "application/json": {
+              "schema": {
+                "$ref": "#/components/schemas/Reversal"
+              }
+            }
+          }
+        },
         "responses": {
-          "201": { "description": "Immutable reversal receipt", "headers": { "Idempotency-Replayed": { "$ref": "#/components/headers/IdempotencyReplayed" }, "Location": { "$ref": "#/components/headers/Location" } }, "content": { "application/json": { "schema": { "$ref": "#/components/schemas/AdjustmentReceipt" } } } },
-          "400": { "$ref": "#/components/responses/Problem" },
-          "401": { "$ref": "#/components/responses/Problem" },
-          "403": { "$ref": "#/components/responses/Problem" },
-          "404": { "$ref": "#/components/responses/Problem" },
-          "409": { "$ref": "#/components/responses/Problem" },
-          "422": { "$ref": "#/components/responses/Problem" },
-          "503": { "$ref": "#/components/responses/UncertainProblem" }
+          "201": {
+            "description": "Committed immutable compensating posting or exact original replay. Base state remains SETTLED.",
+            "headers": {
+              "Cache-Control": {
+                "schema": {
+                  "type": "string"
+                },
+                "description": "Contains no-store; this contract does not require a particular directive ordering."
+              },
+              "Idempotency-Replayed": {
+                "schema": {
+                  "type": "string",
+                  "enum": [
+                    "true",
+                    "false"
+                  ]
+                }
+              },
+              "Location": {
+                "schema": {
+                  "type": "string"
+                },
+                "description": "/api/v1/payments/{paymentId}/adjustments/{adjustmentId}"
+              }
+            },
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/AdjustmentReceipt"
+                }
+              }
+            }
+          },
+          "400": {
+            "description": "Malformed ID, amount, key, reason or pagination.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "401": {
+            "description": "Session absent, expired or revoked. Retain any previously uncertain instruction.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "403": {
+            "description": "Role/owner not authorized, invalid CSRF, or missing required administrative reason.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "404": {
+            "description": "Missing payment/adjustment, unrelated owner, or mismatched parent resource.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "409": {
+            "description": "Conflicting idempotency intent or forbidden adjustment transition. IDEMPOTENCY_CONFLICT does not resolve the original uncertain instruction.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "422": {
+            "description": "EXCESS_REFUND or INSUFFICIENT_FUNDS; no partial posting.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "429": {
+            "description": "Rate limited; retain original request/key.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "503": {
+            "description": "Dependency unavailable; outcome may require same-key resolution.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          }
         }
       }
     },
     "/payments/{paymentId}/adjustments": {
       "get": {
-        "operationId": "listPaymentAdjustments",
-        "parameters": [{ "$ref": "#/components/parameters/PaymentId" }, { "$ref": "#/components/parameters/Limit" }, { "$ref": "#/components/parameters/Offset" }],
+        "operationId": "paymentAdjustments",
+        "description": "Participant owner or ADMIN; query-time authorization, deterministic created_at DESC / id DESC pagination. Do not calculate total refundable value by summing one page.",
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/PaymentId"
+          },
+          {
+            "$ref": "#/components/parameters/Limit"
+          },
+          {
+            "$ref": "#/components/parameters/Offset"
+          }
+        ],
         "responses": {
-          "200": { "description": "Visible immutable adjustment history ordered newest first", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/AdjustmentPage" } } } },
-          "404": { "$ref": "#/components/responses/Problem" }
+          "200": {
+            "description": "Immutable adjustment page",
+            "headers": {
+              "Cache-Control": {
+                "schema": {
+                  "type": "string"
+                },
+                "description": "Contains no-store; this contract does not require a particular directive ordering."
+              }
+            },
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/AdjustmentPage"
+                }
+              }
+            }
+          },
+          "400": {
+            "description": "Malformed ID, amount, key, reason or pagination.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "401": {
+            "description": "Session absent, expired or revoked. Retain any previously uncertain instruction.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "403": {
+            "description": "Role/owner not authorized, invalid CSRF, or missing required administrative reason.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "404": {
+            "description": "Missing payment/adjustment, unrelated owner, or mismatched parent resource.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "503": {
+            "description": "Dependency unavailable; outcome may require same-key resolution.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          }
         }
       }
     },
     "/payments/{paymentId}/adjustments/{adjustmentId}": {
       "get": {
-        "operationId": "getPaymentAdjustment",
-        "parameters": [{ "$ref": "#/components/parameters/PaymentId" }, { "$ref": "#/components/parameters/AdjustmentId" }],
+        "operationId": "paymentAdjustment",
+        "description": "Participant owner or ADMIN; parent/payment pairing must match.",
+        "parameters": [
+          {
+            "$ref": "#/components/parameters/PaymentId"
+          },
+          {
+            "$ref": "#/components/parameters/AdjustmentId"
+          }
+        ],
         "responses": {
-          "200": { "description": "Immutable adjustment receipt", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/AdjustmentRecord" } } } },
-          "404": { "$ref": "#/components/responses/Problem" }
+          "200": {
+            "description": "Immutable receipt with journal, time and recorded reason",
+            "headers": {
+              "Cache-Control": {
+                "schema": {
+                  "type": "string"
+                },
+                "description": "Contains no-store; this contract does not require a particular directive ordering."
+              }
+            },
+            "content": {
+              "application/json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Adjustment"
+                }
+              }
+            }
+          },
+          "400": {
+            "description": "Malformed ID, amount, key, reason or pagination.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "401": {
+            "description": "Session absent, expired or revoked. Retain any previously uncertain instruction.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "403": {
+            "description": "Role/owner not authorized, invalid CSRF, or missing required administrative reason.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "404": {
+            "description": "Missing payment/adjustment, unrelated owner, or mismatched parent resource.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          },
+          "503": {
+            "description": "Dependency unavailable; outcome may require same-key resolution.",
+            "content": {
+              "application/problem+json": {
+                "schema": {
+                  "$ref": "#/components/schemas/Problem"
+                }
+              }
+            }
+          }
+        }
+      }
+    },
+    "/auth/csrf": {
+      "get": {
+        "operationId": "adjustmentCsrfToken",
+        "security": [],
+        "responses": {
+          "200": {
+            "description": "CSRF headerName and token; authentication material must not enter intent storage.",
+            "content": {
+              "application/json": {
+                "schema": {
+                  "type": "object",
+                  "required": [
+                    "headerName",
+                    "token"
+                  ],
+                  "properties": {
+                    "headerName": {
+                      "type": "string",
+                      "const": "X-XSRF-TOKEN"
+                    },
+                    "token": {
+                      "type": "string"
+                    }
+                  }
+                }
+              }
+            }
+          }
         }
       }
     }
   },
   "components": {
     "securitySchemes": {
-      "SessionCookie": { "type": "apiKey", "in": "cookie", "name": "LG-SESSION", "description": "Sandbox cookie name; secure deployments use the __Host- prefix." }
+      "SandboxSession": {
+        "type": "apiKey",
+        "in": "cookie",
+        "name": "LG-SESSION",
+        "description": "Local HTTP sandbox only."
+      },
+      "SecureSession": {
+        "type": "apiKey",
+        "in": "cookie",
+        "name": "__Host-LG-SESSION",
+        "description": "HTTPS HttpOnly Secure session; no authentication tokens in localStorage."
+      }
     },
     "parameters": {
-      "PaymentId": { "name": "paymentId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } },
-      "AdjustmentId": { "name": "adjustmentId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } },
-      "IdempotencyKey": { "name": "Idempotency-Key", "in": "header", "required": true, "schema": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$" }, "description": "Stable for one normalized adjustment instruction and reused after an uncertain response." },
-      "CsrfHeader": { "name": "X-XSRF-TOKEN", "in": "header", "required": true, "schema": { "type": "string", "minLength": 1 } },
-      "Limit": { "name": "limit", "in": "query", "schema": { "type": "integer", "minimum": 1, "maximum": 100, "default": 50 } },
-      "Offset": { "name": "offset", "in": "query", "schema": { "type": "integer", "minimum": 0, "maximum": 10000, "default": 0 } }
-    },
-    "headers": {
-      "IdempotencyReplayed": { "description": "true only when the original durable response is replayed", "schema": { "type": "string", "enum": ["true", "false"] } },
-      "Location": { "description": "Stable adjustment resource location", "schema": { "type": "string" } }
-    },
-    "responses": {
-      "Problem": { "description": "Machine-readable application/problem+json with stable code, safe message and correlationId", "content": { "application/problem+json": { "schema": { "$ref": "#/components/schemas/Problem" } } } },
-      "UncertainProblem": { "description": "The client cannot infer success or failure and must retain the same normalized request and idempotency key", "content": { "application/problem+json": { "schema": { "$ref": "#/components/schemas/Problem" } } } }
+      "PaymentId": {
+        "name": "paymentId",
+        "in": "path",
+        "required": true,
+        "schema": {
+          "type": "string",
+          "format": "uuid"
+        }
+      },
+      "AdjustmentId": {
+        "name": "adjustmentId",
+        "in": "path",
+        "required": true,
+        "schema": {
+          "type": "string",
+          "format": "uuid"
+        }
+      },
+      "IdempotencyKey": {
+        "name": "Idempotency-Key",
+        "in": "header",
+        "required": true,
+        "schema": {
+          "type": "string",
+          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"
+        },
+        "description": "Scope: authenticated actor, operation kind and parent payment. Retain original normalized request/key through timeout, reload and reauthentication. Same-key changed intent is 409; successful replay returns the original 201 body, not a new adjustment."
+      },
+      "CsrfHeader": {
+        "name": "X-XSRF-TOKEN",
+        "in": "header",
+        "required": true,
+        "schema": {
+          "type": "string"
+        },
+        "description": "Acquire with GET /auth/csrf using the current same-origin cookie session."
+      },
+      "Limit": {
+        "name": "limit",
+        "in": "query",
+        "schema": {
+          "type": "integer",
+          "minimum": 1,
+          "maximum": 100,
+          "default": 50
+        }
+      },
+      "Offset": {
+        "name": "offset",
+        "in": "query",
+        "schema": {
+          "type": "integer",
+          "minimum": 0,
+          "maximum": 10000,
+          "default": 0
+        }
+      }
     },
     "schemas": {
-      "Currency": { "type": "string", "enum": ["CAD", "USD", "JPY", "KWD"] },
-      "MinorUnits": { "type": "string", "pattern": "^[0-9]+$", "description": "Exact integer minor units; never a JSON number." },
-      "PositiveMinorUnits": { "type": "string", "pattern": "^[1-9][0-9]{0,12}$" },
-      "AdjustmentState": { "type": "string", "enum": ["NONE", "PARTIALLY_REFUNDED", "FULLY_REFUNDED", "REVERSED"] },
-      "AdjustmentSummary": {
+      "AdjustmentContext": {
         "type": "object",
-        "additionalProperties": false,
-        "required": ["paymentId", "direction", "sourceRef", "destinationRef", "amountMinor", "refundedMinor", "remainingRefundableMinor", "currency", "state", "adjustmentState", "version", "createdAt", "updatedAt", "canRefund", "canReverse"],
+        "required": [
+          "paymentId",
+          "state",
+          "adjustmentState",
+          "amountMinor",
+          "refundedMinor",
+          "remainingRefundableMinor",
+          "currency",
+          "journalId",
+          "version",
+          "payerRef",
+          "recipientRef",
+          "recipientAvailableMinor",
+          "recipientBalanceVersion",
+          "canRefund",
+          "canReverse",
+          "refundDisabledReason",
+          "reversalDisabledReason"
+        ],
         "properties": {
-          "paymentId": { "type": "string", "format": "uuid" },
-          "direction": { "type": "string", "enum": ["OUTGOING", "INCOMING", "ADMIN"] },
-          "accountId": { "type": ["string", "null"], "format": "uuid" },
-          "counterpartyRef": { "type": ["string", "null"] },
-          "sourceRef": { "type": "string", "pattern": "^LG-[0-9a-f]{32}$" },
-          "destinationRef": { "type": "string", "pattern": "^LG-[0-9a-f]{32}$" },
-          "amountMinor": { "$ref": "#/components/schemas/PositiveMinorUnits" },
-          "refundedMinor": { "$ref": "#/components/schemas/MinorUnits" },
-          "remainingRefundableMinor": { "$ref": "#/components/schemas/MinorUnits" },
-          "currency": { "$ref": "#/components/schemas/Currency" },
-          "state": { "type": "string", "enum": ["PENDING", "SETTLED", "FAILED", "CANCELLED"] },
-          "adjustmentState": { "$ref": "#/components/schemas/AdjustmentState" },
-          "version": { "type": "string", "pattern": "^[0-9]+$" },
-          "journalId": { "type": ["string", "null"], "format": "uuid" },
-          "createdAt": { "type": "string", "format": "date-time" },
-          "updatedAt": { "type": "string", "format": "date-time" },
-          "canRefund": { "type": "boolean" },
-          "canReverse": { "type": "boolean" }
-        }
-      },
-      "RefundRequest": { "type": "object", "additionalProperties": false, "required": ["amountMinor"], "properties": { "amountMinor": { "$ref": "#/components/schemas/PositiveMinorUnits" }, "reason": { "type": "string", "minLength": 1, "maxLength": 500 } } },
-      "ReversalRequest": { "type": "object", "additionalProperties": false, "required": ["reason"], "properties": { "reason": { "type": "string", "minLength": 1, "maxLength": 500 } } },
-      "AdjustmentReceipt": { "type": "object", "required": ["id", "paymentId", "kind", "amountMinor", "currency", "journalId"], "properties": { "id": { "type": "string", "format": "uuid" }, "paymentId": { "type": "string", "format": "uuid" }, "kind": { "type": "string", "enum": ["REFUND", "REVERSAL"] }, "amountMinor": { "$ref": "#/components/schemas/PositiveMinorUnits" }, "currency": { "$ref": "#/components/schemas/Currency" }, "journalId": { "type": "string", "format": "uuid" } } },
-      "AdjustmentRecord": { "allOf": [{ "$ref": "#/components/schemas/AdjustmentReceipt" }, { "type": "object", "required": ["reason", "createdAt"], "properties": { "reason": { "type": "string" }, "createdAt": { "type": "string", "format": "date-time" } } }] },
-      "AdjustmentPage": { "type": "object", "required": ["items", "limit", "offset", "hasMore"], "properties": { "items": { "type": "array", "items": { "$ref": "#/components/schemas/AdjustmentRecord" } }, "limit": { "type": "integer" }, "offset": { "type": "integer" }, "hasMore": { "type": "boolean" } } },
-      "Problem": { "type": "object", "required": ["code", "message", "correlationId"], "properties": { "code": { "type": "string" }, "message": { "type": "string" }, "correlationId": { "type": "string" }, "validation": { "type": "object", "additionalProperties": { "type": "string" } } } }
+          "paymentId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "state": {
+            "type": "string",
+            "enum": [
+              "PENDING",
+              "SETTLED",
+              "FAILED",
+              "CANCELLED"
+            ]
+          },
+          "adjustmentState": {
+            "type": "string",
+            "enum": [
+              "NONE",
+              "PARTIALLY_REFUNDED",
+              "FULLY_REFUNDED",
+              "REVERSED"
+            ]
+          },
+          "amountMinor": {
+            "type": "string",
+            "pattern": "^(0|[1-9][0-9]*)$",
+            "description": "Exact integer minor units, never a floating-point JSON number."
+          },
+          "refundedMinor": {
+            "type": "string",
+            "pattern": "^(0|[1-9][0-9]*)$",
+            "description": "Exact integer minor units, never a floating-point JSON number."
+          },
+          "remainingRefundableMinor": {
+            "type": "string",
+            "pattern": "^(0|[1-9][0-9]*)$",
+            "description": "Exact integer minor units, never a floating-point JSON number."
+          },
+          "currency": {
+            "type": "string",
+            "enum": [
+              "CAD",
+              "USD",
+              "JPY",
+              "KWD"
+            ]
+          },
+          "journalId": {
+            "anyOf": [
+              {
+                "type": "string",
+                "format": "uuid"
+              },
+              {
+                "type": "null"
+              }
+            ]
+          },
+          "version": {
+            "type": "string",
+            "pattern": "^(0|[1-9][0-9]*)$",
+            "description": "Exact integer minor units, never a floating-point JSON number."
+          },
+          "payerRef": {
+            "type": "string"
+          },
+          "recipientRef": {
+            "type": "string"
+          },
+          "recipientAvailableMinor": {
+            "anyOf": [
+              {
+                "type": "string",
+                "pattern": "^(0|[1-9][0-9]*)$",
+                "description": "Exact integer minor units, never a floating-point JSON number."
+              },
+              {
+                "type": "null"
+              }
+            ]
+          },
+          "recipientBalanceVersion": {
+            "anyOf": [
+              {
+                "type": "string",
+                "pattern": "^(0|[1-9][0-9]*)$",
+                "description": "Exact integer minor units, never a floating-point JSON number."
+              },
+              {
+                "type": "null"
+              }
+            ]
+          },
+          "canRefund": {
+            "type": "boolean"
+          },
+          "canReverse": {
+            "type": "boolean"
+          },
+          "refundDisabledReason": {
+            "type": [
+              "string",
+              "null"
+            ]
+          },
+          "reversalDisabledReason": {
+            "type": [
+              "string",
+              "null"
+            ]
+          }
+        },
+        "description": "One authorized database statement reads the parent and recipient balance. Payers see null recipient balance/version. Eligibility is informational and is rechecked under the financial locks. Original base settlement state is not rewritten."
+      },
+      "AdjustmentReceipt": {
+        "type": "object",
+        "required": [
+          "id",
+          "paymentId",
+          "kind",
+          "amountMinor",
+          "currency",
+          "journalId"
+        ],
+        "properties": {
+          "id": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "paymentId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "kind": {
+            "type": "string",
+            "enum": [
+              "REFUND",
+              "REVERSAL"
+            ]
+          },
+          "amountMinor": {
+            "type": "string",
+            "pattern": "^(0|[1-9][0-9]*)$",
+            "description": "Exact integer minor units, never a floating-point JSON number."
+          },
+          "currency": {
+            "type": "string",
+            "enum": [
+              "CAD",
+              "USD",
+              "JPY",
+              "KWD"
+            ]
+          },
+          "journalId": {
+            "type": "string",
+            "format": "uuid"
+          }
+        }
+      },
+      "Adjustment": {
+        "type": "object",
+        "required": [
+          "id",
+          "paymentId",
+          "kind",
+          "amountMinor",
+          "currency",
+          "journalId",
+          "reason",
+          "createdAt"
+        ],
+        "properties": {
+          "id": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "paymentId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "kind": {
+            "type": "string",
+            "enum": [
+              "REFUND",
+              "REVERSAL"
+            ]
+          },
+          "amountMinor": {
+            "type": "string",
+            "pattern": "^(0|[1-9][0-9]*)$",
+            "description": "Exact integer minor units, never a floating-point JSON number."
+          },
+          "currency": {
+            "type": "string",
+            "enum": [
+              "CAD",
+              "USD",
+              "JPY",
+              "KWD"
+            ]
+          },
+          "journalId": {
+            "type": "string",
+            "format": "uuid"
+          },
+          "reason": {
+            "type": "string",
+            "maxLength": 500
+          },
+          "createdAt": {
+            "type": "string",
+            "format": "date-time"
+          }
+        }
+      },
+      "AdjustmentPage": {
+        "type": "object",
+        "required": [
+          "items",
+          "limit",
+          "offset",
+          "hasMore"
+        ],
+        "properties": {
+          "items": {
+            "type": "array",
+            "items": {
+              "$ref": "#/components/schemas/Adjustment"
+            }
+          },
+          "limit": {
+            "type": "integer"
+          },
+          "offset": {
+            "type": "integer"
+          },
+          "hasMore": {
+            "type": "boolean"
+          }
+        }
+      },
+      "Refund": {
+        "type": "object",
+        "required": [
+          "amountMinor"
+        ],
+        "properties": {
+          "amountMinor": {
+            "type": "string",
+            "pattern": "^[1-9][0-9]*$",
+            "description": "Positive amount at most 1000000000000, no greater than unrefunded settlement or current recipient availability. Currency is inherited from the original payment."
+          },
+          "reason": {
+            "type": "string",
+            "minLength": 1,
+            "maxLength": 500,
+            "description": "Trimmed before fingerprinting; no sensitive information."
+          }
+        }
+      },
+      "Reversal": {
+        "type": "object",
+        "required": [
+          "reason"
+        ],
+        "properties": {
+          "reason": {
+            "type": "string",
+            "minLength": 1,
+            "maxLength": 500,
+            "description": "Trimmed before fingerprinting; no sensitive information."
+          }
+        }
+      },
+      "Problem": {
+        "type": "object",
+        "required": [
+          "code",
+          "message",
+          "correlationId"
+        ],
+        "properties": {
+          "code": {
+            "type": "string"
+          },
+          "message": {
+            "type": "string"
+          },
+          "correlationId": {
+            "type": "string"
+          },
+          "validation": {
+            "type": "object",
+            "additionalProperties": {
+              "type": "string"
+            }
+          }
+        }
+      }
     }
   }
 }

```

### compose.yaml

REVIEW_DIFFERENCE

```diff
--- branch/compose.yaml
+++ main-history/compose.yaml
@@ -3,8 +3,6 @@
 x-ledger-runtime: &ledger-runtime
   LEDGER_SANDBOX_HTTP: "true"
   LEDGER_AUTH_KEY: ${LEDGER_AUTH_KEY:?LEDGER_AUTH_KEY is required}
-  LEDGERGUARD_AUTH_IP_LIMIT: ${LEDGERGUARD_AUTH_IP_LIMIT:-60}
-  LEDGERGUARD_AUTH_IDENTITY_LIMIT: ${LEDGERGUARD_AUTH_IDENTITY_LIMIT:-10}
   LEDGER_DATABASE_URL: jdbc:postgresql://postgres:5432/${POSTGRES_DB:-ledgerguard}
   LEDGER_RUNTIME_USER: ledger_runtime
   LEDGER_RUNTIME_PASSWORD: ${LEDGER_RUNTIME_PASSWORD:?LEDGER_RUNTIME_PASSWORD is required}

```

### docs/architecture/adr/0020-p08c-replay-safe-payment-adjustments.md

PATH_NOT_IN_MAIN_HISTORY

```diff
# ADR 0020: replay-safe customer refunds and administrator reversals

Status: accepted for the P08C source candidate.

## Context

The verified P06 financial boundary already implements recipient-authorized partial/full refunds, administrator full reversal, idempotency, immutable compensating journals, audit records and concurrency-safe transition enforcement. P08B deliberately stopped at transfer, payment lifecycle and pending cancellation, leaving adjustment operations without a truthful product interface.

The browser must not derive sensitive authority from presentation state, optimistically alter a payment, replace an uncertain command with a new key or imply that the original settlement journal was edited. Administrators need a narrow full-reversal operation, not a generic balance editor.

## Decision

1. Keep `PaymentService` and the protected PostgreSQL financial command path as the only adjustment command boundary.
2. Add read-only adjustment-summary endpoints for a visible customer payment and for an explicitly administrator-scoped lookup. The summary reports exact integer minor-unit strings, original/refunded/remaining amounts, base and adjustment state, immutable references and conservative command eligibility.
3. Keep customer and administrator summary paths separate. Spring Security remains the first role boundary and the controller repeats role/ownership checks as defense in depth.
4. Reuse `IntentStore` for `payment-refunds` and `payment-reversals`. A timeout preserves the normalized command and idempotency key; the UI permits only same-key replay until the outcome is confirmed or deterministically rejected.
5. Render refunds only to the original recipient owner and reversals only to ADMIN. The backend remains authoritative for balance availability and every race.
6. Present adjustments as an immutable timeline and receipt containing their own journal identity. The original settlement amount and journal stay visible and unchanged.
7. Integrate the new routes without rewriting the verified P08B screens. A small router bridge adds adjustment navigation to an owner-visible payment detail and administrator navigation to the existing shell.

## Consequences

- Customer refund and administrator reversal journeys become operable without duplicating financial logic.
- The summary is an advisory read model; it never authorizes a command or spending decision.
- A command can become ineligible between summary read and confirmation. The UI reports the authoritative rejection and refreshes instead of inferring success.
- Administrators receive public account references and immutable payment metadata needed for investigation, but no generic mutation endpoint.
- Later administrator transaction search can link into this bounded reversal surface without changing its command semantics.

```

### docs/evidence/INDEX.md

REVIEW_DIFFERENCE

```diff
--- branch/docs/evidence/INDEX.md
+++ main-history/docs/evidence/INDEX.md
@@ -1,4 +1,4 @@
-# Evidence index — P08B verified, P08C candidate, full product NO_GO
+# Evidence index — P08B verified, full product NO_GO

 ## Current verified P08B evidence

@@ -7,33 +7,39 @@
 - [Durable human-readable P08B report](p08b-5d6d883.md)
 - [Machine-readable P08B provenance](p08b-5d6d883.json)
 - [Scoped P08B requirements/test-ID source](../implementation/P08B_REQUIREMENTS.json)
-- [Replay-safe money-movement architecture](../architecture/adr/0019-p08b-replay-safe-customer-money-movement.md)
+- [Replay-safe customer money-movement architecture](../architecture/adr/0019-p08b-replay-safe-customer-money-movement.md)
 - [Verified P08B UI OpenAPI](../../backend/src/main/resources/openapi/p08b-ui.json)

-Verification job `108721959438` and required gate `108723219635` succeeded. The exact-SHA run completed locked frontend/client verification, Java and PostgreSQL integration, real Compose startup, RabbitMQ duplicate-delivery/process-death proofs, cancellation/refund/reversal regression, schedules, signed webhooks, 24 responsive Chromium journeys with authenticated axe checks and repeatable reconciliation. Artifact `10944390774` is 1,732,590 bytes with digest `sha256:7fadf64bfff5689eea5ab0e4a933bc4b8bc3862f310bfdf8cefd0af6a6251d7f`.
+The exact-SHA run completed 133 core/security JUnit cases, 124 real PostgreSQL/HTTP integration cases, 91 TypeScript client/contract cases, 42 live P05 checks, 32 live P06 checks, 15 live P07A checks, 26 live P07B checks and 24 Chromium journeys. All required suites had zero failures, errors and skips. Seven scoped P08B requirements were bound to named executed evidence, 316 tracked files produced zero high-signal literal-secret findings and reconciliation reported zero discrepancies.

-P08B proofs cover explicit transfer confirmation/receipts, committed-response-loss replay with one effect, durable pending payments, owner-visible payment history/detail, real RabbitMQ settlement and race-safe pending cancellation.
+P08B proofs cover explicit transfer confirmation and settled receipts, owner-scoped intent/key persistence, safe same-key replay after a committed response loss with one economic effect, durable `PENDING` payment acceptance, real RabbitMQ settlement, authoritative payment history/status, pending cancellation while both workers are stopped, responsive desktop/tablet/mobile rendering and authenticated axe checks.

-## P08C candidate evidence contract
+## Preserved P08A and earlier evidence

-P08C is `IMPLEMENTED_UNVERIFIED` until its exact final source SHA passes the permanent workflow.
+P08A implementation `d675db096b8f023469e253737ade80a2b8b3b0fa` passed run `36345292129`.

-- [Scoped P08C requirements/test-ID source](../implementation/P08C_REQUIREMENTS.json)
-- [Adjustment interface architecture](../architecture/adr/0020-p08c-replay-safe-payment-adjustments.md)
-- [P08C candidate OpenAPI](../../backend/src/main/resources/openapi/p08c-ui.json)
+- [Durable human-readable P08A report](p08a-d675db0.md)
+- [Machine-readable P08A provenance](p08a-d675db0.json)

-The candidate gate requires recipient partial/full refund, administrator full reversal, same-key refund replay after response loss, changed-intent conflict, payer/customer denial, forbidden post-adjustment transitions, immutable receipts, six screenshots, 36 responsive Chromium journeys, authenticated axe checks, live Compose adjustment proofs and reconciliation.
+P07B implementation `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975` passed run `36330862462`.

-## Preserved earlier evidence
+- [Durable human-readable P07B report](p07b-cc6b3ca.md)
+- [Machine-readable P07B provenance](p07b-cc6b3ca.json)

-P08A implementation `d675db096b8f023469e253737ade80a2b8b3b0fa` passed run `36345292129`; its [human report](p08a-d675db0.md) and [JSON provenance](p08a-d675db0.json) retain original scope.
+P07A implementation `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed run `36319414655`; its [human-readable report](p07a-9478663.md) and [JSON provenance](p07a-9478663.json) retain original scope.

-P07B implementation `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975` passed run `36330862462`. P07A source `9478663f97f9dc65d0c85117f244e1b8b80c37cb` passed run `36319414655`. P06 source `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed run `36306335283`. P05 source `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`. Their durable reports retain original scope and timestamps.
+P06 implementation `bb1eeb1167b71fb92fb28f82c110fc489f60f03b` passed run `36306335283`. P05 implementation `bbca6dd7478e33320aa134f6cd59c9652f4b60db` passed run `36285547632`. P04 implementation `60a95db82350983eaf1ad3c7545190866c831f98` passed run `36276049817`. P03 implementation `8ee1e1f91a86c11e33468d764b639b425b3e12a7` passed run `36270965725`. Foundation source `cb9930168ffdc793a5759f754a39685369620422` passed run `36267641798`. Their durable reports retain original scope and timestamps.

-Historical component records remain under `component/` and `unit-probes/`; they are not relabeled as current integrated Dxx evidence.
+Historical component records remain available under `component/` and `unit-probes/`. They are not relabeled as current integrated Dxx evidence.
+
+## Honest failure history
+
+P08B's permanent final run passed after the candidate's status-label accessibility repair was incorporated and the temporary repair workflow was retired. The exact final source was then exercised by the complete gate, not only by a narrow browser retry.
+
+P08A's initial browser run had exposed a native-fetch receiver defect. The next exact-SHA run exposed a stale balance fixture assumption, a real WCAG contrast issue and fixture-authentication throttling. Each root cause was repaired, and the entire gate—not only the failed browser step—was rerun successfully.

 ## Remaining evidence

-Later P08 customer/admin interfaces, P09 complete F01–F08 and D01–D24 campaigns, P10 Pact/ZAP/k6/backup-restore/nightly/release lanes and P11 final exploratory package/video remain incomplete.
+The customer adjustment interface, customer schedule/webhook interfaces, broader administrator interface, P09 complete F01–F08 and D01–D24 campaigns, P10 Pact/ZAP/k6/backup-restore/nightly/release lanes, and P11 final exploratory package/video remain incomplete.

 No public application, release tag, security certification, whole-product accessibility conformance or measured performance claim exists. GitHub Actions results are the authority for Docker/PostgreSQL/RabbitMQ/Compose/browser execution.

```

### docs/evidence/p08b-5d6d883.json

REVIEW_DIFFERENCE

```diff
--- branch/docs/evidence/p08b-5d6d883.json
+++ main-history/docs/evidence/p08b-5d6d883.json
@@ -1,20 +1,71 @@
 {
   "phase": "P08B",
   "status": "VERIFIED_PASS",
+  "fullProductStatus": "INCOMPLETE_NO_GO",
   "sourceSha": "5d6d883444845bc5de3364d0c682c3df26005d8e",
-  "workflowRun": 36355379901,
-  "event": "push",
-  "branch": "main",
-  "verificationJob": 108721959438,
-  "requiredGateJob": 108723219635,
-  "conclusion": "success",
-  "completedAt": "2026-09-27T22:35:40Z",
+  "workflow": {
+    "name": "LedgerGuard P08B verification",
+    "runId": 36355379901,
+    "completedAt": "2026-09-27T22:35:40Z",
+    "jobs": [
+      {
+        "id": 108721959438,
+        "name": "Build, customer money movement, browser accessibility, signed webhooks and financial invariants",
+        "conclusion": "success"
+      },
+      {
+        "id": 108723219635,
+        "name": "Required P08B gate",
+        "conclusion": "success"
+      }
+    ]
+  },
   "artifact": {
     "id": 10944390774,
     "name": "ledgerguard-p08b-evidence-5d6d883444845bc5de3364d0c682c3df26005d8e",
     "sizeBytes": 1732590,
-    "digest": "sha256:7fadf64bfff5689eea5ab0e4a933bc4b8bc3862f310bfdf8cefd0af6a6251d7f",
+    "sha256": "7fadf64bfff5689eea5ab0e4a933bc4b8bc3862f310bfdf8cefd0af6a6251d7f",
     "expiresAt": "2026-10-11T22:35:30Z"
   },
-  "limitations": "P08B verification is a development milestone, not a complete product release."
+  "executed": {
+    "coreSecurityJUnit": 133,
+    "postgresHttpIntegration": 124,
+    "typescriptContracts": 91,
+    "p08bTypeScriptContracts": 8,
+    "chromiumJourneys": 24,
+    "p08bChromiumJourneys": 12,
+    "viewportProjects": 3,
+    "p05ComposeChecks": 42,
+    "p06ComposeChecks": 32,
+    "p07aComposeChecks": 15,
+    "p07bComposeChecks": 26,
+    "p08bRequirements": 7,
+    "responsiveScreenshots": 9,
+    "p08bResponsiveScreenshots": 6,
+    "filesSecretScanned": 316,
+    "failures": 0,
+    "errors": 0,
+    "skipped": 0,
+    "trackedTreeDirty": false,
+    "reconciliationDiscrepancies": 0
+  },
+  "verifiedBoundary": [
+    "explicit owner-authorized immediate-transfer confirmation and settled receipt",
+    "same-key uncertain-response recovery with one transfer effect",
+    "durable PENDING payment acceptance and real RabbitMQ settlement",
+    "owner-scoped payment history and authoritative lifecycle detail",
+    "pending-payment cancellation while workers are stopped",
+    "exact minor-unit money handling",
+    "keyboard and semantic accessibility behavior",
+    "authenticated axe WCAG A/AA checks",
+    "desktop, tablet and mobile Chromium journeys"
+  ],
+  "remaining": [
+    "remaining P08 adjustment interface",
+    "schedule/webhook interfaces",
+    "administrator interface",
+    "P09",
+    "P10",
+    "P11"
+  ]
 }

```
