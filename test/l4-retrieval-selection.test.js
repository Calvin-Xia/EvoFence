import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../dist/kernel/store/index.js';
import { qualification, revisionDigest } from '../dist/learning/assets/index.js';
import { retrieveContext } from '../dist/learning/retrieval/index.js';
import { fixture, hash, unwrap } from './l4-retrieval-fixtures.test.js';

test('cp1 ranking is byte-identical across repeats and candidate permutations with explicit ties', () => {
  const f = fixture();
  f.add('zeta', 'same'); f.add('alpha', 'same'); f.add('cheap', 'x'); f.add('expensive', 'long'.repeat(100));
  f.input.budget.maxAssets = 3;
  const before = canonical(f.input), one = f.retrieve();
  assert.deepEqual(one.candidate.assets.map(a => a.assetId), ['cheap', 'alpha', 'zeta']);
  assert.equal(one.attribution.find(a => a.asset.assetId === 'expensive').reasons[0], 'asset-count-budget');
  assert.equal(JSON.stringify(f.retrieve()), JSON.stringify(one));
  assert.equal(canonical(f.input), before);
  f.input.candidates.reverse(); f.input.materials.reverse(); f.input.baseInputs.nodeInputRefs.reverse();
  assert.equal(JSON.stringify(f.retrieve()), JSON.stringify(one));
  f.input.taskContract = Object.fromEntries(Object.entries(f.input.taskContract).reverse());
  assert.equal(JSON.stringify(f.retrieve()), JSON.stringify(one));
});

test('DoD1 qualification rejects unverified and metadata-mismatched experience before material reads', () => {
  const f = fixture(), valid = f.add('valid'), staged = f.stage(f.revision('unverified'));
  const validated = f.stage(f.revision('validated'));
  f.decide('candidate', validated, f.evaluation(validated));
  const mixed = f.retrieve();
  assert.deepEqual(mixed.candidate.assets.map(a => a.assetId), ['valid']);
  const rejected = mixed.attribution.find(a => a.asset.assetId === staged.candidate.asset.assetId);
  assert.equal(rejected.retrieved, false);
  assert.ok(rejected.reasons.includes('EFK_ASSET_QUALIFICATION_INVALID'));
  for (const edit of [{ hostId: 'other' }, { hostVersion: '2.0' }, { hostManifestRef: f.material('other-manifest').ref },
    { model: { ...f.input.context.model, reasoningRequested: 'low' } }, { repoId: 'other-repo' },
    { scope: { ...f.input.context.scope, writeResources: [] } }]) {
    const input = { ...f.input, context: { ...f.input.context, ...edit } };
    const value = unwrap(retrieveContext(input, f.ports));
    if (Object.hasOwn(edit, 'scope')) assert.equal(value.mode, 'candidate'); // A smaller scope remains eligible.
    else {
      assert.equal(value.mode, 'base'); assert.equal(value.cost.materialReads, 0);
      assert.ok(value.attribution.find(a => a.asset.assetId === valid.candidate.asset.assetId).reasons.includes('EFK_ASSET_SCOPE_DENIED'));
    }
  }
  assert.equal(mixed.attribution.find(a => a.asset.assetId === 'validated').retrieved, false);
  const scope = { ...f.input.context.scope, writeResources: ['project-staging', 'extra'] };
  const taskContract = { ...f.input.taskContract, scope };
  const widened = unwrap(retrieveContext({ ...f.input, taskContract, context: { ...f.input.context, scope },
    baseInputs: { ...f.input.baseInputs, contractRef: { ...f.input.baseInputs.contractRef, digest: hash(canonical(taskContract)) } } }, f.ports));
  assert.equal(widened.mode, 'base');
  assert.ok(widened.attribution.every(a => a.reasons.includes('EFK_ASSET_SCOPE_DENIED')));
  assert.equal(unwrap(qualification(f.input.registry, valid.candidate.asset, f.input.context)).usable, false);
});

test('cp1 equal-cost revisions use the newer exact revision without a latest lookup', () => {
  const f = fixture(); f.add('versioned', 'same');
  const second = f.revision('versioned', 'same'); second.candidate.asset.revision = 2;
  second.candidate.asset.digest = revisionDigest(second, f.ports.digest);
  f.promote(f.stage(second)); f.input.budget.maxAssets = 1;
  assert.equal(f.retrieve().candidate.assets[0].revision, 2);
});

test('cp1 exact revision lookup rejects substituted identities and duplicate candidates', () => {
  const f = fixture(), rev = f.add('known');
  f.input.candidates = [{ ...rev.candidate.asset, digest: hash('substitution') }];
  const result = f.retrieve();
  assert.equal(result.mode, 'base');
  assert.deepEqual(result.attribution[0].reasons, ['EFK_ASSET_QUALIFICATION_INVALID']);
  f.input.candidates = [rev.candidate.asset, rev.candidate.asset];
  assert.equal(retrieveContext(f.input, f.ports).error.code, 'EFK_SCHEMA_INVALID');
});

test('cp1 complete-packet token boundary is inclusive and oversized trials are ignored', () => {
  const f = fixture(); f.add('first', 'short'); f.add('second', 'long'.repeat(500));
  f.input.budget.maxAssets = 1;
  const single = f.retrieve();
  f.input.budget.maxAddedTokens = single.cost.chargedAddedTokens;
  assert.equal(f.retrieve().mode, 'candidate');
  f.input.budget.maxAddedTokens--;
  const excluded = f.retrieve();
  assert.equal(excluded.mode, 'base'); assert.equal(excluded.candidate, null);
  assert.ok(excluded.attribution.every(a => a.reasons.includes('added-token-budget')));
  assert.deepEqual(excluded.context, f.baseline());
});

test('cp1 clipping skips an unfit asset and continues to a later fitting one', () => {
  const f = fixture(); f.add('first', 'x'); f.add('later', 'yy');
  const native = f.ports.tokenizer;
  f.ports.tokenizer = { id: 'fixture:packet-sensitive/v1', countTokens(text) {
    if (!text.startsWith('{')) return native.countTokens(text);
    const entries = JSON.parse(text).entries;
    return entries.some(e => e.text === 'x') ? 90000 : native.countTokens(text);
  } };
  const result = f.retrieve();
  assert.deepEqual(result.candidate.assets.map(a => a.assetId), ['later']);
  assert.deepEqual(result.attribution.find(a => a.asset.assetId === 'first').reasons, ['context-window-budget']);
});

test('cp1 retrieval metadata must bind to the actual task/node session, base and time', () => {
  const f = fixture(); f.add('known');
  for (const edit of [{ taskId: 'wrong-task' }, { hostSessionId: 'wrong-session' }, { baseDigest: hash('wrong-base') },
    { at: 21 }, { scope: { ...f.input.context.scope, writeResources: ['outside-task'] } }]) {
    assert.equal(retrieveContext({ ...f.input, context: { ...f.input.context, ...edit } }, f.ports).error.code,
      'EFK_ARTIFACT_BINDING_MISMATCH');
  }
});

test('cp1 explicit budgets reject absent, fractional, negative or out-of-protocol values', () => {
  const f = fixture();
  for (const budget of [{ maxAssets: 6, maxAddedTokens: 100 }, { maxAssets: -1, maxAddedTokens: 100 },
    { maxAssets: 1, maxAddedTokens: undefined }, { maxAssets: 1, maxAddedTokens: -1 }, { maxAssets: 0.5, maxAddedTokens: 100 }]) {
    assert.equal(retrieveContext({ ...f.input, budget }, f.ports).error.code, 'EFK_SCHEMA_INVALID');
  }
});
