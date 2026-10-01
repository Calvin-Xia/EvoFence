import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../dist/kernel/store/index.js';
import { readArtifact } from '../dist/kernel/artifacts/index.js';
import { createEvolutionEvaluator } from '../dist/evaluation/evolution/index.js';
import { revisionDigest } from '../dist/learning/assets/index.js';
import { fixture, hash, unwrap, actor } from './l4-evo-eval-fixtures.test.js';

test('cp1: preregistration binds candidate/base/hosts/model/protocol/splits and cannot be rewritten after results', () => {
  const f = fixture(), registered = f.register(); f.populate(registered);
  const e = unwrap(f.evaluate(registered)), r = e.receipt;
  assert.deepEqual(r.candidate, f.revision.candidate.asset); assert.equal(r.baseDigest, f.plan.baseDigest);
  assert.deepEqual(r.protocolRef, f.plan.protocolRef); assert.deepEqual(r.modelBindings, [f.hostBindings[0].model]);
  assert.deepEqual(r.hostManifestRefs, f.hostBindings.map(h => h.manifestRef)); assert.deepEqual(r.dataSplitRefs, f.plan.dataSplitRefs);
  assert.equal(f.service.preregister(f.plan, 20).error.code, 'EFK_EVALUATION_PROTOCOL_MISMATCH');
  f.plan.primaryMetric = 'quality_score'; assert.equal(registered.plan.primaryMetric, 'task_success');
  assert.equal(e.decision.kind, 'candidate'); assert.equal(e.decision.taskEvidenceRef, null); assert.equal(e.decision.contractRef, null);
});
test('cp1: forged preregistration/authority cannot become a registered evaluator', () => {
  const f = fixture(); f.ports.verifier.issuer = f.author;
  assert.equal(f.service.preregister(f.plan, 10).error.code, 'EFK_DECISION_AUTHORITY_DENIED');
  const g = fixture(); g.plan.approvalRef = g.artifact('self-approved', 'Approval');
  assert.equal(g.service.preregister(g.plan, 10).error.code, 'EFK_AUTHORITY_DENIED');
  const h = fixture(), reg = h.register(); const unsigned = h.artifact(canonical(reg.plan), 'EvolutionPreregistration', { producer: h.issuer });
  assert.equal(h.service.evaluateCapability(unsigned, 20).error.code, 'EFK_DECISION_AUTHORITY_DENIED');
});
test('cp1: candidate/base/dependency/version/model/payload/seed/resource drift is rejected', () => {
  for (const mutate of [r => ({ candidate: { ...r.candidate, digest: hash('changed') } }), () => ({ baseDigest: hash('other base') }),
    () => ({ hostVersion: '9.0.0' }), r => ({ model: { ...r.model, reasoningRequested: 'low' } }),
    () => ({ seed: 999 }), () => ({ toolsetDigest: hash('other tools') }), () => ({ authorityDigest: hash('extra permissions') }),
    r => ({ envelope: { ...r.envelope, requestCap: 21 } }), () => ({ protocolRef: null })]) {
    const f = fixture(), reg = f.register();
    const one = f.run(reg, f.samples[0], 'B', f.hostBindings[0], 'trial-1', 7); f.inventory.length = 0;
    f.run(reg, f.samples[0], 'B', f.hostBindings[0], 'trial-1', 7, mutate(one.run));
    const result = f.evaluate(reg); assert.equal(result.ok, false); assert.ok(['EFK_EVALUATION_PROTOCOL_MISMATCH', 'EFK_SCHEMA_INVALID'].includes(result.error.code));
  }
});
test('cp1: disjoint repo/family/instance splits and private test audience are mandatory', () => {
  for (const kind of ['repo', 'family', 'instance', 'private-tests']) {
    const f = fixture(), original = f.samples[0];
    const sample = { ...original, instanceId: 'train-other', repoId: 'train-repo', familyId: 'train-family',
      privateTestsRef: f.artifact('train private checks', 'PrivateTests', { visibility: 'private', partition: 'train' }) };
    if (kind === 'repo') sample.repoId = original.repoId;
    if (kind === 'family') sample.familyId = original.familyId;
    if (kind === 'instance') sample.instanceId = original.instanceId;
    if (kind === 'private-tests') {
      const dev = fixture({ confirmatory: false });
      const exposed = { ...dev.samples[0], privateTestsRef: dev.artifact('public private tests', 'PrivateTests', { partition: 'dev' }) };
      dev.plan.dataSplitRefs = [dev.artifact(canonical({ partition: 'dev', samples: [exposed] }), 'DataSplit', { partition: 'dev', visibility: 'private' })];
      assert.equal(dev.service.preregister(dev.plan, 10).error.code, 'EFK_PRIVACY_VIOLATION'); continue;
    }
    f.plan.dataSplitRefs.push(f.artifact(canonical({ partition: 'train', samples: [sample] }), 'DataSplit', { partition: 'train' }));
    assert.equal(f.service.preregister(f.plan, 10).error.code, 'EFK_EVALUATION_PROTOCOL_MISMATCH');
  }
});
test('cp1: actual product/base binding and bytes cannot be substituted with author summaries', () => {
  const f = fixture(), reg = f.register();
  const product = f.artifact('summary without attempt binding', 'Program', { visibility: 'private', partition: 'held-out' });
  f.run(reg, f.samples[0], 'B', f.hostBindings[0], 'trial-1', 7, { artifactRefs: [product] });
  assert.equal(f.evaluate(reg).error.code, 'EFK_ARTIFACT_BINDING_MISMATCH');
  const g = fixture(), registered = g.register(); g.populate(registered);
  const realGet = g.ports.artifacts.get;
  g.ports.artifacts.get = ref => ref.id === g.inventory[0].id ? { ok: true, value: 'tampered bytes' } : realGet(ref);
  assert.equal(g.evaluate(registered).error.code, 'EFK_ARTIFACT_DIGEST_MISMATCH');
});
test('cp3: held-out/final receipts and detailed feedback never enter author/report/asset-staging audience', () => {
  const f = fixture(), reg = f.register(); f.populate(reg); const e = unwrap(f.evaluate(reg));
  for (const audience of ['author', 'report', 'asset-staging']) {
    assert.equal(readArtifact(e.receiptRef, audience, 20, f.ports.artifacts).error.code, 'EFK_PRIVACY_VIOLATION');
    assert.equal(readArtifact(e.decisionRef, audience, 20, f.ports.artifacts).error.code, 'EFK_PRIVACY_VIOLATION');
  }
  assert.equal(readArtifact(e.receiptRef, 'evaluator', 20, f.ports.artifacts).ok, true);
  for (const blind of f.blindInputs) {
    assert.deepEqual(Object.keys(blind).sort(), ['actualDiff', 'artifacts', 'contract', 'opaqueId', 'privateTests', 'requiredBranches']);
    assert.equal(Object.hasOwn(blind, 'arm'), false); assert.equal(Object.hasOwn(blind, 'reasoning'), false);
  }
});
test('cp1: construction performs zero port I/O and issuer is copied from registration', () => {
  const f = fixture(), registration = { issuer: actor('registered'), version: '1' };
  const deny = new Proxy({}, { get() { throw new Error('port accessed at construction'); } });
  const service = createEvolutionEvaluator(registration, deny);
  registration.issuer.actorId = 'changed'; assert.equal(service.issuer.actorId, 'registered');
});
test('cp3: trusted provenance prevents offline records from being relabeled as unseen', () => {
  const f = fixture(), reg = f.register(); f.populate(reg);
  f.ports.journal.evidenceKind = () => ({ ok: true, value: 'offline' });
  assert.equal(f.evaluate(reg).error.code, 'EFK_EVALUATION_PROTOCOL_MISMATCH');
});
test('cp1: host manifest bytes must match the declared host version/model/payload', () => {
  const f = fixture(), original = JSON.parse(unwrap(f.ports.artifacts.get(f.hostBindings[0].manifestRef)));
  original.identity.version = '2.0.0';
  const ref = f.artifact(canonical(original), 'HostManifest'); f.hostBindings[0].manifestRef = ref;
  f.revision.compatibility.hosts[0].manifestRef = ref;
  // Re-pin the candidate: the remaining mismatch is manifest content versus the declared version.
  f.revision.candidate.asset.digest = revisionDigest(f.revision, f.ports.digest);
  assert.equal(f.service.preregister(f.plan, 10).error.code, 'EFK_EVALUATION_PROTOCOL_MISMATCH');
});
test('cp3: receipt qualification expires with its underlying evidence; public benefit booleans are ignored', () => {
  const f = fixture(), reg = f.register(); f.populate(reg);
  const e = unwrap(f.evaluate(reg)); assert.equal(f.service.evaluationForPromotion({ ...e, benefitClaimAllowed: false }, 20).ok, true);
  const g = fixture(), r = g.register();
  g.populate(r, ({ sample, arm }) => arm === 'B' && sample.instanceId === 'instance-0' ? {
    actualDiffRef: g.artifact('expiring actual diff', 'ActualDiff', { partition: 'held-out', expiresAt: 30,
      binding: { sessionId: 'session-trial-1:7:fixture-host-0:instance-0:B', hostSessionId: 'native-trial-1:7:fixture-host-0:instance-0:B',
        graph: { graphId: 'evaluation-run', revision: 1, digest: hash('graph') }, nodeId: 'work', attemptId: 'attempt-1', attemptOrdinal: 1, epoch: 1, baseDigest: sample.baseDigest } }) } : {});
  const expired = unwrap(g.evaluate(r)); assert.equal(expired.receiptRef.expiresAt, 30);
  assert.equal(g.service.evaluationForPromotion(expired, 30).error.code, 'EFK_ARTIFACT_UNAVAILABLE');
  assert.equal(g.service.evaluationForPromotion(expired, NaN).error.code, 'EFK_SCHEMA_INVALID');
});
