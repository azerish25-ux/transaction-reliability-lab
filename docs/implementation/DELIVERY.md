# Delivery record — verified P01/P02 foundation

Repository: `azerish25-ux/transaction-reliability-lab`  
Branch: `main`  
Verified clean source: `cb9930168ffdc793a5759f754a39685369620422`  
Source tree: `b958f1c96f8540f5bd766ffcffa7339cae2830b1`

## GitHub delivery

The owner-linked GitHub Git-data route created ordinary source/workflow commits and advanced `main` only through non-forced fast-forward ref updates. Remote branch identity and ancestry were re-read after publication.

Milestone commits:

1. `e91161e2f77b39c5dd59a878102db1cac40fecea` — executable Spring/Compose/CI foundation.
2. `e614cdde88336e535f4d6c7c8e5052a0b62659a6` — additive Flyway V5 repair for the SQL ambiguity detected by execution.
3. `cb9930168ffdc793a5759f754a39685369620422` — bounded readiness retry and retained hidden service evidence.

## Verified workflow

- Workflow: `LedgerGuard fast verification`
- Run: [36267641798](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36267641798)
- Event: `push`
- Exact head SHA: `cb9930168ffdc793a5759f754a39685369620422`
- Verification job `108475257072`: SUCCESS
- Required aggregate gate `108475591888`: SUCCESS
- Started: 2026-09-26 19:54:07 UTC
- Completed: 2026-09-26 19:56:20 UTC

Executed results:

- 120/120 standalone Java cases passed.
- 44/44 TypeScript cases passed.
- 120/120 JUnit Jupiter cases passed; these adapt the same Java case bodies and are not additional unique tests.
- 11/11 PostgreSQL/Testcontainers financial integration cases passed.
- Five Flyway migrations validated/applied.
- Compose configuration, clean image build, three-service health, restricted runtime role, deterministic seed, two zero-discrepancy reconciliations and teardown passed.
- The configured literal secret scan checked 180 tracked text files with zero findings.

## Artifact

- ID: `10913469364`
- Name: `ledgerguard-fast-evidence-cb9930168ffdc793a5759f754a39685369620422`
- Files: 39
- Size: 73,969 bytes
- Digest: `sha256:61a1903b6904e748e38cd8f2a50b3240a252ef975b9228f7512f312c93275b78`
- Expiry: 2026-10-10 19:56:09 UTC

The durable summary is committed under `docs/evidence/`; the expiring artifact is supplementary. This evidence/documentation update is intentionally separate from the tested source SHA, avoiding an impossible self-referential evidence claim.

## Delivery boundaries

- Repository source and one permanent fast CI lane: delivered and verified.
- Versioned release: none; mandatory release gates are incomplete.
- Public full-stack application: none.
- Nightly/release lanes, video and complete evidence package: not delivered yet.
- No release tag is created for this incomplete milestone.
