import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { config, root, evidence, runtimeDir, hash, digest, value, record, writeJson } from './io.mjs';
import { setup, ctx, sdk, agentOptions, handles, createParent, turn, cleanup } from './native.mjs';
import { taskState, resolveSource } from './task-tools.mjs';
import { budget, drain, summarize, reconcileNativeReceipts } from './meter.mjs';
import { grant, dynamicGraph, createKernel } from './graph.mjs';
import { makeHost } from './host.mjs';
import { compileGraph } from '../../dist/kernel/graph/index.js';
import { canonical } from '../../dist/storage/index.js';

const task = 'Implement ledger show [run-id] [--limit <N>] [--json]. N is a decimal positive safe integer. 0, negative, fraction, exponent, junk, infinity, unsafe integer and missing values must explicitly fail exit 1 with empty stdout and JSON stderr error when --json. Missing --limit preserves all existing events. Filter run-id BEFORE limit, then take first N chronological events. Accept --limit=N. catalog.ts is 349 lines, must remain <=350; preserve unrelated code. Scratch only; no core changes.';
let nonce = `CONTINUITY_${randomUUID()}`;
let pauseResolve, parent, kernel;
const pause = { started: () => pauseResolve() };
const prompts = {
  integrate: 'Read both full worker bundles with proposal_read. They deliberately propose different content for docs/cli-limit-scenario.md. Resolve this real shared-file conflict with resolve_shared_conflict, merge the implementation semantics and test examples, and explain your resolution rationale. Then integrate_proposals once as the only scratch writer. Do not overwrite either proposal silently.',
  repair: 'Read src/lib/cli/handlers/ledger.ts and test/ledger-limit-scenario.test.js. The independent verifier has run real red tests after an injected empty-output fault. Diagnose failures, then repair_restore the handler to exact original bytes. The test author also wrote an actual malformed assert.equal: its expected argument is `\'object\' && parsed !== null` (boolean), so checking typeof parsed wrongly compares string with boolean. Fix that actual assertion with repair_test: use assert.equal(typeof parsed, \'object\') and a separate assert.notEqual(parsed, null), preserve nested JSON error code/message checks and ALL behavioral/invalid cases. Remove only the redundant stdout.trim equality after the strict stdout===empty assertion. Explain why this repairs test syntax and strengthens object checking, without weakening --limit checks. End after these two repairs; independent verifier owns final runs.'
};
function childPrompt(stage) {
  if (stage === 'logic') return `${task}\n${taskState.plan.logic}\nRead catalog.ts, handlers/context.ts and handlers/ledger.ts. Submit full replacements for these THREE files via propose_file. Put a positiveIntegerOption helper in context.ts, validate ledger show before opening ledger, and declare limit on an existing catalog line. Use only necessary decimal/positive/Number.isSafeInteger validation, no redundant BigInt or length checks. Also propose docs/cli-limit-scenario.md explaining CLI syntax and semantics. This doc intentionally conflicts with tests worker; parent will merge. Never write test file. Tools allowed: source_read, propose_file. End after four proposals.`;
  if (stage === 'tests') return `${task}\n${taskState.plan.tests}\nRead test/ledger.test.js and relevant handler/context. Submit test/ledger-limit-scenario.test.js and docs/cli-limit-scenario.md via propose_file. Test real CLI subprocesses using absolute scratch dist/cli.js and a temp git repo with .evofence; use Ledger.append to seed >=4 chronological mixed-run events. Cover default exact event identities, valid 2 and =2, boundary 1 and above count, invalid 0 -1 1.5 1e2 NaN Infinity abc empty and unsafe integer exit1/stdout empty/JSON error, missing value, run-id filtering BEFORE limit. Do not assume error code. Your doc should explain test examples so it differs from the logic worker's implementation doc; parent explicitly resolves. Do not import implementation helper as oracle or modify src. Tools: source_read, propose_file. End after two proposals.`;
  return `${task}\nYou are an independent native verifier session, no authorship. Read current handler and focused tests, then run_checks final=${stage === 'finish' ? 'true' : 'false'} exactly once. ${stage === 'verify' ? 'A fault is injected; report exact failing test names, red is expected.' : 'Two focused rounds and all four literal npm gates must pass.'} Do not propose or modify source.`;
}
function complete(stage) {
  if (stage === 'logic') return taskState.proposals.logic?.length === 4;
  if (stage === 'tests') return taskState.proposals.tests?.length === 2;
  if (stage === 'integrate') return taskState.integrated && taskState.conflict !== null;
  if (stage === 'verify') return taskState.checks.some(r => r.label === 'fresh-verify:focused:1' && r.code === 1);
  if (stage === 'repair') return hash(fs.readFileSync(resolveSource(taskState.mutation.path))) === taskState.mutation.originalHash;
  if (stage === 'finish') return taskState.checks.filter(r => r.label.startsWith('finish:')).length === 6 && taskState.checks.filter(r => r.label.startsWith('finish:')).every(r => r.code === 0);
  throw new Error(`Undeclared stage ${stage}`);
}
const git = (args, cwd = config.scratch) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
};
async function main() {
  assert.equal(hash(fs.readFileSync(config.contract)), config.contractSha256);
  assert.equal(git(['rev-parse', 'HEAD']), config.baseline);
  fs.mkdirSync(runtimeDir, { recursive: true });
  writeJson(path.join(evidence, 'egress-authorization.json'), { authorized: true, source: 'Direct user approval in current lane conversation',
    destination: 'https://api.deepseek.com', data: 'Bounded CLI/ledger/test source and task prompts', credentialInPrompt: false });
  await setup(pause);
  if (process.argv.includes('--preflight-only')) { record('native-preflight', { status: 'passed', paidRequests: budget.requests.length }); return; }
  const resumeWorkers = process.argv.includes('--resume-after-workers');
  if (resumeWorkers) {
    const saved = JSON.parse(fs.readFileSync(path.join(evidence, 'interruption.json')));
    nonce = saved.continuityNonce;
    taskState.plan = JSON.parse(fs.readFileSync(path.join(evidence, 'inspection-plan.json')));
    taskState.continuity = nonce;
    for (const role of ['logic', 'tests']) taskState.proposals[role] = JSON.parse(fs.readFileSync(path.join(evidence, `proposals-${role}.json`)));
    // This resume uses ONLY the bounded second session, never the rejected first context.
    parent = await ctx.agents.resume({ resumeSessionId: saved.sessionId, agentOptions: agentOptions() }); handles.push(parent);
    record('continue-after-workers', { sessionId: saved.sessionId, workerRequestsReplayed: false });
  } else {
  assert.equal(fs.existsSync(path.join(evidence, 'inspection-plan.json')), false, 'Existing provider run requires explicit recovery, never reset');
  reconcileNativeReceipts();
  parent = await createParent(`dsh-scenario-${randomUUID()}`);
  record('attempt-started', { sessionId: parent.agent.id, inheritedFailedRequests: budget.requests.length,
    priorContextLoaded: false, priorRequestsReplayed: false });
  record('stage', { stage: 'inspect/decompose', sessionId: parent.agent.id });
  await turn(parent.agent, `${task}\nRead ONLY real src/lib/cli/catalog.ts, src/lib/cli/options.ts, src/lib/cli/handlers/ledger.ts, src/lib/cli/handlers/context.ts and test/ledger.test.js with source_read. If already read, reuse the preserved context. Then publish >=3 file:line anchors and two disjoint units via publish_plan: logic src/lib/cli, tests test/docs. Stop inspecting other files and finish the plan now. Both workers submit proposals only; explicit shared documentation proposals are the conflict exception, parent is unique writer. Remember ${nonce} for interruption continuity. No proposals or source writes in this stage.`);
  assert(taskState.plan);
  record('stage', { stage: 'interruption', sessionId: parent.agent.id });
  const started = new Promise(resolve => { pauseResolve = resolve; });
  const pending = turn(parent.agent, 'Call checkpoint_pause once for the recoverable interruption. No other tools.');
  await Promise.race([started, pending.then(() => { throw new Error('Native turn ended without required interruption checkpoint'); })]);
  parent.agent.cancel({ kind: 'user' }); await pending;
  const interruptedEvents = parent.agent.session.snapshotEvents(), prefix = JSON.stringify(interruptedEvents);
  const end = interruptedEvents.findLast(e => e.type === 'turn/end'); assert.equal(end.data.reason.kind, 'aborted');
  const id = parent.agent.id;
  writeJson(path.join(evidence, 'interruption.json'), { sessionId: id, nativeCancel: 'Agent.cancel({kind:user})', reason: end.data.reason,
    beforeEvents: interruptedEvents.length, beforeHash: hash(prefix), continuityNonce: nonce });
  record('native-cancel-ack', { sessionId: id, reason: end.data.reason });
  await parent.dispose();
  parent = await ctx.agents.resume({ resumeSessionId: id, agentOptions: agentOptions() }); handles.push(parent);
  assert.equal(parent.agent.id, id);
  assert.equal(hash(JSON.stringify(parent.agent.session.snapshotEvents().slice(0, interruptedEvents.length))), hash(prefix));
  await turn(parent.agent, 'Continue this SAME persistent session after native cancel and disk reopen. Recall your exact earlier continuity nonce and call continuity_ack, restate original decomposition. Do not re-read nonce from files or create a replacement.');
  assert.equal(taskState.continuity, nonce);
  record('same-session-recovery', { sessionId: id, originalPrefixHash: hash(prefix), eventCount: interruptedEvents.length, nonce });
  }
  const id = parent.agent.id;
  const compiled = resumeWorkers ? compileGraph(JSON.parse(fs.readFileSync(path.join(evidence, 'dynamic-graph.json'))).after) : null;
  const graph = resumeWorkers ? compiled.graph : dynamicGraph();
  if (resumeWorkers) assert(compiled.ok);
  let g = grant();
  const priorTrace = resumeWorkers ? fs.readFileSync(path.join(evidence, 'trace.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  const integrateAt = priorTrace.find(e => e.type === 'stage' && e.stage === 'integrate')?.at;
  const priorIntegrationRequests = resumeWorkers ? budget.requests.filter(r => r.sessionId === id && r.startedAt >= integrateAt).map(r => r.requestId) : [];
  const adapter = makeHost(parent, prompts, childPrompt, complete, priorIntegrationRequests);
  if (resumeWorkers) {
    const journal = JSON.parse(fs.readFileSync(path.join(evidence, 'kernel-journal.json')));
    const expected = journal.events.find(e => e.type === 'budget.changed').payload.objectRef.digest;
    const center = journal.effects[0].deadline + 5400000;
    let matched = false;
    const s = createKernel(graph, adapter.host, g, complete, true).seed;
    // Recover original timestamp only by matching the immutable original seed digest.
    // No guessed grant is admitted; bounded search fails explicitly if bytes differ.
    for (let expiresAt = center - 1000; expiresAt <= center + 1000; expiresAt++) {
      const candidate = { ...g, expiresAt };
      if (digest(canonical({ graphRef: s.graphRef, policy: s.policy, reservePerRequest: s.reservePerRequest, operations: s.operations, grants: [candidate] })) === expected) {
        g = candidate; matched = true; break;
      }
    }
    assert(matched, 'Original seed bytes unavailable; cannot fabricate a replacement grant');
    writeJson(path.join(evidence, 'recovered-grant.json'), { grant: g, matchingSeedDigest: expected });
  }
  kernel = createKernel(graph, adapter.host, g, complete); adapter.attach(kernel); kernel.snapshot();
  if (resumeWorkers) {
    await kernel.restoreArtifacts();
    const state = value(kernel.service.read(kernel.seed.sessionId));
    const effect = Object.values(state.effects).find(e => e.binding.nodeId === 'integrate');
    assert.equal(git(['diff', '--name-only']), '', 'Inspect actual effects before continuing blocked integration');
    record('reconciled-blocked-integration', { effectId: effect.effectId, sessionId: id,
      observedEffects: 'proposal_read only; scratch remains byte-identical baseline', resend: false });
    const receipt = value(await adapter.host.execute({ effect, grant: g }));
    value(kernel.service.receive(kernel.seed.sessionId, receipt)); value(await kernel.service.evaluate(kernel.seed.sessionId, effect.effectId)); kernel.snapshot();
  } else {
    writeJson(path.join(evidence, 'grant.json'), g);
    record('stage', { stage: 'parallel', parentId: id }); await kernel.parallelWorkers();
    record('stage', { stage: 'integrate', parentId: id }); await kernel.step();
  }
  const file = 'src/lib/cli/handlers/ledger.ts', original = fs.readFileSync(resolveSource(file));
  const code = original.toString();
  const replaced = code.replace(/context\.stdout\(jsonDocument\([^\n]+\)\);/, 'context.stdout(jsonDocument([]));');
  assert.notEqual(replaced, code, 'Mutation target must be actual ledger show output');
  taskState.mutation = { path: file, original, originalHash: hash(original), mutation: 'ledger show stdout replaced by empty events' };
  fs.writeFileSync(resolveSource(file), replaced);
  writeJson(path.join(evidence, 'negative-control.json'), { path: file, mutation: taskState.mutation.mutation,
    originalHash: hash(original), mutatedHash: hash(Buffer.from(replaced)) });
  record('stage', { stage: 'fresh-verify', mutation: file }); await kernel.step();
  record('stage', { stage: 'repair', parentId: id }); await kernel.step();
  record('stage', { stage: 'finish' }); await kernel.step();
  const state = value(kernel.service.read(kernel.seed.sessionId));
  assert.equal(state.nodeStates.find(n => n.nodeId === 'finish').state, 'succeeded');
  value(await adapter.host.observe(kernel.seed.sessionId));
  assert.equal(hash(fs.readFileSync(config.contract)), config.contractSha256);
  assert.equal(git(['status', '--porcelain'], config.integration), '');
  await drain();
  fs.writeFileSync(path.join(evidence, 'scratch.patch'), git(['diff', '--binary']) + '\n');
  const files = Object.values(taskState.proposals).flat().map(p => p.path);
  writeJson(path.join(evidence, 'artifact-hashes.json'), Object.fromEntries([...new Set(files)].map(f => [f, hash(fs.readFileSync(resolveSource(f)))])));
  writeJson(path.join(evidence, 'completion.json'), { cp1: 'passed', cp2: 'passed', cp3: 'passed', evidenceLevel: 'provider-live',
    parentSessionId: id, nodeStates: state.nodeStates, contractSha256: config.contractSha256, cost: summarize() });
  record('scenario-completed', { nodeStates: state.nodeStates, cost: summarize() });
}
try { await main(); }
catch (error) {
  record('fatal', { name: error.name, message: error instanceof assert.AssertionError ? error.message : 'Native driver failed; no credential-bearing error serialized' });
  if (kernel) kernel.snapshot(); summarize(); process.exitCode = 1;
} finally { if (ctx) await cleanup(); }
