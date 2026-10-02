import assert from 'node:assert/strict';
import { bindPiDelegation } from '../dist/hosts/pi/delegation.js';
import { bindPiSharedRequests } from '../dist/hosts/pi/delegation-budget.js';
import { openBudgetLedger } from '../dist/kernel/policy/index.js';
import { mapPiUsage } from '../dist/hosts/pi/usage.js';
import { budgetPolicy } from './l2-scheduler-fixtures.mjs';
import { fixture, effect, sdkUsage, deferred, value } from './l3-pi-fixtures.test.js';
export { deferred, value };
export function delegationFixture(overrides = {}) {
  const parent = fixture();
  const policy = budgetPolicy({ category: 'development', maxUsdMicros: null, maxRequests: 8,
    maxConcurrentRequests: 4, maxInputTokens: 10000, maxOutputTokens: 128 });
  let state = { ledger: value(openBudgetLedger(policy, 100)), owners: [], usage: [] };
  const requests = bindPiSharedRequests(() => state, next => { state = next; });
  const grant = { grantId: 'grant-1', rootAuthorityRef: 'root-1',
    scope: { workspaceRef: null, readResources: ['safe'], writeResources: ['safe'], artifactScopes: [], trustDomain: 'same-user' },
    budget: policy, issuedEpoch: 1, expiresAt: 10000, remainingDepth: 1, maxConcurrency: 2, revocationEpoch: 0, revoked: false };
  const graphRef = { graphId: 'child-graph', revision: 1, digest: `sha256:${'b'.repeat(64)}` };
  function authorized(id = 'delegate-1') {
    const e = effect(id, { kind: 'host.delegate', reservationRef: `reservation:${id}` });
    e.payload = { ...e.payload, graphRef, context: { ...e.payload.context, isolation: 'fresh' } };
    return { effect: e, grant };
  }
  function plan(a) {
    const request = { grantId: `child-grant:${a.effect.effectId}`, scope: { ...grant.scope, writeResources: [] },
      budget: { ...policy, maxRequests: 3 }, expiresAt: 9000, remainingDepth: 0, maxConcurrency: 1 };
    const e = effect(`child-work:${a.effect.effectId}`, { authorityRef: request.grantId,
      reservationRef: a.effect.reservationRef, deadline: 8000 });
    e.binding = { ...e.binding, hostSessionId: null, graph: graphRef };
    e.payload = { ...e.payload, context: { ...e.payload.context, isolation: 'current' } };
    return { request, capabilities: ['host.agent'], effects: [e] };
  }
  const stats = { creates: 0, restores: 0, executions: 0, aborts: 0, disposes: 0, parentAborts: 0 }, specs = [];
  const terminal = new Map();
  let now = 1000;
  const options = { version: '0.99.2', kernelSessionId: 'kernel-1', parentSessionId: 'native-1',
    manager: parent.manager, parent: parent.host, parentCapabilities: ['host.agent', 'host.delegate'],
    model: { provider: 'deepseek', modelId: 'deepseek-flash', thinkingLevel: 'high' },
    clock: { now: () => now }, requests, append: parent.api.appendEntry,
    plan: async a => ({ ok: true, value: plan(a) }),
    create: async spec => {
      stats.creates++; specs.push(spec);
      if (overrides.creationWait) await overrides.creationWait.promise;
      const host = { ...parent.host,
        async execute(a) {
          stats.executions++;
          const id = `${spec.invocationId}:request:${stats.executions}`;
          value(spec.requests.beforeRequest(id, spec.invocationId, spec.grant.budget, { inputTokens: 128, outputTokens: 128, usdMicros: 100 }));
          if (overrides.run) await overrides.run({ spec, a, id, terminal });
          if (overrides.throwRun) throw new Error('native child failed');
          const row = value(mapPiUsage(id, { role: 'assistant', stopReason: 'stop', usage: overrides.missingUsage ? undefined : sdkUsage }));
          const metered = spec.requests.record(row);
          assert(overrides.missingUsage ? !metered.ok : metered.ok);
          const r = { protocol: a.effect.protocol, receiptId: `child:${a.effect.effectId}`, effectId: a.effect.effectId,
            hostInvocationId: spec.invocationId, binding: a.effect.binding, status: 'completed', artifactRefs: [],
            usage: [], observability: ['native-fixture-child'], error: null };
          terminal.set(a.effect.effectId, r); return { ok: true, value: r };
        },
        async cancel() { stats.aborts++; overrides.release?.resolve();
          return { ok: true, value: { status: 'cancelled', targets: [], error: null } }; },
        async reconcile(request) { return { ok: true, value: request.targetIds.map(effectId => ({ effectId,
          verdict: terminal.has(effectId) ? 'resolved' : 'unknown', receipt: terminal.get(effectId) ?? null, error: null })) }; },
      };
      return { ok: true, value: { sessionId: `native-child-${stats.creates}`, host, dispose() { stats.disposes++; } } };
    },
    restore: async (spec, id) => { stats.restores++;
      return { ok: true, value: { sessionId: id, host: { ...parent.host,
        async reconcile(r) { return { ok: true, value: r.targetIds.map(effectId => ({ effectId,
          verdict: terminal.has(effectId) ? 'resolved' : 'unknown', receipt: terminal.get(effectId) ?? null, error: null })) }; } },
        dispose() { stats.disposes++; } } }; },
    ...overrides.options };
  const binding = value(bindPiDelegation(options));
  return { binding, options, parent, grant, policy, requests, authorized, plan, stats, specs, terminal,
    state: () => state, now: n => { now = n; }, rebind: () => value(bindPiDelegation(options)) };
}
