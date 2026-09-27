# ADR 0017 — P07B signed durable webhook delivery

Status: accepted for the P07B candidate. Full-product release status remains NO_GO until later phases pass.

## Context

LedgerGuard already commits financial events through PostgreSQL outbox rows. External HTTP is slower and less reliable than the financial transaction boundary: a receiver can time out, return a retryable status, accept an event and lose its response, or remain unavailable across process restarts. Calling receivers inside a money-changing transaction would couple settlement correctness to an untrusted network dependency.

The project also needs inspectable evidence for exact-byte signatures, SSRF/redirect controls, duplicate suppression, bounded retries, restart recovery, owner authorization and administrator operations.

## Decision

### Durable logical identity

A logical delivery is unique on `(endpoint_id, event_id)`. A bounded fan-out function maps committed outbox events to the customer who owns the originating payment, transfer or schedule and inserts a delivery only for endpoints that were enabled when the event occurred. Duplicate fan-out is harmless through the database uniqueness constraint.

A delivery stores the exact UTF-8 payload bytes that will be transmitted, their SHA-256 digest, event metadata, correlation identity, endpoint-secret version, current retry cycle, attempt count, lease and terminal state. Financial tables and journals are never changed by webhook delivery outcomes.

### Endpoint secrets and rotation

The API generates 32 random bytes and returns their URL-safe base64 representation only during endpoint creation or explicit rotation. AES-256-GCM encryption uses an environment-provided root transformed through a domain-separated SHA-256 KDF. Endpoint identity is authenticated as AES-GCM additional data.

Encrypted secret versions are append-only. Every delivery captures the active secret version at fan-out, so a later rotation does not make an older queued or retried event unverifiable. Ordinary runtime queries receive column-level access to endpoint metadata but not ciphertext or secret-history rows. The dispatcher obtains the required encrypted version only through a restricted security-definer claim. The sandbox receiver obtains it only for an existing endpoint/event/version tuple.

### Exact-byte signature contract

Each attempt regenerates its timestamp and signs:

```text
ASCII(epoch_seconds) + "." + ASCII(event_uuid) + "." + raw_body_bytes
```

The signature is lowercase hexadecimal HMAC-SHA256 prefixed with `v1=`. Headers carry endpoint ID, event ID, timestamp, key version and signature. The receiver validates a plus-or-minus 300-second replay window and compares the expected signature in constant time before recording a receipt.

### Dispatch isolation and retries

Two independently restartable dispatcher processes poll PostgreSQL. Claims use `FOR UPDATE SKIP LOCKED`, a persisted lease owner and lease deadline. A crashed lease becomes an immutable `LEASE_EXPIRED` attempt and is either reclaimed or failed if its budget is exhausted.

There are at most eight attempts per retry cycle. Retryable outcomes are connection failures, timeout, HTTP 408/429 and relevant 5xx. A 2xx response is delivered. Redirects and other 4xx responses are permanent. Delay uses the specified exponential policy with bounded deterministic jitter and a 300-second cap. The initial cycle ends after 24 hours. An authorized manual retry creates a new audited cycle and another bounded 24-hour window without deleting earlier attempts.

Connection timeout is one second, response timeout is three seconds, and redirects are disabled. Dispatch happens outside financial transactions and in a process separate from payment workers.

### Destination control

The bounded lab accepts only destination identifier `sandbox-receiver`, resolved to the exact configured URI `http://receiver:8081/events` in the isolated Compose network. The generic validator still requires HTTPS outside explicit sandbox mode, rejects userinfo, query, fragment, non-normalized paths, unexpected ports and special/private resolved addresses unless the exact internal sandbox exception applies. Customers never submit arbitrary URLs.

The shared HTTP request boundary admits that receiver only when the request path is exactly `/events`, the sandbox profile is active, and the request host/port is exactly `receiver:8081`. Browser origins remain forbidden on this path, and the raw request body is bounded to 65,536 bytes before controller conversion. All ordinary API sandbox traffic remains loopback-only.

### Receiver behavior

The real sandbox receiver reads raw bytes before JSON interpretation, verifies the exact signature, and persists `(endpoint_id,event_id)` before returning success. Repeated accepted requests increment receipt history but do not create another receiver-side logical effect. Controlled modes provide 429, 503, permanent 400, delayed response and “accepted then response lost” evidence.

## Consequences

- Webhook delivery is at least once; receiver deduplication provides one sandbox effect for a logical endpoint/event identity. No exactly-once Internet-delivery claim is made.
- Secret history is retained encrypted so old durable deliveries remain verifiable after rotation.
- Manual retry is explicit and audited rather than an infinite automatic loop.
- The dispatcher and receiver share the restricted runtime database role, but direct DML and secret-table reads are revoked; narrowly scoped security-definer functions mediate mutations and secret retrieval.
- P08 must provide the visual subscription and attempt-history interface. P09 and P10 still must execute the complete resilience, seeded-defect, contract, scanner and performance campaigns.
