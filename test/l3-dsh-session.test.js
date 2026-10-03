import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, value, deadline } from './l3-dsh-fixtures.test.js';
import { nativeUsage, invocationUsage } from '../dist/hosts/dsh/index.js';
import { node, graph, PROTOCOL, digestPort, canonical, harness } from './l2-runtime-support.test.js';
import { packageRoot } from '../scripts/probes/dsh-probe-support.mjs';
import { nativePackageSkipReason } from '../scripts/probes/native-test-support.mjs';

const nativeSkip = nativePackageSkipReason(packageRoot, '@deepseek-ai/dsh', 'EVOFENCE_DSH_PACKAGE_ROOT');
const nativeTest = (name, fn) => test(name, { skip: nativeSkip }, fn);

nativeTest('DoD1: same native session continues and resumes the same kernel journal without model replay', async t => {
  const f = await fixture(); t.after(() => f.close());
  await f.ordinary(); await f.ordinary();
  const status = value(f.binding.status(f.h.seed.sessionId));
  assert.equal(status.sessionId, f.handle.agent.id);
  assert.equal(status.health, 'active');
  const before = value(f.binding.session(status.sessionId)).runtime.close(status.sessionId);
  const count = f.requests.length;
  const resumed = await f.restore();
  assert.equal(f.requests.length, count, 'resume executes no model request');
  assert.notEqual(resumed, f.handle.agent);
  const reopened = value(f.binding.session(status.sessionId));
  assert.equal(reopened.agent, resumed);
  assert.equal(value(reopened.runtime.close(status.sessionId)).events.length, value(before).events.length + 1, 'only disposal pause was committed');
  assert.equal(value(f.binding.status(status.sessionId)).dispatchMode, 'paused');
  const manifest = f.h.persist('native-repin', 'GraphSpec', f.h.seed.graph.spec);
  // Existing PolicyPort pins the graph digest in this fixture, like all L2 lifecycle tests.
  value(f.binding.resume(status.sessionId, manifest));
  assert.equal(value(f.binding.status(status.sessionId)).epoch, 2);
  await f.ordinary(resumed);
  assert(f.requests.every(request => request.sessionId === status.sessionId));
});

nativeTest('cp1: native execution reaches verifying; only the independent evaluator can succeed', async t => {
  const f = await fixture(); t.after(() => f.close());
  value(await f.binding.step(f.h.seed.sessionId));
  const s = value(f.binding.session(f.h.seed.sessionId));
  const state = value(s.runtime.read(f.h.seed.sessionId));
  assert.equal(state.nodeStates[0].state, 'verifying');
  assert.equal(state.effects[Object.keys(state.effects)[0]].binding.hostSessionId, null, 'frozen binding is not rewritten');
  const effectId = Object.keys(state.effects)[0], receipt = Object.values(state.receipts)[0];
  assert.equal(receipt.status, 'completed'); assert(receipt.hostInvocationId);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].model, 'deterministic'); assert.equal(f.requests[0].maxTokens, 128);
  assert.equal(f.requests[0].hostContext, true); assert(f.requests[0].tools.includes('host_echo'));
  value(await f.binding.evaluate(f.h.seed.sessionId, effectId));
  assert.equal(value(s.runtime.read(f.h.seed.sessionId)).nodeStates[0].state, 'succeeded');
  assert.equal(f.h.calls.evaluate, 1);
  assert(f.observations.some(o => o.type === 'user/message'));
});

