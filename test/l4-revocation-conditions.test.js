import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, storeFail } from '../dist/kernel/store/index.js';
import { qualification } from '../dist/learning/assets/index.js';
import { invalidity } from '../dist/evaluation/revocation/index.js';
import { revocationFixture, unwrap, denied, hash } from './l4-revocation-fixtures.test.js';

for (const [name, change, reason] of [
  ['host version', c => ({ ...c, hostVersion: '2' }), 'host-changed'],
  ['host identity', c => ({ ...c, hostId: 'other-host' }), 'host-changed'],
  ['host manifest', c => ({ ...c, hostManifestRef: { ...c.hostManifestRef, digest: hash('other') } }), 'host-changed'],
  ['model', c => ({ ...c, model: { ...c.model, providerModel: 'other/model' } }), 'model-changed'],
  ['reasoning', c => ({ ...c, model: { ...c.model, reasoningRequested: 'low' } }), 'model-changed'],
  ['payload', c => ({ ...c, model: { ...c.model, payloadRef: { ...c.model.payloadRef, digest: hash('other') } } }), 'model-changed'],
  ['repo', c => ({ ...c, repoId: 'other-repo' }), 'scope-changed'],
  ['base', c => ({ ...c, baseDigest: hash('other-base') }), 'scope-changed'],
  ['task', c => ({ ...c, taskId: 'outside-task' }), 'scope-changed'],
  ['scope', c => ({ ...c, scope: { ...c.scope, writeResources: ['outside'] } }), 'scope-changed'],
]) test(`DoD1 ${name} invalidates qualification and stops use`, async () => {
  const f = await revocationFixture(); await f.activate(await f.promote(1));
  const context = change(f.context);
  // Scope invalidation needs preauthorized revoke authority within the changed scope.
  if (name === 'scope') {
    f.settings.rule.authority.root.scope = context.scope;
    f.settings.rule.authority.parent.scope = context.scope;
    f.settings.rule.authority.task = context.scope;
  }
  const result = unwrap(await f.revocation.monitor(f.request(1, [], { context })));
  assert.ok(result.reasons.includes(reason));
  assert.equal(unwrap(qualification(f.state().registry, f.revisions[0].candidate.asset, f.context)).usable, false);
  assert.deepEqual(f.revocation.ordinaryView(f.context).versions, []);
  assert.equal(f.calls.execute, 1);
});

test('cp1 quality threshold stops use at first bad dev observation', async () => {
  const f = await revocationFixture(); await f.activate(await f.promote(2));
  const record = unwrap(await f.revocation.monitor(f.request()));
  assert.deepEqual(record.reasons, ['quality-below:task_success']);
  assert.equal(unwrap(qualification(f.state().registry, record.root, f.context)).eligible, false);
  assert.deepEqual(f.revocation.ordinaryView(f.context).versions, []);
});

test('cp1 online signal is supported and a threshold equality remains usable', async () => {
  const f = await revocationFixture(); await f.activate(await f.promote(1));
  const signal = f.signal(1, { source: 'online', value: 0.8 }, { partition: 'not-evaluation' });
  const before = canonical(f.state());
  assert.equal(unwrap(await f.revocation.monitor(f.request(1, [signal]))), null);
  assert.equal(canonical(f.state()), before); assert.equal(f.revocation.ordinaryView(f.context).versions.length, 1);
});

test('cp1 expired candidate qualification stops use at the inclusive deadline', async () => {
  const f = await revocationFixture({ candidateExpiry: 30 }); await f.activate(await f.promote(1));
  f.setNow(30);
  const record = unwrap(await f.revocation.monitor(f.request(1, [])));
  assert.ok(record.reasons.includes('qualification-expired'));
  assert.equal(unwrap(qualification(f.state().registry, record.root, { ...f.context, at: 30 })).usable, false);
});

test('cp1 expired evaluation qualifies neither current use nor rollback', async () => {
  const f = await revocationFixture({ evaluationExpiry: 30 }); await f.activate(await f.promote(1));
  f.setNow(30);
  const record = unwrap(await f.revocation.monitor(f.request(1, [])));
  assert.ok(record.reasons.includes('qualification-expired')); assert.equal(record.restores[0].targetPromotionId, null);
});

test('cp1 missing or expired required quality disables learning', async () => {
  for (const expired of [false, true]) {
    const f = await revocationFixture(); f.monitoring.policy.requireQuality = true;
    await f.activate(await f.promote(1));
    const refs = expired ? [f.signal(1, { value: 0.9 })] : [];
    if (expired) f.setNow(120);
    const record = unwrap(await f.revocation.monitor(f.request(1, refs)));
    assert.ok(record.reasons.includes(expired ? 'quality-expired:task_success' : 'quality-missing:task_success'));
    assert.deepEqual(f.revocation.ordinaryView(f.context).versions, []);
  }
});

test('cp1 latest observation wins and tied bad observations cannot be hidden by order', async () => {
  const f = await revocationFixture();
  const old = { asset: f.revisions[0].candidate.asset, context: f.context, source: 'dev', metric: 'task_success', value: 0.1, measuredAt: 10 };
  const good = { ...old, measuredAt: 20, value: 0.9 };
  assert.deepEqual(unwrap(invalidity(f.state().registry, old.asset, f.context, f.monitoring.policy, [good, old])), []);
  const tied = { ...good, value: 0.1 };
  for (const signals of [[good, tied], [tied, good]]) assert.deepEqual(unwrap(invalidity(f.state().registry, old.asset,
    f.context, f.monitoring.policy, signals)), ['quality-below:task_success']);
});

test('cp1 authority refusal never partially revokes dependencies', async () => {
  const f = await revocationFixture({ count: 3, dependencies: { 3: [2] } });
  f.settings.rule.assets = [f.revisions[1].candidate.asset];
  const before = canonical(f.state());
  denied(await f.revocation.monitor(f.request()), 'EFK_AUTHORITY_DENIED');
  assert.equal(canonical(f.state()), before); assert.deepEqual(unwrap(f.revocation.inspect()), []);
});

test('cp1 invalid threshold policy and missing evidence are typed refusals', async () => {
  const f = await revocationFixture(); f.monitoring.policy.maxAgeMs = -1;
  denied(await f.revocation.monitor(f.request()), 'EFK_SCHEMA_INVALID');
  f.monitoring.policy.maxAgeMs = 100;
  const signal = f.signal(); f.revocationPorts.verifySignal = () => storeFail('EFK_ARTIFACT_UNAVAILABLE', 'missing attestation');
  denied(await f.revocation.monitor(f.request(2, [signal])), 'EFK_ARTIFACT_UNAVAILABLE');
});
