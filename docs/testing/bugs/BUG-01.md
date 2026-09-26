# BUG-01 — Server failure could discard an uncertain financial outcome

Origin: unintentional implementation defect discovered by code review and reproduced by a new client-unit test. Status: fixed and unit-verified; real HTTP/UI/database proof missing. Severity: high potential financial-UX risk; priority: P1. Risk: R03. Actual loss was NOT observed.

## Environment and preconditions
Node 22.16.0, TypeScript 5.8.3, production ApiClient module compiled by tsc. Original source commit `956e2acb1a0ad2feb4d83779a1aa3f0679ee8eb6`; newly added test bodies made the review run dirty. See [provenance](../../evidence/review-client-503/provenance.json) and [test diff](../../evidence/review-client-503/test-added.diff). The Fetch transport is an injected response, not a real Spring server.

## Reproduction
Run `./scripts/test-client` with the review test at the recorded pre-fix source. The test returns a valid CSRF response, then HTTP 503 for an idempotent payment command using the original intent/key. It asserts `OutcomeUnknown`, not a definite command rejection.

## Expected and actual
Expected: preserve uncertainty and resolve/retry the same key, since a server/proxy failure need not prove rollback. Actual: ApiError was thrown; the new assertion reported 43 passing cases and one failing case. No browser controller existed, so loss of intent or duplicate posting downstream was a plausible risk, NOT an observed effect.

## Evidence and root cause
[Before XML](../../evidence/review-client-503/before.xml), [before log](../../evidence/review-client-503/before.log). Non-2xx handling did not separate potentially ambiguous 5xx/408 responses from durable business rejections. The existing network-loss handling covered thrown Fetch errors but not an actual received failure response.

## Fix and regression
Commit `a74d930987639f3bcfaf03038947537412599fda` routes a keyed POST's 5xx/408 to OutcomeUnknown before normal response parsing. [After XML](../../evidence/review-client-503/after.xml) shows 44/44 client cases passing. Final [combined unit run](../../evidence/component/run.json) records 120 Java plus 44 client tests on the clean code commit. Three newline-rejection hypotheses already passed before the fix; they are retained boundary checks, not invented additional bugs.

Remaining: verify against real proxy/API commit-loss boundaries and the actual UI intent-resolution workflow; those product components are unimplemented.
