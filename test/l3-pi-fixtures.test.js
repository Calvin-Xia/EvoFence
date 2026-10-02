import assert from 'node:assert/strict';
import { bindPiSession } from '../dist/hosts/pi/index.js';
import { fail } from '../dist/protocol/index.js';
export const value = r => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export const sdkUsage = { input: 10, output: 3, cacheRead: 2, cacheWrite: 0, reasoning: 1,
  totalTokens: 15, cost: { total: 0.000037 } };
export function effect(id = 'effect-1', overrides = {}) {
  return { protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' },
    effectId: id, idempotencyKey: id, binding: { sessionId: 'kernel-1', hostSessionId: 'native-1',
      graph: { graphId: 'graph-1', revision: 1, digest: `sha256:${'a'.repeat(64)}` },
      nodeId: 'node-1', attemptId: 'attempt-1', attemptOrdinal: 1, epoch: 1, baseDigest: null },
    authorityRef: 'grant-1', reservationRef: 'reservation-1', leases: [], inputRefs: [], deadline: 10000,
    kind: 'host.agent', payload: { context: { inputRefs: [], maxTokens: 32, preserveHostResources: true, isolation: 'current' },
      toolName: null, argumentsRef: null, graphRef: null, targetIds: [], assetRef: null,
      previousSnapshot: null, deliveryGuarantee: 'none' }, ...overrides };
}
export const authorized = e => ({ effect: e, grant: { grantId: 'grant-1' } });
export function fixture(options = {}) {
  const handlers = new Map(), entries = options.entries ?? [], faults = [], trace = [];
  let nativeId = 'native-1', diskFile = 'persistent-session.jsonl', nativeIdle = true, prompts = 0, aborts = 0;
  const manager = { getSessionId: () => nativeId, getSessionFile: () => diskFile, getEntries: () => entries };
  const ctx = { sessionManager: manager, isIdle: () => nativeIdle };
  const api = {
    on(name, handler) {
      const set = handlers.get(name) ?? new Set(); handlers.set(name, set); set.add(handler);
      return () => set.delete(handler);
    },
    appendEntry(customType, data) {
      if (options.appendError?.()) throw new Error('fixture disk write failed');
      entries.push({ type: 'custom', customType, data: structuredClone(data) });
    },
  };
  async function emit(type, fields = {}) {
    trace.push(type);
    let result;
    for (const handler of handlers.get(type) ?? []) result = await handler({ type, ...fields }, ctx);
    return result;
  }
  async function finish(stopReason = 'stop', usage = sdkUsage) {
    await emit('before_provider_request', { payload: {} });
    await emit('message_end', { message: { role: 'assistant', usage, stopReason } });
    await emit('agent_end', { messages: [] });
    await emit('agent_settled'); nativeIdle = true;
  }
  const session = { sessionManager: manager, get isIdle() { return nativeIdle; },
    async prompt(text) { prompts++; nativeIdle = false; await emit('agent_start');
      if (options.run) await options.run({ emit, finish, text, session }); else await finish(); },
    async waitForIdle() { if (options.idleWait) await options.idleWait.promise; assert.equal(nativeIdle, true); },
    async abort() { aborts++; if (options.abortError) throw new Error('fixture abort failure');
      await options.abort?.({ emit, finish, session }); },
  };
  const binding = value(bindPiSession(api, { version: '0.99.2', kernelSessionId: 'kernel-1', hostSessionId: 'native-1',
    session: () => session, clock: { now: () => 1000 }, prompt: async () => 'fixture prompt',
    context: async () => ({ ok: true, value: [{ role: 'user', content: 'node packet' }] }),
    toolGate: async (_a, event) => event.toolName === 'blocked'
      ? { ok: false, error: fail('EFK_AUTHORITY_DENIED', 'tool is outside this grant') } : { ok: true, value: undefined },
    toolResult: async () => {}, fault: e => faults.push(e), ...options.binding }));
  return { binding, host: binding.host, api, session, manager, entries, faults, trace, emit, finish,
    start: () => emit('session_start', { reason: 'startup' }), counts: () => ({ prompts, aborts }),
    nativeId: id => { nativeId = id; }, diskFile: file => { diskFile = file; }, nativeIdle: value => { nativeIdle = value; } };
}
