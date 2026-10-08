# SP bridge: explicit records, round trip and execution evidence

The optional bridge entry is `dist/bridges/super-plumber/index.js`. It is outside the core closure and is not registered in package exports. Delivery graphs describe software delivery; runtime graphs describe execution under a new task contract. This bridge returns inert `historical-delivery` data with `executable:false` and cannot claim or dispatch imported pending nodes.

Input is a caller-assembled `evofence.sp-snapshot/1` envelope containing `graph`, inline `nodes` and inline `edges`. `importRecords(graph,nodes,edges,bindings)` accepts those explicit native records without following manifest references. `exportRecords` returns the same native record shapes; `exportData` returns the versioned snapshot. `importFile` reads exactly the caller's absolute snapshot path; `exportFile` exclusively creates a new output. Scope roots, parent ignore rules, `.graph` paths, symlink/junction components, containment and existing output aliases are checked. Negated ignore rules do not authorize historical graph access. Complex ignore character classes/escaping are refused; these require a clean snapshot scope. File APIs are not an OS sandbox and do not promise protection against malicious filesystem races or crash durability.

RuntimeBindings supplies the complete new graph configuration and exactly one NodeSpec per task, including resources, limits, context and termination. No authority, budget, TaskContract, artifact qualification or DecisionRecord is synthesized from SP fields. Text contracts and execution_report artifact paths survive as annotations; their files and imported shell/check strings are never read or executed.

`iterates` stays documentary. `fallback` maps only to a fallback edge after explicit caller-supplied predicate and attempt bounds, with a loss entry; it does not impose ordering or retries. `review` stays an annotation and does not affect frontier. Unsupported lifecycle states, edges, extra fields and unmappable runtime edits fail with existing typed EFK errors.

Run after `npm run build` from the lane root. The following entire block is executed verbatim by `test/l5-sp-bridge-roundtrip.test.js`; all file fixtures are under `os.tmpdir()`.

```javascript
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSPBridge, difference, mappingReport } from './dist/bridges/super-plumber/index.js';
// Audit G07/G20: the factory takes no ports any more. The boundary is structural — arity plus the
// fail-closed stubs asserted below — not a counter that a removed parameter can no longer reach.
const bridge = createSPBridge();
assert.equal(createSPBridge.length, 0, 'the factory must not take a ports parameter');
const value = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
const native = {
  graph: { id: 'delivery-example', version: '1.0', label: 'Report',
    entry: { description: 'Prepare a report', defined_by: 'human', level: 0 },
    exit: { description: 'Deliver a report', acceptance_criteria: ['report retained'], defined_by: 'human', level: 1 },
    nodes: [{ file: 'nodes/write.yaml' }, { file: 'nodes/read.yaml' }], edges: [{ file: 'edges/e1.yaml' }] },
  nodes: ['write', 'read'].map(id => ({ id, type: 'task', label: id, level: 1, status: 'pending',
    attempts: 0, max_attempts: 2, created_at: '2026-10-03', updated_at: '2026-10-03' })),
  edges: [{ id: 'e1', source: 'write', target: 'read', type: 'depends_on', reason: 'consume report after writer',
    contract: { produces: 'report', consumed_by: [{ artifact: 'report', used_as: 'input' }], validation: { required: true, method: 'auto' } } }],
};
const bindings = {
  graph: { protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' }, graphId: native.graph.id, revision: 0,
    taskContractRef: { taskId: 'new-task', version: 1, digest: 'sha256:' + 'a'.repeat(64) }, requiredJoins: [],
    resourcePolicy: [], graphLimits: { maxNodes: 4, maxConcurrentAgents: 1, maxDepth: 2, maxAttempts: 2 }, abandonedBranches: [] },
  nodes: native.nodes.map(({ id }) => ({ nodeId: id, kind: 'deterministic', inputRefs: [], outputSchemas: [], loop: null, subgraph: null,
    contextPlan: { inputRefs: [], maxTokens: 1024, preserveHostResources: true, isolation: 'current' }, toolRequirements: [],
    modelRequirements: { providerModel: null, reasoningRequested: null, reasoningGuarantee: 'payload-only', payloadRef: null },
    resources: { exclusive: [], shared: [] }, termination: { maxAttempts: 2, maxActiveWallMs: 1000,
      cancelMode: 'stop-and-confirm', unknownPolicy: 'reconcile', excludeHumanWait: true }, terminal: id === 'read', requiredBranches: [] })),
  fallbacks: [],
};
const root = mkdtempSync(path.join(tmpdir(), 'efk-sp-example-'));
try {
  const source = path.join(root, 'snapshot.json'), output = path.join(root, 'export.yaml');
  const initial = value(bridge.importRecords(native.graph, native.nodes, native.edges, bindings));
  writeFileSync(source, JSON.stringify(value(bridge.exportData(initial))));
  const before = readFileSync(source), imported = value(bridge.importFile(source, { root }, bindings));
  const first = value(bridge.exportData(imported));
  value(bridge.exportFile(imported, output, { root }));
  const second = value(bridge.exportData(value(bridge.importFile(output, { root }, bindings))));
  const diff = difference(first, second);
  assert.deepEqual(diff, []); assert.deepEqual(value(bridge.exportRecords(imported)), native);
  assert.deepEqual(readFileSync(source), before);
  for (const action of ['claim', 'execute', 'dispatchEffect']) assert.equal(bridge[action](imported).error.code, 'EFK_LEGACY_NOT_EXECUTABLE');
  console.log(JSON.stringify({ classification: imported.classification, executable: imported.executable,
    nodes: imported.runtimeGraph.nodes.length, edges: imported.runtimeGraph.typedEdges.map(edge => edge.type),
    difference: diff, losses: imported.losses, portsParameter: createSPBridge.length, mappings: mappingReport().length }));
} finally { rmSync(root, { recursive: true, force: true }); }
```

