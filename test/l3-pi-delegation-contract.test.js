import test from 'node:test';
import assert from 'node:assert/strict';
import { decode } from '../dist/protocol/index.js';
import { bindPiDelegation, attachPiDelegation } from '../dist/hosts/pi/delegation.js';
import { PI_DELEGATION_ENTRY } from '../dist/hosts/pi/delegation-records.js';
import { delegationFixture, value, deferred } from './l3-pi-delegation-fixtures.test.js';
import { harness, usage } from './l2-runtime-support.test.js';
import { createSessionService } from '../dist/runtime/session/index.js';

test('cp1 child inherits one root, narrower workspace/capabilities/model and parent reservation', async () => {
  const f = delegationFixture(); const a = f.authorized();
  const r = value(await f.binding.host.execute(a));
  assert.equal(r.status, 'completed'); value(decode('Receipt', r));
  const spec = f.specs[0];
  assert.equal(spec.parentSessionId, 'native-1'); assert.equal(spec.kernelSessionId, 'kernel-1');
  assert.equal(spec.grant.rootAuthorityRef, f.grant.rootAuthorityRef); assert.equal(spec.grant.remainingDepth, 0);
  assert.deepEqual(spec.grant.scope.writeResources, []); assert.deepEqual(spec.capabilities, ['host.agent']);
  assert.strictEqual(spec.model, f.options.model); assert.equal(spec.grant.budget.poolId, f.policy.poolId);
  assert.deepEqual(spec.graphRef, a.effect.payload.graphRef); assert.deepEqual(r.binding, a.effect.binding);
  assert.equal(r.usage[0].requestId, a.effect.reservationRef); assert.equal(f.stats.disposes, 1);
  assert(!f.parent.entries.some(e => e.data.kind === 'decision'));
});

test('cp1 refuses scope escalation before native child creation', async () => {
  const f = delegationFixture();
  f.options.plan = async a => { const p = f.plan(a); p.request.scope.writeResources = ['private']; return { ok: true, value: p }; };
  const r = await f.binding.host.execute(f.authorized());
  assert.equal(r.error.code, 'EFK_AUTHORITY_DENIED'); assert.equal(f.stats.creates, 0);
});

test('cp1 rejects depth, capability, expiry, pool, authorization and child graph widening', async () => {
  for (const mutate of [p => { p.request.remainingDepth = 1; }, p => { p.capabilities.push('credentials'); },
    p => { p.request.expiresAt = 20000; }, p => { p.request.expiresAt = 900; },
    p => { p.request.budget.poolId = 'second-pool'; }, p => { p.request.budget.authorizationRef = {}; },
    p => { p.effects[0].binding.graph.graphId = 'foreign'; }, p => { p.effects[0].reservationRef = 'second-reservation'; }]) {
    const f = delegationFixture();
    f.options.plan = async a => { const p = structuredClone(f.plan(a)); mutate(p); return { ok: true, value: p }; };
    assert.equal((await f.binding.host.execute(f.authorized())).ok, false); assert.equal(f.stats.creates, 0);
  }
  for (const patch of [{ remainingDepth: 0 }, { revoked: true }, { expiresAt: 900 }]) {
    const f = delegationFixture(); const a = f.authorized(); a.grant = { ...a.grant, ...patch };
    assert.equal((await f.binding.host.execute(a)).ok, false); assert.equal(f.stats.creates, 0);
  }
});

test('cp1 rejects native-board and full cascade guarantees rather than silently downgrading', async () => {
  const f = delegationFixture();
  for (const capability of ['nativeTeamGraphBoard', 'parentChildCancellation']) {
    const a = f.authorized(capability); a.demands = [{ capability, accepts: ['verified'], because: 'task demand' }];
    assert.equal((await f.binding.host.execute(a)).error.code, 'EFK_CAPABILITY_UNSUPPORTED');
  }
  assert.equal(f.stats.creates, 0);
});

test('cp1 creation is bounded even when factories are still pending', async () => {
  const gate = deferred(); const f = delegationFixture({ creationWait: gate });
  const a = f.authorized('one'); a.grant = { ...a.grant, maxConcurrency: 1 };
  const first = f.binding.host.execute(a); await new Promise(r => setImmediate(r));
  const b = f.authorized('two'); b.grant = a.grant;
  assert.equal((await f.binding.host.execute(b)).error.code, 'EFK_BUDGET_EXHAUSTED');
  gate.resolve(); value(await first); assert.equal(f.stats.creates, 1);
});

