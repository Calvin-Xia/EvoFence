import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../dist/kernel/store/index.js';
import { decode } from '../dist/protocol/index.js';
import { emptyRegistry, stageRevision, recordDecision } from '../dist/learning/assets/index.js';
import { createEvolutionEvaluator } from '../dist/evaluation/evolution/index.js';
import { fixture, unwrap, actor, hash } from './l4-evo-eval-fixtures.test.js';

test('DoD1 budget-missing blocks benefit and promotion despite apparently excellent results', () => {
  const f = fixture({ budget: false }), reg = f.register(); f.populate(reg);
  const e = unwrap(f.evaluate(reg)); assert.equal(e.benefitClaimAllowed, false);
  assert.equal(e.receipt.requiredJudgements[0].verdict, 'inconclusive'); assert.ok(e.reasons.includes('budget-missing'));
  assert.equal(f.service.evaluationForPromotion(e, 20).error.code, 'EFK_EVALUATION_INSUFFICIENT');
});
test('DoD1 insufficient-samples cannot become positive or qualify for promotion', () => {
  const f = fixture(), reg = f.register(); f.populate(reg, () => ({}), 100);
  const e = unwrap(f.evaluate(reg)); assert.equal(e.receipt.requiredJudgements[0].verdict, 'exploratory_only');
  assert.equal(e.benefitClaimAllowed, false); assert.equal(f.service.evaluationForPromotion(e, 20).ok, false);
});
test('DoD1 uncertain measurements block a directional conclusion', () => {
  const f = fixture(), reg = f.register(), verifier = f.ports.verifier.verify;
  f.ports.verifier.verify = input => { const result = verifier(input); result.value.outcomesMet = null; return result; };
  f.populate(reg); const e = unwrap(f.evaluate(reg));
  assert.equal(e.receipt.requiredJudgements[0].verdict, 'inconclusive'); assert.equal(e.benefitClaimAllowed, false);
  assert.ok(e.reasons.includes('measurement-uncertain'));
});
test('cp2 same seeds replay identically; different seeds/trials are retained and never chosen by their best result', () => {
  const f = fixture({ seeds: [7, 8], trials: ['cheap-1', 'cheap-2'] }), reg = f.register(); f.populate(reg);
  const a = unwrap(f.evaluate(reg)), b = unwrap(f.evaluate(reg));
  assert.equal(canonical(a), canonical(b)); assert.equal(a.receipt.requiredJudgements.length, 4);
  const analyses = a.receipt.requiredJudgements.map(j => JSON.parse(unwrap(f.ports.artifacts.get(j.analysisRef))));
  assert.deepEqual(analyses.map(a => [a.trialId, a.seed]), [['cheap-1', 7], ['cheap-1', 8], ['cheap-2', 7], ['cheap-2', 8]]);
  assert.notEqual(analyses[0].observedRuns[0].seed, analyses[1].observedRuns[0].seed);
});
test('cp2 discordance floor and ci-spans-mve prevent point-estimate success claims', () => {
  for (const cutoff of [60, 77]) {
    const f = fixture(), reg = f.register();
    f.populate(reg, ({ sample, arm }) => {
      if (arm !== 'B') return {};
      const i = Number(sample.instanceId.split('-')[1]), binding = { sessionId: `override-${i}`, hostSessionId: null,
        graph: { graphId: 'g', revision: 1, digest: hash('graph') }, nodeId: 'w', attemptId: 'a', attemptOrdinal: 1, epoch: 1, baseDigest: sample.baseDigest };
      return { artifactRefs: [f.artifact(canonical({ passes: i < cutoff }), 'Program', { binding, partition: 'held-out' })],
        actualDiffRef: f.artifact(`diff ${i}`, 'ActualDiff', { binding, partition: 'held-out' }) };
    });
    const e = unwrap(f.evaluate(reg)); assert.equal(e.receipt.requiredJudgements[0].verdict, 'inconclusive');
    assert.ok(e.reasons.includes(cutoff === 60 ? 'discordance-floor' : 'ci-spans-mve'));
  }
});
test('cp2 quality is secondary; cost/wall/stability guardrails remain conjunctive with statistical positive', () => {
  for (const changed of ['quality', 'cost', 'wall', 'stability']) {
    const f = fixture(), reg = f.register(), verify = f.ports.verifier.verify;
    if (changed === 'quality') f.ports.verifier.verify = input => { const v = verify(input); v.value.qualityReliable = false; return v; };
    f.populate(reg, ({ sample, arm, host, trial, seed }) => arm !== 'B' ? {} : changed === 'cost'
      ? { usage: [f.usage(`request:${trial}:${seed}:${host.hostId}:${sample.instanceId}:${arm}`, { estimatedUsdMicros: 1000 })] }
      : changed === 'wall' ? { wallMs: 1800 }
      : changed === 'stability' && Number(sample.instanceId.split('-')[1]) >= 130 ? { status: 'incomplete' } : {});
    const e = unwrap(f.evaluate(reg)), j = e.receipt.requiredJudgements[0];
    assert.equal(j.verdict, 'positive');
    if (changed === 'quality') {
      assert.equal(e.benefitClaimAllowed, true); assert.equal(f.analysis(e).metrics.treatment.qualityStatus, 'inconclusive');
    } else {
      assert.equal(e.benefitClaimAllowed, false); assert.equal(f.service.evaluationForPromotion(e, 20).ok, false);
      assert.equal(j[{ cost: 'guardrailCost', wall: 'guardrailWall', stability: 'guardrailTruncation' }[changed]], 'failed');
    }
  }
});
test('cp2 futility look continues or stops without efficacy; offline/dev/draft remains exploratory', () => {
  const f = fixture(), reg = f.register(); f.populate(reg, () => ({}), 80);
  const e = unwrap(f.evaluate(reg)); assert.equal(e.receipt.requiredJudgements[0].look, 'FUTILITY_LOOK');
  assert.equal(e.benefitClaimAllowed, false); assert.equal(f.analysis(e).statistical.continueSampling, true);
  const g = fixture({ confirmatory: false }), registered = g.register(); g.populate(registered);
  const dev = unwrap(g.evaluate(registered)); assert.equal(dev.receipt.requiredJudgements[0].verdict, 'exploratory_only');
  assert.equal(dev.benefitClaimAllowed, false);
});
test('cp2 per-host fixed B-A -> C-B sequence cannot let a good host cancel a blocked host', () => {
  const f = fixture({ hosts: 2, comparisons: ['B-A', 'C-B'] }); f.plan.hosts[1].cellStatus = 'capability_absent';
  const reg = f.register(); f.populate(reg); const e = unwrap(f.evaluate(reg));
  assert.deepEqual(e.receipt.requiredJudgements.map(j => j.verdict), ['positive', 'positive', 'blocked', 'exploratory_only']);
  assert.equal(e.benefitClaimAllowed, false);
});
test('cp3 selection-bias negative control: all cheap trials are kept, even when one has negative evidence', () => {
  const f = fixture({ trials: ['cheap-1', 'cheap-2'] }), reg = f.register();
  f.populate(reg, ({ trial, sample, arm }) => trial === 'cheap-2' && arm === 'B' ? { status: 'incomplete' } : {});
  const e = unwrap(f.evaluate(reg)); assert.deepEqual(e.receipt.requiredJudgements.map(j => j.verdict), ['positive', 'negative']);
  assert.equal(e.benefitClaimAllowed, false); assert.equal(e.decision.outcome, 'rejected');
  assert.equal(e.receipt.requiredJudgements.length, 2); assert.equal(f.service.evaluationForPromotion(e, 20).ok, false);
});
test('cp3 duplicate samples and undeclared seeds/trials cannot be presented as additional independent evidence', () => {
  const f = fixture(), reg = f.register(); f.populate(reg); f.inventory.push(f.inventory[0]);
  assert.equal(f.evaluate(reg).error.code, 'EFK_EVALUATION_PROTOCOL_MISMATCH');
  const g = fixture(), registered = g.register();
  g.run(registered, g.samples[0], 'B', g.hostBindings[0], 'undeclared-cheap-attempt', 7);
  assert.equal(g.evaluate(registered).error.code, 'EFK_EVALUATION_PROTOCOL_MISMATCH');
});
test('cp3 leakage negative control: author-visible held-out/final refs are rejected even when public', () => {
  for (const partition of ['held-out', 'final']) {
    const f = fixture(), reg = f.register();
    const leak = f.artifact('secret evaluator data', 'PrivateTests', { partition, visibility: 'public' });
    f.populate(reg, () => ({ authorVisibleRefs: [leak] }));
    const result = f.evaluate(reg); assert.equal(result.ok, false); assert.equal(result.error.code, 'EFK_PRIVACY_VIOLATION');
  }
});
test('cp3 usage negative control: missing telemetry stays null, keeps reservation, and blocks promotion', () => {
  const f = fixture(), reg = f.register(); f.populate(reg, () => ({ usage: [] }));
  const e = unwrap(f.evaluate(reg)), a = f.analysis(e);
  assert.equal(e.receipt.usageComplete, false); assert.equal(a.budget.totalMicros, null);
  assert.equal(a.observedRuns[0].costMicros, null); assert.equal(e.benefitClaimAllowed, false);
  assert.equal(a.budget.retainedReservationMicros, 320 * 9547);
  assert.equal(e.receipt.requiredJudgements[0].verdict, 'inconclusive'); assert.equal(e.receipt.requiredJudgements[0].costBasis, 'unknown');
});
test('cp3 telemetry checks implicit requests, duplicate request identity, contradictory completeness and reasoning subset', () => {
  for (const changed of ['implicit', 'source', 'reasoning', 'total', 'shared']) {
    const f = fixture(), reg = f.register(); f.populate(reg);
    const first = f.inventory[0], run = JSON.parse(unwrap(f.ports.artifacts.get(first)));
    if (changed === 'implicit') f.requests.get(first.id).push('implicit-title-request');
    else if (changed === 'shared') f.requests.set(f.inventory[1].id, f.requests.get(first.id));
    else {
      if (changed === 'source') run.usage[0].source = 'unknown';
      if (changed === 'reasoning') run.usage[0].reasoning = 100;
      if (changed === 'total') run.usage[0].total = 100;
      const replacement = f.artifact(canonical(run), 'EvolutionRun', { partition: 'held-out', visibility: 'private' });
      f.inventory[0] = replacement; f.requests.set(replacement.id, f.requests.get(first.id));
    }
    const result = f.evaluate(reg);
    if (changed === 'implicit') { const e = unwrap(result); assert.equal(e.receipt.usageComplete, false); assert.equal(e.benefitClaimAllowed, false); }
    else { assert.equal(result.ok, false); assert.equal(result.error.code, 'EFK_USAGE_CONFLICT'); }
  }
});
test('DoD2 production consumer uses the real receipt: registry validates then separately promotes; failed eval cannot transition', () => {
  const f = fixture(), reg = f.register(); f.populate(reg); const e = unwrap(f.evaluate(reg));
  assert.equal(e.benefitClaimAllowed, true); unwrap(f.service.evaluationForPromotion(e, 20));
  const context = { hostId: f.hostBindings[0].hostId, hostVersion: '1.0.0', hostManifestRef: f.hostBindings[0].manifestRef,
    hostSessionId: 'native-context', model: f.hostBindings[0].model, repoId: 'candidate-repo', baseDigest: f.plan.baseDigest,
    taskId: 'coding-task', scope: f.revision.candidate.asset.scope, at: 20 };
  const ports = { digest: f.ports.digest, artifacts: f.ports.artifacts, issuers: { candidate: f.issuer, promotion: actor('promotion-service', 'kernel'),
    activation: actor('activation-service', 'kernel'), revocation: actor('permission-root', 'kernel') }, authorize: () => ({ ok: true, value: true }) };
  const staged = unwrap(stageRevision(emptyRegistry(), f.revision, ports));
  const validated = unwrap(recordDecision(staged, { asset: f.revision.candidate.asset, decisionRef: e.decisionRef, context, at: 20 }, ports));
  assert.equal(validated.history.at(-1).state, 'validated');
  const decision = { ...e.decision, decisionId: 'separate-promotion', kind: 'promotion', outcome: 'promoted', issuer: ports.issuers.promotion, capabilityJudgement: null };
  const decisionRef = f.artifact(canonical(decision), 'DecisionRecord', { producer: ports.issuers.promotion, visibility: 'private' });
  const promoted = unwrap(recordDecision(validated, { asset: f.revision.candidate.asset, decisionRef, context, at: 20 }, ports));
  assert.equal(promoted.history.at(-1).state, 'promoted');
  const g = fixture({ budget: false }), r = g.register(); g.populate(r); const failed = unwrap(g.evaluate(r));
  const gports = { ...ports, digest: g.ports.digest, artifacts: g.ports.artifacts };
  const gs = unwrap(stageRevision(emptyRegistry(), g.revision, gports));
  assert.equal(recordDecision(gs, { asset: g.revision.candidate.asset, decisionRef: failed.decisionRef, context, at: 20 }, gports).error.code, 'EFK_ASSET_QUALIFICATION_INVALID');
});
test('DoD2 authority negative control: forged issuer/signature or substituted receipt never qualifies', () => {
  const f = fixture(), reg = f.register(); f.populate(reg); const e = unwrap(f.evaluate(reg));
  const malicious = { ...e, receiptRef: f.artifact(canonical(e.receipt), 'EvaluationReceipt', { producer: f.issuer, visibility: 'private', partition: 'held-out' }) };
  const decision = { ...e.decision, evaluationReceiptRef: malicious.receiptRef };
  malicious.decision = decision; malicious.decisionRef = f.artifact(canonical(decision), 'DecisionRecord', { producer: f.issuer, visibility: 'private', partition: 'held-out' });
  const refused = f.service.evaluationForPromotion(malicious, 20);
  assert.equal(refused.ok, false); assert.equal(refused.error.code, 'EFK_DECISION_AUTHORITY_DENIED');
  assert.equal(f.service.evaluationForPromotion({ ...e, receiptRef: { ...e.receiptRef, producer: actor('worker') } }, 20).error.code, 'EFK_DECISION_AUTHORITY_DENIED');
  assert.equal(f.service.evaluationForPromotion({ ...e, receipt: { ...e.receipt, baseDigest: hash('substituted') } }, 20).error.code, 'EFK_ARTIFACT_BINDING_MISMATCH');
});
test('DoD2 task-verdict negative control: even an attested task DecisionRecord cannot supply evolution qualification', () => {
  const f = fixture(), reg = f.register(); f.populate(reg); const e = unwrap(f.evaluate(reg));
  const task = { ...e.decision, kind: 'task', outcome: 'completed',
    contractRef: { taskId: 'ordinary-coding-task', version: 1, digest: hash('task contract') },
    taskEvidenceRef: f.artifact('fixture ordinary task evidence', 'TaskEvidenceReport', { producer: f.issuer, visibility: 'private' }),
    evaluationReceiptRef: null, evaluationProtocolRef: null, capabilityJudgement: null };
  unwrap(decode('DecisionRecord', task));
  const taskRef = f.artifact(canonical(task), 'DecisionRecord', { producer: f.issuer, visibility: 'private' });
  unwrap(f.ports.authority.attest(taskRef));
  assert.equal(f.service.evaluationForPromotion({ ...e, decision: task, decisionRef: taskRef }, 20).error.code, 'EFK_DECISION_AUTHORITY_DENIED');
});
test('cp3 independent verifier omissions/fake producer are rejected and judge costs are fully reported', () => {
  for (const mode of ['missing-branch', 'forged-producer', 'judge-usage']) {
    const f = fixture(), reg = f.register(), verify = f.ports.verifier.verify;
    f.ports.verifier.verify = input => {
      const v = verify(input);
      if (mode === 'missing-branch') v.value.branches.pop();
      if (mode === 'forged-producer') v.value.evidenceRefs = [f.artifact('author judged self', 'VerifierOutput', { producer: f.author })];
      if (mode === 'judge-usage') { v.value.requestIds = [`judge-${input.opaqueId}`]; v.value.usage = [f.usage(`judge-${input.opaqueId}`, { estimatedUsdMicros: 100 })]; }
      return v;
    };
    f.populate(reg); const result = f.evaluate(reg);
    if (mode === 'judge-usage') { const e = unwrap(result); assert.equal(f.analysis(e).judgingCostMicros, 32000); assert.equal(f.analysis(e).budget.totalMicros, 43840); }
    else assert.equal(result.error.code, mode === 'missing-branch' ? 'EFK_EVALUATION_INSUFFICIENT' : 'EFK_DECISION_AUTHORITY_DENIED');
  }
});