Regenerate the companion product report from its single source function:

```powershell
node --input-type=module -e 'import {writeFileSync} from "node:fs"; import {renderLossReport} from "./dist/bridges/super-plumber/index.js"; writeFileSync("docs/evofence-harness-kernel/L5-SP-BRIDGE-LOSS-REPORT.md", renderLossReport());'
node --test test/l5-sp-bridge-*.test.js
```

Both reports live on the tracked product documentation surface, outside ignored `execution/**`. Document tests normalize CRLF/CR to LF before comparisons or fenced-block extraction. The patch is intentionally uncommitted, so new files await the orchestrator's normal integration/staging.

Evidence level: native-fixture. The user-specified local Super Plumber clone was inspected read-only at 1.0.0 / acdc506932d8a6d0d2a1c1ba4bb1ea63090f8844. Its `src/core/types.ts`, `schema.ts`, `review.ts`, `docs-export.ts` and `src/cli/export-mermaid.ts` confirm the record shapes and boundaries. `design_approved` is an SP journal event; GraphSchema uses `review`. The optional boolean snapshot annotation `graph.design_approved`, node review and reason are bridge extensions, not native SP schema fields. Native unknown fields are tolerated by SP but rejected by this bridge so nothing is silently dropped. Native `graph export` emits Markdown/Mermaid views, not this snapshot envelope; a native graph manifest is not a self-contained export, and manifest files are never discovered or loaded here.

A one-off isolated VM transpiled the local `types.ts` and `schema.ts` with the lane's existing TypeScript parser, denied all SP filesystem APIs, and invoked the actual source validators on the 5-node/4-edge fixture. Result: graph issues=[], every node/edge issues=[], ioCalls=0. Source SHA256: types=ca2fd05f357f7e811c596f70ed36f491ca5cd72875104647eab3f1bb27117f60; schema=70811852272a1d78ee036906c803572193fdc6794fe4124726e929a887e2ac2c. This checks schema compatibility only; actual multi-graph workspaces, exported views and the full SP workflow semantics remain unknown. Tests do not read this clone or any other external repository.

Controlled capability uplift remains inconclusive; l4_capability_trial attempt 1 failed; 747 / 943 USD remain unresolved; the preregistered envelope is 938.470100 USD. adr_0001 / adr_0004 remain proposed; dual-host-runtime-and-uplift has not graduated.

## Verification results

Lane: l5-sp-bridge. Baseline: d71c75c6f5e33dee04d09d64c15a88e875cdffb0. Node: v24.12.0. Main evidence: native-fixture; no provider-live requests.

