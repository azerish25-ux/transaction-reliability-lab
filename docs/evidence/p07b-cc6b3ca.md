# LedgerGuard P07B exact-SHA verification

Result: **VERIFIED_PASS**  
Implementation source: `cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975`  
Permanent workflow: `LedgerGuard P07B verification`  
Workflow run: `36330862462`  
Completed: September 27, 2026  
Full-product result: **INCOMPLETE / NO_GO**

## Provenance

GitHub Actions checked out the exact implementation source above. Verification job `108652383318` and required aggregate gate `108653566120` both completed successfully. The source tree was clean when evidence was generated.

Artifact `10935339693`, named `ledgerguard-p07b-evidence-cc6b3ca81d2368c188aa7a79cec2d37b2dd8b975`, contains 157,131 bytes and has SHA-256 digest `83378eb2ba6040004d7ba95f7280d00f3d7fc6953635abc1a78a12aa3327d94f`. It expires from GitHub's transient artifact store on October 11, 2026; this report and its JSON companion preserve the durable provenance.

## Executed verification

The permanent gate completed with zero failures, errors or skips across every required suite:

- 133 core/security JUnit cases: 120 `CoreTest` cases and 13 `SecuritySettingsTest` cases.
- 124 real PostgreSQL/HTTP integration cases, including 5 `WebhookDeliveryReliabilityIT` cases.
- 77 TypeScript client/contract cases, including 7 P07B webhook-client cases.
- 42 live P05 payment/RabbitMQ/restart checks.
- 32 live P06 cancellation/refund/reversal checks.
- 15 live P07A two-scheduler checks under the additive V10 schema.
- 26 live P07B signed-webhook checks.
- Eight scoped P07B requirements bound to named executed tests.
- 282 tracked files scanned with zero high-signal literal-secret findings.
- Repeatable independent reconciliation with zero discrepancies.

The gate built Java 21 and TypeScript sources, executed Maven/JUnit/PostgreSQL integration, validated both Compose models, started and seeded the restricted P06 topology, preserved P05 and P06 recovery/adjustment proofs, activated V10 with two schedulers, two separately restartable webhook dispatchers and the signed receiver, exercised P07A and P07B live campaigns, verified runtime status and reconciliation, generated evidence, captured logs and completed scoped teardown.

## Verified P07B boundary

The exact-SHA run establishes the following within the sandbox laboratory boundary:

- Customer-owned approved webhook endpoints with one-time secret disclosure.
- AES-256-GCM encrypted, versioned endpoint secrets at rest.
- Exact-byte HMAC-SHA256 signatures over timestamp, event identity and body.
- Five-minute receiver replay-window validation and constant-time signature comparison.
- Durable endpoint/event fan-out identity and immutable attempt history.
- PostgreSQL leases with two competing dispatcher processes and restart recovery.
- Eight-attempt bounded retry cycles, exponential backoff/jitter, age limits and audited manual retry.
- Exact allowlisted destinations, disabled redirects and rejection of unsafe URL/address forms.
- Durable receiver deduplication when an accepted response is lost.
- Owner-scoped inspection and administrator inspection/retry without secret disclosure.
- Financial isolation: webhook failure neither changes settled money nor blocks payment processing.
- Agreement between scoped OpenAPI, TypeScript client, Java API and live Compose behavior.

## Limitations and handoff

This verification is not a production-banking, compliance, security-certification, public-deployment or accessibility claim. The synthetic-money product remains **INCOMPLETE / NO_GO** because P08 customer/admin interfaces and browser/accessibility evidence, P09 complete fault and seeded-defect laboratory, P10 full contract/security/performance/restore lanes and P11 final evidence/release package remain open.

The next executable milestone is **P08A**: a real same-origin React product shell with registration/login/session expiry, real account balances, account history, customer-safe transaction detail, responsive inspection, Playwright journeys and authenticated axe checks.