nativeTest('cp2: additive bounded context preserves native model, tools and host instructions', async t => {
  const bytes = canonical({ text: 'NODE_PACKET' });
  const ref = { protocol: PROTOCOL, id: 'packet-1', digest: digestPort.digest(bytes),
    producer: { actorId: 'author', kind: 'host-adapter', identityRef: null }, binding: null,
    schema: { name: 'NodeContext', version: '1', digest: digestPort.digest('NodeContext') },
    location: 'fixture:packet', visibility: 'internal', partition: 'not-evaluation', expiresAt: null };
  const h = harness({ spec: graph({ nodes: [node('nA', { terminal: true,
    contextPlan: { inputRefs: [ref], preserveHostResources: true, isolation: 'current', maxTokens: 4096 } })] }) });
  value(h.artifacts.put(ref, bytes));
  const f = await fixture({ harness: h }); t.after(() => f.close());
  value(await f.binding.step(h.seed.sessionId));
  assert.equal(f.requests[0].nodeContext, true); assert.equal(f.requests[0].hostContext, true);
  assert(f.requests[0].tools.includes('evofence_continue'));
  const s = value(f.binding.session(h.seed.sessionId));
  const projection = f.ctx.sessionProjections.snapshot(f.handle.agent.session).values.evofenceNative;
  assert.equal(projection.hostSessionId, h.seed.sessionId); assert.equal(projection.requests, 1);
  assert.equal(projection.lastSeq, f.handle.agent.session.snapshotEvents().at(-1).seq);
  assert.equal(value(s.runtime.read(h.seed.sessionId)).nodeStates[0].state, 'verifying');
});

nativeTest('cp2: actual tool gate retains the host denial and observes normal, denied and thrown results', async t => {
  const f = await fixture(); t.after(() => f.close()); f.mode.value = 'tools';
  await f.ordinary();
  assert.deepEqual(f.executed, { echo: 1, denied: 0, failure: 1 });
  const results = f.observations.filter(o => o.type === 'tools/result');
  assert.equal(results.length, 3); assert.equal(results.filter(o => o.isError).length, 2);
  assert(results.every(o => o.hostSessionId === f.h.seed.sessionId && o.callId !== null));
});

nativeTest('cp2: usage is deduplicated by native invocation; missing counters and USD stay unknown', async t => {
  const f = await fixture(); t.after(() => f.close());
  value(await f.binding.step(f.h.seed.sessionId));
  const s = value(f.binding.session(f.h.seed.sessionId));
  const state = value(s.runtime.read(f.h.seed.sessionId)), effectId = Object.keys(state.effects)[0];
  const report = value(await s.host.usage({ effectId, requestIds: [] }));
  assert.equal(report.usage.length, 1); assert.equal(report.usage[0].inputUncached, 100);
  assert.equal(report.usage[0].total, 147); assert.equal(report.usage[0].estimatedUsdMicros, null);
  assert.equal(state.budget.reservations.length, 1, 'unpriced fixture is not zero USD');
  const receipt = Object.values(state.receipts)[0];
  const event = f.handle.agent.session.snapshotEvents().find(e => e.type === 'assistant/message');
  assert.equal(value(invocationUsage(s, f.composition, [event, event])).length, 1);
  assert.equal(invocationUsage(s, f.composition, [event, { ...event, data: { ...event.data,
    usage: { ...event.data.usage, inputTokens: 101, totalTokens: 148 } } }]).error.code, 'EFK_USAGE_CONFLICT');
  assert.equal(value(s.runtime.receive(f.h.seed.sessionId, receipt)).disposition, 'duplicate');
  assert.deepEqual(value(s.runtime.read(f.h.seed.sessionId)).budget, state.budget);
  assert.equal(value(await s.host.usage({ effectId, requestIds: ['never-observed'] })).complete, false);
  const missing = value(nativeUsage('missing', undefined, 'host-normalized'));
  assert.equal(missing.total, null); assert.equal(missing.complete, false); assert.equal(missing.output, null);
  assert.equal(nativeUsage('bad', { inputTokens: 4, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0, totalTokens: 8 }, 'synthetic').error.code, 'EFK_USAGE_CONFLICT');
});

nativeTest('cp2: failed native model request preserves unknown usage and outstanding reservation', async t => {
  const f = await fixture(); t.after(() => f.close()); f.mode.value = 'failure';
  value(await f.binding.step(f.h.seed.sessionId));
  const state = value(value(f.binding.session(f.h.seed.sessionId)).runtime.read(f.h.seed.sessionId));
  assert.equal(Object.values(state.receipts)[0].status, 'failed');
  assert.equal(Object.values(state.receipts)[0].usage[0].complete, false);
  assert.equal(Object.values(state.receipts)[0].usage[0].output, null);
  assert.equal(state.budget.reservations.length, 1); assert.equal(f.handle.agent.status, 'idle');
});

