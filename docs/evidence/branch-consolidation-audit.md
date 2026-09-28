# Branch consolidation

All five reviewed branch histories are retained by a six-parent merge into `main`.
The merge and removal of their exact remote refs are published in one atomic transaction.

## Source preservation

Verified application files, migrations, tests, existing CI and P08E evidence remain byte-for-byte unchanged from `e0a1f2a77b84e74e004ee2f093f563da9e1b0816`.
The only retained file changes from this housekeeping operation are this report and its JSON companion; the one-use workflow is retired afterward.
This is a history consolidation, not a replacement of newer verified code with earlier staging candidates.

Distinct branch commits preserved: 31.
Full raw source comparisons remain available at audit commit `1de11237756c0434022c7a54eb23b95fb22d26b5`; this compact report avoids duplicating obsolete source in the current tree.

## Branch resolutions

### p05-async-payments

Tip: `9c3faa8d9c2d54576f4f6cfafb3b3a7e9b764698`.

All 39 changed files already match current main or an exact earlier main blob; retain the newer verified versions.

Compared contents: {"EXACT_CONTENT_IN_MAIN_HISTORY": 18, "IDENTICAL_TO_MAIN": 21}.

### p05-staging

Tip: `a9e1db246e7933566cb133d9b3ac47dee804a3c1`.

Retain transport archive and patch in history only. Its alternate messaging implementation and conflicting V7 migration must not replace the delivered P05-P08E system.

Compared contents: {"REVIEW_DIFFERENCE": 16, "PATH_NOT_IN_MAIN_HISTORY": 16, "EXACT_CONTENT_IN_MAIN_HISTORY": 1}.

### p06-payment-adjustments

Tip: `578650fe2e3ba0d4cefc4a1be92ed40f5018d941`.

Retain transport archive in history only. Keep the subsequently delivered and verified P06 adjustment API, accounting rules, tests and later fixes.

Compared contents: {"REVIEW_DIFFERENCE": 12, "EXACT_CONTENT_IN_MAIN_HISTORY": 1, "IDENTICAL_TO_MAIN": 1, "PATH_NOT_IN_MAIN_HISTORY": 2}.

### p07a-source-export

Tip: `3b36983a9476839d77f681d4cd0fbe1699f82c48`.

Retain the obsolete source-export workflow in history only. Its proposed migration-count relaxation is unnecessary in the delivered topology: the P06 fixture loads only the eight base migrations, while later schemas use separate opt-in db/p07 and db/p07b locations. The current exact count is intentionally preserved.

Compared contents: {}.

### p08c-materialize

Tip: `5a55f738c05a6914652d31672bb23a623ce6dbcd`.

Retain the old materializer and unverified transport archive in history only; its historical expected archive checksum differs. Keep the delivered P08C-P08E UI, scoped auth fixtures and secret-safe evidence rules.

Compared contents: {"REVIEW_DIFFERENCE": 7, "PATH_NOT_IN_MAIN_HISTORY": 2}.

## Verification and safety

Before publication: exact remote-tip checks, unchanged application files, transport-path allowlist, 39 exact P05 source matches, eight base migrations and separate opt-in schema locations, every branch tip as an ancestor of the merge, and a dry-run atomic push.
Publication uses explicit expected-tip leases for deleted refs and a non-rewriting fast-forward update of main. A stale branch fails the entire transaction.
After publication, the workflow checks that the remote has exactly one branch, main, at the merge commit.
The complete application suite is not claimed to have been rerun on this history-only merge; existing P08E verification retains its original source-SHA attribution.

Execution: https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36494805965
