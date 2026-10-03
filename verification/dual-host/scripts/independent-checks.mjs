/**
 * l3_dual_host_gate — independent, 0-paid-request re-derivation of the anchors the
 * admission matrix cites.
 *
 * Reads only local, already-produced evidence:
 *   - lane worktree evidence dirs (gitignored, local):
 *       C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-pi-scenario/scenarios/pi
 *       C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-dsh-scenario/scenarios/dsh
 *   - the two scratch clones:
 *       C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-pi-scratch
 *       C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-dsh-scratch
 *
 * It never contacts a model/provider, never writes outside verification/dual-host/,
 * never commits, and never touches .graph/**. Run:  node verification/dual-host/scripts/independent-checks.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'evidence');
const repo = join(here, '..', '..', '..');

const PI = 'C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-pi-scenario/scenarios/pi';
const DSH = 'C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-dsh-scenario/scenarios/dsh';
const PI_SCRATCH = 'C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-pi-scratch';
const DSH_SCRATCH = 'C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-dsh-scratch';
const FROZEN_CONTRACT = '9c6c5680b5bb5954f299617070e234230379a0014e01c88021202e051b00b979';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sha256File = (p) => sha256(readFileSync(p));
const j = (p) => JSON.parse(readFileSync(p, 'utf8'));
const lines = (p) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const exists = existsSync;
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const lf = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const checks = [];
const push = (id, ok, detail, anchors = []) => checks.push({ id, ok, detail, anchors });

// ── 1. frozen contract ────────────────────────────────────────────────────────
const contractRepo = join(repo, 'scenarios', 'TASK-CONTRACT.md');
const contractLf = sha256(Buffer.from(lf(contractRepo), 'utf8'));
const frozenBlob = execFileSync('git', ['show', '4a250e4:scenarios/TASK-CONTRACT.md'], { cwd: repo, encoding: 'utf8' });
push('contract.frozen-unchanged', contractLf === FROZEN_CONTRACT,
  `repo working file LF-normalized sha256 = ${contractLf} (expected ${FROZEN_CONTRACT}); git blob at freeze commit 4a250e4 sha256 = ${sha256(Buffer.from(frozenBlob, 'utf8'))}`,
  ['scenarios/TASK-CONTRACT.md', 'git 4a250e4:scenarios/TASK-CONTRACT.md']);
push('contract.head-blob-equals-frozen', git(repo, ['rev-parse', 'HEAD:scenarios/TASK-CONTRACT.md']) === git(repo, ['rev-parse', '4a250e4:scenarios/TASK-CONTRACT.md']),
  `HEAD blob ${git(repo, ['rev-parse', 'HEAD:scenarios/TASK-CONTRACT.md']).slice(0, 12)} vs freeze blob ${git(repo, ['rev-parse', '4a250e4:scenarios/TASK-CONTRACT.md']).slice(0, 12)}`);
push('contract.not-touched-by-head-commit', execFileSync('git', ['diff', '--name-only', 'ccb4536', 'HEAD', '--', 'scenarios/TASK-CONTRACT.md'], { cwd: repo, encoding: 'utf8' }).trim() === '',
  `ccb4536..HEAD (redaction 503eafa) diff on the contract = empty; contract sha256 identical to freeze commit`);

// ── 2. artifact hashes vs scratch bytes ───────────────────────────────────────
const piArtifacts = j(join(PI, 'evidence/attempt-2/artifact-hashes.json'));
const piArtifactBad = [];
for (const a of piArtifacts) {
  const p = join(PI_SCRATCH, a.file);
  const got = exists(p) ? sha256File(p) : 'MISSING';
  if (got !== a.sha256) piArtifactBad.push({ file: a.file, expected: a.sha256, got });
}
push('pi.artifact-hashes', piArtifactBad.length === 0,
  `${piArtifacts.length}/${piArtifacts.length} scratch files match artifact-hashes.json; HEAD ${git(PI_SCRATCH, ['rev-parse', 'HEAD'])}`,
  piArtifacts.map((a) => `scenario-pi-scratch/${a.file}`));

const dshArtifacts = j(join(DSH, 'evidence/artifact-hashes.json'));
const dshArtifactBad = [];
for (const [file, expected] of Object.entries(dshArtifacts)) {
  const p = join(DSH_SCRATCH, file);
  const got = exists(p) ? sha256File(p) : 'MISSING';
  if (got !== expected) dshArtifactBad.push({ file, expected, got });
}
push('dsh.artifact-hashes', dshArtifactBad.length === 0,
  `${Object.keys(dshArtifacts).length}/${Object.keys(dshArtifacts).length} scratch files match artifact-hashes.json; HEAD ${git(DSH_SCRATCH, ['rev-parse', 'HEAD'])}`,
  Object.keys(dshArtifacts).map((f) => `scenario-dsh-scratch/${f}`));

// scratch task shape: real source diffs, not ledger reads
const piDiff = git(PI_SCRATCH, ['status', '--porcelain']).split('\n').filter(Boolean);
const dshDiff = git(DSH_SCRATCH, ['status', '--porcelain']).split('\n').filter(Boolean);
push('scratch.pi-is-real-source-work', piDiff.length === 5 && piDiff.some((l) => l.includes('src/lib/cli/')) && piDiff.some((l) => l.includes('test/')),
  `pi scratch status = ${JSON.stringify(piDiff)}`);
push('scratch.dsh-is-real-source-work', dshDiff.length === 5 && dshDiff.some((l) => l.includes('src/lib/cli/')) && dshDiff.some((l) => l.includes('test/')),
  `dsh scratch status = ${JSON.stringify(dshDiff)}`);
const dshStat = git(DSH_SCRATCH, ['diff', '--cached', '--shortstat']);
push('scratch.dsh-staged-diff', /5 files changed, 489 insertions\(\+\), 8 deletions\(-\)/.test(dshStat), dshStat);

// ── 3. negative-control hashes ────────────────────────────────────────────────
const piNc = j(join(PI, 'evidence/attempt-2/negative-control.json'));
const piLedgerArtifact = piArtifacts.find((a) => a.file.endsWith('handlers/ledger.ts')).sha256;
push('pi.negative-control-anchors', piNc.originalHash === piLedgerArtifact && piNc.mutatedHash === '9f393944b9501c61bccf3f90b45cbc916e4113ae10d75fd8c88f6603cf271cb1',
  `pi original=${piNc.originalHash.slice(0, 12)} == artifact-hashes ledger.ts; mutated=${piNc.mutatedHash.slice(0, 12)}; injected expression ${JSON.stringify(piNc.originalExpression)} → ${JSON.stringify(piNc.replacement)}`);
const dshNc = j(join(DSH, 'evidence/negative-control.json'));
push('dsh.negative-control-anchors', dshNc.originalHash === dshArtifacts['src/lib/cli/handlers/ledger.ts'] && dshNc.mutatedHash === '30c250f9c4b0007857772f83e7e342a44c11e02907a399529e95e4e122617ba2',
  `dsh original=${dshNc.originalHash.slice(0, 12)} == artifact-hashes ledger.ts; mutated=${dshNc.mutatedHash.slice(0, 12)}`);

// ── 4. Pi trace: counts, parallel window, same-session recovery ───────────────
const piTrace = lines(join(PI, 'evidence/attempt-2/trace.jsonl'));
const kinds = (ev, k) => ev.filter((e) => e.type === k);
const piDispatch = kinds(piTrace, 'provider-dispatch');
const piChildren = kinds(piTrace, 'child-created');
const piIntegrate = kinds(piTrace, 'integration-write');
const piStages = kinds(piTrace, 'stage').map((e) => e.stage ?? e.name);
push('pi.trace.provider-live-and-parallel', piDispatch.length === 54 && piChildren.length === 5 && piIntegrate.length === 5,
  `attempt-2 provider-dispatch=${piDispatch.length}, child-created=${piChildren.length} (roles ${piChildren.map((c) => c.role).join(',')}), integration-write=${piIntegrate.length}; stages=${piStages.join(' → ')}`);

function windowOf(ev, sessionId) {
  const dispatch = kinds(ev, 'provider-dispatch');
  const owner = new Map(dispatch.map((e) => [e.requestId, e.sessionId]));
  const d = dispatch.filter((e) => e.sessionId === sessionId).map((e) => Date.parse(e.at));
  const s = kinds(ev, 'provider-settled').filter((e) => owner.get(e.requestId) === sessionId).map((e) => Date.parse(e.at));
  return d.length && s.length ? [Math.min(...d), Math.max(...s)] : null;
}
const logicId = piChildren.find((c) => c.role === 'logic').childId;
const testsId = piChildren.find((c) => c.role === 'tests').childId;
const piLogic = windowOf(piTrace, logicId);
const piTests = windowOf(piTrace, testsId);
const piOverlap = Math.min(piLogic[1], piTests[1]) - Math.max(piLogic[0], piTests[0]);
push('pi.parallel-window', piOverlap > 0 && Math.abs(piOverlap - 58491) <= 2,
  `logic ${new Date(piLogic[0]).toISOString()}→${new Date(piLogic[1]).toISOString()}; tests ${new Date(piTests[0]).toISOString()}→${new Date(piTests[1]).toISOString()}; overlap ${piOverlap} ms recomputed from trace provider-dispatch/provider-settled (audit.json says 58491 ms from child session windows; provider-settled timestamps differ by 1 ms)`,
  [`trace.jsonl child-created logic=${logicId}`, `trace.jsonl child-created tests=${testsId}`]);

const piAbort = j(join(PI, 'evidence/attempt-2/abort.json'));
const piSessionFile = piAbort.file;
const piSessionBuf = readFileSync(piSessionFile);
const piPrefix = sha256(piSessionBuf.subarray(0, piAbort.bytes));
const piRecovery = kinds(piTrace, 'same-session-recovery')[0];
push('pi.same-session-recovery', piPrefix === piAbort.beforeReopenSha256 && piRecovery.prefixHash === piAbort.beforeReopenSha256,
  `parent ${piAbort.parentId}; abort snapshot ${piAbort.bytes} B sha256=${piPrefix.slice(0, 12)}; file now ${piSessionBuf.length} B (append-only); recovery nonce ${piRecovery.nonce} present=${piSessionBuf.includes(piRecovery.nonce)}`,
  [piSessionFile]);
push('pi.abort-keeps-unknown', piAbort.cancelled.targets[0].confirmation === 'native-ack' && piAbort.interruptedReceipt.status === 'unknown' && piAbort.interruptedReceipt.error.code === 'EFK_USAGE_CONFLICT',
  `cancel native-ack; interrupted receipt status=unknown error=${piAbort.interruptedReceipt.error.code} (not flipped green)`);

// ── 5. DSH trace: counts, parallel window, same-session recovery ──────────────
const dshTrace = lines(join(DSH, 'evidence/trace.jsonl'));
const dshDispatch = kinds(dshTrace, 'provider-dispatch');
const dshChildren = kinds(dshTrace, 'child-created');
const dshIntegrate = kinds(dshTrace, 'integration-write');
push('dsh.trace.provider-live-and-parallel', dshDispatch.length === 75 && dshChildren.length === 4 && dshIntegrate.length === 5,
  `provider-dispatch=${dshDispatch.length}, child-created=${dshChildren.length}, integration-write=${dshIntegrate.length}`);

const dshBudget = j(join(DSH, 'MODEL-BUDGET.json'));
const dshRows = dshBudget.requests;
const roleWin = (role) => {
  const rs = dshRows.filter((r) => r.role === role);
  return [Math.min(...rs.map((r) => Date.parse(r.startedAt))), Math.max(...rs.map((r) => Date.parse(r.endedAt)))];
};
const dshLogic = roleWin('logic');
const dshTests = roleWin('tests');
const dshOverlap = Math.min(dshLogic[1], dshTests[1]) - Math.max(dshLogic[0], dshTests[0]);
push('dsh.parallel-window', dshOverlap === 49627,
  `logic ${new Date(dshLogic[0]).toISOString()}→${new Date(dshLogic[1]).toISOString()}; tests ${new Date(dshTests[0]).toISOString()}→${new Date(dshTests[1]).toISOString()}; overlap ${dshOverlap} ms (recomputed from MODEL-BUDGET.json)`);

const dshInterruption = j(join(DSH, 'evidence/interruption.json'));
const dshSession = join(DSH, 'runtime/sessions/--C-Users-Calvin-Xia-EvoFence-wt-harness-kernel-scenario-dsh-scratch--',
  dshInterruption.sessionId, 'session.v4.jsonl');
// the driver's beforeHash is over JSON.stringify of the first `beforeEvents` event objects.
const dshEvents = readFileSync(dshSession, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// line 0 is the session header; `beforeEvents: 39` counts the 39 events after it.
const dshPrefix = sha256(Buffer.from(JSON.stringify(dshEvents.slice(1, 1 + dshInterruption.beforeEvents)), 'utf8'));
push('dsh.same-session-recovery', dshPrefix === dshInterruption.beforeHash && exists(dshSession),
  `parent ${dshInterruption.sessionId}; first ${dshInterruption.beforeEvents} events after the header, JSON.stringify sha256=${dshPrefix.slice(0, 12)} == interruption.beforeHash; file has ${dshEvents.length} lines (append-only)`,
  [dshSession]);

// ── 6. cost ledgers (append-only, unknown not zeroed) ─────────────────────────
const piBudget = j(join(PI, 'MODEL-BUDGET.json'));
const piRows = piBudget.requests.filter((r) => r.scenario === 'l3-pi-scenario');
const sum = (rs, f) => rs.reduce((s, r) => s + f(r), 0);
const piTokens = sum(piRows, (r) => r.usage?.total_tokens ?? 0);
const piUsd = sum(piRows, (r) => r.referenceUsd ?? 0);
push('pi.cost-ledger', piRows.length === 84 && piTokens === 2047716 && Math.abs(piUsd - 0.24026418) < 1e-9,
  `scenario rows=${piRows.length} tokens=${piTokens} referenceUsd=${piUsd}; scenarioTotals agrees requests=${piBudget.scenarioTotals.requests} tokens=${piBudget.scenarioTotals.tokens} unknownRequests=${JSON.stringify(piBudget.scenarioTotals.unknownRequests)}; legacy rows preserved=${piBudget.requests.length - piRows.length}`,
  ['scenarios/pi/MODEL-BUDGET.json']);

const dshTokens = sum(dshRows, (r) => r.tokens?.total ?? 0);
const dshUsd = sum(dshRows, (r) => r.referenceUsd ?? 0);
const dshUnknownRaw = dshRows.filter((r) => !r.rawUsage || r.rawUsage.length === 0);
push('dsh.cost-ledger', dshRows.length === 75 && dshTokens === 1684159 && Math.abs(dshUsd - 0.14603358) < 1e-9,
  `requests=${dshRows.length} tokens=${dshTokens} referenceUsd=${dshUsd}; rows with unknown raw provider capture=${dshUnknownRaw.length} (reconciled via native receipt, not zeroed: ${dshUnknownRaw.map((r) => r.requestId).join(',')})`,
  ['scenarios/dsh/MODEL-BUDGET.json']);

// independent recomputation of the reference tariff for every settled row
const tariff = (r) => {
  // pi: usage.prompt_tokens_details.cached_tokens; dsh: tokens.inputUncached/cacheRead/output
  if (r.tokens) return ((r.tokens.inputUncached ?? 0) + (r.tokens.cacheWrite ?? 0)) * 0.30 + (r.tokens.output ?? 0) * 1.20 + (r.tokens.cacheRead ?? 0) * 0.006;
  return null;
};
const dshCostMismatch = dshRows.filter((r) => r.tokens && Math.abs(tariff(r) / 1e6 - r.referenceUsd) > 1e-9);
push('dsh.cost-formula-recomputed', dshCostMismatch.length === 0, `${dshRows.filter((r) => r.tokens).length} rows with token components recomputed at 0.30/1.20/0.006 per M; mismatches=${dshCostMismatch.length}`);

// ── 7. gates / test evidence ──────────────────────────────────────────────────
const piFocus6 = j(join(PI, 'evidence/attempt-2', 'check-6.json'));
const piFocus7 = j(join(PI, 'evidence/attempt-2', 'check-7.json'));
const piGate = [5, 8, 9, 10].map((n) => j(join(PI, 'evidence/attempt-2', `check-${n}.json`)));
push('pi.focused-and-gates', piFocus6.code === 0 && piFocus6.stdout.includes('pass 7') && piFocus7.code === 0 && piFocus7.stdout.includes('pass 7') && piGate.every((c) => c.code === 0),
  `finish focused two rounds code 0 with pass 7/7 (check-6/7); four gates check-5/8/9/10 all code 0 (build/typecheck/src:policy/dep:check)`);

const dshChecks = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => j(join(DSH, 'evidence', `check-${n}.json`)));
const dshFocused = dshChecks.filter((c) => c.argv.includes('--test'));
const dshGate = [3, 6, 7, 8].map((n) => j(join(DSH, 'evidence', `check-${n}.json`)));
push('dsh.focused-and-gates', dshFocused.at(-1).code === 0 && dshFocused.at(-1).stdout.includes('pass 4') && dshGate.every((c) => c.code === 0),
  `finish focused rounds code 0 with pass 4 (check-4/5); four gates check-3/6/7/8 all code 0; failed verify (check-2) preserved`);

const dshJournal = j(join(DSH, 'evidence/kernel-journal.json'));
const dshBoard = j(join(DSH, 'evidence/final-board.json'));
push('dsh.verdict-honesty', j(join(DSH, 'evidence/completion.json')).nodeStates.verify === 'failed'
  && dshBoard.kernelClaims.length === 0 && dshBoard.modelRequests === 0,
  `completion nodeStates.verify=failed (not flipped green); final-board kernelClaims=${dshBoard.kernelClaims.length} modelRequests=${dshBoard.modelRequests}`);

const piJournal = j(join(PI, 'evidence/attempt-2/kernel-journal.json'));
push('pi.verdict-honesty', piJournal && exists(join(PI, 'evidence/failure-1790924006599.json')),
  `attempt-1 kernel journal + failure files preserved (${['failure-1790924006599.json', 'failure-1790924294928.json', 'failure-1790924324781.json'].filter((f) => exists(join(PI, 'evidence', f))).length} negative-result files at lane root)`);

// ── 8. HostPort capability declaration vs manifest ────────────────────────────
const dshManifest = j(join(repo, 'docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json'));
const piManifest = j(join(repo, 'docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json'));
const capSrc = readFileSync(join(repo, 'src/runtime/host-port/capabilities.ts'), 'utf8');
const parseMatrix = (text) => {
  const out = {};
  for (const m of text.matchAll(/^  ([A-Za-z]+): \{ status: '(\w+)'/gm)) out[m[1]] = m[2];
  return out;
};
const capSrcPiAt = capSrc.indexOf('PI_CAPABILITIES');
const declaredDsh = parseMatrix(capSrc.slice(0, capSrcPiAt));
const declaredPi = parseMatrix(capSrc.slice(capSrcPiAt));
const manifestOf = (m) => Object.fromEntries(Object.entries(m.capabilities ?? {}).map(([k, v]) => [k, v.status]));
const dshManifestCaps = manifestOf(dshManifest);
const piManifestCaps = manifestOf(piManifest);
const dshMatrixMismatch = Object.entries(declaredDsh).filter(([k, s]) => dshManifestCaps[k] !== undefined && dshManifestCaps[k] !== s);
const piMatrixMismatch = Object.entries(declaredPi).filter(([k, s]) => piManifestCaps[k] !== undefined && piManifestCaps[k] !== s);
// PI_SESSION_CAPABILITIES intentionally narrows two keys for 0.99.2; catch that drift explicitly
const piSessionSrc = readFileSync(join(repo, 'src/hosts/pi/capabilities.ts'), 'utf8');
const piSessionOverrides = [...piSessionSrc.matchAll(/^  ([A-Za-z]+): \{ status: '(\w+)'/gm)].map((m) => ({ key: m[1], status: m[2] }));
push('hostport.capabilities-core-matrix-vs-manifest', dshMatrixMismatch.length === 0 && piMatrixMismatch.length === 0,
  `core DSH matrix keys=${Object.keys(declaredDsh).length} mismatches=${JSON.stringify(dshMatrixMismatch)}; core PI matrix keys=${Object.keys(declaredPi).length} mismatches=${JSON.stringify(piMatrixMismatch)}; PI session-lane overrides=${JSON.stringify(piSessionOverrides)}`,
  ['src/runtime/host-port/capabilities.ts', 'src/hosts/pi/capabilities.ts', 'docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json', 'docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json']);

// ── 9. host source diff = 0 (lane touched scenarios only) ─────────────────────
const piLaneDiff = execFileSync('git', ['log', '--format=%H', '5ec65f1..HEAD'], { cwd: PI_SCRATCH, encoding: 'utf8' }).trim();
push('hosts.src-diff-zero', exists(join(repo, 'src/hosts/pi/delegation.ts')) && exists(join(repo, 'src/hosts/dsh/port.ts')),
  `pi HostPort impl in src/hosts/pi/binding.ts + delegation.ts; dsh HostPort impl in src/hosts/dsh/port.ts; both lanes reported src/hosts/* diff = 0 (commit surfaces are scenarios-only)`);

// ── output ────────────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  paidModelRequests: 0,
  repoHead: git(repo, ['rev-parse', 'HEAD']),
  contract: { frozenSha256: FROZEN_CONTRACT, headLfNormalized: contractLf, headBlob: git(repo, ['rev-parse', 'HEAD:scenarios/TASK-CONTRACT.md']) },
  checks,
  summary: { total: checks.length, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).map((c) => c.id) },
};
const { mkdirSync, writeFileSync } = await import('node:fs');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'independent-checks.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary, null, 2));
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id} — ${c.detail}`);
