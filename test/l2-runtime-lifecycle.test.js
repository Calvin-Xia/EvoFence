import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionService, initialState, reduce, project } from '../dist/runtime/session/index.js';
import { harness, value, usage, canonical, node, graph, PROTOCOL } from './l2-runtime-support.test.js';
import { edge, predicate } from './l2-scheduler-fixtures.mjs';

test('runtime cp1 factory is inert and create/read/close perform no host execution', () => {
  const service = createSessionService(new Proxy({}, { get() { throw new Error('factory touched a port'); } }));
  assert.equal(typeof service.step, 'function');
  const h = harness();
  assert.equal(h.read().revision, 1);
  assert.equal(h.read().dispatchMode, 'active');
  value(h.service.close(h.seed.sessionId));
  assert.equal(h.calls.execute, 0);
});

test('runtime DoD1 identical initial state and events yield identical projection and intentions', async () => {
  const h = harness();
  h.script.usage[h.effectId('nA')] = [usage(h.requestId('nA'))];
  const before = h.read(), copy = canonical(before);
  const a = h.round(before), b = h.round(before);
  assert.equal(canonical(a), canonical(b));
  assert.equal(canonical(before), copy, 'planner must not mutate input');
  value(await h.step());
  const exported = value(h.service.close(h.seed.sessionId));
  const start = value(initialState(exported, h.seed));
  let left = start, right = structuredClone(start);
  for (const event of exported.events) {
    left = value(reduce(left, event)); right = value(reduce(right, structuredClone(event)));
    assert.equal(canonical(left), canonical(right));
  }
  assert.equal(canonical(left), canonical(value(project(exported, h.seed))));
  assert.equal(h.calls.execute, 1);
  assert.equal(h.read().budget.settlements[0].micros, 37);
});

test('runtime cp1 host completion stops at verifying until registered evaluator decides', async () => {
  const h = harness();
  value(await h.step());
  assert.equal(h.read().nodeStates[0].state, 'verifying');
  assert.equal(h.calls.evaluate, 0);
  value(await h.service.evaluate(h.seed.sessionId, h.effectId('nA')));
  assert.equal(h.read().nodeStates[0].state, 'succeeded');
  assert.equal(h.calls.evaluate, 1);
  assert.equal(h.read().events.filter(e => e.type === 'decision.recorded').length, 1);
});

test('runtime cp1 forged evaluator issuer cannot grant task success', async () => {
  const h = harness({ transformDecision: decision => ({ ...decision, issuer: { actorId: 'host', kind: 'host-adapter', identityRef: null } }) });
  value(await h.step());
  const revision = h.read().revision;
  assert.equal((await h.service.evaluate(h.seed.sessionId, h.effectId('nA'))).error.code, 'EFK_DECISION_AUTHORITY_DENIED');
  assert.equal(h.read().revision, revision);
  assert.equal(h.read().nodeStates[0].state, 'verifying');
});

test('runtime cp1 repair preserves failed attempt and creates a distinct attempt', async () => {
  const spec = graph({ nodes: [node('nA'), node('nB', { terminal: true })], typedEdges: [
    edge('repair-a-b', 'repair', 'nA', 'nB', { when: predicate('eq', 'decision.outcome', 'repair'), maxAttempts: 2 }) ] });
  const h = harness({ spec, evaluateOutcome: 'repair' });
  value(await h.step());
  value(await h.service.evaluate(h.seed.sessionId, h.effectId('nA')));
  assert.equal(h.read().nodeStates.find(n => n.nodeId === 'nA').state, 'failed');
  assert.equal(h.read().nodeStates.find(n => n.nodeId === 'nB' && n.attemptOrdinal === 1), undefined);
  assert.equal(h.read().nodeStates.find(n => n.nodeId === 'nB' && n.attemptOrdinal === 2).state, 'pending');
});

test('runtime cp1 denied policy commits no intention and makes no host call', async () => {
  const h = harness({ revokedEpoch: 1 });
  const refused = await h.step();
  assert.equal(refused.error.code, 'EFK_GRANT_REVOKED');
  assert.equal(Object.keys(h.read().effects).length, 0);
  assert.equal(h.calls.execute, 0);
});

test('runtime cp1 dependency failure retains the failed branch and an explicit consumer gap', async () => {
  const spec = graph({ nodes: [node('nA'), node('nB', { terminal: true })], typedEdges: [edge('dep', 'dependency', 'nA', 'nB')] });
  const h = harness({ spec, evaluateOutcome: 'failed' });
  value(await h.step());
  value(await h.service.evaluate(h.seed.sessionId, h.effectId('nA')));
  value(await h.step());
  assert.equal(h.read().nodeStates.find(n => n.nodeId === 'nA').state, 'failed');
  assert.equal(h.read().nodeStates.find(n => n.nodeId === 'nB').state, 'waiting');
});

test('runtime cp1 malformed protocol and journal gaps fail without cached recovery', async () => {
  const h = harness();
  assert.equal(h.service.create({ ...h.seed, sessionId: 'other', epoch: 1, protocol: { ...PROTOCOL, schemaVersion: '9' } }).error.code, 'EFK_PROTOCOL_UNSUPPORTED');
  value(await h.step());
  const exported = value(h.service.close(h.seed.sessionId));
  assert.equal(project({ ...exported, events: exported.events.filter(e => e.sequence !== 1) }, h.seed).error.code, 'EFK_RECOVERY_SEQUENCE_GAP');
});

test('runtime cp1 maximum-length node IDs produce valid compact invocation identities', async () => {
  const nodeId = 'n'.repeat(128);
  const h = harness({ spec: graph({ nodes: [node(nodeId, { terminal: true })] }) });
  value(await h.step());
  assert.equal(h.read().nodeStates[0].nodeId, nodeId);
  assert.equal(h.read().nodeStates[0].state, 'verifying');
});
