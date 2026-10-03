import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeTaskEvaluator } from '../dist/runtime/session/evaluation.js';
import { readArtifact } from '../dist/kernel/artifacts/index.js';
import { audit } from '../verification/kernel/static-audit.mjs';
import { contract, registration, digest, schema, issuer, value } from './l3-eval-fixtures.test.js';
import { harness, usage, canonical, node, graph } from './l2-runtime-support.test.js';
import { edge, predicate } from './l2-scheduler-fixtures.mjs';

function runtime(options = {}) {
  const task = contract({ requiredBranches: options.branches ?? [] });
  const taskContractRef = { taskId: task.taskId, version: task.version, digest: digest.digest(canonical(task)) };
  const spec = options.spec ?? graph({ nodes: [node('nA', { terminal: true })] });
  const h = harness({ spec: { ...spec, taskContractRef } });
  let evaluated = 0;
  function observation(id, name, data, binding, changes = {}) {
    const bytes = canonical(data);
    const ref = { protocol: task.protocol, id, digest: digest.digest(bytes), producer: issuer, binding,
      schema: schema(name), location: `independent:${id}`, visibility: 'internal', expiresAt: null,
      partition: 'dev', ...changes };
    value(h.artifacts.put(ref, bytes)); return ref;
  }
  const evaluator = createRuntimeTaskEvaluator({ task,
    registration: registration({ hostProducer: { actorId: 'host', kind: 'host-adapter', identityRef: null } }), artifacts: h.artifacts,
    clock: h.ports.clock, digest: h.ports.digest,
    observations: async (_seed, _state, receipt) => {
      evaluated++;
      if (options.summary) return { ok: true, value: [observation('summary', 'AgentSummary', options.summary, receipt.binding)] };
      return { ok: true, value: [
        observation('private-tests', 'TestsObservation', options.failed
          ? { total: 2, passed: 1, failed: 1, skipped: 0, exitCode: 1 } : { total: 2, passed: 2, failed: 0, skipped: 0, exitCode: 0 },
        receipt.binding, { visibility: 'private', partition: 'held-out' }),
        observation('outcomes', 'OutcomeObservation', { outcomes: [{ outcomeId: 'out-1', met: true }] }, receipt.binding),
        observation('product', 'Deliverable', 'real product', receipt.binding, { producer: { actorId: 'kernel', kind: 'kernel', identityRef: null } }),
      ] };
    } });
  h.ports.evaluator = evaluator;
  for (const n of spec.nodes) h.script.usage[h.effectId(n.nodeId)] = [usage(h.requestId(n.nodeId))];
  return { ...h, task, evaluated: () => evaluated };
}
function record(h) {
  const event = h.read().events.find(e => e.type === 'decision.recorded');
  return { event, decision: JSON.parse(value(h.artifacts.get(event.payload.objectRef))) };
}

test('cp3 real session path calls the registered service then graph.decide and one atomic journal batch', async t => {
  const h = runtime(); value(await h.step());
  const before = h.read();
  assert.equal(before.nodeStates[0].state, 'verifying');
  assert.equal(h.evaluated(), 0);
  value(await h.service.evaluate(h.seed.sessionId, h.effectId('nA')));
  const after = h.read(), { event, decision } = record(h);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.nodeStates[0].state, 'succeeded', JSON.stringify({ reasons: decision.reasons, usage: after.usageIssues,
    reservations: after.budget.reservations }));
  assert.equal(h.evaluated(), 1);
  const batch = after.events.filter(e => e.revision === after.revision);
  assert.deepEqual(batch.map(e => e.type), ['decision.recorded', 'node.transition']);
  assert.ok(batch.every(e => e.causedBy === event.causedBy && e.payload.decisionId === decision.decisionId));
  assert.ok(decision.inputs.some(r => r.schema.name === 'Receipt'));
  t.diagnostic(JSON.stringify({ trace: after.events.map(e => ({ sequence: e.sequence, revision: e.revision, type: e.type,
    after: e.payload.after, visibility: e.visibility })), outcome: decision.outcome, evaluatorCalls: h.evaluated(),
    hostExecuteCalls: h.calls.execute, evidenceKind: 'native-fixture' }));
});

test('cp3 runtime self-claimed completion remains unknown with explicit missing measurements', async () => {
  const h = runtime({ summary: 'I completed the task.' }); value(await h.step());
  value(await h.service.evaluate(h.seed.sessionId, h.effectId('nA')));
  assert.equal(record(h).decision.outcome, 'unknown');
  assert.equal(h.read().nodeStates[0].state, 'unknown');
});

test('cp3 runtime private report, decision and events never grant author read access', async () => {
  const h = runtime({ failed: true }); value(await h.step());
  value(await h.service.evaluate(h.seed.sessionId, h.effectId('nA')));
  const { event, decision } = record(h);
  assert.equal(decision.outcome, 'failed');
  assert.equal(event.visibility, 'private');
  for (const ref of [event.payload.objectRef, decision.taskEvidenceRef]) {
    assert.equal(ref.visibility, 'private');
    assert.equal(readArtifact(ref, 'author', 1000, h.artifacts).error.code, 'EFK_PRIVACY_VIOLATION');
    assert.equal(readArtifact(ref, 'evaluator', 1000, h.artifacts).ok, true);
  }
  for (const id of h.artifacts.ids()) {
    const refs = h.read().events.flatMap(e => e.payload.objectRef === null ? [] : [e.payload.objectRef]);
    const ref = refs.find(r => r.id === id);
    if (ref?.visibility === 'internal') assert.equal(value(h.artifacts.get(ref)).includes('private-tests'), false);
  }
});

test('cp3 runtime repair appends a new attempt and retains original failed decision/evidence', async () => {
  const spec = graph({ nodes: [node('nA'), node('nB', { terminal: true })], typedEdges: [
    edge('repair', 'repair', 'nA', 'nB', { when: predicate('eq', 'decision.outcome', 'repair'), maxAttempts: 2 }),
  ] });
  const h = runtime({ spec, failed: true }); value(await h.step());
  value(await h.service.evaluate(h.seed.sessionId, h.effectId('nA')));
  assert.equal(record(h).decision.outcome, 'repair');
  assert.equal(h.read().nodeStates.find(n => n.nodeId === 'nA' && n.attemptOrdinal === 1).state, 'failed');
  assert.equal(h.read().nodeStates.find(n => n.nodeId === 'nB' && n.attemptOrdinal === 2).state, 'pending');
  assert.equal(h.read().events.filter(e => e.type === 'decision.recorded').length, 1);
});

test('cp3 runtime failed CAS cannot publish a successful node or decision event', async () => {
  const h = runtime(); value(await h.step());
  const before = h.read(), append = h.store.append;
  h.store.append = request => request.events.some(e => e.type === 'decision.recorded')
    ? { ok: false, error: { code: 'EFK_REVISION_CONFLICT', message: 'injected CAS failure' } } : append(request);
  assert.equal((await h.service.evaluate(h.seed.sessionId, h.effectId('nA'))).error.code, 'EFK_REVISION_CONFLICT');
  assert.equal(canonical(h.read()), canonical(before));
});

test('cp3 static audit retains the sole graph decision wiring and zero violations', () => {
  const result = audit();
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.secondDecisionCalls, []);
  assert.ok(result.calls.some(c => c.file === 'src/runtime/session/evaluation.ts' && c.exported === 'createTaskEvaluator'));
  assert.equal(result.entrypoints.filter(e => e.file === 'src/runtime/session/evaluation.ts' && e.exported === 'decide').length, 1);
});
