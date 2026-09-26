# BUG-05 — FLOATING_POINT_AMOUNT_PARSE

Origin: deliberately seeded component mutation, not an accidental production finding. Required-catalogue relationship: D12; scope UNIT_COMPONENT_ONLY, counts_toward_G07=false. Status: component detection verified and original source restored. Severity: high potential integrity risk; priority P1. Risk: R09. This severity is a prioritization judgment, not an observed financial incident.

## Environment and setup
Source commit `a74d930987639f3bcfaf03038947537412599fda`; clean tree at experiment start: `True`. Run `D12-1ee08cc2-c9da-4df0-bd3f-7cba0f75be4c`. Java 21.0.11 / Node 22.16.0 and TypeScript 5.8.3 as applicable. The source file is `frontend/src/money.ts`. The exact [original source](../../evidence/unit-probes/D12-1ee08cc2-c9da-4df0-bd3f-7cba0f75be4c/source-before.txt), [mutant](../../evidence/unit-probes/D12-1ee08cc2-c9da-4df0-bd3f-7cba0f75be4c/source-mutant.txt) and [verdict/provenance](../../evidence/unit-probes/D12-1ee08cc2-c9da-4df0-bd3f-7cba0f75be4c/verdict.json) are preserved.

## Reproduction and controlled difference
Execute `./scripts/lab unit-probes D12` on the recorded baseline. The runner first requires `TSMONEY-CAD-29` to pass; replaces one unique declared source span; compiles/runs the same test with the same input; restores the exact original bytes; reruns that detecting test. The variant is source-level, not a default-off runtime toggle. Float/truncate conversion changes CAD 0.29 into 28 minor units.

## Expected and actual
Expected: the original implementation's detecting assertion passes. Actual mutated behavior: The actual frontend money parser returns 28 for CAD 0.29. One assertion failed, with zero discovery/setup errors or skips. See [baseline XML](../../evidence/unit-probes/D12-1ee08cc2-c9da-4df0-bd3f-7cba0f75be4c/baseline.xml), [mutant XML](../../evidence/unit-probes/D12-1ee08cc2-c9da-4df0-bd3f-7cba0f75be4c/mutant.xml) and [restored XML](../../evidence/unit-probes/D12-1ee08cc2-c9da-4df0-bd3f-7cba0f75be4c/restoration.xml). Full logs are adjacent to those reports. The runner's measured verdict was `DETECTED`.

## Root cause, correction and regression
Use exact string/BigInt decimal conversion, never float/truncate. The mutation was removed and the restored source SHA-256 `ae7d4efd624a04e113009a29aed063c664a730efa0fcb003c24a2ab0549b0773` equals the original digest. Restoration passed the detecting assertion; final full unit results are separate evidence. No browser, API or journal was involved.

## Scope limits
This report cannot establish real database, HTTP, broker, browser, restart, multi-process or financial-account effects. The mandatory full-boundary Dxx experiment remains open even though this component-level regression detector works.
