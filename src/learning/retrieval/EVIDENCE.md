# l4-retrieval evidence

Evidence level: unit tests, existing real registry/context entry points, real implementation
mutations in isolated Node child loaders. Evaluation/host receipts are synthetic fixtures.
Worktree branch `refactor/hk-l4-retrieval`, initial HEAD `d2e311d`, initially clean.

## Checkpoints

- cp1 passed: `cp1 ranking is byte-identical across repeats and candidate permutations with
  explicit ties`, exact revision tie-breaking, count/token boundaries, skip-and-continue clipping,
  current task/node binding, staged/validated and host/model/repo/scope refusal cases.
- cp2 passed: candidate uses the existing BoundedContextPacket/ContextPacket/audit; pending,
  reported used and reported ignored feedback carry reasons. `evidence/example.json` records a
  promoted, eligible, not-yet-active asset and the complete candidate plus reported usage.
  Baseline 4088, candidate 4978, delta 890 fixture tokens; content-only count 45, total computational
  count 9111 across 3 tokenizer calls and 2 material reads. The exact packet includes audit overhead.
- cp3 passed: root revocation invalidates child/leaf on the next query; expiry at 30 refuses where
  29 passes. Pollution negatives cover unverified/staged/validated assets, mismatched metadata,
  unknown human provenance, dev/held-out/final/not-evaluation sourceTrace, private source, held-out/
  final content, fake instruction purposes, missing/substituted/duplicate hydration, undeclared
  input, wrong schema expectation and missing current content/source bytes. A base plan cannot
  preload unqualified asset material. Valid assets remain usable as candidates alongside refusals.

Unknown-provenance and split-contamination tests explicitly exercise the registry's staging
refusal followed by retrieval of the refused candidate. They do not fabricate a supposedly
trusted promoted registry entry containing impossible provenance. Provenance and qualifications
are owned by the passed upstream modules.

`evidence/empty-example.json`: mode base, candidate null, input token delta 0; the original
baseline packet is retained. Empty retrieval still records 1 tokenizer call and 4088 computational
fixture tokens. Wall and USD are unknown (null), not reported as free execution.

## Required gates

| Command | Exit | Result |
|---|---:|---|
| `npm run build` | 0 | current TypeScript output |
| `npm run typecheck` | 0 | no errors |
| `npm run src:policy` | 0 | 236 TS files; 0 JS; global largest 350 lines |
| `npm run dep:check` | 0 | 236 modules / 917 edges / 0 cycles / acyclic true |
| `node --test --test-reporter=tap test/l4-retrieval-*.test.js` run 1 | 0 | 32 tests / 32 pass / 0 fail / 0 skipped / 0 cancelled |
| same command run 2 | 0 | 32 tests / 32 pass / 0 fail / 0 skipped / 0 cancelled |
| `node verification/kernel/static-audit.mjs` | 0 | passed; **0 violations**, 88 core modules / 358 edges |

Both test runs have identical totals and mutation results. Node's totals include the helper-only
fixtures file as one successful file-discovery case; the other 31 cases have behavioral assertions,
including four actual implementation mutation controls. Source/test files are all under 350 lines;
the retrieval implementation's largest TS file is 120 lines. No broader npm test suite is claimed.

Raw stdout/stderr for every gate and both test runs are in `evidence/`; numerical results are
in `evidence/results.json`. The first evidence-collector attempt failed to JSON-parse TAP's
escaped example diagnostic after a successful 32/32 run. Its complete test output was preserved;
the example was then recorded directly from the same fixture entry. This was a recording issue,
not a test failure. The second run and static audit completed successfully.

## Real negative controls

`test/l4-retrieval-negative-controls.test.js` uses an isolated ESM loader to mutate the actual
`dist/learning/retrieval/retrieve.js` in child memory, without modifying source/dist/core on disk.
Each control runs a specific behavior test green, red under the mutant, then green without it.
Red requires an AssertionError, rather than accepting loader or process failures. Dist hashes
must remain unchanged. Exact mutation sites and red TAP evidence are in the two raw test logs
and `evidence/negative-controls.json`.

| Control | DoD | Mutation | Green → red → restored |
|---|---|---|---|
| qualification-bypass | ① | remove eligible filter, admitting staged/validated/scope-mismatched assets | exit 0 / pass 1 → exit 1 / fail 1 → exit 0 / pass 1 |
| revocation-bypass | ① | same filter bypass lets revoked dependency closure enter context | 0/1 → 1/1 → 0/1 |
| empty-injection | ② | return candidate mode on empty set | 0/1 → 1/1 → 0/1 |
| unaccounted-overhead | ② | report zero tokenizer work on empty retrieval | 0/1 → 1/1 → 0/1 |

Each of the four cycles passed twice. The fixture candidate and all numbers above are local
proofs, not provider token accuracy, live activation, wall/invoice measurements or capability
improvement. `l4_capability_trial` owns controlled benefit and adopted-path evidence.

## Scope and reproduction

Changes are exclusively `src/learning/retrieval/**` and `test/l4-retrieval-*.test.js`. No commit,
install, core/upstream modification or `.graph` operation occurred. No contract drift was needed.
The output remains uncommitted for orchestrator review/integration.

```powershell
npm run build
npm run typecheck
npm run src:policy
npm run dep:check
node --test --test-reporter=tap test/l4-retrieval-*.test.js
node --test --test-reporter=tap test/l4-retrieval-*.test.js
node verification/kernel/static-audit.mjs
git status --short
```
