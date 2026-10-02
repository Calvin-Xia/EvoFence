import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { config, lane, evidence, root, hash, writeJson } from './io.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(evidence, name)));
const trace = fs.readFileSync(path.join(evidence, 'trace.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const budget = JSON.parse(fs.readFileSync(path.join(root, 'MODEL-BUDGET.json')));
const completion = read('completion.json');
const finalBoard = read('final-board.json');
assert.equal(finalBoard.kernelClaims.length, 0);
assert(finalBoard.after.every(t => t.ownerId === undefined));
assert.equal(finalBoard.modelRequests, 0);
const requests = budget.requests;
assert.equal(hash(fs.readFileSync(config.contract)), config.contractSha256);
assert.equal(new Set(requests.map(r => r.requestId)).size, requests.length);
const pool = read('request-pool.json');
assert.equal(pool.reservations.length, 0, 'Unknown actual spend must remain explicit, not silently released');
assert.equal(pool.settlements.length, requests.filter(r => r.tokens !== null).length);
for (const r of requests) {
  assert.equal(r.provider, config.provider); assert.equal(r.model, config.model);
  assert.deepEqual(r.thinking, { type: 'enabled' }); assert.equal(r.reasoningEffort, config.thinking);
  assert.equal(r.httpStatus, 200); assert.equal(r.outcome, 'settled');
  const n = r.nativeUsage, t = r.tokens;
  assert.equal(t.inputUncached, n.inputTokens); assert.equal(t.output, n.outputTokens);
  assert.equal(t.cacheRead, n.cacheReadTokens); assert.equal(t.cacheWrite, n.cacheWriteTokens);
  assert.equal(t.total, n.totalTokens); assert.equal(t.total, t.inputUncached + t.output + t.cacheRead + t.cacheWrite);
  assert.equal(pool.settlements.find(s => s.requestId === r.requestId).micros, Math.ceil(r.referenceUsd * 1e6));
  if (r.usageBasis === 'provider-raw' || (r.rawUsage?.length > 0 && !r.reconciliation)) {
    const raw = Object.assign({}, ...r.rawUsage.map(f => f.usage));
    assert.equal(raw.input_tokens, t.inputUncached); assert.equal(raw.output_tokens, t.output);
    assert.equal(raw.cache_read_input_tokens, t.cacheRead); assert.equal(raw.cache_creation_input_tokens, t.cacheWrite);
  } else assert(r.reconciliation, 'Historical normalized usage must retain its original unknown result');
}
const interrupted = read('interruption.json');
assert.equal(interrupted.sessionId, completion.parentSessionId);
assert.equal(interrupted.reason.kind, 'aborted');
const integrated = read('invocation-integrate.json');
assert.equal(hash(JSON.stringify(integrated.events.slice(0, interrupted.beforeEvents))), interrupted.beforeHash);
const recovery = trace.find(r => r.type === 'same-session-recovery' && r.sessionId === completion.parentSessionId);
assert.equal(recovery.nonce, interrupted.continuityNonce);
const logic = read('invocation-logic.json'), tests = read('invocation-tests.json');
assert.notEqual(logic.sessionId, tests.sessionId);
const range = sessionId => {
  const rows = requests.filter(r => r.sessionId === sessionId);
  return { from: Math.min(...rows.map(r => Date.parse(r.startedAt))), to: Math.max(...rows.map(r => Date.parse(r.endedAt))) };
};
const a = range(logic.sessionId), b = range(tests.sessionId);
const overlapMs = Math.min(a.to, b.to) - Math.max(a.from, b.from);
assert(overlapMs > 0, 'Native workers must actually overlap');
assert(requests.some(l => l.sessionId === logic.sessionId && requests.some(t => t.sessionId === tests.sessionId
  && Date.parse(l.startedAt) < Date.parse(t.endedAt) && Date.parse(t.startedAt) < Date.parse(l.endedAt))), 'Provider requests must overlap');
const conflict = read('shared-file-conflict.json');
assert.notEqual(conflict.variants[0].content, conflict.variants[1].content);
assert.deepEqual(new Set(conflict.variants.map(r => r.sessionId)), new Set([logic.sessionId, tests.sessionId]));
assert(conflict.rationale.length > 0);
assert.equal(hash(fs.readFileSync(path.join(config.scratch, conflict.path))), conflict.resolvedHash);
const red = read('invocation-verify.json'), final = read('invocation-finish.json');
for (const verifier of [red.sessionId, final.sessionId]) {
  assert(![logic.sessionId, tests.sessionId, completion.parentSessionId].includes(verifier), 'Verifier must be independent of authors');
}
const checkFiles = fs.readdirSync(evidence).filter(f => /^check-\d+\.json$/.test(f));
const checks = checkFiles.map(read), negative = checks.find(c => c.label === 'fresh-verify:focused:1');
assert.equal(negative.code, 1);
const failingNames = negative.stdout.split('\n').filter(line => /not ok|^✖/.test(line));
assert(failingNames.length > 0);
const mutation = read('negative-control.json');
assert.notEqual(mutation.originalHash, mutation.mutatedHash);
assert(trace.some(r => r.type === 'repair-restored' && r.hash === mutation.originalHash));
assert.equal(hash(fs.readFileSync(path.join(config.scratch, mutation.path))), mutation.originalHash);
const finishChecks = checks.filter(c => c.label.startsWith('finish:'));
assert.equal(finishChecks.length, 6); assert(finishChecks.every(c => c.code === 0));
const focused = finishChecks.filter(c => c.label.includes(':focused:'));
assert.equal(focused.length, 2);
const testCounts = focused.map(c => Number(c.stdout.match(/(?:# tests |ℹ tests )(\d+)/)?.[1]));
assert(testCounts.every(n => n >= 3));
for (const c of focused) assert(/(?:# fail |ℹ fail )0\b/.test(c.stdout));
for (const gate of ['build', 'typecheck', 'src:policy', 'dep:check']) {
  const c = finishChecks.find(c => c.label.endsWith(`:${gate}`));
  assert(c.argv.includes('run') && c.argv.includes(gate), 'Literal npm gate required');
}
const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
};
const integrationStatus = git(['status', '--porcelain'], config.integration);
const laneStatus = git(['status', '--porcelain'], lane);
assert(laneStatus.split('\n').every(line => line.endsWith('scenarios/dsh/')), 'Lane changed files outside ownership');
assert(!fs.readdirSync(root, { recursive: true }).some(f => String(f).endsWith('.test.js')), 'Integration test discovery pollution');
const hashes = read('artifact-hashes.json');
for (const [file, digest] of Object.entries(hashes)) assert.equal(hash(fs.readFileSync(path.join(config.scratch, file))), digest);
const originalTest = JSON.parse(fs.readFileSync(path.join(evidence, 'proposals-tests.json'))).find(r => r.path.startsWith('test/')).content;
const finalTest = fs.readFileSync(path.join(config.scratch, 'test/ledger-limit-scenario.test.js'), 'utf8');
assert.equal(finalTest.slice(finalTest.indexOf("test('ledger show")), originalTest.slice(originalTest.indexOf("test('ledger show")),
  'All behavioral test bodies must survive the assertion-helper repair byte-identically');
const gateResults = [];
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
for (const gate of ['build', 'typecheck', 'src:policy', 'dep:check']) {
  const file = path.join(evidence, `lane-gate-${gate.replace(':', '-')}.json`);
  if (process.argv.includes('--evidence-only')) {
    const row = JSON.parse(fs.readFileSync(file)); assert.equal(row.code, 0);
    gateResults.push({ gate, code: row.code });
  } else {
    const r = spawnSync(process.execPath, [npm, 'run', gate], { cwd: lane, encoding: 'utf8', windowsHide: true });
    const row = { gate, cwd: lane, code: r.status, stdout: r.stdout, stderr: r.stderr };
    writeJson(file, row);
    assert.equal(r.status, 0, r.stderr); gateResults.push({ gate, code: r.status });
  }
}
git(['add', '--', ...Object.keys(hashes)], config.scratch);
fs.writeFileSync(path.join(evidence, 'scratch.patch'), git(['diff', '--binary', 'HEAD'], config.scratch) + '\n');
const clean = integrationStatus === '';
const result = { passed: clean, scenarioEvidencePassed: true, cp1: 'passed', cp2: 'passed', cp3: clean ? 'passed' : 'failed', evidenceLevel: 'provider-live',
  nativeWorkerIds: [logic.sessionId, tests.sessionId], verifierIds: [red.sessionId, final.sessionId], overlapMs,
  recoveredSessionId: completion.parentSessionId, failingNames, testCounts, gates: gateResults,
  requests: requests.length, tokens: requests.reduce((n, r) => n + r.tokens.total, 0),
  referenceUsd: requests.reduce((n, r) => n + r.referenceUsd, 0), invoiceUsd: null,
  normalizedOnlyHistoricalRequests: requests.filter(r => r.reconciliation).map(r => r.requestId),
  unknownAccountedUsage: requests.filter(r => r.tokens === null).map(r => r.requestId),
  providerRawUnknownRequests: requests.filter(r => r.reconciliation).map(r => r.requestId),
  costMeaning: '参考非账单', sourceHostDiff: 0, integrationStatus: clean ? 'clean' : 'dirty-external', integrationPorcelain: integrationStatus,
  blocker: clean ? null : 'Brief cp3 requires a clean integration worktree; this lane cannot mutate it', contractSha256: config.contractSha256 };
const auditFile = path.join(evidence, 'audit.json'), initialAudit = path.join(evidence, 'audit-initial.json');
if (fs.existsSync(auditFile) && !fs.existsSync(initialAudit)) fs.copyFileSync(auditFile, initialAudit);
writeJson(path.join(evidence, 'audit.json'), result);
writeJson(path.join(evidence, 'completion.json'), { ...completion, cp3: result.cp3, independentAudit: 'audit.json', blocker: result.blocker });
process.stdout.write(JSON.stringify(result) + '\n');
if (!clean) process.exitCode = 1;
