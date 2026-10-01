import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionService } from '../dist/runtime/session/index.js';
import { createMemoryEventStore } from '../dist/storage/index.js';
import { fail } from '../dist/protocol/index.js';
import { harness, value, usage, digestPort, node, graph } from './l2-runtime-support.test.js';

test('runtime cp3 pause blocks new dispatch while preserving in-flight work', async () => {
  const h = harness({ spec: graph({ nodes: [node('nA', { terminal: true }), node('nB', { terminal: true })] }) });
  let finish, entered;
  const inHost = new Promise(resolve => { entered = resolve; });
  h.ports.host = { ...h.host, execute: authorized => {
    h.calls.execute++;
    entered();
    return new Promise(resolve => { finish = () => resolve(h.fake.execute(authorized)); });
  } };
  const step = h.step();
  await inHost;
  value(h.service.pause(h.seed.sessionId, { commandId: 'pause-flight', expectedRevision: h.read().revision, reason: 'review' }));
  assert.equal(h.read().epoch, 1);
  assert.equal(h.read().dispatchMode, 'paused');
  assert.equal(h.read().nodeStates.find(n => n.nodeId === 'nA').state, 'leased');
  finish();
  value(await step);
  assert.equal(h.calls.execute, 1);
  assert.equal(h.read().nodeStates.find(n => n.nodeId === 'nA').state, 'verifying');
  assert.equal(h.read().intents.length, 1);
  value(await h.step());
  assert.equal(h.calls.execute, 1);
});

test('runtime cp3 resume advances epoch and preserves unknown without redispatch', async () => {
  const h = harness();
  h.script.outcomes[h.effectId('nA')] = 'unknown';
  value(await h.step());
  value(h.service.pause(h.seed.sessionId, { commandId: 'pause', expectedRevision: h.read().revision, reason: 'recovery' }));
  const manifestRef = { ...h.persist('manifest', 'HostManifest', {}), digest: h.seed.graphRef.digest };
  const command = { commandId: 'resume', expectedRevision: h.read().revision, epoch: 2, manifestRef };
  value(h.service.resume(h.seed.sessionId, command));
  assert.equal(h.read().epoch, 2);
  assert.equal(h.calls.resume, 1);
  const revision = h.read().revision;
  value(h.service.resume(h.seed.sessionId, command));
  assert.equal(h.read().revision, revision);
  assert.equal(h.calls.resume, 1);
  value(await h.step());
  assert.deepEqual(h.read().unknownEffectIds, [h.effectId('nA')]);
  assert.equal(h.calls.execute, 1);
});

test('runtime cp3 resume admission failure leaves epoch and mode unchanged', () => {
  const h = harness({ resumeError: fail('EFK_HOST_SESSION_MISMATCH', 'wrong native session') });
  value(h.service.pause(h.seed.sessionId, { commandId: 'pause', expectedRevision: h.read().revision, reason: 'review' }));
  const before = h.read();
  const manifestRef = h.persist('manifest', 'HostManifest', {});
  const refused = h.service.resume(h.seed.sessionId, { commandId: 'resume', expectedRevision: before.revision, epoch: 2, manifestRef });
  assert.equal(refused.error.code, 'EFK_HOST_SESSION_MISMATCH');
  assert.equal(h.read().revision, before.revision);
  assert.equal(h.read().epoch, 1);
  assert.equal(h.read().dispatchMode, 'paused');
});

test('runtime cp3 unconfirmed cancel stays unknown and retains spent-or-unknown reservation', async () => {
  const h = harness();
  h.script.outcomes[h.effectId('nA')] = 'unknown';
  value(await h.step());
  const request = { commandId: 'cancel-one', expectedRevision: h.read().revision, reason: 'user-stop' };
  const report = value(await h.service.cancel(h.seed.sessionId, request));
  assert.equal(report.status, 'unknown');
  assert.equal(report.error.code, 'EFK_CANCEL_UNCONFIRMED');
  assert.equal(h.read().cancellation, 'unconfirmed');
  assert.equal(h.read().nodeStates[0].state, 'unknown');
  assert.equal(h.read().budget.reservations.length, 1);
  assert.equal(h.read().dispatchMode, 'cancelling');
  const calls = h.calls.execute;
  value(await h.service.cancel(h.seed.sessionId, request));
  value(await h.step());
  assert.equal(h.calls.execute, calls);
});

