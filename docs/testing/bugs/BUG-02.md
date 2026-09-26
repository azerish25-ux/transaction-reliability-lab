# BUG-02 — IDEMPOTENCY_PAYLOAD_MISMATCH

Origin: deliberately seeded component mutation, not an accidental production finding. Required-catalogue relationship: D02; scope UNIT_COMPONENT_ONLY, counts_toward_G07=false. Status: component detection verified and original source restored. Severity: high potential integrity risk; priority P1. Risk: R01. This severity is a prioritization judgment, not an observed financial incident.

## Environment and setup
Source commit `a74d930987639f3bcfaf03038947537412599fda`; clean tree at experiment start: `True`. Run `D02-02565596-88e8-41e3-a1b6-706f3dfba345`. Java 21.0.11 / Node 22.16.0 and TypeScript 5.8.3 as applicable. The source file is `backend/src/main/java/lab/ledgerguard/core/Idempotency.java`. The exact [original source](../../evidence/unit-probes/D02-02565596-88e8-41e3-a1b6-706f3dfba345/source-before.txt), [mutant](../../evidence/unit-probes/D02-02565596-88e8-41e3-a1b6-706f3dfba345/source-mutant.txt) and [verdict/provenance](../../evidence/unit-probes/D02-02565596-88e8-41e3-a1b6-706f3dfba345/verdict.json) are preserved.

## Reproduction and controlled difference
Execute `./scripts/lab unit-probes D02` on the recorded baseline. The runner first requires `IDEMPOTENCY-intent-change` to pass; replaces one unique declared source span; compiles/runs the same test with the same input; restores the exact original bytes; reruns that detecting test. The variant is source-level, not a default-off runtime toggle. Fingerprint ignores economically meaningful intent values.

## Expected and actual
Expected: the original implementation's detecting assertion passes. Actual mutated behavior: Source fingerprints differing only in amount collapse. One assertion failed, with zero discovery/setup errors or skips. See [baseline XML](../../evidence/unit-probes/D02-02565596-88e8-41e3-a1b6-706f3dfba345/baseline.xml), [mutant XML](../../evidence/unit-probes/D02-02565596-88e8-41e3-a1b6-706f3dfba345/mutant.xml) and [restored XML](../../evidence/unit-probes/D02-02565596-88e8-41e3-a1b6-706f3dfba345/restoration.xml). Full logs are adjacent to those reports. The runner's measured verdict was `DETECTED`.

## Root cause, correction and regression
Do not ignore any economically meaningful intent field when fingerprinting. The mutation was removed and the restored source SHA-256 `596a093ad30d70a2a0b9460e045608e4aba4d295e298fd79117b287017008369` equals the original digest. Restoration passed the detecting assertion; final full unit results are separate evidence. This Java fingerprint helper is not used as the SQL envelope hash; no database idempotency failure is claimed.

## Scope limits
This report cannot establish real database, HTTP, broker, browser, restart, multi-process or financial-account effects. The mandatory full-boundary Dxx experiment remains open even though this component-level regression detector works.