| Checkpoint | Verdict | Evidence |
| --- | --- | --- |
| cp1 | passed | 129 classified mappings, independent enum/field coverage; iterates/fallback/review differences, typed refusals, mapping-row deletion turns the named assertion red |
| cp2 | passed | Supported records and text contracts round-trip field for field; machine difference=[]; loss report generated by renderLossReport; the factory takes no ports (arity 0) and `claim`/`execute`/`dispatchEffect` all return `EFK_LEGACY_NOT_EXECUTABLE`; the arity and stub boundaries are pinned by the mutation controls in `test/l5-sp-bridge-negative-controls.test.js` (the former `ports` counters are gone: with the parameter removed they could no longer be incremented, so they proved nothing) |
| cp3 | failed (acceptance blocker) | Bridge boundary assertions and three mutation controls pass, but the separately required core-import guard fails at the unchanged baseline in both worktrees (39 I08 diagnostics). This does not authorize edits to core or its guard |

Actual commands: `npm run build`, `npm run typecheck`, `npm run src:policy`, `npm run dep:check`, `node scripts/check-core-imports.mjs`, `node --test test/l5-sp-bridge-*.test.js`, `node --test test/l2-graph-*.test.js`, `npm run check`.

```text
build: exit 0
typecheck: exit 0
src:policy: 303 TypeScript files; largest 350 lines; 0 JavaScript files; exit 0
dep:check: modules 303; edges 1255; cycles 0; acyclic true; exit 0
bridge tests: 27 tests; 27 pass; 0 fail; 0 skipped; exit 0
l2 graph tests: 92 tests; 92 pass; 0 fail; exit 0
full check: 1344 tests; 1344 pass; 0 fail; 0 skipped; exit 0
```

The documentation block's actual JSON output:

```json
{"classification":"historical-delivery","executable":false,"nodes":2,"edges":["dependency"],"difference":[],"losses":[],"portsParameter":0,"mappings":129}
```

Each negative control reruns its exact named assertion using a temporary loader or module copy. Real dist bytes retain their SHA256 digest. No source edits are performed by the mutation tests.

| Mutation | green (exit/pass/fail) | red | restored |
| --- | --- | --- | --- |
| omit depends_on mapping | 0/1/0 | 1/0/1 | 0/1/0 |
| append a journal event on import | 0/1/0 | 1/0/1 | 0/1/0 |
| import child_process / spawnSync in bridge module copy | 0/1/0 | 1/0/1 | 0/1/0 |
| disable early .graph path refusal | 0/1/0 | 1/0/1 | 0/1/0 |
| promote design_approved annotation into grant issue | 0/1/0 | 1/0/1 | 0/1/0 |

A fresh temporary snapshot copied only `git ls-files` plus the 14 new patch files, linked the existing dependencies without installing, and rebuilt from source. No execution documents were present. Both LF and actual CRLF document checkouts ran the complete bridge shard with identical 27/27 counts and exit 0. Temporary copies were removed after verifying their absolute paths were inside os.tmpdir(). This checks checkout portability; it is not a hosted CI result.

Integration read-only checks: typecheck exit 0; src:policy 297 TS / largest 350 / 0 JS / exit 0; dep:check 297 modules / 1235 edges / 0 cycles / acyclic true / exit 0. In both worktrees, `node scripts/check-core-imports.mjs` exits 1 with 39 I08 diagnostics; normalized diagnostic lists are identical. Example: `src/protocol/errors.ts: injected ports have no default backend` (I08/PORT_PARAMETER_DEFAULT). Core scan file counts are lane=90 and integration=91; integration has a pre-existing ignored `src/kernel/scheduler/review-evidence.json`. The six new bridge modules are outside the core roots and none of these diagnostics concern them.

Integration build/check and equal bridge-test counts remain pending: those commands write dist and the new bridge files have not been integrated. No writes to the integration point or local SP clone, no graph CLI/sp.mjs, no reads or writes of graph truth directories, no dependency install, commit, push, merge, tag or publishing occurred. Lane tracked diff remains empty; only the authorized 6 source files, 6 test files and 2 non-ignored product reports are new.

Remaining unknowns: actual native multi-graph workspace/export coverage, cross-user filesystem races, crash durability, provider billing/cancellation, real host activation and capability uplift. None of these unknowns is replaced by fixture success.
