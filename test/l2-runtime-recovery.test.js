import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionService } from '../dist/runtime/session/index.js';
import { createMemoryEventStore } from '../dist/storage/index.js';
import { harness, value, usage, canonical, digestPort, node, graph } from './l2-runtime-support.test.js';

test('runtime cp2 failed atomic intention commit never dispatches or reserves', async () => {
  const h = harness();
  const append = h.store.append;
  h.store.append = request => request.effects.length > 0
    ? { ok: false, error: { code: 'EFK_REVISION_CONFLICT', message: 'injected commit fault' } } : append(request);
  assert.equal((await h.step()).error.code, 'EFK_REVISION_CONFLICT');
  assert.equal(h.read().budget.requestCount, 0);
  assert.equal(h.read().intents.length, 0);
  assert.equal(h.calls.execute, 0);
});

test('runtime cp2 claim committed before crash restores as unknown and is never resent', async () => {
  const h = harness();
  h.ports.host = { ...h.host, execute: async () => { h.calls.execute++; throw new Error('crash after claim'); } };
  await assert.rejects(h.step(), /crash after claim/);
  assert.deepEqual(h.read().unknownEffectIds, [h.effectId('nA')]);
  assert.equal(h.read().budget.reservations.length, 1);
  const exported = value(h.service.close(h.seed.sessionId));
  const restored = createMemoryEventStore({ digest: digestPort });
  value(restored.restoreSession(exported));
  const reopened = createSessionService({ ...h.ports, store: restored });
  assert.equal(canonical(value(reopened.open(h.seed))), canonical(h.read()));
  value(await reopened.step(h.seed.sessionId));
  assert.equal(h.calls.execute, 1, 'restart did not retry the unknown effect');
  const report = value(await reopened.reconcile(h.seed.sessionId));
  assert.deepEqual(report.notExecuted, [h.effectId('nA')]);
  assert.equal(value(reopened.read(h.seed.sessionId)).budget.reservations.length, 0);
  assert.equal(h.calls.execute, 1);
});

test('runtime cp2 unknown evidence stays unknown until an actual reconcile receipt', async () => {
  const h = harness();
  h.script.outcomes[h.effectId('nA')] = 'unknown';
  value(await h.step());
  const first = value(await h.service.reconcile(h.seed.sessionId));
  assert.deepEqual(first.unknown, [h.effectId('nA')]);
  assert.equal(h.read().nodeStates[0].state, 'unknown');
  assert.equal(h.read().budget.reservations.length, 1);
  h.script.reconcile[h.effectId('nA')] = 'completed';
  h.script.usage[h.effectId('nA')] = [usage(h.requestId('nA'))];
  assert.deepEqual(value(await h.service.reconcile(h.seed.sessionId)).resolved, [h.effectId('nA')]);
  assert.equal(h.read().nodeStates[0].state, 'verifying');
  assert.equal(h.read().budget.settlements.length, 1);
  assert.equal(h.calls.execute, 1);
});

test('runtime DoD2 old epoch receipt is archived without node or usage consumption', async () => {
  const h = harness();
  h.script.outcomes[h.effectId('nA')] = 'unknown';
  value(await h.step());
  const effect = h.read().effects[h.effectId('nA')];
  value(h.service.pause(h.seed.sessionId, { commandId: 'pause-1', expectedRevision: h.read().revision, reason: 'human' }));
  const manifestRef = { ...h.persist('manifest', 'HostManifest', {}), digest: h.seed.graphRef.digest };
  value(h.service.resume(h.seed.sessionId, { commandId: 'resume-1', expectedRevision: h.read().revision, epoch: 2, manifestRef }));
  const receipt = h.receipt(effect, { usage: [usage(h.requestId('nA'))] });
  assert.equal(value(h.service.receive(h.seed.sessionId, receipt)).disposition, 'archived');
  assert.equal(h.read().nodeStates[0].state, 'unknown');
  assert.equal(h.read().budget.settlements.length, 0);
  assert.equal(h.read().budget.reservations.length, 1);
  assert.deepEqual(h.read().archivedReceiptIds, [receipt.receiptId]);
  assert.equal(value(h.service.receive(h.seed.sessionId, receipt)).disposition, 'duplicate');
  value(await h.step());
  assert.equal(h.calls.execute, 1);
});

test('runtime cp2 physical webhooks for one invocation settle usage exactly once', async () => {
  const h = harness();
  h.script.usage[h.effectId('nA')] = [usage(h.requestId('nA'))];
  value(await h.step());
  const original = h.fake.receiptFor(h.effectId('nA'));
  const revision = h.read().revision;
  assert.equal(value(h.service.receive(h.seed.sessionId, original)).disposition, 'duplicate');
  assert.equal(h.read().revision, revision);
  value(h.service.receive(h.seed.sessionId, { ...original, receiptId: 'webhook-two' }));
  value(h.service.receive(h.seed.sessionId, { ...original, receiptId: 'webhook-three' }));
  assert.equal(h.read().budget.settlements.length, 1);
  assert.equal(h.read().budget.settlements[0].micros, 37);
  assert.equal(h.read().appliedInvocations.length, 1);
  const snapshot = value(h.service.close(h.seed.sessionId));
  const rebuilt = createMemoryEventStore({ digest: digestPort });
  value(rebuilt.restoreSession(snapshot));
  const reopened = createSessionService({ ...h.ports, store: rebuilt });
  assert.equal(canonical(value(reopened.open(h.seed)).budget), canonical(h.read().budget));
  assert.equal(h.calls.execute, 1);
});

