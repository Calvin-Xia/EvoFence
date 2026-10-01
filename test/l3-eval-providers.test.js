import test from 'node:test';
import assert from 'node:assert/strict';
import { decode } from '../dist/protocol/index.js';
import { createTaskEvaluator } from '../dist/kernel/evaluation/index.js';
import { fixture, registration, value, issuer } from './l3-eval-fixtures.test.js';

test('cp1 ordinary task completes from registered observations without a baseline', () => {
  const f = fixture(), before = structuredClone(f.report), result = value(f.evaluate());
  assert.equal(result.decision.outcome, 'completed');
  assert.equal(f.task.acceptance.baselineRequired, false);
  assert.equal(result.decision.evaluationReceiptRef, null);
  assert.equal(result.decision.capabilityJudgement, null);
  assert.deepEqual(result.decision.issuer, issuer);
  assert.equal(value(decode('DecisionRecord', result.decision)).kind, 'task');
  assert.equal(result.measurements.find(m => m.metric === 'tests').passRate, 1);
  assert.deepEqual(f.report, before, 'evaluation must not overwrite source observations');
  assert.deepEqual(value(f.evaluate()), result, 'pure repeated evaluation is deterministic');
  assert.deepEqual(value(createTaskEvaluator(registration(), f.context).evaluateTask(f.task, f.report)), result.decision);
});

test('cp1 provider registration, version and selection are explicit', () => {
  const f = fixture();
  assert.equal(f.evaluate(registration({ selected: ['not-registered'] })).error.code, 'EFK_DECISION_AUTHORITY_DENIED');
  assert.equal(f.evaluate(registration({ version: '2' })).error.code, 'EFK_DECISION_AUTHORITY_DENIED');
  assert.equal(f.evaluate(registration({ selected: ['tests', 'tests'] })).error.code, 'EFK_DECISION_AUTHORITY_DENIED');
  const absent = value(f.evaluate(registration({ selected: [] })));
  assert.equal(absent.decision.outcome, 'unknown');
  assert.ok(absent.gaps.some(g => g.gapReason === 'tests-provider-missing'));
});

test('cp1 empty summary and self-declared completion cannot satisfy real measurements', () => {
  for (const bytes of ['', 'I completed every check and outcome.']) {
    const f = fixture();
    const summary = f.put('summary', 'AgentSummary', bytes);
    f.report.artifactRefs = [summary];
    const result = value(f.evaluate());
    assert.equal(result.decision.outcome, 'unknown');
    assert.ok(result.gaps.some(g => g.gapReason === 'tests-evidence-missing'));
    assert.equal(result.report.requiredOutcomesMet, null);
    assert.equal(result.report.privateTestsPassed, null);
  }
});

test('cp1 unregistered producer cannot make an outcome claim authoritative', () => {
  const f = fixture();
  const claim = f.put('claim', 'OutcomeObservation', { outcomes: [{ outcomeId: 'out-1', met: true }] },
    { producer: { actorId: 'worker', kind: 'host-adapter', identityRef: null } });
  f.report.artifactRefs = [f.tests, claim, f.product];
  assert.equal(value(f.evaluate()).decision.outcome, 'unknown');
});

test('cp1 malformed counts and summary-shaped test results fail the observation boundary', () => {
  for (const tests of [{ total: 2, passed: 2, failed: 1, skipped: 0, exitCode: 0 }, { summary: 'done', passed: true }, '']) {
    assert.equal(fixture({ tests }).evaluate().error.code, 'EFK_SCHEMA_INVALID');
  }
});

test('cp1 measurement bytes and full attempt binding must match the consumer', () => {
  const f = fixture();
  f.context.evidence[0].bytes = 'tampered';
  assert.equal(f.evaluate().error.code, 'EFK_ARTIFACT_DIGEST_MISMATCH');
  for (const patch of [{ epoch: 2 }, { attemptOrdinal: 2 }, { baseDigest: null }, { hostSessionId: 'wrong-host' }]) {
    const stale = fixture();
    stale.report.binding = { ...stale.report.binding, ...patch };
    assert.equal(stale.evaluate().error.code, 'EFK_ARTIFACT_BINDING_MISMATCH');
  }
});

test('cp1 pinned contract digest rejects substituted task goals', () => {
  const f = fixture(); f.task.goal = 'substituted requirement';
  assert.equal(f.evaluate().error.code, 'EFK_ARTIFACT_BINDING_MISMATCH');
});
