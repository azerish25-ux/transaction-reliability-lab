# BUG-08 — FIXED_24H_RECURRENCE

Origin: deliberately seeded component mutation, not an accidental production finding. Required-catalogue relationship: D21; scope UNIT_COMPONENT_ONLY, counts_toward_G07=false. Status: component detection verified and original source restored. Severity: high potential integrity risk; priority P1. Risk: R15. This severity is a prioritization judgment, not an observed financial incident.

## Environment and setup
Source commit `a74d930987639f3bcfaf03038947537412599fda`; clean tree at experiment start: `True`. Run `D21-2a4d2ee6-218c-4a1d-8b00-b4dd04a8c41c`. Java 21.0.11 / Node 22.16.0 and TypeScript 5.8.3 as applicable. The source file is `backend/src/main/java/lab/ledgerguard/core/SchedulePolicy.java`. The exact [original source](../../evidence/unit-probes/D21-2a4d2ee6-218c-4a1d-8b00-b4dd04a8c41c/source-before.txt), [mutant](../../evidence/unit-probes/D21-2a4d2ee6-218c-4a1d-8b00-b4dd04a8c41c/source-mutant.txt) and [verdict/provenance](../../evidence/unit-probes/D21-2a4d2ee6-218c-4a1d-8b00-b4dd04a8c41c/verdict.json) are preserved.

## Reproduction and controlled difference
Execute `./scripts/lab unit-probes D21` on the recorded baseline. The runner first requires `SCHEDULE-daily-spring` to pass; replaces one unique declared source span; compiles/runs the same test with the same input; restores the exact original bytes; reruns that detecting test. The variant is source-level, not a default-off runtime toggle. Add a fixed UTC day instead of preserving the intended Halifax wall-clock time.

## Expected and actual
Expected: the original implementation's detecting assertion passes. Actual mutated behavior: Daily Halifax 09:00 resolves an hour late after the spring DST change. One assertion failed, with zero discovery/setup errors or skips. See [baseline XML](../../evidence/unit-probes/D21-2a4d2ee6-218c-4a1d-8b00-b4dd04a8c41c/baseline.xml), [mutant XML](../../evidence/unit-probes/D21-2a4d2ee6-218c-4a1d-8b00-b4dd04a8c41c/mutant.xml) and [restored XML](../../evidence/unit-probes/D21-2a4d2ee6-218c-4a1d-8b00-b4dd04a8c41c/restoration.xml). Full logs are adjacent to those reports. The runner's measured verdict was `DETECTED`.

## Root cause, correction and regression
Advance intended local calendar time, then resolve against zone rules. The mutation was removed and the restored source SHA-256 `ba503d13d9625f9cc6152fe2d088e1e1dfa9b875293094196b2fa51729792443` equals the original digest. Restoration passed the detecting assertion; final full unit results are separate evidence. No durable scheduler occurrence or worker restart was executed.

## Scope limits
This report cannot establish real database, HTTP, broker, browser, restart, multi-process or financial-account effects. The mandatory full-boundary Dxx experiment remains open even though this component-level regression detector works.