test('runtime cp2 incomplete telemetry can be completed and conflicting usage blocks release', async () => {
  const h = harness();
  h.script.usage[h.effectId('nA')] = [usage(h.requestId('nA'), { complete: false, estimatedUsdMicros: 0 })];
  value(await h.step());
  assert.equal(h.read().budget.reservations.length, 1);
  assert.equal(h.read().budget.settlements.length, 0);
  const original = h.fake.receiptFor(h.effectId('nA'));
  value(h.service.receive(h.seed.sessionId, { ...original, receiptId: 'complete-meter', usage: [usage(h.requestId('nA'))] }));
  assert.equal(h.read().budget.settlements[0].micros, 37);
  assert.equal(h.service.receive(h.seed.sessionId, { ...original, receiptId: 'conflicting-meter', usage: [usage(h.requestId('nA'), { estimatedUsdMicros: 99 })] }).error.code, 'EFK_USAGE_CONFLICT');
  assert.equal(h.read().budget.settlements[0].micros, 37);
  assert.equal(h.read().receipts['conflicting-meter'], undefined);
});

test('runtime cp2 CAS competition commits one journal/outbox batch', () => {
  const h = harness(), state = h.read(), batch = h.round(state);
  value(h.store.append({ sessionId: h.seed.sessionId, requestId: 'winner', expectedRevision: state.revision, epoch: 1, ...batch }));
  assert.equal(h.store.append({ sessionId: h.seed.sessionId, requestId: 'loser', expectedRevision: state.revision, epoch: 1, ...batch }).error.code, 'EFK_REVISION_CONFLICT');
  assert.equal(h.read().intents.length, 1);
  assert.equal(h.read().budget.requestCount, 1);
  assert.equal(h.calls.execute, 0);
});

test('runtime cp2 expired lease cannot dispatch or consume a late receipt', async () => {
  const spec = graph({ nodes: [node('nA', { terminal: true, resources: { exclusive: ['writer'], shared: [] } })],
    resourcePolicy: [{ resourceId: 'writer', mode: 'exclusive', maxHolders: 1 }] });
  const h = harness({ spec });
  const [effect] = h.planOnly();
  h.setNow(7000);
  assert.equal((await h.step()).error.code, 'EFK_LEASE_STALE');
  assert.equal(h.calls.execute, 0);
  const late = h.receipt(effect, { usage: [usage(effect.reservationRef)] });
  assert.equal(value(h.service.receive(h.seed.sessionId, late)).disposition, 'archived');
  assert.equal(h.read().budget.settlements.length, 0);
});

test('runtime cp2 restart rejects a widened budget seed', async () => {
  const h = harness();
  value(await h.step());
  const reopened = createSessionService(h.ports);
  assert.equal(reopened.open({ ...h.seed, policy: { ...h.seed.policy, maxRequests: 100 } }).error.code, 'EFK_SOURCE_PIN_DRIFT');
  assert.equal(h.calls.execute, 1);
});

test('runtime cp2 reused invocation identity cannot consume a second effect reservation', async () => {
  const h = harness({ spec: graph({ nodes: [node('nA', { terminal: true }), node('nB', { terminal: true })] }) });
  h.script.hostInvocationId = { [h.effectId('nA')]: 'same-native-invocation', [h.effectId('nB')]: 'same-native-invocation' };
  h.script.usage[h.effectId('nA')] = [usage(h.requestId('nA'))];
  h.script.usage[h.effectId('nB')] = [usage(h.requestId('nB'))];
  assert.equal((await h.step()).error.code, 'EFK_USAGE_CONFLICT');
  assert.equal(h.read().budget.settlements.length, 1);
  assert.equal(h.read().budget.reservations.length, 1);
  assert.equal(h.read().appliedInvocations.length, 1);
  assert.equal(h.read().nodeStates.find(n => n.nodeId === 'nB').state, 'leased');
  assert.ok(h.read().unknownEffectIds.includes(h.effectId('nB')));
});

test('runtime cp2 output metadata without actual artifact bytes cannot advance state', () => {
  const schema = { name: 'Output', version: '1', digest: digestPort.digest('output-schema') };
  const h = harness({ spec: graph({ nodes: [node('nA', { terminal: true, outputSchemas: [schema] })] }) });
  const [effect] = h.planOnly();
  value(h.store.dispatchEffect(h.seed.sessionId, { expectedRevision: h.read().revision, epoch: 1, effectId: effect.effectId, claimId: 'claim' }));
  const ref = { protocol: effect.protocol, id: 'absent-output', digest: digestPort.digest('absent'), binding: effect.binding,
    producer: { actorId: 'host', kind: 'host-adapter', identityRef: null }, schema, location: 'absent',
    visibility: 'internal', expiresAt: null, partition: 'not-evaluation' };
  const before = h.read().revision;
  assert.equal(h.service.receive(h.seed.sessionId, h.receipt(effect, { artifactRefs: [ref] })).error.code, 'EFK_ARTIFACT_UNAVAILABLE');
  assert.equal(h.read().revision, before);
  assert.equal(h.read().nodeStates[0].state, 'leased');
});
