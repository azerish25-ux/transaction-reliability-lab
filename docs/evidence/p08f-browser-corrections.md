# P08F observed browser failures and corrections

Overall product: **INCOMPLETE / NO_GO**. This is an observed defect record, not a passing verification claim.

## Failed execution

Permanent P08F run `36503272972` tested source `6d1dec657b6c2a348d0490606ab0efee55b6a481`. The browser stage and required gate failed. Generated XML recorded 144 browser cases, 11 failures, zero errors and zero skips. All 114 P01-P08E browser cases passed; 19 of the 30 new administrator cases passed. Unit (159), PostgreSQL/HTTP integration (139) and TypeScript client (186) suites had zero failures, errors or skips. These counts belong to that source, before the additional numeric-version integration regression.

Artifact `11007248914`, `ledgerguard-p08f-evidence-6d1dec657b6c2a348d0490606ab0efee55b6a481`, was downloaded and its SHA-256 verified as `0c1448cc302ebb1a448c08113a43123e2bd0a0215532de50432322632f748af7`. Raw artifacts have finite retention. No failed run is relabeled as successful.

## Root causes and corrective changes

1. **Filter accessible names:** P08FE2E01 failed at all three widths. Implicit select labels included their option content, so the exact Transaction kind label did not resolve. Explicit label spans and `aria-labelledby` now bind the select to its visible field label; the results-per-page selector uses the same pattern. The original label-based search assertions remain.
2. **Audit row assertion:** P08FE2E03 expected a standalone Refund text node, while the actual cell also contained its sequence. The assertion now finds exactly one row by the real returned refund ID and verifies the complete action/sequence cell. This strengthens record identity without changing the business expectation or removing privacy/database assertions.
3. **Mobile administrator navigation:** P08FE2E04/05/06/08/10 failed only on mobile. A global mobile header rule hid links carrying the shared navigation class, including the secondary administrator navigation. The administrator-specific anchor rule now explicitly uses inline-flex and a 44-pixel minimum height. Other customer/header navigation rules are unchanged.

Source correction: `70a94d46cede9f6c7ed835eb64379636378d415f`. The three corrected files passed strict TypeScript checks locally. Browser actions have bounded timeouts; automatic recordings remain disabled for administrator journeys. A fresh permanent full run, not local compilation or the failed run above, is required before declaring P08F verified.

CI now stops the browser campaign at its first failure to preserve actionable diagnostics rather than waiting for cascaded timeouts. This does not relax completion: the required evidence gate still demands every required case, no skips, no functional retries, all seven P08F requirements and all fifteen responsive screenshots.

## Delivery diagnostics

A source publisher encountered a GitHub internal-server-error response; a guarded bounded retry delivered the candidate without force-pushing. A later diagnostic publisher's literal replacement precondition correctly rejected a whitespace mismatch before committing. The replacement was corrected against the inspected source hash and then applied successfully. Temporary source/diagnostic workflows are removed after their scoped use; their historical runs remain inspectable.
