import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../dist/kernel/store/index.js';
import { revocationFixture, unwrap, denied } from './l4-revocation-fixtures.test.js';

for (const partition of ['train', 'held-out', 'final']) test(`feedback boundary rejects ${partition} before signal reads or authority calls`, async () => {
  const f = await revocationFixture(), ref = f.signal(2, {}, { partition });
  let hiddenReads = 0;
  const get = f.artifacts.get;
  f.artifacts.get = r => { if (r.id === ref.id) hiddenReads++; return get(r); };
  const before = canonical(f.state()), ids = f.artifacts.ids();
  denied(await f.revocation.monitor(f.request(2, [ref])), 'EFK_PRIVACY_VIOLATION');
  assert.equal(hiddenReads, 0); assert.equal(f.monitoring.verifies, 0);
  assert.deepEqual(f.artifacts.ids(), ids); assert.equal(canonical(f.state()), before);
  assert.deepEqual(unwrap(f.revocation.inspect()), []); assert.equal(f.calls.execute, 0);
});

for (const visibility of ['held-out', 'final']) test(`feedback boundary rejects ${visibility} visibility despite a dev split label`, async () => {
  const f = await revocationFixture(), ref = f.signal(2, {}, { visibility });
  denied(await f.revocation.monitor(f.request(2, [ref])), 'EFK_PRIVACY_VIOLATION');
  assert.equal(f.monitoring.verifies, 0);
});

test('feedback boundary relabelled final metadata fails trusted origin verification', async () => {
  const f = await revocationFixture(), final = f.signal(2, {}, { partition: 'final', visibility: 'final' });
  const disguised = { ...final, partition: 'dev', visibility: 'private' };
  denied(await f.revocation.monitor(f.request(2, [disguised])), 'EFK_AUTHORITY_DENIED');
  assert.deepEqual(unwrap(f.revocation.inspect()), []);
});

test('feedback boundary mixed valid and final evidence is rejected before consuming either', async () => {
  const f = await revocationFixture(), refs = [f.signal(), f.signal(2, {}, { partition: 'final' })];
  denied(await f.revocation.monitor(f.request(2, refs)), 'EFK_PRIVACY_VIOLATION'); assert.equal(f.monitoring.verifies, 0);
});

for (const [name, change, metadata, code] of [
  ['wrong producer', {}, { producer: { actorId: 'author', kind: 'evaluator', identityRef: null } }, 'EFK_DECISION_AUTHORITY_DENIED'],
  ['other asset', { asset: null }, {}, 'EFK_SCHEMA_INVALID'],
  ['other model', { context: 'other-model' }, {}, 'EFK_ARTIFACT_BINDING_MISMATCH'],
  ['future', { measuredAt: 21 }, {}, 'EFK_ARTIFACT_BINDING_MISMATCH'],
  ['extra hidden field', { finalScore: 'SECRET_FINAL_FEEDBACK' }, {}, 'EFK_SCHEMA_INVALID'],
  ['source mismatch', { source: 'online' }, {}, 'EFK_ARTIFACT_BINDING_MISMATCH'],
  ['nonfinite', { value: null }, {}, 'EFK_SCHEMA_INVALID'],
]) test(`feedback boundary rejects ${name} without a revocation or feedback copy`, async () => {
  const f = await revocationFixture();
  const changes = change.context === 'other-model' ? { ...change, context: { ...f.context, model: { ...f.context.model, providerModel: 'other/model' } } } : change;
  const ref = f.signal(2, changes, metadata), before = canonical(f.state());
  denied(await f.revocation.monitor(f.request(2, [ref])), code);
  assert.equal(canonical(f.state()), before); assert.deepEqual(unwrap(f.revocation.inspect()), []);
});

test('ordinary task view contains only exact activated versions, never monitoring or evaluation references', async () => {
  const f = await revocationFixture(); await f.activate(await f.promote(1));
  const serialized = canonical(f.revocation.ordinaryView(f.context));
  for (const forbidden of ['evaluationRef', 'signalRefs', 'reasons', 'evidenceRef', 'QualitySignal', 'EvaluationReceipt']) assert.ok(!serialized.includes(forbidden));
  const result = unwrap(await f.ordinary()); assert.equal(result.receipt.status, 'completed');
});

test('feedback boundary refuses a caller subset that omits an attested regression measurement', async () => {
  const f = await revocationFixture(), bad = f.signal(), good = f.signal(2, { value: 0.95 });
  denied(await f.revocation.monitor(f.request(2, [good])), 'EFK_EVALUATION_PROTOCOL_MISMATCH');
  assert.deepEqual(unwrap(f.revocation.inspect()), []);
  const complete = unwrap(await f.revocation.monitor(f.request(2, [bad, good])));
  assert.ok(complete.reasons.includes('quality-below:task_success'));
});
