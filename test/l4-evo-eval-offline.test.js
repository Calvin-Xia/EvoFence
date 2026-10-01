import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { canonical, storeOk } from '../dist/kernel/store/index.js';
import { fixture, unwrap } from './l4-evo-eval-fixtures.test.js';
import { revisionDigest } from '../dist/learning/assets/index.js';

test('real offline measurements: fresh Node process runs actual coding artifacts/private checks; no unseen claim', t => {
  const f = fixture({ n: 6, confirmatory: false, budget: false });
  const temporary = mkdtempSync(join(tmpdir(), 'evofence-l4-offline-'));
  t.after(() => {
    const resolved = realpathSync(temporary);
    assert.equal(dirname(resolved), realpathSync(tmpdir())); assert.ok(basename(resolved).startsWith('evofence-l4-offline-'));
    rmSync(resolved, { recursive: true });
  });
  const base = 'const sum = xs => null;\n', basePath = join(temporary, 'base.js'); writeFileSync(basePath, base);
  f.plan.baseDigest = f.ports.digest.digest(base); f.revision.compatibility.repositories[0].baseDigest = f.plan.baseDigest;
  f.revision.candidate.asset.digest = revisionDigest(f.revision, f.ports.digest);
  const code = {
    A: 'const sum = xs => xs.reduce((a, b) => a + b, 0);',
    B: 'const sum = xs => xs.reduce((a, b) => a + Number(b), 0);',
  };
  const diffs = {};
  for (const [i, arm] of ['A', 'B'].entries()) {
    const file = join(temporary, `opaque-${i}.js`); writeFileSync(file, code[arm]); code[arm] = readFileSync(file, 'utf8');
    const diff = spawnSync('git', ['diff', '--no-index', '--', basePath, file], { encoding: 'utf8' });
    assert.equal(diff.error, undefined); assert.equal(diff.status, 1); assert.match(diff.stdout, /@@/);
    // Keep actual hunks, remove filesystem/arm metadata before presenting them to the blind verifier.
    diffs[arm] = diff.stdout.replace(/^diff --git .*$/gm, 'diff --git a/program.js b/program.js')
      .replace(/^--- .*$/gm, '--- a/program.js').replace(/^\+\+\+ .*$/gm, '+++ b/program.js');
  }
  const samples = f.samples.map((s, i) => ({ ...s,
    baseDigest: f.plan.baseDigest,
    contractRef: f.artifact('Return the numeric sum of numeric strings; preserve numeric input behavior.', 'BehaviorContract', { partition: 'dev' }),
    privateTestsRef: f.artifact(`import assert from 'node:assert/strict'; assert.equal(sum(['${i}', '2']), ${i + 2}); assert.equal(sum([3, 4]), 7);`,
      'PrivateTests', { partition: 'dev', visibility: 'private' }) }));
  f.plan.dataSplitRefs = [f.artifact(canonical({ partition: 'dev', samples }), 'DataSplit', { partition: 'dev', visibility: 'private' })];
  const observed = [];
  f.ports.verifier.version = 'offline-node-private-checks-1';
  f.ports.verifier.verify = input => {
    const execution = spawnSync(process.execPath, ['--input-type=module', '-e', `${input.artifacts[0]}\n${input.privateTests}`], { encoding: 'utf8', timeout: 10000 });
    assert.equal(execution.error, undefined); const passed = execution.status === 0;
    const output = { opaqueId: input.opaqueId, status: execution.status, stdout: execution.stdout, stderr: execution.stderr };
    observed.push({ ...output, outputHash: f.ports.digest.digest(canonical(output)),
      programDigest: f.ports.digest.digest(input.artifacts[0]), checksDigest: f.ports.digest.digest(input.privateTests) });
    return storeOk({ privateTestsPassed: passed, outcomesMet: passed,
      branches: input.requiredBranches.map(id => ({ id, passed })), qualityScore: passed ? 80 : null, qualityReliable: true,
      evidenceRefs: [f.artifact(canonical(output), 'ActualNodeOutput', { producer: f.verifierIssuer, partition: 'dev', visibility: 'private' })],
      usage: [], requestIds: [] });
  };
  const reg = f.register();
  for (const sample of samples) for (const arm of ['A', 'B']) {
    const first = f.run(reg, sample, arm, f.hostBindings[0], 'trial-1', 7); f.inventory.pop();
    const binding = first.run.actualDiffRef.binding;
    const replacement = f.run(reg, sample, arm, f.hostBindings[0], 'trial-1', 7, {
      artifactRefs: [f.artifact(code[arm], 'ActualJavaScript', { producer: f.author, binding, partition: 'dev' })],
      actualDiffRef: f.artifact(diffs[arm], 'ActualDiff', { producer: f.author, binding, partition: 'dev' }),
      usage: [] });
    f.requests.set(replacement.ref.id, []); // Actual local subprocesses made zero provider requests.
  }
  const evaluation = unwrap(f.evaluate(reg)), a = f.analysis(evaluation);
  assert.equal(a.metrics.control.successes, 0); assert.equal(a.metrics.treatment.successes, 6);
  assert.equal(a.statistics.n, 6); assert.equal(a.statistics.delta, 1); assert.equal(evaluation.benefitClaimAllowed, false);
  assert.equal(evaluation.decision.outcome, 'inconclusive'); assert.equal(observed.filter(x => x.status === 0).length, 6);
  const evidence = { evidenceKind: 'real-offline', corpus: 'six dev instances of numeric string addition', paidRequests: 0,
    baseDigest: f.plan.baseDigest, actualGitDiffs: diffs,
    observations: observed, analysis: { n: a.statistics.n, delta: a.statistics.delta, metrics: a.metrics, statistical: a.statistical },
    verdict: evaluation.decision.outcome, benefitClaimAllowed: evaluation.benefitClaimAllowed,
    limitations: ['Small dev sample; no held-out data', 'No provider/host session trial', 'same-user subprocess, no OS sandbox', 'No authorized trial budget or signed T0'] };
  const folder = new URL('../src/evaluation/evolution/evidence/', import.meta.url);
  mkdirSync(folder, { recursive: true }); writeFileSync(new URL('offline.json', folder), `${JSON.stringify(evidence, null, 2)}\n`);
});
test('statistics use stratified paired SE/MVE, 10000 draws, BCa and the frozen formula; seed affects draws only', () => {
  const f = fixture(), reg = f.register(); f.populate(reg);
  const a = f.analysis(unwrap(f.evaluate(reg))), s = a.statistics;
  assert.equal(s.n, 160); assert.equal(s.n01, 48); assert.equal(s.n10, 0); assert.equal(s.delta, 0.3);
  // Independent analytic variance for the fixed fixture strata: .16*(.25*.75)/64 + .1225*(4/7*3/7)/56.
  const analyticSe = Math.sqrt(0.16 * 0.25 * 0.75 / 64 + 0.1225 * (4 / 7) * (3 / 7) / 56);
  assert.ok(Math.abs(s.se - analyticSe) < 0.001); assert.equal(s.zMve, (0.3 - 0.15) / s.se);
  assert.ok(s.bca95[0] < 0.3 && s.bca95[1] > 0.3); assert.ok(Math.abs(s.conditionalPower - 0.93372) < 0.0001);
  assert.equal(s.exactMcNemarP, 2 ** -47); assert.ok(s.scoreNullSe > 0); assert.equal(s.bcaMvePositive, true);
  const g = fixture(); g.plan.bootstrapSeed = 999; const r = g.register(); g.populate(r); const other = g.analysis(unwrap(g.evaluate(r)));
  assert.notEqual(other.statistics.bootstrapDigest, s.bootstrapDigest); assert.equal(other.statistics.delta, s.delta);
});
