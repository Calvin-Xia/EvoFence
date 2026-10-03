import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveContext } from '../dist/learning/retrieval/index.js';
import { fixture as retrievalFixture } from './l4-retrieval-fixtures.test.js';
import { revocationFixture, unwrap } from './l4-revocation-fixtures.test.js';

test('cp1 real retrieval entry stops reading revoked root and derived content and returns the base context', async () => {
  const f = await revocationFixture({ count: 3, dependencies: { 3: [2] } });
  await f.activate(await f.promote(2)); await f.activate(await f.promote(3));
  const base = retrievalFixture(), candidates = f.revisions.slice(1).map(r => r.candidate.asset);
  const materials = f.revisions.slice(1).flatMap(r => r.candidate.contentRefs.map(ref => ({ ref,
    bytes: unwrap(f.artifacts.get(ref)), purpose: 'evidence', expectation: { productKind: 'pre-source', schema: ref.schema, binding: null } })));
  const input = { ...base.input, registry: f.state().registry, candidates, context: f.context, materials,
    baseInputs: { ...base.input.baseInputs, nodeInputRefs: materials.map(m => m.ref) } };
  const ports = { ...base.ports, artifacts: f.artifacts };
  const selected = unwrap(retrieveContext(input, ports));
  assert.equal(selected.mode, 'candidate'); assert.equal(selected.candidate.assets.length, 2);
  unwrap(await f.revocation.monitor(f.request()));
  const stopped = unwrap(retrieveContext({ ...input, registry: f.state().registry }, ports));
  assert.equal(stopped.mode, 'base'); assert.equal(stopped.fallbackReason, 'no-eligible-assets');
  assert.equal(stopped.cost.materialReads, 0); assert.equal(stopped.candidate, null);
  for (const asset of stopped.attribution) assert.ok(asset.reasons.includes('EFK_ASSET_REVOKED'));
});

test('cp3 a new authorized repair after failed rollback restores service without replaying failed effects', async () => {
  const f = await revocationFixture(); const safe = await f.activate(await f.promote(1)); await f.activate(await f.promote(2));
  const input = f.request(), first = unwrap(await f.revocation.monitor(input)); f.settings.outcome = 'failed';
  assert.equal(unwrap(await f.revocation.recover(first.requestId)).status, 'pending');
  f.settings.outcome = 'active';
  const next = unwrap(await f.revocation.monitor({ ...input, requestId: 'explicit-repair' }));
  assert.equal(unwrap(await f.revocation.recover(next.requestId)).status, 'complete');
  assert.deepEqual(f.pointer().snapshot, safe.activation.newSnapshot);
  assert.equal(f.revocation.ordinaryView(f.context).versions[0].asset.revision, 1);
  assert.equal(f.calls.execute, 4);
  const failures = f.state().promotions.filter(p => p.mode === 'rollback' && p.status === 'failed');
  assert.equal(failures.length, 1); assert.equal(f.artifacts.get(first.evidenceRef).ok, true);
});
