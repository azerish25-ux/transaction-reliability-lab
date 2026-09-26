# Dependency decision record — 2026-09-26

| Component | Selected/observed version | Evidence and status |
|---|---|---|
| Java | 21 baseline; local OpenJDK 21.0.11 | `java -version`; standalone modules compile with `--release 21` |
| Spring Boot parent | 3.5.16 | Official release announcement and 3.5 dependency table verified; Maven resolution NOT performed |
| JUnit Jupiter | 5.12.2 | Managed by that parent; source adapter written; Jupiter engine NOT run |
| Testcontainers | 1.21.4 | Managed by that parent; PostgreSQL suite written; NOT run |
| REST Assured | 5.5.7 | Managed dependency only; no live HTTP suite implemented |
| Flyway | 11.7.2 | Managed dependency; four migrations written; NOT run |
| PostgreSQL test image | postgres:17.11-bookworm | Tag is listed in official docker-library/official-images manifest; registry pull/digest NOT verified |
| Node/npm | 22.16.0 / 10.9.2 | Installed tools; Node client-unit tests actually run |
| TypeScript | 5.8.3 | Installed global compiler; strict compilation actually run |
| React / Vite | Not installed or integrated | Official React 19.2.4 and Vite 7.3.2 releases inspected as candidates only; no package-lock or build claim |

## Compatibility and maintenance risk

Spring's June 25, 2026 announcement states 3.5.16 is the final open-source-supported 3.5 release. It retains the mandated Jupiter 5 stack but is outside OSS maintenance at execution time. No commercial support is assumed. This is a release blocker requiring an explicit compatibility/support decision and fresh vulnerability verification, not a claim of a supported secure production stack.

The Maven parent provides pinned managed coordinates, but an effective POM, resolved dependency tree, SBOM and vulnerability report were NOT generated. The test image has an exact patch/OS tag rather than `latest`, but its immutable registry digest was not retrieved. Actions are not pinned because no workflow was written/published. No frontend lockfile or Maven Wrapper was fabricated.

Primary references consulted:
- https://spring.io/blog/2026/06/25/spring-boot-3-5-16-available-now/
- https://docs.spring.io/spring-boot/3.5/appendix/dependency-versions/coordinates.html
- https://docs.spring.io/spring-boot/3.5/system-requirements.html
- https://raw.githubusercontent.com/docker-library/official-images/master/library/postgres
- https://github.com/react/react/releases/tag/v19.2.4
- https://github.com/vitejs/vite/releases/tag/v7.3.2
- https://www.postgresql.org/docs/current/sql-createfunction.html
- https://www.rabbitmq.com/docs/confirms
- https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/ZonedDateTime.html
- https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html
