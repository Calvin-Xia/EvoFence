# l4_asset_registry execution evidence

```text
lane: l4-assets
branch: refactor/hk-l4-assets
baseline: 6728aae860d4434f8acde554d059a1d344a8bf60
runtime: Node v24.12.0
cp1: passed — immutable revisions, six local categories, provenance/content/compatibility digest pins,
             explicit state observations, exact revision dependencies, append-only history
cp2: passed — host/model/repository/task/scope checks, complete evaluation binding and guardrails,
             validated != activated, qualified retrieval separated from scoped application
cp3: passed — transitive revocation/expiry (including evaluation evidence expiry), actual project-only
             exclusive writes and read-only Skill fixtures, five real negative controls
门禁: build=0, typecheck=0, src:policy=0, dep:check=0;
      test run 1 = exit 0 / 29 tests / 29 pass / 0 fail;
      test run 2 = exit 0 / 29 tests / 29 pass / 0 fail;
      static-audit = exit 0 / 85 modules / 349 edges / 0 violations
未证明项: production journal/CAS integration and durability; production permission-root/lease/safe-idle
          enforcement; real host activation; real user Skills sampling; controlled capability benefit;
          Node 22.13 runtime execution; same-user filesystem race/OS sandbox guarantees
阻塞: 无；core contract unchanged; no commit/install/graph operations
```

## Checkpoint evidence

- **cp1:** [registry behavior tests](../../../test/l4-assets-registry.test.js) retain old revisions after
  replacement and retain staged/validated/promoted/active history after revocation. Modified content,
  source traces, creation time or compatibility pins fail digest checks. Missing material, non-train
  sources, unattributed humans, private content and missing artifact bytes fail typed.
- **cp2:** the same file independently changes host id/version/manifest, model reasoning payload,
  repository/base, task and granted scope. All queries reject mismatches and return byte-identical
  results on repeated inputs. Receipts missing usage, dependencies, host/model/data/evidence or any
  mandatory judgement are refused. A positive statistic cannot filter failing guardrails. Candidate,
  promotion and activation observations cannot substitute for one another.
- **cp3:** root -> child -> leaf activation is revoked at the root; every dependent becomes unusable
  and invalid, while all prior revisions/events remain byte-identical. Expiry is checked at the exact
  supplied boundary and includes the qualification's evidence. [writer tests](../../../test/l4-assets-writer.test.js)
  perform actual temporary-filesystem writes and compare synthetic user Skill bytes. Traversal,
  absolute paths, sibling-prefix escapes, junction aliases, read-only Skill staging and existing
  hardlinks are refused. Missing parents do not trigger directory creation/fallback.

## Qualification example

[EXAMPLE.json](EXAMPLE.json) is extracted from the successful test output, not handwritten:
`fixture-host@1.0.0`, `fixture/model`, `fixture-repo`, `fixture-task`, `host-session`.

| Observation / context | state | eligible (retrieval) | usable (application) |
|---|---|---|---|
| validated | validated | false | false |
| promoted | promoted | true | false |
| confirmed scoped activation | active | true | true |
| another host session | promoted | true | false |
| host version 9.0 | promoted | false | false |

The host mismatch is `invalid / EFK_ASSET_SCOPE_DENIED`; validated alone has no promoted execution
qualification. No query exposes private evaluation references or reads its ArtifactStore.

## Real negative controls

[negative-controls.test.js](../../../test/l4-assets-negative-controls.test.js) transforms actual built
module source inside an isolated child loader. Exact match counts are checked before replacement.
The parent requires an assertion failure from the named behavioral test (not a loader/import error),
then reruns that test without the loader and verifies the on-disk dist hash is unchanged.

| Control | Implementation mutation | Named behavioral test | green / red / restored |
|---|---|---|---|
| DoD① compatibility-bypass | `compatibility.compatible` returns true before pin/scope checks | DoD1 compatibility rejects host/model/repository/task/scope drift deterministically | exit 0, 1 pass / exit 1, 1 fail / exit 0, 1 pass |
| DoD② validated-autoactivation | `qualification.query` considers validated active | DoD2 validated never automatically activates; explicit promotion and scoped receipt are required | 0, 1 pass / 1, 1 fail / 0, 1 pass |
| DoD② revocation-no-propagation | remove dependency walks in invalidation and qualification | DoD2 revocation propagates transitively and preserves every revision and prior event | 0, 1 pass / 1, 1 fail / 0, 1 pass |
| DoD② outside-write | remove physical staging/Skill containment check | DoD2 out-of-project writes reject traversal, absolute paths and sibling prefix tricks | 0, 1 pass / 1, 1 fail / 0, 1 pass |
| DoD② history-erasure | appendEvent keeps only the new observation | DoD2 history survives revocation and revision replacement without erasing earlier observations | 0, 1 pass / 1, 1 fail / 0, 1 pass |

Both complete test logs contain the exact replacement text, target test, child counts and raw red
TAP assertion evidence. Each run has **24 behavioral tests + 5 mutation controls = 29**. Counts,
passing titles and mutation results agree across the two runs; elapsed times/PIDs/temp names vary.

## Gate artifacts and source preservation

- [results.json](evidence/results.json): commands, exit codes, counters, repeatability, mutation details,
  audit summary and SHA256 hashes for every lane TypeScript/test file.
- [test run 1](evidence/test-run-1.stdout.txt), [test run 2](evidence/test-run-2.stdout.txt): complete
  parent results and child red outputs; matching stderr files are empty.
- [static audit](evidence/static-audit.stdout.txt): complete audit with `violations: []`.
- Build/typecheck/src-policy/dep-check stdout/stderr are retained alongside those files.
- Source policy: 216 TS modules, zero source JS, repository largest 350 lines. Lane largest TS file
  163 lines; largest lane test 278 lines. Dependency gate: 216 modules / 811 edges / 0 cycles.
- `git diff --quiet HEAD` exits 0: all pre-existing tracked files, including core, are unchanged.
  Every untracked path is under `src/learning/assets/**` or `test/l4-assets-*.test.js`.

## Evidence limits

The injected artifact backend is the upstream memory implementation with real SHA256 identity;
it does not prove disk durability. Evaluation, issuer registration, authorization, host receipts
and snapshots are explicit synthetic fixtures. No paid model calls, real Skill directory reads,
real host activation or capability-benefit trial occurred. The optional filesystem writer is
tested on the actual local filesystem, with same-user semantics. Registry plans require the
owner's command/journal commit; this lane does not install another persistent truth or modify
the frozen core to wire those commands. Those integration and benefit claims remain with their
owning lanes.
