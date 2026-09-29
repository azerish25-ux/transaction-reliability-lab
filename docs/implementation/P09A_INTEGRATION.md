# P09A integration and evidence-integrity checkpoint

Status: **IMPLEMENTED_UNVERIFIED**. Full product: **INCOMPLETE / NO_GO**.

P09A's F01/D02 implementation is delivered on `main`. It is not necessary to
rebuild the laboratory from scratch. A complete milestone pass still requires
both the product and isolated-lab jobs to succeed on the same source SHA.
F02–F08 and the other 23 Dxx experiments are not claimed by this checkpoint.

## Delivered corrections

- Product and lab campaigns now execute on separate concurrent runners against
  the same candidate. `Required P09A gate` still demands success from both;
  skipped, failed and cancelled prerequisites cannot produce a passing gate.
- Teardown reports bounded, sanitized guardian error/state codes. It does not
  print arbitrary exceptions, SQL, credentials, cookies or nested proof data.
  Physical restoration read-back remains mandatory.
- Evidence validation compares the complete verdict-derived JUnit XML, not just
  totals. Wrong assertions, identities, observations or hidden skips fail even
  when totals and self-declared hashes are unchanged.
- Screenshot validation checks complete PNG chunks, CRCs, bounded decompression,
  dimensions and scanlines. This is file-integrity validation, not a claim of
  visual quality or complete accessibility.
- Packaging evidence binds the clean source, actual backend JAR and every
  frontend output file. Image evidence requires immutable Docker image IDs,
  the Compose hash and the same lab instance as the financial experiments.
- Missing, oversized, escaped and symlinked evidence is rejected. Two accidentally
  tracked generated Python caches were removed.
- The guardian accepts only the two valid wildcard spellings for its fixed
  Toxiproxy listener, preserving the fixed proxy name, upstream and port.
- Only the HTTP controller joins an additional console bridge so Docker can
  publish its explicitly loopback-bound port. Financial targets remain internal.

## Observed failure 1: guardian target comparison

[Run 36558375806](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36558375806),
source `c9073f7ab54be89bbbc57c7b1752ae47ad032f05`, passed 116 component tests,
frontend verification, Maven packaging, scoped normal-artifact checks, database
and API startup, and seeding. Guardian startup then failed with
`PROXY_TARGET_CHANGED`. This was not a valid fault experiment or detection.

The guardian expected the literal requested listener `0.0.0.0:15432`.
[Toxiproxy 2.12.0](https://github.com/Shopify/toxiproxy/blob/v2.12.0/proxy.go)
replaces that value with `proxy.listener.Addr().String()` after binding; a dual
stack wildcard may be represented as `[::]:15432`. Commit
`92a2563ee302df843eb47a5a461fbeae0db10440` accepts only those two spellings and
also requires `p09a-postgres`, upstream `postgres:5432`, boolean enabled state
and a toxic list. Identity is checked on root GETs and restoration read-back.
Other hosts, ports, names and upstreams remain rejected. F01's independent
PostgreSQL JDBC-route proof is still required.

[Run 36559328861](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36559328861)
on that corrected source passed **163 component tests**, frontend verification,
Maven packaging and P09A-specific normal-artifact checks. Controller and guardian
became healthy, and physical teardown read-back reported `restored: true`.
This establishes that the guardian startup blocker was corrected in the real
stack, but does not establish a completed F01 or D02 experiment.

## Observed failure 2: internal-only console publication

The same run next failed with `ConnectionRefusedError` when the external CLI
contacted the host console. The server already listened on `0.0.0.0:8090` inside
its container, and its container health check passed. However, it was connected
only to an `internal: true` bridge. Docker does not materialize the requested
host publication for that internal-only endpoint. See the
[upstream issue](https://github.com/moby/moby/issues/36174) and
[port-publishing documentation](https://docs.docker.com/engine/network/port-publishing/).

Commit `b6d291a57eaeb35aae3d48fff0319552dcfae6c7` attaches only the controller to
an additional console bridge and retains explicit `127.0.0.1` host publication.
PostgreSQL, both APIs, Toxiproxy and the guardian remain internal with no host
ports. The controller is dual-homed; this is not a claim that it has no network
egress. Fixed dependency allowlists and ADMIN, CSRF, Host and Origin checks are
unchanged. This candidate is being checked by
[run 36560099620](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36560099620).
An in-progress workflow is not a successful experiment or milestone.

## Verification boundaries

The authoring container executed **47 newly added tests**: 39 evidence-integrity
and diagnostic cases plus eight proxy-contract cases. All passed, as did Python
compilation. Synthetic fixtures in these tests do not count toward F01 activation
or D02 detection. The full real P09A component suite executed 163 passing cases in
run 36559328861, rather than merely being inferred from the two local files.

The full P01–P08F product campaign and `Required P08F gate` passed in
[run 36557255628](https://github.com/azerish25-ux/transaction-reliability-lab/actions/runs/36557255628)
on `cc49976f576bc95038aaad5a66e82e5333b9ef8c`. That run's laboratory failed and
`Required P09A gate` correctly failed. Historical product success must not be
substituted for the corrected candidate's results.

## Release-isolation audit: G12 remains open

The normal-artifact check is explicitly `P09A_SPECIFIC_EXCLUSION_ONLY` and
reports `globalG12Complete: false`. The scoped audit found that
`backend/src/main/java/lab/ledgerguard/messaging/WorkerFaults.java` is a normal
application component containing process-halt implementations controlled by
sandbox/test properties. Normal compilation includes it. Disabling a property
is not packaging exclusion. Also, the inspected backend Dockerfile and Maven
POM do not implement the complete verification-only artifact selection declared
by `compose.verification.yaml`.

This is not a complete inventory or a closed G12 gate. Active legacy hooks must
be separated into explicitly selected verification artifacts while preserving
existing real crash/ambiguous-response regression tests. Normal packaging and
runtime denial must both be proven. Removing those tests is not a valid fix.

## Required next action

```bash
./scripts/lab test p09a-unit
./scripts/lab test p09a
```

Resolve failures from the real same-source campaign, then retain actual F01
route/activation/recovery evidence, D02 baseline/failing-mutant/restored evidence,
real browser and authorization results, controller-death/expiry recovery and
validated artifact provenance. Preserve the failing mutant JUnit when a defect
is validly detected. Only successful product and lab jobs on the exact candidate
permit `VERIFIED_PASS`. After that, continue P09 with F02/D06. P10, P11 and global
G12 closure remain separate open requirements.
