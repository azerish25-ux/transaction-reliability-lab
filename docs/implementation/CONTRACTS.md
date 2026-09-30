# P10 ordinary consumer/provider contracts

Status: HTTP contract code implemented; local consumer generation and compilation
verified. Live Spring/PostgreSQL provider acceptance is still pending. Overall
project status remains **INCOMPLETE / NO_GO**.

## Actual boundaries

- `tests/pact/consumer.cjs` uses Pact JS 17.1.4 and the compiled shipped
  `frontend/src/api.ts` `ApiClient`. Its transport only resolves browser-relative
  URLs to Pact's local server. It does not replace request serialization, methods,
  headers or client response processing.
- Five interactions cover the authenticated session, empty and populated wallet
  pages, CSRF-token shape and CAD wallet creation. Money is contractually a decimal
  string, not a JSON number. Account identity/time fields use bounded matchers;
  balances, currency, role and pagination semantics are exact.
- `PactProviderIT` uses Pact JVM 4.6.17, a real normal Spring application JAR,
  disposable PostgreSQL 17, all actual migrations, and restricted runtime DB role.
  Provider states register/login through the real HTTP API and create their own
  wallets. Only ephemeral session/CSRF credentials are substituted in Pact
  requests. No controller, database or auth mock is used; no auth limits are raised.
- The `contracts` Maven profile adds contract test sources/dependencies only. It
  does not enable verification-only application sources or fault modes.
- `PactSchemaSensitivityTest` is a separate engine-sensitivity check: an in-memory synthetic
  compatible response must pass and numeric money in place of a string must fail
  genuine Pact verification. This does not count as Spring provider acceptance.

## Run

From the repository root, with Java 21, Node 22 and Docker available:

```sh
npm --prefix frontend ci
npm --prefix frontend run verify
PACT_DO_NOT_TRACK=true npm --prefix frontend run test:pact
pact_do_not_track=true ./mvnw -B -ntp -f backend/pom.xml -Pcontracts -Dit.test=PactProviderIT,PaymentMessageProviderIT verify
```

Consumer generation recreates only its own generated Pact to avoid stale merged
interactions. No paid broker or external contract service is used. Generated Pact
files and raw test output live in ignored evidence/build directories.

## Hosted verification and current limits

In GitHub Actions, select **Bad Penny ordinary consumer-provider contracts**, then
**Run workflow → main → Run workflow**. The job is `contracts`. This manual workflow
checks the current source and uploads source-SHA-named evidence for 14 days. It is
supplemental; it cannot replace or satisfy either existing required release gate.
It does not invoke `scripts/lab`, a verification overlay, or a fault/security scan.

Local results on 2026-09-30:

- Actual Pact JS consumer generation: passed, five interactions.
- Contract-profile Java compilation/package: passed.
- Final Java unit suite with all contract additions: 168 passed, zero failures/skips.
- Frontend verify: all type checks, 186 client cases and production build passed.
- Live provider run: not run; Docker is unavailable in this execution environment.
- Genuine Pact JVM schema-sensitivity check: passed. The generated consumer's
  compatible response passes; changing `postedMinor` from string to JSON number
  produces a Pact mismatch at that field. This replaces the proxy-dependent JS
  diagnostic with a deterministic in-memory comparison using the same Pact JVM
  matcher used for provider verification. No network settings were changed.
- Real sender-wire-builder to real webhook-receiver contract: passed. Exact payload
  bytes, signature headers, correlation, successful receipt hash and HTTP 204 are
  verified with fixed synthetic inputs and a mocked persistence collaborator.
- Hosted run: not triggered. The connected GitHub tools have no workflow-dispatch
  action and the cloud browser is signed out. The owner run button above is the
  smallest remaining action for this particular acceptance loop.

## Scope still missing

These five HTTP interactions are an initial slice, not full P10 completion.
Payment/transfer/schedule/webhook HTTP contracts, live
provider results, performance/migration/restore evidence and other P10 requirements
remain open. Existing integration tests do not substitute for those claims.

Implementation references: [Pact JS consumer tests](https://docs.pact.io/implementation_guides/javascript/docs/consumer)
and [Pact JVM JUnit 5](https://docs.pact.io/implementation_guides/jvm/provider/junit5).

## Asynchronous payment message slice (2026-09-30)

`PaymentMessageConsumerTest` generates a genuine V3 Pact and feeds its bytes to
`ReliableEventConsumers.settle`, the actual Rabbit listener method. It asserts the
parsed identity/state, settlement collaborator call and acknowledgement, with no
unexpected failed-work or retry collaborator calls. `PaymentMessageProviderIT`
uses Pact JVM `MessageTestTarget` to verify the actual `OutboxPublisher.publishDue`
serialization captured at the broker transport boundary against that Pact.

Both local runs passed (one consumer and one provider interaction, zero failures
or skips). These focused contract tests mock SQL/broker collaborators; they do not
prove database settlement, redelivery, or RabbitMQ behavior. Existing live
integration acceptance remains separate. No process-death provider or active
fault mode is loaded. Test-only subclass mocks avoid requiring JVM instrumentation
attachment in this environment.

Run consumer generation before message provider verification:

```sh
pact_do_not_track=true ./mvnw -B -ntp -f backend/pom.xml -Pcontracts -Dtest=PaymentMessageConsumerTest test
pact_do_not_track=true ./mvnw -B -ntp -f backend/pom.xml -Pcontracts -Dtest=PaymentMessageProviderIT test
```

The manual workflow includes generation in its unit-test phase and provider
verification in its selected integration phase. Its archive also includes
`backend/target/pacts/`.

## Webhook wire contract

`WebhookWireContractTest` invokes the sender's extracted package-private
`signedRequest` builder, consumes its actual body publisher, and supplies its
headers/body to `WebhookReceiverController.receive`. The receiver verifies the
signature with the actual secret box/signature code, checks NORMAL mode, and
records the expected payload hash. Persistence is mocked; no network endpoint is
contacted. Destination allowlist and resolved-address checks remain in the sender's
unchanged delivery path before wire construction. This focused contract does not
prove live delivery/retry behavior.
