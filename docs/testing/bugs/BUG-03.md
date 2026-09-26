# BUG-03 — STALE_EVENT_OVERWRITE

Origin: deliberately seeded component mutation, not an accidental production finding. Required-catalogue relationship: D08; scope UNIT_COMPONENT_ONLY, counts_toward_G07=false. Status: component detection verified and original source restored. Severity: high potential integrity risk; priority P1. Risk: R06. This severity is a prioritization judgment, not an observed financial incident.

## Environment and setup
Source commit `a74d930987639f3bcfaf03038947537412599fda`; clean tree at experiment start: `True`. Run `D08-ff996202-238b-47b1-bc99-4ca6e53978aa`. Java 21.0.11 / Node 22.16.0 and TypeScript 5.8.3 as applicable. The source file is `backend/src/main/java/lab/ledgerguard/core/Projection.java`. The exact [original source](../../evidence/unit-probes/D08-ff996202-238b-47b1-bc99-4ca6e53978aa/source-before.txt), [mutant](../../evidence/unit-probes/D08-ff996202-238b-47b1-bc99-4ca6e53978aa/source-mutant.txt) and [verdict/provenance](../../evidence/unit-probes/D08-ff996202-238b-47b1-bc99-4ca6e53978aa/verdict.json) are preserved.

## Reproduction and controlled difference
Execute `./scripts/lab unit-probes D08` on the recorded baseline. The runner first requires `PROJECTION-stale` to pass; replaces one unique declared source span; compiles/runs the same test with the same input; restores the exact original bytes; reruns that detecting test. The variant is source-level, not a default-off runtime toggle. Remove both version and terminal-state protection; an old full snapshot overwrites SETTLED.

## Expected and actual
Expected: the original implementation's detecting assertion passes. Actual mutated behavior: A prior PENDING snapshot regresses a SETTLED projection. One assertion failed, with zero discovery/setup errors or skips. See [baseline XML](../../evidence/unit-probes/D08-ff996202-238b-47b1-bc99-4ca6e53978aa/baseline.xml), [mutant XML](../../evidence/unit-probes/D08-ff996202-238b-47b1-bc99-4ca6e53978aa/mutant.xml) and [restored XML](../../evidence/unit-probes/D08-ff996202-238b-47b1-bc99-4ca6e53978aa/restoration.xml). Full logs are adjacent to those reports. The runner's measured verdict was `DETECTED`.

## Root cause, correction and regression
Guard both aggregate version and allowed terminal state changes. The mutation was removed and the restored source SHA-256 `c1c0793b31627bec8e6f98e7b25ae99c7a840493090c0ede778d3f3b21abbe3c` equals the original digest. Restoration passed the detecting assertion; final full unit results are separate evidence. No broker delivery or persisted read-model mutation was executed.

## Scope limits
This report cannot establish real database, HTTP, broker, browser, restart, multi-process or financial-account effects. The mandatory full-boundary Dxx experiment remains open even though this component-level regression detector works.