test('cp2 parent and child actual calls share one request count, settlements and remaining cap', async () => {
  const f = delegationFixture();
  value(f.requests.beforeRequest('ordinary-parent-request', 'ordinary-parent', f.policy, { inputTokens: 128, outputTokens: 128, usdMicros: 100 }));
  const parentRow = { requestId: 'ordinary-parent-request', source: 'host-normalized', inputUncached: 10, cacheRead: 2,
    cacheWrite: 0, output: 3, reasoning: 1, total: 15, estimatedUsdMicros: 37, invoiceUsdMicros: null, complete: true, evidenceRefs: [] };
  value(f.requests.record(parentRow)); value(f.requests.record(parentRow));
  const r = value(await f.binding.host.execute(f.authorized()));
  assert.equal(f.state().ledger.requestCount, 2); assert.equal(f.state().ledger.settlements.length, 2);
  assert.equal(f.state().ledger.settlements.reduce((n, s) => n + s.micros, 0), 74);
  assert.equal(r.usage[0].estimatedUsdMicros, 37);
  const requestId = f.state().owners[1].requestId;
  assert.equal(f.requests.beforeRequest(requestId, f.state().owners[1].invocationId, f.policy,
    { inputTokens: 128, outputTokens: 128, usdMicros: 100 }).error.code, 'EFK_IDEMPOTENCY_COLLISION');
  assert.equal(f.requests.record({ ...parentRow, estimatedUsdMicros: 38 }).error.code, 'EFK_USAGE_CONFLICT');
});

test('cp2 unknown usage retains reservations and cannot be replaced by zero', async () => {
  const f = delegationFixture({ missingUsage: true }); const r = value(await f.binding.host.execute(f.authorized()));
  assert.equal(r.status, 'unknown'); assert.equal(r.error.code, 'EFK_USAGE_INCOMPLETE');
  assert.equal(r.usage[0].estimatedUsdMicros, null); assert.equal(r.usage[0].complete, false);
  assert.equal(f.state().ledger.reservations.length, 1); assert.equal(f.state().ledger.settlements.length, 0);
  assert.equal(value(await f.binding.host.usage({ effectId: r.effectId, requestIds: [] })).complete, false);
});

test('cp2 child cannot replace its meter owner or enlarge a transport bound', async () => {
  const f = delegationFixture(); value(await f.binding.host.execute(f.authorized())); const s = f.specs[0];
  assert.equal(s.requests.beforeRequest('bypass', 'other-owner', f.policy,
    { inputTokens: 128, outputTokens: 128, usdMicros: 100 }).error.code, 'EFK_BUDGET_NOT_AUTHORIZED');
  assert.equal(s.requests.beforeRequest('over-output', s.invocationId, s.grant.budget,
    { inputTokens: 128, outputTokens: 129, usdMicros: 100 }).error.code, 'EFK_BUDGET_NOT_AUTHORIZED');
});

test('cp1 foreign child identity is never prompted, aborted or disposed as owned work', async () => {
  const f = delegationFixture(); const base = f.options.create;
  f.options.create = async spec => { const c = value(await base(spec)); c.sessionId = 'native-1'; return { ok: true, value: c }; };
  const r = value(await f.binding.host.execute(f.authorized()));
  assert.equal(r.status, 'unknown'); assert.equal(r.error.code, 'EFK_HOST_SESSION_MISMATCH');
  assert.equal(f.stats.executions, 0); assert.equal(f.stats.aborts, 0); assert.equal(f.stats.disposes, 0);
});

test('cp2 child cannot settle another invocation request or bypass the shared remaining cap', async () => {
  const f = delegationFixture();
  value(f.requests.beforeRequest('parent-held', 'ordinary-parent', f.policy, { inputTokens: 128, outputTokens: 128, usdMicros: 100 }));
  value(await f.binding.host.execute(f.authorized()));
  assert.equal(f.specs[0].requests.record({ requestId: 'parent-held' }).error.code, 'EFK_BUDGET_NOT_AUTHORIZED');
  const g = delegationFixture();
  for (let index = 0; index < 8; index++) {
    const requestId = `parent-${index}`;
    value(g.requests.beforeRequest(requestId, 'parent', g.policy, { inputTokens: 128, outputTokens: 128, usdMicros: 100 }));
    value(g.requests.record({ requestId, source: 'synthetic', inputUncached: 10, cacheRead: 0, cacheWrite: 0,
      output: 1, reasoning: 0, total: 11, estimatedUsdMicros: 1, invoiceUsdMicros: null, complete: true, evidenceRefs: [] }));
  }
  const denied = value(await g.binding.host.execute(g.authorized()));
  assert.equal(denied.status, 'unknown'); assert.equal(g.state().ledger.requestCount, 8);
});

