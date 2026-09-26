# Evidence index — partial implementation, NO_GO

Tested code commit: `a74d930987639f3bcfaf03038947537412599fda`. Source tree and environment are in [run.json](component/run.json); input file hashes are in [source-inputs.json](source-inputs.json). The run started from a clean tree. Later evidence/documentation commits are not represented as the tested code SHA.

| Executed check | Actual result | Boundary |
|---|---|---|
| `./scripts/lab test unit`: Java | 120 passed, 0 failed, 0 errors, 0 skipped | Java 21 standalone runner; not Jupiter engine |
| `./scripts/lab test unit`: TypeScript | 44 passed, 0 failed, 0 errors, 0 skipped | Actual production TS utilities/client; injected Fetch/storage, not live HTTP/browser |
| Component source probes | 7 DETECTED; each baseline/restoration passed, mutant assertion failed | UNIT_COMPONENT_ONLY; full-stack Dxx detections = 0 |
| Review regression | Initially 43 pass / 1 fail; after fix 44 pass | Unintentional client 5xx uncertainty bug, not an infrastructure experiment |

[Java results](component/java.xml) · [client results](component/client.xml) · [combined log](component/unit.log) · [probe summary](unit-probes/summary.json) · [eight scoped reports](../testing/bugs/README.md).

The 164 unique component cases are not inflated by counting repeat executions and the 21 baseline/mutant/restoration runs again. The Java arithmetic oracle executes 50,000 deterministic steps; the TypeScript round-trip case checks 10,000 generated values in four currencies. These are component models, not full-system throughput or property-test proof.

## Unexecuted or missing

PostgreSQL/Flyway/JUnit/Testcontainers: source-written but not resolved/compiled/executed. RabbitMQ/Toxiproxy, Spring HTTP/security, Pact, actual browser/axe, ZAP, all F01–F08, all complete D01–D24, migration/restore, reference k6, three CI lanes and video: no executed evidence. The five exploratory charters are prepared, not performed. Eight scoped findings are not the required complete ten-report integrated-product set. No screenshots, scans, benchmark numbers or passing CI badges were invented.

## Provenance and reuse

The preserved red logs are expected negative controls or the actual pre-fix regression. Missing test discovery, setup errors, timeout and failed cleanup are different classifications and cannot count as a detection. Original and mutant source bytes, case ID, command, timestamps, return codes and hashes are retained. Current code must still match the source-input manifest before these results are reused. Evidence-only commits may follow the tested commit; after implementation inputs change, rerun and refresh evidence instead of relabeling old reports.

No live credentials are present. Test signature vectors and synthetic IDs are public deterministic fixtures. There is no demo video/public app URL/CI run URL because those artifacts were not produced.

## Environment and delivery checks

[Environment doctor](environment-doctor.json), [database entry blocker](database-attempt.log), [up blocker](up-attempt.log), [remote re-read](remote-verification.json) and [limited literal-secret scan](literal-secret-scan.json). The infrastructure commands returned exit status 2, not a passing integration result. The limited scan found no configured literal patterns; this does not satisfy security/scanner gates.
