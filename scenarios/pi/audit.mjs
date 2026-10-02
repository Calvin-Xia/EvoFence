import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { config, evidence, root, hash, writeJson, attempt } from './io.mjs';

const read = file => JSON.parse(fs.readFileSync(path.join(evidence, file)));
const trace = fs.readFileSync(path.join(evidence, 'trace.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const result = read('result.json'), abort = read('abort.json'), preflight = read('preflight.json');
const budget = JSON.parse(fs.readFileSync(path.join(root, 'MODEL-BUDGET.json')));
const requests = budget.requests.filter(r => r.scenario === 'l3-pi-scenario');
const thisAttempt = requests.filter(r => (r.attempt ?? '1') === attempt);
const children = trace.filter(e => e.type === 'child-created');
const facts = [], fact = (name, test, evidenceRefs) => { assert(test, name); facts.push({ name, passed: true, evidenceRefs }); };
fact('frozen contract unchanged', hash(fs.readFileSync(config.contract)) === preflight.contractSha256, ['preflight.json']);
fact('provider-live actual HTTP and required payload', thisAttempt.length > 0 && thisAttempt.every(r => r.httpStatus === 200
  && r.provider === 'deepseek' && r.model === 'deepseek-flash' && r.thinking === 'high'
  && r.payload.thinking.type === 'enabled' && r.payload.reasoning_effort === 'high'), ['MODEL-BUDGET.json']);
fact('raw usage complete, accounted on every HTTP dispatch', thisAttempt.every(r => r.status === 'settled'
  && r.usage.total_tokens === r.usage.prompt_tokens + r.usage.completion_tokens && r.referenceUsd !== null), ['MODEL-BUDGET.json']);
fact('ledger has unique request identities across all attempts', new Set(requests.map(r => r.id)).size === requests.length, ['MODEL-BUDGET.json']);
const pool = JSON.parse(fs.readFileSync(path.join(root, 'evidence/request-pool.json')));
fact('shared pool retained previous attempts', requests.every(r => pool.owners.some(o => o.requestId === r.id)), ['../request-pool.json']);
for (const r of thisAttempt) {
  const normalized = pool.usage.find(u => u.requestId === r.id);
  fact(`raw/native alignment ${r.id}`, normalized?.complete && normalized.total === r.usage.total_tokens
    && normalized.inputUncached + normalized.cacheRead === r.usage.prompt_tokens
    && normalized.output === r.usage.completion_tokens, ['MODEL-BUDGET.json', '../request-pool.json']);
}
fact('two disjoint native author child identities', children.filter(e => ['logic', 'tests'].includes(e.role)).length === 2
  && new Set(children.map(e => e.childId)).size === children.length && children.every(e => e.childId !== result.parentId), ['trace.jsonl']);
const logic = children.find(e => e.role === 'logic'), tests = children.find(e => e.role === 'tests');
const interval = id => { const rows = thisAttempt.filter(r => r.sessionId === id);
  return { start: Math.min(...rows.map(r => Date.parse(r.dispatchedAt))), end: Math.max(...rows.map(r => Date.parse(r.finishedAt))) }; };
const li = interval(logic.childId), ti = interval(tests.childId), overlapMs = Math.min(li.end, ti.end) - Math.max(li.start, ti.start);
fact('workers truly overlap in live provider execution', overlapMs > 0, ['trace.jsonl', 'MODEL-BUDGET.json']);
for (const child of [logic, tests]) {
  const entries = fs.readFileSync(child.file, 'utf8').trim().split('\n').map(JSON.parse);
  fact(`${child.role} same-session child loops`, entries.filter(e => e.customType === 'evofence.kernel.pi.v1'
    && e.data.kind === 'receipt' && e.data.receipt.status === 'completed').length === 2, [child.file]);
}
const reopened = trace.filter(e => e.type === 'session-reopened' && e.sessionId === result.parentId);
const recovery = trace.find(e => e.type === 'same-session-recovery');
fact('actual abort ack and same-id reopen', abort.cancelled.status === 'cancelled'
  && abort.cancelled.targets[0].confirmation === 'native-ack' && reopened.length >= 2
  && recovery.sessionId === abort.parentId && abort.parentId === result.parentId, ['abort.json', 'trace.jsonl']);
fact('remembered nonce from prior context', trace.some(e => e.type === 'continuity-ack' && e.nonce === recovery.nonce), ['trace.jsonl']);
fact('persistent native prefix immutable', hash(fs.readFileSync(abort.file).subarray(0, abort.bytes)) === abort.beforeReopenSha256, ['abort.json', abort.file]);
const proposalRows = ['logic', 'tests'].flatMap(role => read(`proposals/${role}/bundle.json`));
fact('non-overlapping source ownership and three or more files', proposalRows.length >= 3
  && new Set(proposalRows.map(r => r.path)).size === proposalRows.length, ['proposals/logic/bundle.json', 'proposals/tests/bundle.json']);
fact('single integration writer', trace.filter(e => e.type === 'integration-write').length === proposalRows.length
  && trace.filter(e => e.type === 'integration-write').every(e => proposalRows.some(r => r.path === e.path
    && r.baseHash === e.baseHash && hash(Buffer.from(r.content)) === e.afterHash)), ['trace.jsonl']);
const checkFiles = fs.readdirSync(evidence).filter(f => /^check-[0-9]+\.json$/.test(f)).sort((a, b) => Number(a.match(/[0-9]+/)[0]) - Number(b.match(/[0-9]+/)[0]));
const checks = checkFiles.map(read), red = checks.find(r => r.label === 'fresh-verify:focused:1');
const hasQuality = fs.existsSync(path.join(evidence, 'quality-repair.json'));
const green = checks.filter(r => hasQuality ? /^quality-final:focused:[12]$/.test(r.label) : /^finish:focused:[12]$/.test(r.label));
fact('mutation causes real CLI behavioral red', red.code === 1 && /not ok|✖/.test(red.stdout) && /AssertionError|ERR_ASSERTION/.test(red.stdout), checkFiles);
fact('two final focused rounds have three or more real passing cases', green.length === 2 && green.every(r => r.code === 0
  && /(?:#|ℹ) fail 0/.test(r.stdout) && Number(r.stdout.match(/(?:#|ℹ) tests (\d+)/)?.[1]) >= 3), checkFiles);
const mutation = read('negative-control.json');
fact('restored injected source byte-for-byte', hash(fs.readFileSync(path.join(config.scratch, mutation.path))) === mutation.originalHash
  && trace.some(e => e.type === 'repair-restored' && e.restoredHash === mutation.originalHash), ['negative-control.json', 'trace.jsonl']);
fact('fresh independent verifier ids differ from author/parent', children.filter(e => e.role.startsWith('verifier')).length >= 2
  && children.filter(e => e.role.startsWith('verifier')).every(e => ![logic.childId, tests.childId, result.parentId].includes(e.childId)), ['trace.jsonl']);
fact('kernel finish follows preserved red and repair', result.kernelNodeStates.some(n => n.nodeId === 'finish' && n.state === 'succeeded')
  && result.kernelNodeStates.some(n => n.nodeId === 'verify' && n.state === 'failed')
  && result.kernelNodeStates.some(n => n.nodeId === 'repair' && n.state === 'succeeded'), ['kernel-journal.json', 'result.json']);
fact('final byte hashes agree with actual scratch', read('artifact-hashes.json').every(r => hash(fs.readFileSync(path.join(config.scratch, r.file))) === r.sha256), ['artifact-hashes.json']);
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const gates = [];
for (const gate of ['build', 'typecheck', 'src:policy', 'dep:check']) {
  const r = spawnSync(process.execPath, [npmCli, 'run', gate], { cwd: config.scratch, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  const row = { command: `npm run ${gate}`, code: r.status, stdout: r.stdout, stderr: r.stderr };
  gates.push(row); writeJson(path.join(evidence, `audit-gate-${gate.replace(':', '-')}.json`), row); assert.equal(r.status, 0, `${gate}: ${r.stderr || r.stdout}`);
}
const testSource = fs.readFileSync(path.join(config.scratch, 'test/ledger-limit-scenario.test.js'), 'utf8');
fact('tests exercise the real CLI rather than numeric helper', testSource.includes('spawnSync') && testSource.includes('dist/cli.js')
  && !testSource.includes('positiveIntegerOption'), ['test/ledger-limit-scenario.test.js']);
const totals = { requests: requests.length, thisAttemptRequests: thisAttempt.length,
  tokens: requests.reduce((n, r) => n + r.usage.total_tokens, 0),
  inputTokens: requests.reduce((n, r) => n + r.usage.prompt_tokens, 0),
  outputTokens: requests.reduce((n, r) => n + r.usage.completion_tokens, 0),
  cacheReadTokens: requests.reduce((n, r) => n + r.usage.prompt_tokens_details.cached_tokens, 0),
  referenceUsd: requests.reduce((n, r) => n + r.referenceUsd, 0), unknownRequests: requests.filter(r => r.status !== 'settled').map(r => r.id),
  invoice: null, basis: config.priceBasis };
const report = { lane: 'l3-pi-scenario', attempt, grade: 'provider-live', cp1: 'passed', cp2: 'passed', cp3: 'passed',
  independentAuditor: 'codex lane execution agent, different from deepseek source author/verifier sessions', facts, overlapMs, totals, gates,
  failedAttemptPreserved: attempt === '1' ? null : { path: '../kernel-journal.json', outcome: 'unknown integration retained; no success rewrite' } };
writeJson(path.join(evidence, 'audit.json'), report);
const files = fs.readdirSync(evidence).filter(f => fs.statSync(path.join(evidence, f)).isFile() && f !== 'index.json');
writeJson(path.join(evidence, 'index.json'), { lane: 'l3-pi-scenario', attempt, generatedAt: new Date().toISOString(),
  artifacts: files.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(evidence, file))) })),
  rawNativeSessions: [abort.file, ...children.map(e => e.file)], cumulativeBudget: path.join(root, 'MODEL-BUDGET.json') });
process.stdout.write(JSON.stringify({ cp1: report.cp1, cp2: report.cp2, cp3: report.cp3, overlapMs, totals, gates: gates.map(r => ({ command: r.command, code: r.code })) }, null, 2) + '\n');
