import test from 'node:test';
import assert from 'node:assert/strict';
import { PI_ENTRY } from '../dist/hosts/pi/index.js';
import { fixture, value, effect, authorized, deferred } from './l3-pi-fixtures.test.js';

test('cp3 custom binding is idempotent on session_start and completed receipt survives reopen', async () => {
  const f = fixture(); await f.start(); await f.start();
  assert.equal(f.entries.filter(e => e.data?.kind === 'binding').length, 1);
  const receipt = value(await f.host.execute(authorized(effect()))); f.binding.unload();
  const reopened = fixture({ entries: structuredClone(f.entries) }); await reopened.start();
  assert.deepEqual(value(await reopened.host.execute(authorized(effect()))), receipt);
  assert.equal(reopened.counts().prompts, 0);
  const reconciled = value(await reopened.host.reconcile({ sessionId: 'kernel-1', targetIds: ['effect-1'] }));
  assert.equal(reconciled[0].verdict, 'resolved'); assert.deepEqual(reconciled[0].receipt, receipt);
});
test('cp3 crash after dispatch retains unknown and forbids retry across different idempotency keys', async () => {
  const dispatch = { version: 1, kind: 'dispatch', kernelSessionId: 'kernel-1', hostSessionId: 'native-1', effect: effect(), receipt: null, requestUsage: [], requestIds: [] };
  const f = fixture({ entries: [{ type: 'custom', customType: PI_ENTRY, data: dispatch }] }); await f.start();
  assert.equal((await f.host.execute(authorized(effect()))).error.code, 'EFK_EFFECT_NON_IDEMPOTENT_RETRY');
  assert.equal((await f.host.execute(authorized(effect('effect-1', { idempotencyKey: 'fresh-key' })))).error.code, 'EFK_IDEMPOTENCY_COLLISION');
  assert.equal(value(await f.host.reconcile({ sessionId: 'kernel-1', targetIds: ['effect-1', 'unseen'] }))[0].verdict, 'unknown');
  assert.equal(f.counts().prompts, 0);
});
test('cp3 malformed restored entry stops kernel without touching ordinary transcript', async () => {
  for (const data of [null, { version: 9 }, { version: 1, kind: 'binding', hostSessionId: 'another', kernelSessionId: 'kernel-1' }]) {
    const f = fixture({ entries: [{ type: 'custom', customType: PI_ENTRY, data }, { type: 'message', data: 'normal host work' }] });
    await f.start(); assert.equal(f.faults[0].code, 'EFK_SOURCE_PIN_DRIFT'); assert.equal(f.entries[1].data, 'normal host work');
    assert.equal(await f.emit('tool_call', { toolName: 'read', toolCallId: 'ordinary', input: {} }), undefined);
  }
});
test('cp3 unload during prompt retains unknown, removes hooks and never aborts/disposes host', async () => {
  const started = deferred(), release = deferred();
  const f = fixture({ run: async ({ finish }) => { started.resolve(); await release.promise; await finish(); } });
  await f.start(); const work = f.host.execute(authorized(effect())); await started.promise;
  f.binding.unload(); release.resolve();
  assert.equal(value(await work).status, 'unknown'); assert.equal(f.counts().aborts, 0);
  assert.equal(await f.emit('tool_call', { toolName: 'blocked', toolCallId: 'normal-after-unload', input: {} }), undefined);
  assert.equal((await f.host.execute(authorized(effect('new')))).error.code, 'EFK_HOST_SESSION_MISMATCH');
});
test('cp3 session shutdown/switch invalidates packet and subsequent kernel execution', async () => {
  const f = fixture(); await f.start(); await f.emit('session_shutdown', { reason: 'switch' }); f.nativeId('replacement');
  assert.equal((await f.host.execute(authorized(effect()))).error.code, 'EFK_HOST_SESSION_MISMATCH');
  assert.equal(await f.emit('context', { messages: ['ordinary replacement context'] }), undefined);
  assert.equal(f.counts().prompts, 0);
});
test('cp3 hook exception latches unknown and blocks owned tool; ordinary tools keep working', async () => {
  const f = fixture({ binding: { toolGate: async () => { throw new Error('fixture gate failure'); } },
    run: async ({ emit, finish }) => {
      assert.equal((await emit('tool_call', { toolName: 'read', toolCallId: 'owned', input: {} })).block, true);
      await finish();
    } });
  await f.start(); assert.equal(value(await f.host.execute(authorized(effect()))).status, 'unknown');
  assert.equal(f.faults[0].code, 'EFK_HOST_EXECUTION_FAILED');
  assert.equal(await f.emit('tool_call', { toolName: 'read', toolCallId: 'normal', input: {} }), undefined);
  assert.equal((await f.host.execute(authorized(effect('another')))).error.code, 'EFK_HOST_EXECUTION_FAILED');
});
test('cp3 entry write exception dispatches zero prompts and never confirms promotion', async () => {
  let broken = false; const f = fixture({ appendError: () => broken }); await f.start(); broken = true;
  const receipt = value(await f.host.execute(authorized(effect())));
  assert.equal(receipt.status, 'unknown'); assert.equal(f.counts().prompts, 0);
});
test('cp3 cancel owns only named active invocation; abort waits for native settled acknowledgement', async () => {
  const started = deferred(), release = deferred();
  const f = fixture({ run: async ({ finish }) => { started.resolve(); await release.promise;
    await finish('aborted', { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } }); },
    abort: async () => { release.resolve(); await new Promise(r => setImmediate(r)); } });
  await f.start(); const work = f.host.execute(authorized(effect())); await started.promise;
  assert.equal(value(await f.host.cancel({ sessionId: 'kernel-1', targetIds: ['unrelated'] })).status, 'unknown');
  assert.equal(f.counts().aborts, 0);
  const cancelled = value(await f.host.cancel({ sessionId: 'kernel-1', targetIds: ['effect-1'] }));
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.targets[0].confirmation, 'native-ack');
  const receipt = value(await work); assert.equal(receipt.status, 'unknown');
  assert.equal(receipt.usage[0].estimatedUsdMicros, null);
});
test('cp3 abort failure is unconfirmed, without replacing it by completion or zero spend', async () => {
  const started = deferred(), release = deferred();
  const f = fixture({ abortError: true, run: async ({ finish }) => { started.resolve(); await release.promise; await finish(); } });
  await f.start(); const work = f.host.execute(authorized(effect())); await started.promise;
  const cancel = value(await f.host.cancel({ sessionId: 'kernel-1', targetIds: ['effect-1'] }));
  assert.equal(cancel.status, 'unknown'); assert.equal(cancel.error.code, 'EFK_CANCEL_UNCONFIRMED');
  release.resolve(); assert.equal(value(await work).status, 'unknown');
});
test('cp3 asynchronous context resolver cannot inject after unload', async () => {
  const resolving = deferred(), release = deferred();
  const f = fixture({ binding: { context: async () => { resolving.resolve(); await release.promise; return { ok: true, value: ['late packet'] }; } } });
  await f.start(); const work = f.host.execute(authorized(effect())); await resolving.promise;
  f.binding.unload(); release.resolve(); assert.equal((await work).error.code, 'EFK_HOST_SESSION_MISMATCH');
  assert.equal(f.counts().prompts, 0); assert.equal(await f.emit('context', { messages: ['host history'] }), undefined);
});
test('cp3 cancellation while preparing prompt proves not-executed without aborting ordinary host', async () => {
  const preparing = deferred(), release = deferred();
  const f = fixture({ binding: { prompt: async () => { preparing.resolve(); await release.promise; return 'prepared'; } } });
  await f.start(); const work = f.host.execute(authorized(effect())); await preparing.promise;
  const cancelled = value(await f.host.cancel({ sessionId: 'kernel-1', targetIds: ['effect-1'] }));
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.targets[0].confirmation, 'not-executed');
  release.resolve(); const receipt = value(await work); assert.equal(receipt.status, 'not-executed');
  assert.equal(receipt.hostInvocationId, null); assert.deepEqual(receipt.usage, []);
  assert.deepEqual(f.counts(), { prompts: 0, aborts: 0 });
  assert.equal(value(await f.host.reconcile({ sessionId: 'kernel-1', targetIds: ['effect-1'] }))[0].verdict, 'not-executed');
});
