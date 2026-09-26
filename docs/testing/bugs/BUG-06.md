# BUG-06 — UNCHECKED_MONEY_OVERFLOW

Origin: deliberately seeded component mutation, not an accidental production finding. Required-catalogue relationship: D13; scope UNIT_COMPONENT_ONLY, counts_toward_G07=false. Status: component detection verified and original source restored. Severity: high potential integrity risk; priority P1. Risk: R09. This severity is a prioritization judgment, not an observed financial incident.

## Environment and setup
Source commit `a74d930987639f3bcfaf03038947537412599fda`; clean tree at experiment start: `True`. Run `D13-5d0db6c9-d372-464e-b850-05e1dd5910e5`. Java 21.0.11 / Node 22.16.0 and TypeScript 5.8.3 as applicable. The source file is `backend/src/main/java/lab/ledgerguard/core/WalletBalance.java`. The exact [original source](../../evidence/unit-probes/D13-5d0db6c9-d372-464e-b850-05e1dd5910e5/source-before.txt), [mutant](../../evidence/unit-probes/D13-5d0db6c9-d372-464e-b850-05e1dd5910e5/source-mutant.txt) and [verdict/provenance](../../evidence/unit-probes/D13-5d0db6c9-d372-464e-b850-05e1dd5910e5/verdict.json) are preserved.

## Reproduction and controlled difference
Execute `./scripts/lab unit-probes D13` on the recorded baseline. The runner first requires `WALLET-overflow` to pass; replaces one unique declared source span; compiles/runs the same test with the same input; restores the exact original bytes; reruns that detecting test. The variant is source-level, not a default-off runtime toggle. Unchecked addition wraps; the secondary constructor defense prevents corruption but the controlled overflow error contract regresses.

## Expected and actual
Expected: the original implementation's detecting assertion passes. Actual mutated behavior: Unchecked long addition falls through to the secondary balance invariant error instead of the controlled overflow error. One assertion failed, with zero discovery/setup errors or skips. See [baseline XML](../../evidence/unit-probes/D13-5d0db6c9-d372-464e-b850-05e1dd5910e5/baseline.xml), [mutant XML](../../evidence/unit-probes/D13-5d0db6c9-d372-464e-b850-05e1dd5910e5/mutant.xml) and [restored XML](../../evidence/unit-probes/D13-5d0db6c9-d372-464e-b850-05e1dd5910e5/restoration.xml). Full logs are adjacent to those reports. The runner's measured verdict was `DETECTED`.

## Root cause, correction and regression
Use checked arithmetic with the explicit BALANCE_OVERFLOW mapping. The mutation was removed and the restored source SHA-256 `1bd77de511546334a3a0e1fda1fb310662c6c7d26b55e5e367982b742323ea7f` equals the original digest. Restoration passed the detecting assertion; final full unit results are separate evidence. Secondary constructor validation still prevents a negative wallet; this probe does not demonstrate a corrupted persisted balance.

## Scope limits
This report cannot establish real database, HTTP, broker, browser, restart, multi-process or financial-account effects. The mandatory full-boundary Dxx experiment remains open even though this component-level regression detector works.