nativeTest('DoD2: observation hook failure durably pauses evolution and preserves ordinary host work', async t => {
  let throwHook = false;
  const f = await fixture({ onObservation: o => { if (throwHook && o.type === 'assistant/message') throw new Error('fixture fault with secret-like content must be redacted'); } });
  t.after(() => f.close()); throwHook = true;
  value(await f.binding.step(f.h.seed.sessionId));
  const status = value(f.binding.status(f.h.seed.sessionId));
  assert.equal(status.health, 'degraded'); assert.equal(status.dispatchMode, 'paused');
  assert(status.unknownEffectIds.length === 1);
  assert.equal((await f.binding.evaluate(f.h.seed.sessionId, status.unknownEffectIds[0])).ok, false);
  assert.equal(f.h.calls.evaluate, 0);
  assert(!JSON.stringify(status).includes('secret-like'));
  throwHook = false; const count = f.requests.length; await f.ordinary();
  assert.equal(f.requests.length, count + 1); assert.equal(f.handle.agent.status, 'idle');
});

nativeTest('DoD2: removed context hook cannot confirm an evolution turn; ordinary work continues', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.removers.get('agent/pre-step')();
  value(await f.binding.step(f.h.seed.sessionId));
  const status = value(f.binding.status(f.h.seed.sessionId));
  assert.equal(status.dispatchMode, 'paused'); assert.equal(status.health, 'degraded');
  assert.equal(status.unknownEffectIds.length, 1);
  await f.ordinary(); assert.equal(f.requests.length, 2);
});

nativeTest('DoD2: plugin uninstall preserves native loop and tools but denies pending evolution', async t => {
  const f = await fixture(); t.after(() => f.close());
  await deadline(f.fiber.dispose());
  assert.equal(value(f.binding.status(f.h.seed.sessionId)).dispatchMode, 'paused');
  assert.equal(value(f.binding.status(f.h.seed.sessionId)).health, 'disposed');
  assert.equal((await f.binding.step(f.h.seed.sessionId)).ok, false);
  await f.ordinary(); assert.equal(f.requests.length, 1); assert.equal(f.handle.agent.status, 'idle');
  assert(f.ctx.tools.schemas().some(tool => tool.name === 'host_echo'));
  assert(!f.ctx.tools.schemas().some(tool => tool.name === 'evofence_continue'));
});

nativeTest('cp3: runtime error is visible, journal is paused, normal followup still works', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = value(f.binding.session(f.h.seed.sessionId));
  s.runtime.step = async () => { throw new Error('controlled runtime fault'); };
  const result = await f.binding.step(f.h.seed.sessionId);
  assert.equal(result.error.code, 'EFK_EFFECT_UNKNOWN');
  assert.equal(value(f.binding.status(f.h.seed.sessionId)).dispatchMode, 'paused');
  await f.ordinary(); assert.equal(f.requests.length, 1);
});

nativeTest('DoD2: failed durable pause remains visible and locally refuses evolution without stopping native work', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = value(f.binding.session(f.h.seed.sessionId));
  s.runtime.step = async () => { throw new Error('runtime port failure'); };
  s.runtime.pause = () => { throw new Error('store pause failure'); };
  assert.equal((await f.binding.step(f.h.seed.sessionId)).ok, false);
  assert.equal(value(f.binding.status(f.h.seed.sessionId)).pauseError.code, 'EFK_EFFECT_UNKNOWN');
  assert.equal((await f.binding.evaluate(f.h.seed.sessionId, 'unconfirmed')).ok, false);
  assert.equal(f.h.calls.evaluate, 0);
  await f.ordinary(); assert.equal(f.requests.length, 1);
});