test('cp2 host.cancel effect produces the frozen receipt consumed by kernel dispatch', async () => {
  const creationWait = deferred(); const f = delegationFixture({ creationWait });
  const running = f.binding.host.execute(f.authorized()); await new Promise(r => setImmediate(r));
  const control = f.authorized('cancel-control');
  control.effect = { ...control.effect, kind: 'host.cancel', reservationRef: null,
    payload: { ...control.effect.payload, graphRef: null, context: null, targetIds: ['delegate-1'] } };
  const r = value(await f.binding.host.execute(control)); value(decode('Receipt', r));
  assert.equal(r.status, 'cancelled'); assert.deepEqual(r.usage, []);
  creationWait.resolve(); assert.equal(value(await running).status, 'not-executed'); assert.equal(f.stats.executions, 0);
});

test('cp2 cancel stops only the named child while sibling and ordinary parent work survive', async () => {
  const gates = new Map([['one', deferred()], ['two', deferred()]]);
  const f = delegationFixture({ run: async ({ spec }) => gates.get(spec.invocationId.endsWith(':one') ? 'one' : 'two').promise });
  const baseCreate = f.options.create;
  f.options.create = async spec => { const made = value(await baseCreate(spec)); const key = spec.invocationId.endsWith(':one') ? 'one' : 'two';
    made.host.cancel = async () => { f.stats.aborts++; gates.get(key).resolve(); return { ok: true, value: { status: 'cancelled', targets: [], error: null } }; };
    return { ok: true, value: made }; };
  const one = f.binding.host.execute(f.authorized('one')), two = f.binding.host.execute(f.authorized('two'));
  await new Promise(r => setImmediate(r));
  const cancelled = value(await f.binding.host.cancel({ sessionId: 'kernel-1', targetIds: ['one'] }));
  assert.equal(cancelled.targets[0].confirmation, 'native-ack'); assert.equal(f.stats.aborts, 1);
  assert.equal(f.parent.counts().aborts, 0); assert.equal(f.state().ledger.reservations.length, 1);
  assert.equal(value(await one).status, 'unknown'); gates.get('two').resolve(); assert.equal(value(await two).status, 'completed');
});

test('cp3 persisted terminal delegation is read back without creation, prompting or double charging', async () => {
  const f = delegationFixture(); const a = f.authorized(); const original = value(await f.binding.host.execute(a));
  const state = structuredClone(f.state()); const reopened = f.rebind(); f.now(20000);
  assert.deepEqual(value(await reopened.host.execute(a)), original);
  assert.equal(value(await reopened.host.reconcile({ sessionId: 'kernel-1', targetIds: [a.effect.effectId] }))[0].verdict, 'resolved');
  assert.equal(f.stats.creates, 1); assert.equal(f.stats.executions, 1); assert.deepEqual(f.state(), state);
});

test('cp3 dispatched record never creates another child or repeats a provider request', async () => {
  const f = delegationFixture({ throwRun: true }); const a = f.authorized(); value(await f.binding.host.execute(a));
  const reopened = f.rebind();
  assert.equal((await reopened.host.execute(a)).error.code, 'EFK_EFFECT_NON_IDEMPOTENT_RETRY');
  const read = value(await reopened.host.reconcile({ sessionId: 'kernel-1', targetIds: [a.effect.effectId] }));
  assert.equal(read[0].verdict, 'unknown'); assert.equal(f.stats.creates, 1); assert.equal(f.stats.executions, 1);
  assert.equal(f.state().ledger.reservations.length, 1);
});

test('cp3 restored child receipt resolves unknown parent with no replay and no new charge', async () => {
  const f = delegationFixture(); const a = f.authorized(); const original = value(await f.binding.host.execute(a));
  const rows = f.parent.entries.filter(e => e.customType === PI_DELEGATION_ENTRY);
  f.parent.entries.splice(f.parent.entries.indexOf(rows.at(-1)), 1); // crash after dispatch persisted, before parent receipt
  const state = structuredClone(f.state()); const reopened = f.rebind();
  assert.equal(reopened.receipt(a.effect.effectId), null);
  const recovered = value(await reopened.host.reconcile({ sessionId: 'kernel-1', targetIds: [a.effect.effectId] }))[0];
  assert.equal(recovered.verdict, 'resolved'); assert.deepEqual(recovered.receipt, original);
  assert.equal(f.stats.restores, 1); assert.equal(f.stats.creates, 1); assert.equal(f.stats.executions, 1); assert.deepEqual(f.state(), state);
});

