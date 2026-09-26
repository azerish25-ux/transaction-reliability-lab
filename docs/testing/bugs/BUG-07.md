# BUG-07 — WEBHOOK_SIGNATURE_MISMATCH

Origin: deliberately seeded component mutation, not an accidental production finding. Required-catalogue relationship: D19; scope UNIT_COMPONENT_ONLY, counts_toward_G07=false. Status: component detection verified and original source restored. Severity: high potential integrity risk; priority P1. Risk: R13. This severity is a prioritization judgment, not an observed financial incident.

## Environment and setup
Source commit `a74d930987639f3bcfaf03038947537412599fda`; clean tree at experiment start: `True`. Run `D19-4ee110fa-be27-4598-a974-616ea3d9c469`. Java 21.0.11 / Node 22.16.0 and TypeScript 5.8.3 as applicable. The source file is `backend/src/main/java/lab/ledgerguard/core/WebhookSignature.java`. The exact [original source](../../evidence/unit-probes/D19-4ee110fa-be27-4598-a974-616ea3d9c469/source-before.txt), [mutant](../../evidence/unit-probes/D19-4ee110fa-be27-4598-a974-616ea3d9c469/source-mutant.txt) and [verdict/provenance](../../evidence/unit-probes/D19-4ee110fa-be27-4598-a974-616ea3d9c469/verdict.json) are preserved.

## Reproduction and controlled difference
Execute `./scripts/lab unit-probes D19` on the recorded baseline. The runner first requires `WEBHOOK-independent-vector` to pass; replaces one unique declared source span; compiles/runs the same test with the same input; restores the exact original bytes; reruns that detecting test. The variant is source-level, not a default-off runtime toggle. Omit the event identity from the signed bytes; receiver interoperability and replay binding break.

## Expected and actual
Expected: the original implementation's detecting assertion passes. Actual mutated behavior: The signature differs from the independently generated known vector because event identity is omitted. One assertion failed, with zero discovery/setup errors or skips. See [baseline XML](../../evidence/unit-probes/D19-4ee110fa-be27-4598-a974-616ea3d9c469/baseline.xml), [mutant XML](../../evidence/unit-probes/D19-4ee110fa-be27-4598-a974-616ea3d9c469/mutant.xml) and [restored XML](../../evidence/unit-probes/D19-4ee110fa-be27-4598-a974-616ea3d9c469/restoration.xml). Full logs are adjacent to those reports. The runner's measured verdict was `DETECTED`.

## Root cause, correction and regression
Sign the prescribed timestamp, event identity and exact raw body bytes. The mutation was removed and the restored source SHA-256 `14dd6f17c1dab167dfce1d43a157173b533a71c1d0257c3b14c6d01a34dce960` equals the original digest. Restoration passed the detecting assertion; final full unit results are separate evidence. No HTTP sender/receiver interoperability or replay storage was executed.

## Scope limits
This report cannot establish real database, HTTP, broker, browser, restart, multi-process or financial-account effects. The mandatory full-boundary Dxx experiment remains open even though this component-level regression detector works.
