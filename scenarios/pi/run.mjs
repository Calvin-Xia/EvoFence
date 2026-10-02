import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { bindPiDelegation } from '../../dist/hosts/pi/delegation.js';
import { config, evidence, runtimeDir, root, attempt, hash, value, writeJson, record, init } from './io.mjs';
import { setup, sdk, makeSession, pool, cleanup, budgetSnapshot, poolSnapshot, clock } from './native.mjs';
import { taskState, checks } from './task-tools.mjs';
import { grant, spec, node, graphRef, makeEffect, dynamicGraph, createKernel, childPlan } from './graph.mjs';
import { compileGraph } from '../../dist/kernel/graph/index.js';

const git = args => { const r = spawnSync('git', args, { cwd: config.scratch, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr); return r.stdout; };
const task = `Implement ledger show [run-id] [--limit <N>] [--json]. N is a decimal positive safe integer. Zero, negatives, fractions, NaN, junk, infinity, unsafe integers and missing values fail explicitly with exit 1 and JSON error when --json. No --limit preserves existing events exactly. Limit is applied AFTER run-id filtering, to the first N chronological events. Accept --limit=N too. Use real CLI subprocess tests, not copies of implementation. Baseline catalog is 349 lines; src files must stay <=350 lines. All work is scratch only.`;
const nonce = `CONTINUITY_${randomUUID()}`;
let parent, delegation, kernel, pauseResolve;
const pause = { started: () => pauseResolve() };
const prompts = {
  inspect: `${task}\nInspect real catalog, options, handlers/ledger.ts, handlers/context.ts, test/ledger.test.js. Read them with source_read. Publish anchors with file:line and two disjoint units through publish_plan: logic owns src/lib/cli/**, tests owns test/** and docs/**. Remember this nonce for recovery: ${nonce}. Do not modify files.`,
  interruption: 'Call checkpoint_pause once. This is a deliberate real recoverable native abort checkpoint. Do not call other tools.',
  resumed: 'The host has reopened this same persistent session after abort. Recall the exact continuity nonce from your earlier task context and call continuity_ack with it. Briefly restate the saved task decomposition. Do not write source.',
  integrate: 'Both native worker results are ready. Read their results supplied in the finite context, then call integrate_proposals once. It is the only writer and checks original byte hashes; report conflicts explicitly. Do not reimplement or silently overwrite either worker.',
  repair: 'An independent verifier ran real CLI subprocess tests and found the injected failure. Read current src/lib/cli/handlers/ledger.ts and test/ledger-limit-scenario.test.js; explain which test behavior the injected empty-output mutation breaks. Use repair_restore to repair to the exact pre-mutation bytes. Do not edit tests or weaken assertions.',
};
function childPrompt(role, a) {
  const phase = a.effect.binding.nodeId;
  if (role === 'logic') return `${task}\n${taskState.plan.logic}\n${phase === 'inspect'
    ? 'First child loop: inspect src/lib/cli/catalog.ts, handlers/context.ts and handlers/ledger.ts with source_read. No proposals yet. State a precise implementation plan.'
    : 'Second loop in this SAME child session: implement your inspected plan by propose_file. Submit full replacement content for catalog.ts, handlers/context.ts and handlers/ledger.ts. Add a positiveIntegerOption helper in context.ts, use it in ledger show before opening the ledger, and declare limit in catalog. Keep catalog <=350 lines by using an inline flag entry on an existing line. Read originals again if needed. Preserve unrelated code exactly. Do not write tests/docs.'}`;
  if (role === 'tests') return `${task}\n${taskState.plan.tests}\n${phase === 'inspect'
    ? 'First child loop: read test/ledger.test.js, src/lib/cli/handlers/ledger.ts and src/lib/cli/handlers/context.ts. No proposals yet. Plan independent observable CLI tests.'
    : 'Second loop in this SAME child session: propose_file test/ledger-limit-scenario.test.js and docs/cli-limit-scenario.md. Use Ledger.append to seed >=4 mixed-run events in a temporary git repo with .evofence directory; invoke absolute scratch dist/cli.js via Node spawnSync. Test (1) no-limit default unchanged against directly seeded event identities, (2) limit 2 and =2 valid values chronological order, (3) limit 1 and above count boundary, (4) invalid values incl 0 -1 1.5 1e2 abc empty and unsafe integer fail 1 with empty stdout and JSON stderr error, (5) missing value fails, (6) run-id filtering happens before limit. Do not import numeric helper as oracle. Do not assume error code beyond an explicit error object. No edits to src; no shell commands or commits.'}`;
  return role === 'verifier-red'
    ? `${task}\nYou are an independent verifier session with no authorship. A fault was deliberately injected after integration. Read the focused test and handler if needed, call run_checks final=false. Report the EXACT failing test names and observed mismatch. A nonzero result is expected; do not repair code or tests.`
    : `${task}\nYou are a fresh independent verifier, not a code author. Read focused tests and handler, review actual observables and invalid-input assertions. Call run_checks final=true exactly once. This executes the two required fresh focused rounds and all four gates. State raw exit codes and limitations. Do not write source.`;
}
function complete(stage) {
  if (stage === 'logic') return taskState.proposals.logic?.length >= 3;
  if (stage === 'tests') return taskState.proposals.tests?.some(r => r.path.endsWith('-scenario.test.js'));
  if (stage === 'integrate') return Object.values(taskState.proposals).flat().every(r => hash(fs.readFileSync(path.join(config.scratch, r.path))) === hash(Buffer.from(r.content)));
  if (stage === 'verify') return taskState.checks.some(r => r.label.startsWith('fresh-verify:focused:') && r.code === 1);
  if (stage === 'repair') return hash(fs.readFileSync(path.join(config.scratch, taskState.mutation.path))) === taskState.mutation.originalHash;
  if (stage === 'finish') return taskState.checks.filter(r => r.label.startsWith('finish:')).length === 6
    && taskState.checks.filter(r => r.label.startsWith('finish:')).every(r => r.code === 0);
  throw new Error(`undeclared stage ${stage}`);
}
async function main() {
  const resumeWorkers = process.argv.includes('--resume-after-workers');
  const resume = process.argv.includes('--resume-after-recovery') || resumeWorkers;
  const restartPreflight = process.argv.includes('--restart-preflight');
  init(resume || restartPreflight);
  if (restartPreflight) assert(!fs.readFileSync(path.join(evidence, 'trace.jsonl'), 'utf8').includes('provider-dispatch'), 'preflight restart cannot replay paid work');
  assert.equal(git(['rev-parse', 'HEAD']).trim(), config.baseline);
  assert.equal(git(['diff', '--name-only']).trim(), '', 'scratch must match baseline content');
  assert.equal(git(['ls-files', '--others', '--exclude-standard']).trim(), '', 'scratch must have no untracked task source');
  const contractBefore = fs.readFileSync(config.contract);
  if (!resume) writeJson(path.join(evidence, 'preflight.json'), { lane: 'l3-pi-scenario', baseline: config.baseline,
    branch: git(['branch', '--show-current']).trim(), contractPath: config.contract, contractSha256: hash(contractBefore),
    model: 'deepseek/deepseek-flash', thinking: 'high', piVersion: config.piVersion, estimatedRequestCeiling: config.maxRequests,
    referenceUpperUsd: config.maxRequests * (config.maxInputTokens * .3 + config.maxOutputTokens * 1.2) / 1e6,
    invoice: false, dollarHardCap: null, credentialsPersisted: false });
  await setup();
  let g = grant(), parentId;
  if (resume) {
    const abort = JSON.parse(fs.readFileSync(path.join(evidence, 'abort.json')));
    const trace = fs.readFileSync(path.join(evidence, 'trace.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const recovered = trace.find(e => e.type === 'same-session-recovery');
    assert.equal(recovered.sessionId, abort.parentId);
    assert.equal(fs.existsSync(path.join(evidence, 'kernel-journal.json')), resumeWorkers, 'explicit continuation boundary must match journal');
    taskState.plan = JSON.parse(fs.readFileSync(path.join(evidence, 'inspection-plan.json')));
    taskState.continuity = recovered.nonce; parentId = abort.parentId;
    parent = await makeSession('parent', sdk.SessionManager.open(abort.file), null,
      async a => prompts[a.effect.binding.nodeId], pause, true, true);
    assert.equal(parent.sessionId, parentId);
    if (resumeWorkers) {
      g = parent.manager.getEntries().find(e => e.customType === 'evofence.kernel.pi.delegation.v1').data.authorized.grant;
      for (const role of ['logic', 'tests']) taskState.proposals[role] = JSON.parse(fs.readFileSync(path.join(evidence, 'proposals', role, 'bundle.json')));
    }
    record('continue-after-driver-fix', { parentId, completedPaidStagesReplayed: false });
  } else {
  // Establish an ordinary real persistent host session before attaching the kernel binding.
  const manager = sdk.SessionManager.create(config.scratch, path.join(runtimeDir, 'sessions'));
  parent = await makeSession('parent', manager, null, async a => prompts[a.effect.binding.nodeId], pause, false);
  await parent.session.prompt('HOST_BOOTSTRAP: Establish this persistent Pi host session. Reply ready, no tools.');
  await parent.session.waitForIdle(); await parent.drain(); const parentFile = manager.getSessionFile(); parentId = parent.sessionId;
  parent.dispose();
  parent = await makeSession('parent', sdk.SessionManager.open(parentFile), null, async a => prompts[a.effect.binding.nodeId], pause, true, true);
  const bootstrap = compileGraph(spec('bootstrap', [node('bootstrap', null, true)])); assert(bootstrap.ok);
  const ref = graphRef(bootstrap.graph);
  record('stage', { stage: 'inspect/decompose', sessionId: parentId });
  const inspection = value(await parent.host.execute({ effect: makeEffect('inspect', ref, parentId, g), grant: g }));
  assert.equal(inspection.status, 'completed'); assert(taskState.plan !== null);
  record('stage', { stage: 'interruption', sessionId: parentId });
  const started = new Promise(resolve => { pauseResolve = resolve; });
  const interruptionEffect = makeEffect('interruption', ref, parentId, g);
  const pending = parent.host.execute({ effect: interruptionEffect, grant: g });
  await started;
  const cancelled = value(await parent.host.cancel({ sessionId: 'pi-scenario', targetIds: ['interruption'] }));
  const interruptedReceipt = value(await pending); await parent.drain();
  assert.equal(cancelled.status, 'cancelled'); assert.equal(parent.session.isIdle, true);
  const bytesBefore = fs.readFileSync(parentFile), messages = parent.session.messages.length;
  writeJson(path.join(evidence, 'abort.json'), { parentId, file: parentFile, cancelled, interruptedReceipt,
    beforeReopenSha256: hash(bytesBefore), bytes: bytesBefore.length, messages });
  record('native-abort-ack', { parentId, status: cancelled.status, receiptStatus: interruptedReceipt.status });
  parent.dispose();
  parent = await makeSession('parent', sdk.SessionManager.open(parentFile), null, async a => prompts[a.effect.binding.nodeId], pause, true, true);
  assert.equal(parent.sessionId, parentId); assert.equal(parent.session.messages.length, messages);
  const resumed = value(await parent.host.execute({ effect: makeEffect('resumed', ref, parentId, g), grant: g }));
  assert.equal(resumed.status, 'completed'); assert.equal(taskState.continuity, nonce);
  assert(fs.readFileSync(parentFile).subarray(0, bytesBefore.length).equals(bytesBefore), 'native transcript prefix preserved byte-for-byte');
  record('same-session-recovery', { sessionId: parentId, nonce, prefixHash: hash(bytesBefore), messagesBefore: messages });
  }
  const children = new Map();
  if (resumeWorkers) {
    for (const e of fs.readFileSync(path.join(evidence, 'trace.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(e => e.type === 'child-created')) {
      children.set(e.childId, { file: e.file, role: e.role });
    }
  }
  const options = { version: config.piVersion, kernelSessionId: 'pi-scenario', parentSessionId: parentId,
    manager: parent.manager, parent: parent.host, parentCapabilities: ['host.agent', 'host.delegate'],
    model: { provider: config.provider, modelId: config.model, thinkingLevel: config.thinking }, clock, requests: pool,
    append: (name, data) => parent.manager.appendCustomEntry(name, data),
    plan: async a => {
      const role = a.effect.binding.nodeId === 'verify' ? 'verifier-red' : a.effect.binding.nodeId === 'finish' ? 'verifier-final' : a.effect.binding.nodeId;
      const plan = childPlan(a, role); writeJson(path.join(evidence, `child-plan-${a.effect.binding.nodeId}.json`), plan);
      return { ok: true, value: plan };
    },
    async create(childSpec) {
      const role = childSpec.graphRef.graphId.split(':')[1];
      const promptRole = role === 'verify' ? 'verifier-red' : role === 'finish' ? 'verifier-final' : role;
      const childManager = sdk.SessionManager.create(config.scratch, path.join(runtimeDir, 'children'));
      const child = await makeSession(promptRole.startsWith('verifier') ? 'verifier' : promptRole,
        childManager, childSpec, async a => childPrompt(promptRole, a), pause);
      children.set(child.sessionId, { file: childManager.getSessionFile(), role: promptRole });
      record('child-created', { parentId, childId: child.sessionId, role: promptRole, file: childManager.getSessionFile() });
      return { ok: true, value: child };
    },
    async restore(childSpec, childId) {
      const row = children.get(childId); assert(row, 'unrecorded child restore');
      const child = await makeSession(row.role.startsWith('verifier') ? 'verifier' : row.role,
        sdk.SessionManager.open(row.file), childSpec, async a => childPrompt(row.role, a), pause, true, true);
      assert.equal(child.sessionId, childId); return { ok: true, value: child };
    } };
  delegation = value(bindPiDelegation(options));
  const graph = dynamicGraph(); kernel = createKernel(graph, delegation.host, g, complete);
  if (resumeWorkers) await kernel.restoreArtifacts();
  else { record('stage', { stage: 'parallel', sessionId: parentId }); await kernel.parallelWorkers(); }
  prompts.integrate += '\nWORKER RESULTS:\n' + JSON.stringify(Object.values(taskState.proposals).flat().map(r => ({ path: r.path, baseHash: r.baseHash, outputHash: hash(Buffer.from(r.content)) })));
  record('stage', { stage: 'integrate', sessionId: parentId }); await kernel.step();
  const initial = await checks('pre-mutation'); assert(initial.every(r => r.code === 0), 'natural implementation failure requires repair before injection');
  const faultPath = 'src/lib/cli/handlers/ledger.ts', original = fs.readFileSync(path.join(config.scratch, faultPath));
  const text = original.toString('utf8'), needle = 'context.stdout(jsonDocument(';
  assert(text.includes(needle), 'ledger show stdout mutation anchor must exist');
  // Mutate only ledger show output; other handlers and tests remain unchanged.
  const start = text.indexOf(needle), end = text.indexOf(';', start) + 1;
  const replacement = 'context.stdout(jsonDocument([]));';
  const mutated = Buffer.from(text.slice(0, start) + replacement + text.slice(end));
  taskState.mutation = { path: faultPath, originalHash: hash(original), mutatedHash: hash(mutated),
    originalBase64: original.toString('base64'), originalExpression: text.slice(start, end), replacement };
  writeJson(path.join(evidence, 'negative-control.json'), taskState.mutation);
  fs.writeFileSync(path.join(config.scratch, faultPath), mutated);
  record('negative-control-injected', { path: faultPath, originalHash: hash(original), mutatedHash: hash(mutated), replacement });
  record('stage', { stage: 'fresh-verify' }); await kernel.step();
  record('stage', { stage: 'repair', sessionId: parentId }); await kernel.step();
  record('stage', { stage: 'finish' }); await kernel.step();
  const final = value(kernel.service.read('pi-scenario')); assert(final.nodeStates.some(n => n.nodeId === 'finish' && n.state === 'succeeded'));
  assert.equal(hash(fs.readFileSync(config.contract)), hash(contractBefore));
  fs.writeFileSync(path.join(evidence, 'scratch.patch'), git(['diff', '--binary']));
  const extras = git(['ls-files', '--others', '--exclude-standard']).trim().split('\n').filter(Boolean);
  for (const file of extras) {
    const diff = spawnSync('git', ['diff', '--no-index', '--binary', '--', '/dev/null', file], { cwd: config.scratch, encoding: 'utf8', windowsHide: true });
    assert.equal(diff.status, 1, diff.stderr); fs.appendFileSync(path.join(evidence, 'scratch.patch'), diff.stdout);
  }
  const paths = [...new Set([...git(['diff', '--name-only']).trim().split('\n'), ...extras])].filter(Boolean);
  writeJson(path.join(evidence, 'artifact-hashes.json'), paths.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(config.scratch, file))) })));
  const calls = budgetSnapshot().requests.filter(r => r.scenario === 'l3-pi-scenario');
  const report = { lane: 'l3-pi-scenario', cp1: 'passed', cp2: 'passed', cp3: 'pending-independent-audit',
    grade: 'provider-live', parentId, children: [...children.entries()], scratch: config.scratch, paths,
    requests: calls.length, settledRequests: calls.filter(r => r.status === 'settled').length,
    tokens: calls.every(r => r.usage !== null) ? calls.reduce((n, r) => n + r.usage.total_tokens, 0) : null,
    referenceUsd: calls.filter(r => r.referenceUsd !== null).reduce((n, r) => n + r.referenceUsd, 0),
    unknownRequests: calls.filter(r => r.status !== 'settled').map(r => r.id), costBasis: '参考非账单; local pinned provider catalog',
    tests: taskState.checks.map(({ label, code }) => ({ label, code })), kernelNodeStates: final.nodeStates,
    poolReservations: poolSnapshot().ledger.reservations, limits: ['No capability-uplift inference', 'No OS sandbox', 'No provider cancellation billing confirmation',
      'Recovery is explicit abort + native disk reopen, not process-kill', 'Pi has no native team board; SDK factory implements child delegation',
      'Transport request ledger and kernel invocation ledger are distinct, both retained', 'Invoice and current external pricing not queried'] };
  report.attempt = attempt;
  writeJson(path.join(evidence, 'result.json'), report);
  record('scenario-completed', { requests: report.requests, tokens: report.tokens, referenceUsd: report.referenceUsd });
}
try { await main(); }
catch (error) { record('fatal', { name: error.name, message: error.message }); writeJson(path.join(evidence, `failure-${Date.now()}.json`), { name: error.name, message: error.message, stack: error.stack }); process.exitCode = 1; }
finally { if (delegation) value(await delegation.close('unload')); parent?.dispose(); await cleanup(); }