test('cp3 unload during creation proves no prompt and disposes the eventual child', async () => {
  const creationWait = deferred(); const f = delegationFixture({ creationWait }); const a = f.authorized();
  const execution = f.binding.host.execute(a); await new Promise(r => setImmediate(r));
  const closed = f.binding.close('unload'); creationWait.resolve(); value(await closed);
  assert.equal(value(await execution).status, 'not-executed'); assert.equal(f.stats.executions, 0); assert.equal(f.stats.disposes, 1);
});

test('cp3 shutdown hook and explicit exception close stop children but preserve parent ownership', async () => {
  for (const reason of ['shutdown', 'exception']) {
    const release = deferred(); const f = delegationFixture({ run: () => release.promise, release });
    const bound = value(attachPiDelegation(f.parent.api, f.options));
    const running = bound.host.execute(f.authorized()); await new Promise(r => setImmediate(r));
    if (reason === 'shutdown') await f.parent.emit('session_shutdown', { reason: 'exit' }); else value(await bound.close(reason));
    assert.equal(value(await running).status, 'unknown'); assert.equal(f.stats.aborts, 1); assert.equal(f.stats.disposes, 1);
    assert.equal(f.parent.counts().aborts, 0);
  }
});

test('cp3 foreign sessions and conflicting persistent identities fail closed', async () => {
  const f = delegationFixture(); value(await f.binding.host.execute(f.authorized()));
  const last = structuredClone(f.parent.entries.at(-1)); last.data.authorized.effect.idempotencyKey = 'changed'; f.parent.entries.push(last);
  assert.equal(bindPiDelegation(f.options).error.code, 'EFK_IDEMPOTENCY_COLLISION');
  assert.equal((await f.binding.host.execute({ ...f.authorized('other'), effect: { ...f.authorized('other').effect,
    binding: { ...f.authorized().effect.binding, hostSessionId: 'foreign-parent' } } })).error.code, 'EFK_HOST_SESSION_MISMATCH');
});

test('cp2/cp3 frozen SessionService accepts aggregate settlement and later recovery once, without host decisions', async () => {
  const f = delegationFixture({ missingUsage: true }), h = harness();
  const sessionId = 'kernel-delegation-integration';
  f.grant.scope = h.seed.grants[0].scope;
  const seed = { ...h.seed, sessionId, operations: { nA: { ...h.seed.operations.nA, kind: 'host.delegate',
    payload: { ...h.seed.operations.nA.payload, graphRef: f.authorized().effect.payload.graphRef,
      context: { ...h.seed.operations.nA.payload.context, isolation: 'fresh' } } } } };
  f.options.kernelSessionId = sessionId; f.options.parent = h.host;
  f.options.plan = async a => {
    const p = f.plan(a); p.effects[0].binding.sessionId = sessionId; p.effects[0].deadline = a.effect.deadline;
    return { ok: true, value: p };
  };
  const bound = value(bindPiDelegation(f.options));
  const service = createSessionService({ ...h.ports, host: bound.host });
  value(service.create({ ...seed, epoch: 1, protocol: f.authorized().effect.protocol }));
  value(await service.step(sessionId));
  const unresolved = value(service.read(sessionId)); const prior = Object.values(unresolved.receipts)[0];
  assert.equal(prior.status, 'unknown'); assert.equal(unresolved.budget.reservations.length, 1);
  assert.equal(unresolved.events.some(e => e.type === 'decision.recorded'), false);
  const actualRequest = f.state().owners[0].requestId;
  value(f.requests.record(usage(actualRequest, { source: 'synthetic' })));
  const recovery = value(await bound.host.reconcile({ sessionId, targetIds: [prior.effectId] }))[0];
  assert.equal(recovery.verdict, 'resolved'); assert.notEqual(recovery.receipt.receiptId, prior.receiptId);
  value(service.receive(sessionId, recovery.receipt));
  const resolved = value(service.read(sessionId));
  assert.equal(resolved.budget.settlements.length, 1); assert.equal(resolved.budget.settlements[0].micros, 37);
  assert.equal(resolved.budget.reservations.length, 0); assert.equal(resolved.nodeStates[0].state, 'verifying');
  assert.equal(value(service.receive(sessionId, recovery.receipt)).disposition, 'duplicate');
  assert.equal(f.stats.creates, 1); assert.equal(f.stats.executions, 1); assert.equal(h.calls.evaluate, 0);
});