test('runtime cp3 native cancel acknowledgement releases leases but does not invent free usage', async () => {
  const spec = graph({ nodes: [node('nA', { terminal: true, resources: { exclusive: ['writer'], shared: [] } })],
    resourcePolicy: [{ resourceId: 'writer', mode: 'exclusive', maxHolders: 1 }] });
  const h = harness({ spec });
  h.script.outcomes[h.effectId('nA')] = 'unknown';
  h.script.cancelConfirmed[h.effectId('nA')] = true;
  value(await h.step());
  assert.equal(h.read().scheduler.leases.grants.length, 1);
  const report = value(await h.service.cancel(h.seed.sessionId, { commandId: 'cancel-confirm', expectedRevision: h.read().revision, reason: 'user-stop' }));
  assert.equal(report.status, 'cancelled');
  assert.equal(h.read().dispatchMode, 'cancelled');
  assert.equal(h.read().nodeStates[0].state, 'cancelled');
  assert.equal(h.read().scheduler.leases.grants.length, 0);
  assert.equal(h.read().unknownEffectIds.length, 0);
  assert.equal(h.read().budget.reservations.length, 1);
  assert.equal(h.read().budget.settlements.length, 0);
});

test('runtime cp3 unclaimed effects cancel atomically without host calls and release proven unspent', async () => {
  const h = harness();
  h.planOnly();
  const report = value(await h.service.cancel(h.seed.sessionId, { commandId: 'cancel-before-send', expectedRevision: h.read().revision, reason: 'stop' }));
  assert.equal(report.status, 'cancelled');
  assert.equal(h.calls.execute, 0);
  assert.equal(h.read().budget.reservations.length, 0);
  assert.equal(h.read().budget.settlements[0].micros, 0);
  assert.equal(h.read().intents.length, 0);
});

test('runtime cp3 command replay survives restored journal and rejects changed identity content', () => {
  const h = harness();
  const request = { commandId: 'pause-replay', expectedRevision: h.read().revision, reason: 'review' };
  const original = value(h.service.pause(h.seed.sessionId, request));
  const store = createMemoryEventStore({ digest: digestPort });
  value(store.restoreSession(value(h.service.close(h.seed.sessionId))));
  const restarted = createSessionService({ ...h.ports, store });
  value(restarted.open(h.seed));
  assert.deepEqual(value(restarted.pause(h.seed.sessionId, request)), original);
  assert.equal(restarted.pause(h.seed.sessionId, { ...request, reason: 'changed' }).error.code, 'EFK_IDEMPOTENCY_COLLISION');
  assert.equal(value(restarted.read(h.seed.sessionId)).revision, original.revision);
});

test('runtime cp3 shared request cap does not duplicate across concurrent intentions', async () => {
  const h = harness({ spec: graph({ nodes: [node('nA', { terminal: true }), node('nB', { terminal: true })] }),
    budget: { maxRequests: 1, maxConcurrentRequests: 1 } });
  h.script.outcomes[h.effectId('nA')] = 'unknown';
  value(await h.step());
  assert.equal(h.calls.execute, 1);
  assert.equal(h.read().budget.requestCount, 1);
  assert.equal(h.read().budget.reservations.length, 1);
  assert.equal((await h.step()).error.code, 'EFK_BUDGET_EXHAUSTED');
  assert.equal(h.calls.execute, 1);
});

test('runtime cp3 missing usage never becomes zero after completed host work', async () => {
  const h = harness();
  value(await h.step());
  assert.equal(h.read().budget.settlements.length, 0);
  assert.equal(h.read().budget.reservations[0].reservedMicros, 100);
  const receipt = h.fake.receiptFor(h.effectId('nA'));
  value(h.service.receive(h.seed.sessionId, { ...receipt, receiptId: 'meter-later', usage: [usage(h.requestId('nA'))] }));
  assert.equal(h.read().budget.settlements[0].micros, 37);
});

test('runtime cp3 cancellation of settled verifying work preserves its receipt and settles lifecycle', async () => {
  const h = harness();
  value(await h.step());
  const original = h.fake.receiptFor(h.effectId('nA'));
  value(await h.service.cancel(h.seed.sessionId, { commandId: 'cancel-verified', expectedRevision: h.read().revision, reason: 'stop-before-evaluation' }));
  assert.equal(h.read().nodeStates[0].state, 'cancelled');
  assert.deepEqual(h.read().receipts[original.receiptId], original);
  assert.equal(h.read().budget.reservations.length, 1);
  assert.equal(h.calls.execute, 1);
});

test('runtime cp3 multi-target native cancellation commits distinct acknowledgements atomically', async () => {
  const h = harness({ spec: graph({ nodes: [node('nA', { terminal: true }), node('nB', { terminal: true })] }) });
  for (const name of ['nA', 'nB']) {
    h.script.outcomes[h.effectId(name)] = 'unknown';
    h.script.cancelConfirmed[h.effectId(name)] = true;
  }
  value(await h.step());
  const report = value(await h.service.cancel(h.seed.sessionId, { commandId: 'cancel-both', expectedRevision: h.read().revision, reason: 'stop' }));
  assert.equal(report.status, 'cancelled');
  assert.equal(h.read().unknownEffectIds.length, 0);
  assert.ok(h.read().nodeStates.every(n => n.state === 'cancelled'));
  assert.equal(new Set(h.read().events.map(e => e.eventId)).size, h.read().events.length);
  assert.equal(h.read().budget.reservations.length, 2);
});
