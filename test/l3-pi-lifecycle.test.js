import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPiSession } from '../dist/hosts/pi/index.js';
import { fixture, value, effect, authorized, deferred } from './l3-pi-fixtures.test.js';

test('DoD1 version mismatch rejects before touching SDK or registering hooks', () => {
  const deny = new Proxy({}, { get() { throw new Error('touched SDK'); } });
  assert.equal(bindPiSession(deny, { version: '0.99.2' }).error.code, 'EFK_SOURCE_PIN_DRIFT');
});
test('DoD1 persistent existing identity is mandatory; memory and foreign sessions refuse', async () => {
  const f = fixture(); f.diskFile(undefined); await f.start();
  assert.equal((await f.host.execute(authorized(effect()))).error.code, 'EFK_HOST_SESSION_MISMATCH');
  assert.equal(f.counts().prompts, 0);
  const foreign = fixture(); foreign.nativeId('other-native'); await foreign.start();
  assert.equal((await foreign.host.execute(authorized(effect()))).error.code, 'EFK_HOST_SESSION_MISMATCH');
});
test('DoD1 kernel execution retains native manager, transcript/resources and never owns disposal', async () => {
  const entries = [{ type: 'message', data: { role: 'user', content: 'existing conversation' } }];
  const f = fixture({ entries }); const manager = f.session.sessionManager;
  await f.start(); const r = value(await f.host.execute(authorized(effect())));
  assert.equal(r.status, 'completed'); assert.equal(f.session.sessionManager, manager);
  assert.equal(r.binding.hostSessionId, 'native-1'); assert.match(r.hostInvocationId, /^pi:native-1:/);
  assert.equal(entries[0].data.content, 'existing conversation');
  f.binding.unload(); assert.deepEqual(f.counts(), { prompts: 1, aborts: 0 });
});
test('DoD2 agent_end stays busy through awaited end and settled plus SDK idle barrier', async () => {
  const ending = deferred(), release = deferred(), idleWait = deferred();
  const f = fixture({ idleWait, binding: { agentEnd: async () => { ending.resolve(); await release.promise; } } });
  await f.start(); let returned = false;
  const work = f.host.execute(authorized(effect())).then(r => { returned = true; return r; });
  await ending.promise;
  assert.equal(value(await f.host.observe('kernel-1')).idle, false);
  assert.equal((await f.host.execute(authorized(effect('other')))).error.code, 'EFK_HOST_REVISION_CONFLICT');
  assert.equal(returned, false); release.resolve();
  // Even after agent_settled callback, the host-owned waitForIdle has not resolved.
  await new Promise(r => setImmediate(r)); assert(f.trace.includes('agent_settled'));
  assert.equal(returned, false); idleWait.resolve();
  assert.equal(value(await work).status, 'completed'); assert.equal(value(await f.host.observe('kernel-1')).idle, true);
});
test('DoD2 duplicate pending invocation shares one prompt, final receipt is idempotent', async () => {
  const started = deferred(), release = deferred();
  const f = fixture({ run: async ({ finish }) => { started.resolve(); await release.promise; await finish(); } });
  await f.start(); const a = authorized(effect()); const first = f.host.execute(a); await started.promise;
  const second = f.host.execute(a); release.resolve();
  assert.deepEqual(value(await first), value(await second));
  assert.deepEqual(value(await f.host.execute(a)), value(await first)); assert.equal(f.counts().prompts, 1);
  assert.equal((await f.host.execute(authorized(effect('different', { idempotencyKey: 'effect-1' })))).error.code, 'EFK_IDEMPOTENCY_COLLISION');
});
test('DoD2 intermediate end and queued continuation are one invocation with two distinct usages', async () => {
  const f = fixture({ run: async ({ emit, finish }) => {
    await emit('before_provider_request', { payload: {} });
    await emit('message_end', { message: { role: 'assistant', stopReason: 'toolUse', usage: { input: 10, output: 3, cacheRead: 2, cacheWrite: 0, totalTokens: 15, cost: { total: .00001 } } } });
    await emit('agent_end', { messages: [] }); assert.equal(f.binding.state().idle, false);
    await emit('agent_start'); await finish();
  } });
  await f.start(); const receipt = value(await f.host.execute(authorized(effect())));
  assert.equal(receipt.status, 'completed'); assert.equal(receipt.usage.length, 1);
  assert.equal(receipt.usage[0].requestId, 'reservation-1'); assert.equal(receipt.usage[0].total, 30);
  const raw = value(await f.host.usage({ effectId: 'effect-1', requestIds: [] })); assert.equal(raw.usage.length, 2);
  assert.notEqual(raw.usage[0].requestId, raw.usage[1].requestId);
});
test('DoD2 missing settled cannot manufacture completion from end alone', async () => {
  const f = fixture({ run: async ({ emit }) => {
    await emit('before_provider_request', { payload: {} });
    await emit('message_end', { message: { role: 'assistant', stopReason: 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } } });
    await emit('agent_end', { messages: [] }); f.nativeIdle(true);
  } });
  await f.start(); assert.equal(value(await f.host.execute(authorized(effect()))).status, 'unknown');
});
test('DoD2 settlement hook reentry refuses even when a native idle flag is prematurely true', async () => {
  const f = fixture({ run: async ({ finish }) => { f.nativeIdle(true); await finish();
    assert.equal((await f.host.execute(authorized(effect('reenter')))).error.code, 'EFK_HOST_REVISION_CONFLICT'); } });
  await f.start(); assert.equal(value(await f.host.execute(authorized(effect()))).status, 'completed'); assert.equal(f.counts().prompts, 1);
});
test('DoD2 ordinary host work starting during prompt preparation prevents dispatch and metering contamination', async () => {
  const preparing = deferred(), release = deferred();
  const f = fixture({ binding: { prompt: async () => { preparing.resolve(); await release.promise; return 'prepared'; } } });
  await f.start(); const work = f.host.execute(authorized(effect())); await preparing.promise;
  f.nativeIdle(false); await f.emit('agent_start');
  await f.emit('before_provider_request', { payload: { ordinary: true } });
  assert.equal(await f.emit('tool_call', { toolName: 'blocked', toolCallId: 'ordinary-preparing', input: {} }), undefined);
  release.resolve(); assert.equal((await work).error.code, 'EFK_HOST_REVISION_CONFLICT');
  assert.equal(f.counts().prompts, 0); assert.equal(value(await f.host.usage({ effectId: 'effect-1', requestIds: [] })).usage.length, 0);
});