nativeTest('cp3: native cancellation confirms only the bound active loop; missing usage is not free', async t => {
  const f = await fixture(); t.after(() => f.close()); f.mode.value = 'hold';
  const started = f.started(), stepping = f.binding.step(f.h.seed.sessionId);
  await deadline(started);
  const s = value(f.binding.session(f.h.seed.sessionId)), effectId = s.running.effect.effectId;
  assert.equal(value(await s.host.cancel({ sessionId: f.h.seed.sessionId, targetIds: ['ordinary-host-work'] })).status, 'unknown');
  assert.equal(f.handle.agent.status, 'running');
  assert.equal(value(await s.host.cancel({ sessionId: f.h.seed.sessionId, targetIds: [effectId] })).status, 'cancelled');
  value(await deadline(stepping));
  assert.equal(Object.values(value(s.runtime.read(f.h.seed.sessionId)).receipts)[0].status, 'cancelled');
  assert.equal(value(await s.host.usage({ effectId, requestIds: [] })).complete, false);
});

nativeTest('cp3: resume and reconcile never replay a claimed unknown native action', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.removers.get('session/event')();
  value(await f.binding.step(f.h.seed.sessionId));
  const before = value(f.binding.status(f.h.seed.sessionId)); assert.equal(before.unknownEffectIds.length, 1);
  const count = f.requests.length, resumed = await f.restore();
  const s = value(f.binding.session(resumed.id));
  const outcome = value(await s.runtime.reconcile(resumed.id));
  assert.equal(outcome.unknown.length, 1); assert.equal(f.requests.length, count);
  assert.equal(value(s.runtime.read(resumed.id)).dispatchMode, 'paused');
});

nativeTest('cp2: native continue tool queues once and executes after the same caller turn settles', async t => {
  const f = await fixture(); t.after(() => f.close());
  // Native ToolRuntime dispatch, while its ordinary loop is idle, is still the real pipeline.
  const result = await f.ctx.tools.execute({ callId: f.sdk['dsh-llm'].ToolCallId('continue-native'), name: 'evofence_continue', arguments: {}, agent: f.handle.agent, signal: new AbortController().signal });
  assert.equal(result.isError, false);
  value(await deadline(f.binding.settle(f.h.seed.sessionId)));
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].sessionId, f.handle.agent.id);
  assert.equal(value(f.binding.status(f.h.seed.sessionId)).nodeStates[0].state, 'verifying');
});

nativeTest('cp2: model-issued native continuation returns before idle and reuses the same caller', async t => {
  const f = await fixture(); t.after(() => f.close()); f.mode.value = 'continue';
  await f.ordinary();
  value(await deadline(f.binding.settle(f.h.seed.sessionId)));
  assert.equal(f.requests.length, 3, 'two ordinary requests and one reserved kernel invocation');
  assert(f.requests.every(r => r.sessionId === f.handle.agent.id));
  assert.equal(value(f.binding.status(f.h.seed.sessionId)).nodeStates[0].state, 'verifying');
});

nativeTest('A15: an actual native board claim with no kernel mapping refuses advancement', async t => {
  const f = await fixture({ team: true }); t.after(() => f.close());
  const task = await f.ctx.agentTeams.createTask(f.handle.agent, { subject: 'ordinary native task', description: 'no kernel owner' });
  await f.ctx.agentTeams.updateTask(f.handle.agent, { taskId: task.id, expectedRevision: task.revision, action: 'claim' });
  const result = await f.binding.step(f.h.seed.sessionId);
  assert.equal(result.error.code, 'EFK_HOST_BOARD_AUTHORITY_CONFLICT');
  assert.equal(f.requests.length, 0); assert.equal(value(f.binding.status(f.h.seed.sessionId)).dispatchMode, 'paused');
  await f.ordinary(); assert.equal(f.requests.length, 1);
});

