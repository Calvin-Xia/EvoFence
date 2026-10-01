import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMemoryArtifactStore } from '../dist/storage/index.js';
import { canonical, storeOk, storeFail } from '../dist/kernel/store/index.js';
import { emptyRegistry, stageRevision, revisionDigest, qualification, recordDecision, revokeRevision } from '../dist/learning/assets/index.js';

const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const protocol = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
const assetProtocol = { namespace: 'evofence.assets/1', schemaVersion: '1.0.0' };
const actor = (actorId, kind = 'evaluator') => ({ actorId, kind, identityRef: null });
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
function fixture() {
  const digest = { digest: hash }, artifacts = createMemoryArtifactStore({ digest });
  const issuers = { candidate: actor('candidate-service'), promotion: actor('promotion-service', 'kernel'),
    activation: actor('activation-service', 'kernel'), revocation: actor('permission-root', 'kernel') };
  const ports = { digest, artifacts, issuers, authorize: () => storeOk(true) };
  let ordinal = 0;
  function artifact(bytes, schema = 'Material', overrides = {}) {
    const ref = { protocol, id: `artifact-${++ordinal}`, digest: hash(bytes), producer: actor('source', 'kernel'), binding: null,
      schema: { name: schema, version: '1.1.0', digest: hash(schema) }, location: `fixture:${ordinal}`,
      visibility: 'internal', expiresAt: null, partition: 'train', ...overrides };
    unwrap(artifacts.put(ref, bytes)); return ref;
  }
  const source = artifact('read-only training source');
  const manifest = artifact('pinned fixture host manifest', 'HostManifest');
  const payload = artifact('{"thinking":"fixture"}', 'ModelPayload');
  const protocolRef = artifact('fixture evaluation protocol', 'EvaluationProtocol');
  const model = { providerModel: 'fixture/model', reasoningRequested: 'high', reasoningGuarantee: 'payload-only', payloadRef: payload };
  const scope = { workspaceRef: null, readResources: ['repo'], writeResources: ['project-staging'], artifactScopes: ['assets'], trustDomain: 'same-user' };
  const context = { hostId: 'fixture-host', hostVersion: '1.0.0', hostManifestRef: manifest, hostSessionId: 'host-session',
    model, repoId: 'fixture-repo', baseDigest: hash('base'), taskId: 'fixture-task', scope, at: 20 };
  function revision(assetId = 'asset', dependencies = [], overrides = {}) {
    const category = overrides.category ?? 'strategy';
    const kind = { 'graph-template': 'template', strategy: 'memory', experience: 'memory', skill: 'skill', tool: 'tool-policy', 'code-patch': 'skill' }[category];
    const result = { category, createdAt: 10, compatibility: { hosts: [{ hostId: context.hostId, version: context.hostVersion, manifestRef: manifest }],
      models: [model], repositories: [{ repoId: context.repoId, baseDigest: context.baseDigest }], taskIds: [context.taskId], protocolRef },
    candidate: { protocol: assetProtocol, asset: { protocol: assetProtocol, assetId, revision: 1, digest: hash('placeholder'), scope, qualificationRef: null },
      kind, contentRefs: [artifact(`candidate content ${assetId}`)], sourceTraces: [source], dependencies,
      hypothesis: 'A pinned strategy improves an unseen coding task under matched resources.', qualification: 'staged',
      evaluationRef: null, expiresAt: null, revocationRef: null }, ...overrides };
    result.candidate.asset.digest = revisionDigest(result, digest); return result;
  }
  function evaluation(rev, overrides = {}) {
    const judgement = { cellStatus: 'complete', look: 'CONFIRMATORY_LOOK', verdict: 'positive', protocolRef,
      analysisRef: artifact('synthetic positive analysis fixture'), costBasis: 'measured-usage-estimate',
      guardrailCost: 'passed', guardrailWall: 'passed', guardrailTruncation: 'passed' };
    const receipt = { evaluationId: `evaluation-${ordinal}`, candidate: rev.candidate.asset, baseDigest: context.baseDigest,
      dependencyRefs: rev.candidate.dependencies, protocolRef, dataSplitRefs: [source], hostManifestRefs: [manifest],
      modelBindings: [model], requiredJudgements: [judgement], usageComplete: true, evidenceRefs: [source], ...overrides };
    return { receipt, ref: artifact(canonical(receipt), 'EvaluationReceipt', { producer: actor('independent-evaluator'), visibility: 'private' }) };
  }
  function decision(kind, rev, evaluationResult, overrides = {}) {
    const outcome = { candidate: 'validated', promotion: 'promoted', activation: 'active' }[kind];
    const content = { protocol, decisionId: `decision-${ordinal}`, kind, outcome, inputs: rev.candidate.contentRefs,
      contractRef: null, taskEvidenceRef: null, evaluationReceiptRef: kind === 'activation' ? null : evaluationResult.ref,
      activationReceiptRef: null, evaluatorVersion: 'fixture-v1', evaluationProtocolRef: protocolRef, reasons: [], evidenceRefs: [],
      feedbackVisibility: 'internal', issuer: issuers[kind], capabilityJudgement: kind === 'candidate' ? evaluationResult.receipt.requiredJudgements[0] : null, ...overrides };
    return artifact(canonical(content), 'DecisionRecord', { producer: content.issuer, visibility: 'private' });
  }
  function apply(snapshot, rev, decisionRef, ctx = context) {
    return recordDecision(snapshot, { asset: rev.candidate.asset, decisionRef, context: ctx, at: ctx.at }, ports);
  }
  function promoted(snapshot, rev, evalResult = evaluation(rev)) {
    snapshot = unwrap(apply(snapshot, rev, decision('candidate', rev, evalResult)));
    return { snapshot: unwrap(apply(snapshot, rev, decision('promotion', rev, evalResult))), evaluation: evalResult };
  }
  function activated(snapshot, rev, evalResult, overrides = {}, ctx = context) {
    const receipt = { protocol, asset: rev.candidate.asset, hostSessionId: ctx.hostSessionId, scope: ctx.scope,
      previousSnapshot: artifact('old host snapshot', 'HostSnapshot'), newSnapshot: artifact('new host snapshot', 'HostSnapshot'),
      actualStatus: 'active', authorizationRef: 'activation-grant', evaluationRef: evalResult.ref, ...overrides };
    const ref = artifact(canonical(receipt), 'ActivationReceipt', { producer: actor('fixture-adapter', 'host-adapter') });
    return apply(snapshot, rev, decision('activation', rev, evalResult, { activationReceiptRef: ref }), ctx);
  }
  function revoke(snapshot, rev) {
    const evidenceRef = artifact('revoked: controlled regression evidence', 'RevocationEvidence', { producer: issuers.revocation });
    return revokeRevision(snapshot, { asset: rev.candidate.asset, evidenceRef, authorizationRef: 'revocation-grant', at: context.at }, ports);
  }
  const stage = (snapshot, rev) => unwrap(stageRevision(snapshot, rev, ports));
  const query = (snapshot, rev, ctx = context) => unwrap(qualification(snapshot, rev.candidate.asset, ctx));
  return { ports, artifact, context, revision, evaluation, decision, apply, promoted, activated, revoke, stage, query };
}

