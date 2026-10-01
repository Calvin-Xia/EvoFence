import test from 'node:test';
import assert from 'node:assert/strict';
import { mapPiUsage, addPiUsage } from '../dist/hosts/pi/index.js';
import { createSessionService } from '../dist/runtime/session/index.js';
import { fixture, value, effect, authorized, sdkUsage } from './l3-pi-fixtures.test.js';
import { harness } from './l2-runtime-support.test.js';

test('cp2 usage cache split and reasoning subset preserve raw and normalized semantics', () => {
  const message = { role: 'assistant', stopReason: 'stop', usage: sdkUsage };
  const raw = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15,
    prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 1 } };
  const mapped = value(mapPiUsage('request-1', message, { raw, source: 'provider', evidenceRefs: [] }));
  assert.equal(mapped.inputUncached, 10); assert.equal(mapped.cacheRead, 2);
  assert.equal(mapped.cacheWrite, null); assert.equal(mapped.output, 3); assert.equal(mapped.reasoning, 1);
  assert.equal(mapped.total, 15); assert.equal(mapped.invoiceUsdMicros, null); assert.equal(mapped.complete, true);
  assert.equal(mapped.estimatedUsdMicros, 37);
  assert.deepEqual(raw.completion_tokens_details, { reasoning_tokens: 1 });
});
test('cp2 same invocation usage dedupes; conflicting duplicate and bad arithmetic refuse', () => {
  const u = value(mapPiUsage('request-1', { role: 'assistant', stopReason: 'stop', usage: sdkUsage }));
  assert.equal(value(addPiUsage([u], structuredClone(u))).length, 1);
  assert.equal(addPiUsage([u], { ...u, output: 4 }).error.code, 'EFK_USAGE_CONFLICT');
  assert.equal(mapPiUsage('bad', { role: 'assistant', stopReason: 'stop', usage: { ...sdkUsage, totalTokens: 16 } }).error.code, 'EFK_USAGE_INCOMPLETE');
  assert.equal(mapPiUsage('bad', { role: 'assistant', usage: { ...sdkUsage, reasoning: 4 } }).error.code, 'EFK_USAGE_INCOMPLETE');
});
test('cp2 absent usage and SDK abort/error zero placeholders remain unknown, never free', () => {
  for (const message of [{ role: 'assistant', stopReason: 'stop' },
    { role: 'assistant', stopReason: 'aborted', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } } },
    { role: 'assistant', stopReason: 'error', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } }]) {
    const row = value(mapPiUsage('unknown-request', message));
    assert.equal(row.complete, false); assert.equal(row.total, null); assert.equal(row.estimatedUsdMicros, null);
    assert.equal(row.source, 'unknown');
  }
});
test('cp2 missing request telemetry leaves effect unknown and lookup incomplete', async () => {
  const g = fixture({ run: async ({ emit }) => {
    await emit('before_provider_request', { payload: {} });
    await emit('message_end', { message: { role: 'assistant', stopReason: 'stop' } });
    await emit('agent_end', { messages: [] }); await emit('agent_settled'); g.nativeIdle(true);
  } });
  await g.start(); const receipt = value(await g.host.execute(authorized(effect())));
  assert.equal(receipt.status, 'unknown'); assert.equal(receipt.error.code, 'EFK_USAGE_INCOMPLETE');
  assert.equal(receipt.usage[0].estimatedUsdMicros, null);
  assert.equal(value(await g.host.usage({ effectId: 'effect-1', requestIds: [] })).complete, false);
  assert.equal(value(await g.host.usage({ effectId: 'never-dispatched', requestIds: [] })).complete, false);
});
test('cp2 duplicate message delivery does not charge twice; request lookup checks all IDs', async () => {
  const f = fixture({ run: async ({ emit }) => {
    await emit('before_provider_request', { payload: {} });
    const message = { role: 'assistant', stopReason: 'stop', usage: sdkUsage };
    await emit('message_end', { message }); await emit('message_end', { message: structuredClone(message) });
    await emit('agent_end', { messages: [] }); await emit('agent_settled'); f.nativeIdle(true);
  } });
  await f.start(); const r = value(await f.host.execute(authorized(effect()))); assert.equal(r.usage.length, 1);
  const raw = value(await f.host.usage({ effectId: 'effect-1', requestIds: [] }));
  const report = value(await f.host.usage({ effectId: 'effect-1', requestIds: [raw.usage[0].requestId, 'missing'] }));
  assert.equal(report.complete, false); assert.equal(report.usage.length, 1);
});
test('cp2 context adds packet to existing messages, tool callbacks retain identities and ordinary tools', async () => {
  let seen; const original = [{ role: 'system', content: 'host AGENTS + skills' }, { role: 'user', content: 'history' }];
  const f = fixture({ binding: { toolResult: async (a, event) => { seen = { a, event }; } },
    run: async ({ emit, finish }) => {
      const injected = await emit('context', { messages: original });
      assert.deepEqual(injected.messages.slice(0, 2), original); assert.equal(injected.messages.length, 3);
      assert.equal(original.length, 2);
      const denied = await emit('tool_call', { toolName: 'blocked', toolCallId: 'call-denied', input: { path: 'x' } });
      assert.equal(denied.block, true);
      assert.equal(await emit('tool_call', { toolName: 'read', toolCallId: 'call-1', input: { path: 'x' } }), undefined);
      await emit('tool_result', { toolName: 'read', toolCallId: 'call-1', input: { path: 'x' }, content: ['result'], isError: true });
      await finish();
    } });
  await f.start(); assert.equal(value(await f.host.execute(authorized(effect()))).status, 'completed');
  assert.equal(seen.a.effect.effectId, 'effect-1'); assert.equal(seen.event.toolCallId, 'call-1'); assert.equal(seen.event.isError, true);
  assert.equal(await f.emit('tool_call', { toolName: 'blocked', toolCallId: 'ordinary', input: {} }), undefined);
  assert.equal(await f.emit('context', { messages: original }), undefined);
});
test('cp2 fresh context and activation refuse explicitly; no separate child or snapshot fabricated', async () => {
  const f = fixture(); await f.start();
  assert.equal((await f.host.context({ sessionId: 'kernel-1', plan: { inputRefs: [], maxTokens: 32, preserveHostResources: true, isolation: 'fresh' } })).error.code, 'EFK_CAPABILITY_UNSUPPORTED');
  assert.equal((await f.host.execute(authorized(effect('activation', { kind: 'host.activate' })))).error.code, 'EFK_CAPABILITY_UNSUPPORTED');
  assert.equal(f.counts().prompts, 0);
});
test('cp2 frozen SessionPorts injection sends receipt to journal and stops at verifying', async () => {
  const h = harness();
  const f = fixture({ binding: { kernelSessionId: h.seed.sessionId } }); await f.start();
  const service = createSessionService({ ...h.ports, host: f.host }); value(service.open(h.seed));
  value(await service.step(h.seed.sessionId));
  const state = value(service.read(h.seed.sessionId));
  assert.equal(state.nodeStates[0].state, 'verifying');
  assert.equal(state.events.filter(e => e.type === 'receipt.applied').length, 1);
  assert.equal(state.events.filter(e => e.type === 'decision.recorded').length, 0);
  assert.equal(f.counts().prompts, 1); assert.equal(state.appliedInvocations.length, 1);
  assert.equal(f.entries.filter(e => e.data?.kind === 'receipt').length, 1);
});
test('cp2 successful request plus missing second meter remains incomplete across restore', async () => {
  const f = fixture({ run: async ({ emit }) => {
    await emit('before_provider_request', { payload: {} });
    await emit('message_end', { message: { role: 'assistant', stopReason: 'toolUse', usage: sdkUsage } });
    await emit('before_provider_request', { payload: {} });
    await emit('agent_end', { messages: [] }); await emit('agent_settled'); f.nativeIdle(true);
  } });
  await f.start(); assert.equal(value(await f.host.execute(authorized(effect()))).status, 'unknown');
  assert.equal(value(await f.host.usage({ effectId: 'effect-1', requestIds: [] })).complete, false);
  const restored = fixture({ entries: structuredClone(f.entries) }); await restored.start();
  assert.equal(value(await restored.host.usage({ effectId: 'effect-1', requestIds: [] })).complete, false);
});