nativeTest('A15: board owner is accepted only as the projection of an actual current kernel claim', async t => {
  const f = await fixture({ team: true }); t.after(() => f.close());
  f.h.planOnly();
  const s = value(f.binding.session(f.h.seed.sessionId));
  const claim = value(s.runtime.read(f.h.seed.sessionId)).scheduler.claims[0];
  const task = await f.ctx.agentTeams.createTask(f.handle.agent, { subject: 'kernel projection', description: 'bound existing claim' });
  await f.ctx.agentTeams.updateTask(f.handle.agent, { taskId: task.id, expectedRevision: task.revision, action: 'claim' });
  value(f.binding.projectBoard(f.h.seed.sessionId, { taskId: task.id, ownerSessionId: f.handle.agent.id,
    nodeId: claim.binding.nodeId, attemptId: claim.binding.attemptId, ownerClaimId: claim.claimId }));
  const observation = value(await s.host.observe(f.h.seed.sessionId));
  assert.deepEqual(observation.boardOwners, [{ nodeId: claim.binding.nodeId, attemptId: claim.binding.attemptId, ownerClaimId: claim.claimId }]);
  assert.equal(value(s.runtime.read(f.h.seed.sessionId)).scheduler.claims[0].claimId, claim.claimId);
  assert.equal(f.requests.length, 0);
});

nativeTest('boundary: native operations reject an impersonated caller and wrong version', async t => {
  const f = await fixture(); t.after(() => f.close());
  const impostor = { ...f.handle.agent, id: f.handle.agent.id };
  const result = await f.ctx.tools.execute({ callId: f.sdk['dsh-llm'].ToolCallId('impostor'), name: 'evofence_status', arguments: {}, agent: impostor, signal: new AbortController().signal });
  assert.equal(JSON.parse(result.value).error.code, 'EFK_AUTHORITY_DENIED');
  const { createDshBinding } = await import('../dist/hosts/dsh/index.js');
  assert.throws(() => createDshBinding(f.ctx, { ...f.composition, version: '0.1.7-rc.1' }), /exact version/);
});

nativeTest('cp2: native multi-step evolution cannot spend an unreserved implicit model request', async t => {
  const f = await fixture(); t.after(() => f.close()); f.mode.value = 'tools';
  value(await f.binding.step(f.h.seed.sessionId));
  assert.equal(f.requests.length, 1, 'second implicit native request was stopped before the adapter');
  assert.equal(value(f.binding.status(f.h.seed.sessionId)).dispatchMode, 'paused');
  assert.equal(value(f.binding.status(f.h.seed.sessionId)).unknownEffectIds.length, 1);
  assert.equal(f.executed.echo, 1);
});

function toolRequest(h) {
  const ref = h.persist('native-tool-args', 'ToolArguments', { text: 'ok' });
  return { ...h.seed, epoch: 1, protocol: PROTOCOL,
    operations: { nA: { kind: 'host.tool', inputRefs: [ref], payload: { context: null, toolName: 'host_echo', argumentsRef: ref,
      graphRef: null, targetIds: [], assetRef: null, previousSnapshot: null, deliveryGuarantee: 'none' } } } };
}
nativeTest('cp2: committed tool effect traverses the actual native policy and result pipeline', async t => {
  const h = harness(), f = await fixture({ harness: h, request: toolRequest(h), denyTool: 'host_echo' });
  t.after(() => f.close());
  value(await f.binding.step(h.seed.sessionId));
  const s = value(f.binding.session(h.seed.sessionId)), state = value(s.runtime.read(h.seed.sessionId));
  assert.equal(f.executed.echo, 0, 'denied native tool body is not invoked');
  assert.equal(Object.values(state.receipts)[0].status, 'failed');
  assert.equal(state.nodeStates[0].state, 'verifying');
  assert.equal(state.budget.reservations.length, 1, 'no tool meter is invented');
});
nativeTest('DoD2: missing tool-result hook leaves the actual tool outcome unconfirmed and pauses', async t => {
  const h = harness(), f = await fixture({ harness: h, request: toolRequest(h) });
  t.after(() => f.close()); f.removers.get('tools/result')();
  value(await f.binding.step(h.seed.sessionId));
  assert.equal(f.executed.echo, 1);
  const status = value(f.binding.status(h.seed.sessionId));
  assert.equal(status.dispatchMode, 'paused'); assert.equal(status.unknownEffectIds.length, 1);
  assert.equal((await f.binding.evaluate(h.seed.sessionId, status.unknownEffectIds[0])).ok, false);
  await f.ordinary(); assert.equal(f.requests.length, 1);
});