test('immutable identity preserves six categories, provenance, time and old revisions', () => {
  const f = fixture(); let snapshot = emptyRegistry();
  for (const category of ['graph-template', 'strategy', 'experience', 'skill', 'tool', 'code-patch']) {
    const rev = f.revision(category, [], { category }); snapshot = f.stage(snapshot, rev);
    assert.equal(snapshot.revisions.at(-1).category, category);
    assert.equal(snapshot.revisions.at(-1).createdAt, 10);
    assert.deepEqual(snapshot.revisions.at(-1).candidate.sourceTraces, rev.candidate.sourceTraces);
  }
  const first = f.revision('versioned'); snapshot = f.stage(snapshot, first);
  const before = canonical(snapshot);
  first.candidate.hypothesis = 'caller mutation'; assert.equal(canonical(snapshot), before);
  const second = f.revision('versioned'); second.candidate.asset.revision = 2;
  second.candidate.asset.digest = revisionDigest(second, f.ports.digest); snapshot = f.stage(snapshot, second);
  assert.equal(snapshot.revisions.filter(r => r.candidate.asset.assetId === 'versioned').length, 2);
  assert.throws(() => { snapshot.revisions[0].candidate.hypothesis = 'overwrite'; }, TypeError);
});
test('identity rejects content, provenance and compatibility digest drift', () => {
  const f = fixture(), rev = f.revision();
  for (const change of [r => { r.candidate.hypothesis = 'different'; }, r => { r.createdAt++; },
    r => { r.compatibility.hosts[0].version = '2.0'; }, r => { r.candidate.sourceTraces = [r.candidate.contentRefs[0]]; }]) {
    const bad = structuredClone(rev); change(bad);
    assert.equal(stageRevision(emptyRegistry(), bad, f.ports).error.code, 'EFK_ARTIFACT_DIGEST_MISMATCH');
  }
});
test('duplicate staging is stable; conflicting or skipped revisions cannot rewrite history', () => {
  const f = fixture(), rev = f.revision(), snapshot = f.stage(emptyRegistry(), rev);
  assert.equal(unwrap(stageRevision(snapshot, rev, f.ports)), snapshot);
  const bad = structuredClone(rev); bad.candidate.hypothesis = 'overwrite'; bad.candidate.asset.digest = revisionDigest(bad, f.ports.digest);
  assert.equal(stageRevision(snapshot, bad, f.ports).error.code, 'EFK_IDEMPOTENCY_COLLISION');
  bad.candidate.asset.revision = 3; bad.candidate.asset.digest = revisionDigest(bad, f.ports.digest);
  assert.equal(stageRevision(snapshot, bad, f.ports).error.code, 'EFK_REVISION_CONFLICT');
});
test('missing material, unattributed human and non-train sources fail closed', () => {
  const f = fixture();
  for (const partition of ['dev', 'held-out', 'final', 'not-evaluation']) {
    const rev = f.revision(partition); rev.candidate.sourceTraces = [f.artifact('forbidden source', 'Material', { partition })];
    rev.candidate.asset.digest = revisionDigest(rev, f.ports.digest);
    assert.equal(stageRevision(emptyRegistry(), rev, f.ports).error.code, 'EFK_EVALUATION_PROTOCOL_MISMATCH');
  }
  const empty = f.revision('empty'); empty.candidate.contentRefs = [];
  assert.equal(stageRevision(emptyRegistry(), empty, f.ports).error.code, 'EFK_SCHEMA_INVALID');
  const human = f.revision('human'); human.candidate.sourceTraces = [f.artifact('unattributed', 'Material', { producer: actor('human', 'human') })];
  human.candidate.asset.digest = revisionDigest(human, f.ports.digest);
  assert.equal(stageRevision(emptyRegistry(), human, f.ports).error.code, 'EFK_ARTIFACT_BINDING_MISMATCH');
});
test('artifact identity and audience are reused, with no unavailable-content fallback', () => {
  const f = fixture(), rev = f.revision();
  rev.candidate.contentRefs = [f.artifact('private content', 'Material', { visibility: 'private' })];
  rev.candidate.asset.digest = revisionDigest(rev, f.ports.digest);
  assert.equal(stageRevision(emptyRegistry(), rev, f.ports).error.code, 'EFK_PRIVACY_VIOLATION');
  const missing = f.revision('missing'); missing.candidate.contentRefs[0].id = 'nonexistent';
  missing.candidate.asset.digest = revisionDigest(missing, f.ports.digest);
  assert.equal(stageRevision(emptyRegistry(), missing, f.ports).error.code, 'EFK_ARTIFACT_UNAVAILABLE');
});
test('DoD1 compatibility rejects host/model/repository/task/scope drift deterministically', () => {
  const f = fixture(), rev = f.revision(); const p = f.promoted(f.stage(emptyRegistry(), rev), rev);
  assert.equal(f.query(p.snapshot, rev).eligible, true);
  for (const changes of [{ hostId: 'other' }, { hostVersion: '9.0' }, { hostManifestRef: f.artifact('other manifest') },
    { model: { ...f.context.model, reasoningRequested: 'low' } }, { repoId: 'other' }, { baseDigest: hash('other') },
    { taskId: 'other' }, { scope: { ...f.context.scope, writeResources: ['outside'] } }]) {
    const ctx = { ...f.context, ...changes };
    const one = f.query(p.snapshot, rev, ctx), two = f.query(p.snapshot, rev, ctx);
    assert.equal(JSON.stringify(one), JSON.stringify(two)); assert.equal(one.eligible, false);
    assert.ok(one.reasons.includes('EFK_ASSET_SCOPE_DENIED'));
  }
  const missing = f.revision('missing-compat'); missing.compatibility.models = [];
  assert.equal(stageRevision(emptyRegistry(), missing, f.ports).error.code, 'EFK_SCHEMA_INVALID');
});
test('DoD2 validated never automatically activates; explicit promotion and scoped receipt are required', t => {
  const f = fixture(), rev = f.revision(), evaluation = f.evaluation(rev);
  let snapshot = f.stage(emptyRegistry(), rev);
  snapshot = unwrap(f.apply(snapshot, rev, f.decision('candidate', rev, evaluation)));
  const validatedExample = f.query(snapshot, rev);
  assert.equal(f.query(snapshot, rev).state, 'validated'); assert.equal(f.query(snapshot, rev).usable, false);
  assert.equal(f.activated(snapshot, rev, evaluation).error.code, 'EFK_ASSET_QUALIFICATION_INVALID');
  snapshot = unwrap(f.apply(snapshot, rev, f.decision('promotion', rev, evaluation)));
  const promotedExample = f.query(snapshot, rev);
  assert.equal(f.query(snapshot, rev).state, 'promoted'); assert.equal(f.query(snapshot, rev).usable, false);
  snapshot = unwrap(f.activated(snapshot, rev, evaluation));
  assert.equal(f.query(snapshot, rev).state, 'active'); assert.equal(f.query(snapshot, rev).usable, true);
  assert.equal(f.query(snapshot, rev, { ...f.context, hostSessionId: 'another-session' }).usable, false);
  t.diagnostic(JSON.stringify({ qualificationExamples: { evidenceLevel: 'synthetic-fixture',
    context: { hostId: f.context.hostId, hostVersion: f.context.hostVersion, model: f.context.model.providerModel,
      repoId: f.context.repoId, taskId: f.context.taskId, hostSessionId: f.context.hostSessionId },
    validated: validatedExample, promoted: promotedExample, active: f.query(snapshot, rev),
    otherSession: f.query(snapshot, rev, { ...f.context, hostSessionId: 'another-session' }),
    incompatibleHost: f.query(snapshot, rev, { ...f.context, hostVersion: '9.0' }) } }));
});
test('forged issuer, skipped transition and insufficient evaluation cannot grant qualification', () => {
  const f = fixture(), rev = f.revision(), snapshot = f.stage(emptyRegistry(), rev), e = f.evaluation(rev);
  assert.equal(f.apply(snapshot, rev, f.decision('promotion', rev, e)).error.code, 'EFK_ASSET_QUALIFICATION_INVALID');
  assert.equal(f.apply(snapshot, rev, f.decision('candidate', rev, e, { issuer: actor('worker', 'host-adapter') })).error.code, 'EFK_DECISION_AUTHORITY_DENIED');
  for (const changes of [{ usageComplete: false }, { requiredJudgements: [] }, { hostManifestRefs: [] }, { modelBindings: [] },
    { dependencyRefs: [rev.candidate.asset] }, { baseDigest: hash('wrong') }, { evidenceRefs: [] }, { dataSplitRefs: [] }]) {
    const bad = f.evaluation(rev, changes);
    assert.equal(f.apply(snapshot, rev, f.decision('candidate', rev, bad, { capabilityJudgement: e.receipt.requiredJudgements[0] })).error.code, 'EFK_ASSET_QUALIFICATION_INVALID');
  }
});
test('all judgements and guardrails matter; a positive result cannot filter failures', () => {
  const f = fixture(), rev = f.revision(), snapshot = f.stage(emptyRegistry(), rev), e = f.evaluation(rev);
  for (const changes of [{ verdict: 'inconclusive' }, { guardrailCost: 'unknown' }, { guardrailWall: 'failed' }, { guardrailTruncation: 'failed' }]) {
    const bad = f.evaluation(rev, { requiredJudgements: [e.receipt.requiredJudgements[0], { ...e.receipt.requiredJudgements[0], ...changes }] });
    assert.equal(f.apply(snapshot, rev, f.decision('candidate', rev, bad)).error.code, 'EFK_ASSET_QUALIFICATION_INVALID');
  }
});
test('promotion cannot substitute evaluation or bypass current authority', () => {
  const f = fixture(), rev = f.revision(), e = f.evaluation(rev); let snapshot = f.stage(emptyRegistry(), rev);
  snapshot = unwrap(f.apply(snapshot, rev, f.decision('candidate', rev, e)));
  assert.equal(f.apply(snapshot, rev, f.decision('promotion', rev, f.evaluation(rev))).error.code, 'EFK_ASSET_QUALIFICATION_INVALID');
  f.ports.authorize = () => storeFail('EFK_GRANT_REVOKED', 'fixture grant revoked');
  assert.equal(f.apply(snapshot, rev, f.decision('promotion', rev, e)).error.code, 'EFK_GRANT_REVOKED');
});
test('failed/unknown activation keeps prior history and never invents a new snapshot', () => {
  const f = fixture(), rev = f.revision(), p = f.promoted(f.stage(emptyRegistry(), rev), rev);
  const before = canonical(p.snapshot);
  for (const changes of [{ actualStatus: 'failed', newSnapshot: null }, { actualStatus: 'unknown', newSnapshot: null }, { newSnapshot: null }]) {
    assert.equal(f.activated(p.snapshot, rev, p.evaluation, changes).error.code, 'EFK_ACTIVATION_UNCONFIRMED');
    assert.equal(canonical(p.snapshot), before); assert.equal(f.query(p.snapshot, rev).usable, false);
  }
  assert.equal(f.activated(p.snapshot, rev, p.evaluation, { hostSessionId: 'other' }).error.code, 'EFK_ARTIFACT_BINDING_MISMATCH');
  f.ports.authorize = () => storeFail('EFK_ACTIVATION_NOT_SETTLED', 'fixture not idle');
  assert.equal(f.activated(p.snapshot, rev, p.evaluation).error.code, 'EFK_ACTIVATION_NOT_SETTLED');
});
test('DoD2 revocation propagates transitively and preserves every revision and prior event', () => {
  const f = fixture(), root = f.revision('root'); let snapshot = f.stage(emptyRegistry(), root);
  const r = f.promoted(snapshot, root); snapshot = unwrap(f.activated(r.snapshot, root, r.evaluation));
  const child = f.revision('child', [root.candidate.asset]); snapshot = f.stage(snapshot, child);
  const c = f.promoted(snapshot, child); snapshot = unwrap(f.activated(c.snapshot, child, c.evaluation));
  const leaf = f.revision('leaf', [child.candidate.asset]); snapshot = f.stage(snapshot, leaf);
  const l = f.promoted(snapshot, leaf); snapshot = unwrap(f.activated(l.snapshot, leaf, l.evaluation));
  assert.equal(f.query(snapshot, leaf).usable, true);
  const before = structuredClone(snapshot); snapshot = unwrap(f.revoke(snapshot, root));
  for (const rev of [root, child, leaf]) {
    const result = f.query(snapshot, rev); assert.equal(result.usable, false); assert.equal(result.eligible, false);
    assert.equal(result.validity, 'invalid'); assert.ok(result.reasons.includes('EFK_ASSET_REVOKED'));
  }
  assert.deepEqual(snapshot.revisions, before.revisions);
  assert.deepEqual(snapshot.history.slice(0, before.history.length), before.history);
  assert.equal(snapshot.history.length, before.history.length + 1);
  assert.equal(f.apply(snapshot, root, f.decision('candidate', root, r.evaluation)).error.code, 'EFK_ASSET_REVOKED');
});
test('expiry propagates at the exact boundary without mutating history or activating another revision', () => {
  const f = fixture(), root = f.revision('expiring'); root.candidate.expiresAt = 30;
  root.candidate.asset.digest = revisionDigest(root, f.ports.digest);
  const p = f.promoted(f.stage(emptyRegistry(), root), root);
  const child = f.revision('dependent', [root.candidate.asset]); const c = f.promoted(f.stage(p.snapshot, child), child);
  const before = canonical(c.snapshot); assert.equal(f.query(c.snapshot, child, { ...f.context, at: 29 }).eligible, true);
  const result = f.query(c.snapshot, child, { ...f.context, at: 30 });
  assert.equal(result.eligible, false); assert.ok(result.reasons.includes('EFK_ASSET_EXPIRED')); assert.equal(canonical(c.snapshot), before);
});
test('unknown or substituted dependency revisions are refused; unqualified dependencies cannot promote', () => {
  const f = fixture(), root = f.revision('root'), snapshot = f.stage(emptyRegistry(), root);
  for (const dep of [{ ...root.candidate.asset, revision: 2 }, { ...root.candidate.asset, digest: hash('substituted') }]) {
    assert.equal(stageRevision(snapshot, f.revision('child', [dep]), f.ports).error.code, 'EFK_ASSET_QUALIFICATION_INVALID');
  }
  const child = f.revision('child', [root.candidate.asset]), staged = f.stage(snapshot, child), e = f.evaluation(child);
  const validated = unwrap(f.apply(staged, child, f.decision('candidate', child, e)));
  assert.equal(f.apply(validated, child, f.decision('promotion', child, e)).error.code, 'EFK_ASSET_QUALIFICATION_INVALID');
});
test('qualification is a pure stable view without private evaluation refs or bytes', () => {
  const f = fixture(), rev = f.revision(), p = f.promoted(f.stage(emptyRegistry(), rev), rev);
  f.ports.artifacts.get = () => { throw Error('query must not read a store'); };
  const result = f.query(p.snapshot, rev); assert.equal(result.eligible, true);
  assert.equal(JSON.stringify(result), JSON.stringify(f.query(p.snapshot, rev)));
  assert.equal(JSON.stringify(result).includes(p.evaluation.ref.id), false);
  assert.equal(qualification(p.snapshot, { ...rev.candidate.asset, digest: hash('missing') }, f.context).error.code, 'EFK_ASSET_QUALIFICATION_INVALID');
});
test('qualification evidence expiry propagates through dependencies without a wall clock or erased history', () => {
  const f = fixture(), root = f.revision('root'), evaluation = f.evaluation(root);
  evaluation.receipt.evidenceRefs = [f.artifact('expiring evaluation evidence', 'Measurement', { expiresAt: 30 })];
  evaluation.ref = f.artifact(canonical(evaluation.receipt), 'EvaluationReceipt', { producer: actor('independent-evaluator') });
  const p = f.promoted(f.stage(emptyRegistry(), root), root, evaluation);
  const child = f.revision('child', [root.candidate.asset]); const c = f.promoted(f.stage(p.snapshot, child), child);
  const before = canonical(c.snapshot);
  assert.equal(f.query(c.snapshot, child, { ...f.context, at: 29 }).eligible, true);
  assert.ok(f.query(c.snapshot, child, { ...f.context, at: 30 }).reasons.includes('EFK_ASSET_EXPIRED'));
  assert.equal(canonical(c.snapshot), before);
});
test('revocation requires attributable current authority and retains prior active observations', () => {
  const f = fixture(), rev = f.revision(), p = f.promoted(f.stage(emptyRegistry(), rev), rev);
  const active = unwrap(f.activated(p.snapshot, rev, p.evaluation)), before = canonical(active);
  f.ports.authorize = () => storeFail('EFK_AUTHORITY_DENIED', 'fixture no revocation grant');
  assert.equal(f.revoke(active, rev).error.code, 'EFK_AUTHORITY_DENIED');
  assert.equal(canonical(active), before); assert.equal(f.query(active, rev).usable, true);
});
test('DoD2 history survives revocation and revision replacement without erasing earlier observations', () => {
  const f = fixture(), first = f.revision('history'); let snapshot = f.stage(emptyRegistry(), first);
  const staged = structuredClone(snapshot.history); snapshot = unwrap(f.revoke(snapshot, first));
  assert.deepEqual(snapshot.history.slice(0, staged.length), staged);
  assert.equal(snapshot.history.length, 2); const revoked = structuredClone(snapshot.history);
  const second = f.revision('history'); second.candidate.asset.revision = 2;
  second.candidate.asset.digest = revisionDigest(second, f.ports.digest); snapshot = f.stage(snapshot, second);
  assert.deepEqual(snapshot.history.slice(0, revoked.length), revoked); assert.equal(snapshot.history.length, 3);
  assert.equal(snapshot.revisions.length, 2); assert.equal(f.query(snapshot, second).usable, false);
});
