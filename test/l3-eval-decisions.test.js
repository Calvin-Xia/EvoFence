import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, value, schema } from './l3-eval-fixtures.test.js';
import { canonical } from '../dist/storage/index.js';

test('cp2 tests, outcome and artifact integrity combine conjunctively; failures cannot average out', () => {
  for (const options of [
    { tests: { total: 10, passed: 9, failed: 1, skipped: 0, exitCode: 1 } },
    { outcomes: { outcomes: [{ outcomeId: 'out-1', met: false }] } },
  ]) {
    const f = fixture(options), result = value(f.evaluate());
    assert.equal(result.decision.outcome, 'failed');
    f.context.repairAllowed = true;
    assert.equal(value(f.evaluate()).decision.outcome, 'repair');
  }
  const zero = fixture({ tests: { total: 0, passed: 0, failed: 0, skipped: 0, exitCode: 0 } });
  assert.equal(value(zero.evaluate()).decision.outcome, 'unknown');
  assert.equal(value(fixture({ product: '' }).evaluate()).decision.outcome, 'unknown');
});

test('cp2 every declared outcome needs its own observation and accepted artifact kind/schema', () => {
  const f = fixture({ task: { requiredOutcomes: [
    { outcomeId: 'out-1', description: 'first', schema: schema('Deliverable'), evidenceKinds: ['native-fixture'] },
    { outcomeId: 'out-2', description: 'second', schema: schema('OtherDeliverable'), evidenceKinds: ['native-disk'] },
  ] } });
  const result = value(f.evaluate());
  assert.equal(result.decision.outcome, 'unknown');
  assert.ok(result.gaps.some(g => g.gapReason === 'outcomes-incomplete'));
  assert.ok(result.gaps.some(g => g.gapReason === 'outcome-artifact-missing'));
});

test('cp2 missing required branch stays explicit and never grants completion', () => {
  const f = fixture({ branches: ['nA', 'nB'] }); f.branch('nA');
  const result = value(f.evaluate());
  assert.equal(result.decision.outcome, 'unknown');
  assert.deepEqual(result.report.branchReport.map(b => b.nodeId), ['nA', 'nB']);
  assert.equal(result.report.branchReport[1].gapReason, 'branch-missing');
  assert.equal(result.report.branchReport[1].binding, null);
});

test('cp2 bound succeeded branches with actual products and registered decisions complete', () => {
  const f = fixture({ branches: ['nA', 'nB'] }); f.branch('nA'); f.branch('nB');
  const result = value(f.evaluate());
  assert.equal(result.decision.outcome, 'completed');
  assert.ok(result.report.branchReport.every(b => b.gapReason === null));
});

test('cp2 failed and cancelled branches are retained and use explicit repair policy', () => {
  for (const state of ['failed', 'cancelled']) {
    const f = fixture({ branches: ['nA'] }); f.branch('nA', { state });
    const result = value(f.evaluate());
    assert.equal(result.decision.outcome, 'failed');
    assert.equal(result.report.branchReport[0].state, state);
    assert.equal(result.report.branchReport[0].gapReason, `branch-state-${state}`);
    f.context.repairAllowed = true;
    assert.equal(value(f.evaluate()).decision.outcome, 'repair');
  }
});

test('cp2 duplicate, unexpected and stale branches cannot wash fan-in gaps into success', () => {
  for (const mutation of ['duplicate', 'unexpected', 'stale', 'no-product', 'no-decision']) {
    const f = fixture({ branches: ['nA'] }); const b = f.branch('nA');
    if (mutation === 'duplicate') f.report.branchReport.push({ ...b, gapReason: 'second-claim' });
    if (mutation === 'unexpected') f.branch('nB');
    if (mutation === 'stale') b.binding = { ...b.binding, epoch: 2 };
    if (mutation === 'no-product') b.artifactRefs = [];
    if (mutation === 'no-decision') b.decisionRef = null;
    assert.equal(value(f.evaluate()).decision.outcome, 'unknown', mutation);
  }
});

test('cp2 succeeded state cannot substitute for a registered branch decision', () => {
  const f = fixture({ branches: ['nA'] }), b = f.branch('nA');
  const forged = f.put('forged', 'DecisionRecord', { ...JSON.parse(f.context.evidence.find(e => e.ref.id === b.decisionRef.id).bytes),
    issuer: { actorId: 'worker', kind: 'host-adapter', identityRef: null } }, { binding: b.binding });
  b.decisionRef = forged;
  assert.equal(value(f.evaluate()).decision.outcome, 'unknown');
});

test('cp2 required branch products need actual bound run output as well as the decision', () => {
  const f = fixture({ branches: ['nA'] }), b = f.branch('nA');
  b.artifactRefs = b.artifactRefs.filter(r => r.schema.name !== 'Receipt');
  const result = value(f.evaluate());
  assert.equal(result.decision.outcome, 'unknown');
  assert.ok(result.report.branchReport[0].gapReason !== null);
});

test('cp2 production statuses distinguish human wait, unknown telemetry and confirmed failure', () => {
  for (const [runStatus, outcome] of [['needs-human', 'needs-human'], ['unknown', 'unknown'],
    ['usage_incomplete', 'unknown'], ['incomplete', 'failed'], ['timeout', 'failed'], ['cancelled', 'failed']]) {
    assert.equal(value(fixture({ report: { runStatus } }).evaluate()).decision.outcome, outcome, runStatus);
  }
  assert.equal(value(fixture({ report: { usageComplete: false } }).evaluate()).decision.outcome, 'unknown');
  assert.equal(value(fixture({ report: { privacyChecked: false } }).evaluate()).decision.outcome, 'unknown');
});

test('cp2 workspace tasks require an actual nonempty base-bound diff', () => {
  const f = fixture();
  f.task.scope.workspaceRef = f.product;
  f.report.contractRef.digest = f.context.digest.digest(canonical(f.task));
  assert.equal(value(f.evaluate()).decision.outcome, 'unknown');
  f.report.actualDiffRef = f.put('diff', 'ActualDiff', '@@ actual base diff @@');
  assert.equal(value(f.evaluate()).decision.outcome, 'completed');
});
