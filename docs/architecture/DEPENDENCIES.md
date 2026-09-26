# Dependency and image decisions

This file records the exact P01 foundation selections. Versions are pinned rather than floating so a reviewer can reproduce the same dependency boundary.

| Component | Selected version/tag | Reason and boundary |
|---|---|---|
| Java | 21 | Mandated baseline and current LTS language/runtime target |
| Apache Maven | 3.9.16 | Current stable Maven 3 line; downloaded through committed wrapper URL and SHA-256 |
| Maven wrapper bootstrap | 3.3.4-compatible only-script layout | No wrapper JAR is committed; bootstrap authenticates the Maven distribution |
| Spring Boot | 3.5.16 | Preserves the required Boot 3.5/JUnit Jupiter 5-compatible line already selected by the repository |
| PostgreSQL | `postgres:17.11-bookworm` | Exact server image used by Compose and existing Testcontainers tests |
| RabbitMQ | `rabbitmq:4.3.5-management-alpine` | Exact broker/management image; business consumers are a later phase |
| Build container | `maven:3.9.16-eclipse-temurin-21-noble` | Exact Maven/JDK build environment |
| Runtime container | `eclipse-temurin:21.0.12.1_1-jre-noble` | Exact Java 21 runtime image; runs as uid/gid 10001 |
| Node.js CI | 22 | Matches the available/current project baseline |
| TypeScript | 5.8.3 | Exact package and committed npm integrity lock |

## Maintenance and verification policy

- Spring dependencies are managed by the pinned Boot parent; changing the Boot patch requires a complete fast-lane rerun and review of its managed JUnit/Testcontainers/Flyway versions.
- Maven distribution integrity is checked before extraction. Container tags are exact release tags rather than `latest`.
- GitHub Actions are pinned to immutable commit SHAs in workflow source.
- The API image installs only `curl` for an actual readiness probe and runs non-root with a read-only root filesystem.
- PostgreSQL migrations use `ledger_owner`; normal JDBC connections use `ledger_runtime`. A readiness check fails when the runtime role is not restricted or the ledger schema is absent.
- No dependency inclusion alone is counted as exercising a required boundary. RabbitMQ, OAuth resource-server, Toxiproxy and other later-phase libraries remain unclaimed until their real behavior is implemented and tested.
