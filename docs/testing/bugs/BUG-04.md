# BUG-04 — REVERSAL_AFTER_REFUND

Origin: deliberately seeded component mutation, not an accidental production finding. Required-catalogue relationship: D11; scope UNIT_COMPONENT_ONLY, counts_toward_G07=false. Status: component detection verified and original source restored. Severity: high potential integrity risk; priority P1. Risk: R08. This severity is a prioritization judgment, not an observed financial incident.

## Environment and setup
Source commit `a74d930987639f3bcfaf03038947537412599fda`; clean tree at experiment start: `True`. Run `D11-0f4d60c6-13ab-46c5-8bd1-d2f5dbc04ad0`. Java 21.0.11 / Node 22.16.0 and TypeScript 5.8.3 as applicable. The source file is `backend/src/main/java/lab/ledgerguard/core/PaymentRules.java`. The exact [original source](../../evidence/unit-probes/D11-0f4d60c6-13ab-46c5-8bd1-d2f5dbc04ad0/source-before.txt), [mutant](../../evidence/unit-probes/D11-0f4d60c6-13ab-46c5-8bd1-d2f5dbc04ad0/source-mutant.txt) and [verdict/provenance](../../evidence/unit-probes/D11-0f4d60c6-13ab-46c5-8bd1-d2f5dbc04ad0/verdict.json) are preserved.

## Reproduction and controlled difference
Execute `./scripts/lab unit-probes D11` on the recorded baseline. The runner first requires `REVERSAL-after-refund` to pass; replaces one unique declared source span; compiles/runs the same test with the same input; restores the exact original bytes; reruns that detecting test. The variant is source-level, not a default-off runtime toggle. A full reversal forgets a previous successful partial refund.

## Expected and actual
Expected: the original implementation's detecting assertion passes. Actual mutated behavior: A partially refunded settled policy object accepts a full reversal. One assertion failed, with zero discovery/setup errors or skips. See [baseline XML](../../evidence/unit-probes/D11-0f4d60c6-13ab-46c5-8bd1-d2f5dbc04ad0/baseline.xml), [mutant XML](../../evidence/unit-probes/D11-0f4d60c6-13ab-46c5-8bd1-d2f5dbc04ad0/mutant.xml) and [restored XML](../../evidence/unit-probes/D11-0f4d60c6-13ab-46c5-8bd1-d2f5dbc04ad0/restoration.xml). Full logs are adjacent to those reports. The runner's measured verdict was `DETECTED`.

## Root cause, correction and regression
Preserve the no-prior-refund precondition. The mutation was removed and the restored source SHA-256 `f9ca472061e766163aa263b1216f524d7bd2b80607e7120a78520947a8d1326f` equals the original digest. Restoration passed the detecting assertion; final full unit results are separate evidence. The PostgreSQL command has its own guard and was not exercised.

## Scope limits
This report cannot establish real database, HTTP, broker, browser, restart, multi-process or financial-account effects. The mandatory full-boundary Dxx experiment remains open even though this component-level regression detector works.
