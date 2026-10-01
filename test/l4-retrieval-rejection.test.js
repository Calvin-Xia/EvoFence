import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../dist/kernel/store/index.js';
import { stageRevision, revisionDigest } from '../dist/learning/assets/index.js';
import { retrieveContext } from '../dist/learning/retrieval/index.js';
import { fixture, hash, unwrap } from './l4-retrieval-fixtures.test.js';

test('cp3 revocation propagation removes transitive dependents on the next retrieval without stale injection', () => {
  const f = fixture(), root = f.add('root'), child = f.add('child', 'child', [root.candidate.asset]);
  f.add('leaf', 'leaf', [child.candidate.asset]);
  const before = f.retrieve(); assert.equal(before.candidate.assets.length, 3);
  const priorHistory = canonical(f.input.registry.history);
  f.revoke(root);
  const revokedHistory = canonical(f.input.registry), after = f.retrieve();
  assert.equal(after.mode, 'base'); assert.equal(after.candidate, null);
  assert.ok(after.attribution.every(a => a.reasons.includes('EFK_ASSET_REVOKED') && !a.retrieved));
  assert.deepEqual(after.context, f.baseline());
  assert.equal(after.cost.materialReads, 0);
  assert.equal(canonical(f.input.registry), revokedHistory);
  assert.equal(canonical(f.input.registry.history.slice(0, -1)), priorHistory);
});

test('cp3 exact expiry boundary stops retrieval through the dependency closure', () => {
  const f = fixture(), root = f.add('expiring', 'root', [], { expiresAt: 30 });
  f.add('dependent', 'child', [root.candidate.asset]);
  f.input.context = { ...f.input.context, at: 29 }; f.input.baseInputs.at = 29;
  assert.equal(f.retrieve().mode, 'candidate');
  f.input.context = { ...f.input.context, at: 30 }; f.input.baseInputs.at = 30;
  const value = f.retrieve();
  assert.equal(value.mode, 'base'); assert.equal(value.cost.materialReads, 0);
  assert.ok(value.attribution.every(a => a.reasons.includes('EFK_ASSET_EXPIRED')));
});

test('cp3 pollution negatives reuse registration provenance and train-only admission before retrieval', () => {
  const cases = [
    ['unknown-source', { producer: { actorId: 'unknown-human', kind: 'human', identityRef: null } }, 'EFK_ARTIFACT_BINDING_MISMATCH'],
    ...['dev', 'held-out', 'final', 'not-evaluation'].map(partition => [`source-${partition}`, { partition }, 'EFK_EVALUATION_PROTOCOL_MISMATCH']),
    ['private-source', { visibility: 'private' }, 'EFK_PRIVACY_VIOLATION'],
  ];
  for (const [id, edit, code] of cases) {
    const f = fixture(), rev = f.revision(id), sentinel = `FORBIDDEN_${id}_BYTES`;
    rev.candidate.sourceTraces = [f.material(sentinel, edit).ref];
    rev.candidate.asset.digest = revisionDigest(rev, f.ports.digest);
    const stage = stageRevision(f.input.registry, rev, f.registryPorts);
    assert.equal(stage.ok, false); assert.equal(stage.error.code, code);
    // A refused staging attempt cannot be smuggled in as a retrieval candidate.
    f.input.candidates = [rev.candidate.asset];
    const count = f.ports.tokenizer.countTokens;
    f.ports.tokenizer.countTokens = text => { assert.equal(text.includes(sentinel), false); return count(text); };
    const result = f.retrieve();
    assert.equal(result.mode, 'base'); assert.equal(result.cost.materialReads, 0);
    assert.deepEqual(result.attribution[0].reasons, ['EFK_ASSET_QUALIFICATION_INVALID']);
    assert.equal(JSON.stringify(result).includes(sentinel), false);
  }
});

test('cp3 held-out content and fake instruction labels never become activation context', () => {
  for (const partition of ['held-out', 'final']) {
    const f = fixture(), rev = f.revision(`content-${partition}`);
    rev.candidate.contentRefs = [f.material('forbidden content', { partition }).ref];
    rev.candidate.asset.digest = revisionDigest(rev, f.ports.digest);
    assert.equal(stageRevision(f.input.registry, rev, f.registryPorts).error.code, 'EFK_EVALUATION_PROTOCOL_MISMATCH');
    f.input.candidates = [rev.candidate.asset]; assert.equal(f.retrieve().mode, 'base');
  }
  for (const purpose of ['human-instruction', 'host-instruction', 'candidate-feedback']) {
    const f = fixture(); f.add('label'); f.input.materials[0].purpose = purpose;
    const result = f.retrieve();
    assert.equal(result.mode, 'base'); assert.deepEqual(result.attribution[0].reasons, ['EFK_AUTHORITY_DENIED']);
  }
});

