import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackFor } from '../dist/kernel/evaluation/index.js';
import { readArtifact } from '../dist/kernel/artifacts/index.js';
import { fixture, value, issuer } from './l3-eval-fixtures.test.js';

test('cp3 private failure feedback never carries evaluator refs, locators, digests or test details', () => {
  const f = fixture({ tests: { total: 4, passed: 3, failed: 1, skipped: 0, exitCode: 1 } });
  const result = value(f.evaluate());
  for (const audience of ['author', 'report', 'asset-staging']) {
    const feedback = value(feedbackFor(result, audience)), serialized = JSON.stringify(feedback);
    assert.equal(feedback.outcome, 'failed');
    assert.equal(feedback.gaps[0].gapReason, 'restricted-acceptance-unmet');
    assert.match(feedback.gaps[0].repair, /public task contract/);
    for (const token of [f.tests.id, f.tests.digest, f.tests.location, 'TestsObservation', issuer.actorId, 'tests-failed']) {
      assert.equal(serialized.includes(token), false, token);
    }
  }
  assert.ok(value(feedbackFor(result, 'evaluator')).gaps[0].refs.some(r => r.id === f.tests.id));
  value(f.artifacts.put(result.decision.taskEvidenceRef, result.reportBytes));
  assert.equal(readArtifact(result.decision.taskEvidenceRef, 'author', 1000, f.artifacts).error.code, 'EFK_PRIVACY_VIOLATION');
});

test('cp3 public repair feedback points at the observed outcome failure and concrete action', () => {
  const f = fixture({ outcomes: { outcomes: [{ outcomeId: 'out-1', met: false }] } });
  f.context.repairAllowed = true;
  const feedback = value(feedbackFor(value(f.evaluate()), 'author'));
  assert.equal(feedback.outcome, 'repair');
  assert.equal(feedback.gaps[0].gapReason, 'outcomes-failed');
  assert.equal(feedback.gaps[0].refs[0].id, f.outcomes.id);
  assert.match(feedback.gaps[0].repair, /every declared outcome/);
});

test('cp3 source partition gates feedback even if a final result is labelled public', () => {
  const f = fixture({ outcomes: { outcomes: [{ outcomeId: 'out-1', met: false }] } });
  const final = f.put('final-secret-marker', 'OutcomeObservation', { outcomes: [{ outcomeId: 'out-1', met: false }] },
    { producer: issuer, visibility: 'public', partition: 'final' });
  f.report.artifactRefs = [f.tests, final, f.product];
  const view = value(feedbackFor(value(f.evaluate()), 'author'));
  assert.equal(view.gaps[0].gapReason, 'restricted-acceptance-unmet');
  assert.equal(JSON.stringify(view).includes(final.id), false);
});

test('cp3 private test observations cannot be mislabeled as author-visible artifacts', () => {
  const f = fixture();
  const leaked = f.put('public-private-tests', 'TestsObservation', { total: 1, passed: 1, failed: 0, skipped: 0, exitCode: 0 },
    { producer: issuer, visibility: 'internal', partition: 'dev' });
  f.report.artifactRefs = [leaked, f.outcomes, f.product];
  assert.equal(f.evaluate().error.code, 'EFK_PRIVACY_VIOLATION');
});