test('cp3 undeclared, substituted or unavailable hydration is typed and cannot reach a packet', () => {
  const changes = [
    [f => { f.input.baseInputs.nodeInputRefs = []; }, 'EFK_GRAPH_INPUT_STALE'],
    [f => { f.input.materials[0].ref = { ...f.input.materials[0].ref, visibility: 'public' }; }, 'EFK_GRAPH_INPUT_STALE'],
    [f => { f.input.materials[0].bytes = 'substituted body'; }, 'EFK_ARTIFACT_DIGEST_MISMATCH'],
    [f => { f.input.materials = []; }, 'EFK_ARTIFACT_UNAVAILABLE'],
    [f => { f.input.materials[0].expectation = { ...f.input.materials[0].expectation,
      schema: { ...f.input.materials[0].ref.schema, digest: hash('wrong-schema') } }; }, 'EFK_ARTIFACT_BINDING_MISMATCH'],
  ];
  for (const [edit, code] of changes) {
    const f = fixture(); f.add('known'); edit(f);
    const result = f.retrieve();
    assert.equal(result.mode, 'base'); assert.equal(result.candidate, null);
    assert.deepEqual(result.attribution[0].reasons, [code]);
  }
});

test('cp3 ambiguous duplicate hydration rejects independently of submission order', () => {
  const f = fixture(); f.add('known');
  f.input.materials.push({ ...f.input.materials[0], bytes: 'substituted duplicate body' });
  assert.equal(retrieveContext(f.input, f.ports).error.code, 'EFK_GRAPH_INPUT_STALE');
  f.input.materials.reverse();
  assert.equal(retrieveContext(f.input, f.ports).error.code, 'EFK_GRAPH_INPUT_STALE');
});

test('cp3 a live material read refusal cannot be hidden by another valid asset', () => {
  const f = fixture(), unavailable = f.add('unavailable', 'x'); f.add('valid', 'yy');
  const get = f.ports.artifacts.get;
  f.ports.artifacts.get = ref => ref.id === unavailable.candidate.contentRefs[0].id
    ? { ok: false, error: { code: 'EFK_ARTIFACT_UNAVAILABLE', message: 'fixture content gone' } } : get(ref);
  const result = f.retrieve();
  assert.deepEqual(result.candidate.assets.map(a => a.assetId), ['valid']);
  assert.deepEqual(result.attribution.find(a => a.asset.assetId === 'unavailable').reasons, ['EFK_ARTIFACT_UNAVAILABLE']);
  assert.equal(result.context.packet.entries.length, 1);
});

test('cp3 missing current source bytes return to base without substituting source summaries', () => {
  const f = fixture(), rev = f.add('known'), get = f.ports.artifacts.get;
  f.ports.artifacts.get = ref => ref.id === rev.candidate.sourceTraces[0].id
    ? { ok: false, error: { code: 'EFK_ARTIFACT_UNAVAILABLE', message: 'fixture locator gone' } } : get(ref);
  const result = f.retrieve();
  assert.equal(result.mode, 'base');
  assert.deepEqual(result.attribution[0].reasons, ['EFK_ARTIFACT_UNAVAILABLE']);
});

test('DoD1 base plan cannot bypass qualification by preloading registered experience', () => {
  const f = fixture(), rev = f.stage(f.revision('staged'));
  f.input.baseInputs.plan.inputRefs = rev.candidate.contentRefs;
  f.input.baseInputs.artifacts = f.input.materials;
  assert.equal(retrieveContext(f.input, f.ports).error.code, 'EFK_GRAPH_INPUT_STALE');
});

test('cp3 disabled or zero-token injection budgets fall back with explicit clipping attribution', () => {
  const f = fixture(); f.add('known'); f.input.budget.maxAssets = 0;
  const disabled = f.retrieve();
  assert.equal(disabled.mode, 'base'); assert.equal(disabled.fallbackReason, 'no-assets-fit');
  assert.equal(disabled.attribution[0].retrieved, true);
  assert.deepEqual(disabled.attribution[0].reasons, ['asset-count-budget']);
  f.input.budget.maxAssets = 5; f.input.budget.maxAddedTokens = 0;
  const clipped = f.retrieve();
  assert.equal(clipped.mode, 'base'); assert.deepEqual(clipped.attribution[0].reasons, ['added-token-budget']);
});

test('cp3 an invalid base execution remains an error rather than a successful empty fallback', () => {
  const f = fixture(); f.input.baseInputs.contractRef.digest = hash('stale-task');
  assert.equal(retrieveContext(f.input, f.ports).error.code, 'EFK_SOURCE_PIN_DRIFT');
});
