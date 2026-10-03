import test from 'node:test';
import assert from 'node:assert/strict';
import { delegationFixture, value, deadline } from './l3-dsh-delegation-fixtures.test.js';
import { decode, fail } from '../dist/protocol/index.js';
import { DSH_CAPABILITIES } from '../dist/runtime/host-port/index.js';
import { packageRoot } from '../scripts/probes/dsh-probe-support.mjs';
import { nativePackageSkipReason } from '../scripts/probes/native-test-support.mjs';

// The delegation fixture mounts the pinned Cordis/AgentLoop/ToolRuntime host, so every
// case except the frozen-manifest evidence check needs the native @deepseek-ai/dsh install.
const nativeSkip = nativePackageSkipReason(packageRoot, '@deepseek-ai/dsh', 'EVOFENCE_DSH_PACKAGE_ROOT');
const nativeTest = (name, fn) => test(name, { skip: nativeSkip }, fn);

nativeTest('DoD1 cp1/cp2: fresh native child returns bound products and usage through HostPort, kernel evaluates', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  const report = value(await deadline(f.runtime.step(f.h.seed.sessionId)));
  assert.equal(report.appliedReceipts.length, 1);
  const state = value(f.runtime.read(f.h.seed.sessionId)), receipt = Object.values(state.receipts)[0];
  assert.equal(receipt.status, 'completed'); value(decode('Receipt', receipt));
  assert.equal(receipt.artifactRefs.length, 1); assert.equal(receipt.usage[0].total, 147);
  assert.equal(receipt.usage[0].estimatedUsdMicros, null); assert.equal(state.budget.reservations.length, 1);
  const record = [...f.records.values()][0], child = f.ctx.agents.get(record.childId);
  assert.equal(child.session.header.parentSession, f.handle.agent.id);
  assert.equal(record.grant.rootAuthorityRef, f.authority.grant.rootAuthorityRef);
  assert.equal(record.grant.remainingDepth, 1); assert.equal(record.grant.budget.poolId, f.h.seed.policy.poolId);
  assert.equal(f.ctx.agentTeams.membership(child).role, 'teammate');
  assert.equal(f.requests[0].nodeContext, true); assert.equal(f.requests[0].hostContext, true);
  assert.equal(f.counts.spawn, 1); assert.equal(f.counts.collect, 1);
  assert.equal(state.nodeStates[0].state, 'verifying'); assert.equal(f.h.calls.evaluate, 0);
  value(await f.runtime.evaluate(f.h.seed.sessionId, receipt.effectId));
  assert.equal(value(f.runtime.read(f.h.seed.sessionId)).nodeStates[0].state, 'succeeded');
});

nativeTest('cp1: same-id fake or stale host caller and invented grant cannot confer authority', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  const authorized = await f.claimed(), original = f.authority;
  f.setAuthority({ ...original, caller: { ...original.caller } });
  assert.equal((await f.delegated.host.execute(authorized)).error.code, 'EFK_AUTHORITY_DENIED');
  f.setAuthority(original);
  assert.equal((await f.delegated.host.execute({ ...authorized, grant: { ...authorized.grant, rootAuthorityRef: 'invented' } })).error.code, 'EFK_AUTHORITY_DENIED');
  assert.equal(f.counts.spawn, 0); assert.equal(f.requests.length, 0);
  const stale = original.caller, restored = await f.restore();
  assert.notEqual(restored, stale); f.setAuthority({ ...original, caller: stale });
  assert.equal((await f.delegated.host.execute(authorized)).error.code, 'EFK_AUTHORITY_DENIED');
});

nativeTest('cp1: child scope, depth, budget, expiry and revoked parent are refused before native spawn', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  const authorized = await f.claimed(), originalPlan = f.ports.plan;
  const base = value(originalPlan());
  for (const change of [{ scope: { ...base.child.scope, writeResources: ['outside'] } }, { remainingDepth: 2 },
    { budget: { ...base.child.budget, poolId: 'other' } }, { expiresAt: 10001 }]) {
    f.ports.plan = () => ({ ok: true, value: { ...base, child: { ...base.child, ...change } } });
    assert.equal((await f.delegated.host.execute(authorized)).ok, false);
  }
  f.ports.plan = originalPlan;
  f.setAuthority({ caller: f.handle.agent, grant: { ...authorized.grant, revoked: true } });
  assert.equal((await f.delegated.host.execute({ ...authorized, grant: f.authority.grant })).error.code, 'EFK_GRANT_REVOKED');
  assert.equal(f.counts.spawn, 0);
});

nativeTest('DoD1 cp2: handoff uses the actual existing child and enqueue stays distinct from consumption', async t => {
  const f = await delegationFixture({ isolation: 'current' }); t.after(() => f.close());
  const spawned = await f.ctx.agentTeams.spawnTeammate(f.handle.agent, { name: 'existing', description: 'host child',
    prompt: [{ type: 'text', text: 'HOST_CREATED' }], context: 'fresh', provider: 'spawn', signal: new AbortController().signal });
  const child = f.ctx.agents.get(spawned.member.id); await deadline(child.whenIdle());
  const before = f.requests.length;
  f.setTarget({ kind: 'existing', childId: child.id });
  const authorized = await f.claimed(), receipt = value(await deadline(f.delegated.host.execute(authorized)));
  assert.equal(f.counts.spawn, 0); assert.equal(f.counts.send, 1);
  assert.equal([...f.records.values()][0].childId, child.id);
  assert(receipt.observability.some(o => o.startsWith('durable-enqueue:')));
  assert.equal(receipt.status, 'unknown', 'this pinned native fixture queues without target consumption');
  assert.equal(f.requests.length, before);
  assert.equal(value(await f.delegated.host.usage({ effectId: authorized.effect.effectId, requestIds: [] })).complete, false);
  assert.equal((await f.delegated.host.execute(authorized)).error.code, 'EFK_EFFECT_NON_IDEMPOTENT_RETRY');
  assert.equal(f.counts.send, 1);
});

nativeTest('DoD1 cp2: native model failure feeds back failed and retains missing usage', async t => {
  const f = await delegationFixture(); t.after(() => f.close()); f.mode.value = 'failure';
  value(await deadline(f.runtime.step(f.h.seed.sessionId)));
  const state = value(f.runtime.read(f.h.seed.sessionId)), receipt = Object.values(state.receipts)[0];
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.error.code, 'EFK_HOST_EXECUTION_FAILED');
  assert.equal(receipt.usage[0].output, null); assert.equal(receipt.usage[0].complete, false);
  assert.equal(state.budget.reservations.length, 1); assert.equal(f.counts.collect, 0);
});

nativeTest('DoD2 cp2: native board is a projection of the unique kernel claim, concurrent dispatch is once', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  const authorized = await f.claimed();
  const results = await deadline(Promise.all([f.delegated.host.execute(authorized), f.delegated.host.execute(authorized)]));
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(f.counts.spawn, 1); assert.equal(f.requests.length, 1);
  const record = [...f.records.values()][0], state = value(f.runtime.read(f.h.seed.sessionId));
  const observed = value(await f.delegated.host.observe(f.h.seed.sessionId));
  assert.deepEqual(observed.boardOwners, [{ nodeId: 'nA', attemptId: authorized.effect.binding.attemptId, ownerClaimId: state.scheduler.claims[0].claimId }]);
  assert.equal(record.claimId, state.scheduler.claims[0].claimId); assert.equal(state.scheduler.claims.length, 1);
  const replay = value(await f.delegated.host.execute(authorized)); assert.equal(replay.status, 'completed'); assert.equal(f.counts.spawn, 1);
});

nativeTest('DoD2 cp2: independent native board owner refuses dispatch, preserving kernel claim', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  const authorized = await f.claimed(), before = value(f.runtime.read(f.h.seed.sessionId)).scheduler;
  const task = await f.ctx.agentTeams.createTask(f.handle.agent, { subject: 'rogue', description: 'independent scheduler' });
  await f.ctx.agentTeams.updateTask(f.handle.agent, { taskId: task.id, expectedRevision: task.revision, action: 'claim' });
  const result = await f.delegated.host.execute(authorized);
  assert.equal(result.error.code, 'EFK_HOST_BOARD_AUTHORITY_CONFLICT'); assert.equal(f.counts.spawn, 0); assert.equal(f.requests.length, 0);
  assert.deepEqual(value(f.runtime.read(f.h.seed.sessionId)).scheduler.claims, before.claims);
});

nativeTest('cp2: uncommitted and stale effects, reliable delivery demand and fork are refused', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  f.h.planOnly(); const effect = Object.values(f.h.read().effects)[0], grant = f.authority.grant;
  assert.equal((await f.delegated.host.execute({ effect, grant })).error.code, 'EFK_CLAIM_CONFLICT');
  const state = f.h.read(); value(f.h.store.dispatchEffect(f.h.seed.sessionId, { expectedRevision: state.revision, epoch: state.epoch, effectId: effect.effectId, claimId: 'manual' }));
  assert.equal((await f.delegated.host.execute({ effect: { ...effect, binding: { ...effect.binding, epoch: 9 } }, grant })).error.code, 'EFK_CLAIM_CONFLICT');
  assert.equal((await f.delegated.host.execute({ effect: { ...effect, payload: { ...effect.payload, deliveryGuarantee: 'acknowledged-durable' } }, grant })).error.code, 'EFK_CAPABILITY_UNSUPPORTED');
  f.setTarget({ kind: 'fresh', name: 'fork', description: 'unprobed', provider: 'fork' });
  assert.equal((await f.delegated.host.execute({ effect, grant })).error.code, 'EFK_CAPABILITY_UNSUPPORTED');
  assert.equal(f.counts.spawn, 0);
});

nativeTest('DoD1 cp3: wait and interrupt stop only the named running child, missing usage remains unknown', async t => {
  const f = await delegationFixture(); t.after(() => f.close()); f.mode.value = 'hold';
  const authorized = await f.claimed(), started = f.started(), execution = f.delegated.host.execute(authorized);
  await deadline(started);
  const record = [...f.records.values()][0], child = f.ctx.agents.get(record.childId);
  assert.equal(child.status, 'running');
  assert.equal(value(await f.delegated.host.cancel({ sessionId: f.h.seed.sessionId, targetIds: ['worker', 'ordinary-work'] })).status, 'unknown');
  assert.equal(child.status, 'running'); assert.equal(f.counts.interrupt.length, 0);
  const cancelled = value(await deadline(f.delegated.host.cancel({ sessionId: f.h.seed.sessionId, targetIds: [child.id] })));
  assert.equal(cancelled.status, 'cancelled'); assert.deepEqual(f.counts.interrupt, ['worker']);
  const receipt = value(await deadline(execution)); assert.equal(receipt.status, 'cancelled');
  assert.equal(receipt.usage[0].complete, false); assert.equal(receipt.usage[0].total, null);
  assert(f.counts.wait > 0); await deadline(f.handle.agent.whenIdle()); assert.equal(f.handle.agent.status, 'idle');
});

nativeTest('cp3: takeover reconciles the same child without spawn or resend; duplicate and late receipt do not settle again', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  value(await deadline(f.runtime.step(f.h.seed.sessionId)));
  const state = value(f.runtime.read(f.h.seed.sessionId)), receipt = Object.values(state.receipts)[0];
  const count = f.requests.length;
  f.recreate();
  const outcome = value(await f.delegated.host.reconcile({ sessionId: f.h.seed.sessionId, targetIds: [receipt.effectId] }))[0];
  assert.equal(outcome.verdict, 'resolved'); assert.deepEqual(outcome.receipt, receipt);
  assert.equal(value(f.runtime.receive(f.h.seed.sessionId, outcome.receipt)).disposition, 'duplicate');
  assert.deepEqual(value(f.runtime.read(f.h.seed.sessionId)).budget, state.budget); assert.equal(f.requests.length, count);
  const report = value(await f.delegated.host.usage({ effectId: receipt.effectId, requestIds: [] }));
  const originalSnapshot = f.ports.snapshot;
  f.ports.snapshot = () => ({ ok: false, error: fail('EFK_ARTIFACT_UNAVAILABLE', 'native child left the live registry') });
  assert.deepEqual(value(await f.delegated.host.usage({ effectId: receipt.effectId, requestIds: [] })), report, 'settled usage survives loss of the live child');
  f.ports.snapshot = originalSnapshot;
  const manifest = f.h.persist('resume-pin', 'GraphSpec', f.h.seed.graph.spec);
  value(f.runtime.pause(f.h.seed.sessionId, { commandId: 'pause', expectedRevision: value(f.runtime.read(f.h.seed.sessionId)).revision, reason: 'takeover' }));
  value(f.runtime.resume(f.h.seed.sessionId, { commandId: 'resume', expectedRevision: value(f.runtime.read(f.h.seed.sessionId)).revision, epoch: 2, manifestRef: manifest }));
  const budget = value(f.runtime.read(f.h.seed.sessionId)).budget;
  assert.equal(value(f.runtime.receive(f.h.seed.sessionId, { ...receipt, receiptId: 'late-child-copy' })).disposition, 'archived');
  assert.deepEqual(value(f.runtime.read(f.h.seed.sessionId)).budget, budget);
  assert.equal(f.counts.spawn, 1); assert.equal(f.counts.send, 0);
});

nativeTest('cp3: prepared dispatch surviving interruption cannot be blindly replayed', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  const authorized = await f.claimed();
  const original = f.context.agentTeams.spawnTeammate;
  f.context.agentTeams.spawnTeammate = async () => { throw new Error('native failure with credential-like detail'); };
  const receipt = value(await f.delegated.host.execute(authorized)); assert.equal(receipt.status, 'unknown');
  assert(!JSON.stringify(receipt).includes('credential-like'));
  f.context.agentTeams.spawnTeammate = original; f.recreate();
  assert.equal((await f.delegated.host.execute(authorized)).error.code, 'EFK_EFFECT_NON_IDEMPOTENT_RETRY');
  assert.equal(value(await f.delegated.host.reconcile({ sessionId: f.h.seed.sessionId, targetIds: [receipt.effectId] }))[0].verdict, 'unknown');
  assert.equal(f.requests.length, 0);
});

nativeTest('cp2: child hooks preserve native denial and prevent unreserved extra model steps', async t => {
  const f = await delegationFixture(); t.after(() => f.close()); f.mode.value = 'tools';
  const authorized = await f.claimed(), receipt = value(await deadline(f.delegated.host.execute(authorized)));
  assert.equal(receipt.status, 'unknown'); assert.equal(f.requests.length, 1);
  assert.equal(f.executed.denied, 0); assert.equal(f.executed.echo, 1); assert.equal(f.executed.failure, 1);
  assert(f.counts.gates.every(g => g.grant.grantId === 'child-grant'));
});

nativeTest('cp2: removed child pre-step hook cannot confirm a child outcome', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  f.removers.get('agent/pre-step')();
  const authorized = await f.claimed(), receipt = value(await deadline(f.delegated.host.execute(authorized)));
  assert.equal(receipt.status, 'unknown'); assert.equal(f.requests.length, 1); assert.equal(f.counts.collect, 0);
});

nativeTest('cp3: kernel cancel dispatches HostPort cancel receipts and scopes the real child', async t => {
  const f = await delegationFixture(); t.after(() => f.close()); f.mode.value = 'hold';
  const started = f.started(), execution = f.runtime.step(f.h.seed.sessionId);
  await deadline(started);
  const state = value(f.runtime.read(f.h.seed.sessionId));
  const cancelled = value(await deadline(f.runtime.cancel(f.h.seed.sessionId,
    { commandId: 'cancel-child', expectedRevision: state.revision, reason: 'native child interrupt' })));
  assert.equal(cancelled.status, 'cancelled'); value(await deadline(execution));
  const after = value(f.runtime.read(f.h.seed.sessionId));
  assert.equal(after.nodeStates[0].state, 'cancelled');
  assert.equal(after.budget.reservations.length, 1); assert.deepEqual(f.counts.interrupt, ['worker']);
  await deadline(f.handle.agent.whenIdle()); assert.equal(f.requests.length, 1, 'native failure notice does not spend a second request');
  f.mode.value = 'reply'; await f.ordinary(); assert.equal(f.requests.length, 2, 'ordinary host followup remains usable');
});

nativeTest('cp3: takeover of an in-flight child reads evidence without re-dispatch', async t => {
  const f = await delegationFixture(); t.after(() => f.close()); f.mode.value = 'hold';
  const authorized = await f.claimed(), started = f.started(), execution = f.delegated.host.execute(authorized);
  await deadline(started);
  const count = f.requests.length; f.recreate();
  const pending = value(await f.delegated.host.reconcile({ sessionId: f.h.seed.sessionId, targetIds: [authorized.effect.effectId] }))[0];
  assert.equal(pending.verdict, 'unknown');
  assert.equal((await f.delegated.host.execute(authorized)).error.code, 'EFK_EFFECT_NON_IDEMPOTENT_RETRY');
  assert.equal(f.requests.length, count);
  value(await deadline(f.delegated.host.cancel({ sessionId: f.h.seed.sessionId, targetIds: [authorized.effect.effectId] })));
  value(await deadline(execution));
  const settled = value(await f.delegated.host.reconcile({ sessionId: f.h.seed.sessionId, targetIds: [authorized.effect.effectId] }))[0];
  assert.equal(settled.verdict, 'resolved'); assert.equal(settled.receipt.status, 'cancelled');
  assert.equal(f.counts.spawn, 1); assert.equal(f.counts.send, 0);
});

nativeTest('cp2: unknown counters are preserved and idempotency collisions are refused', async t => {
  const f = await delegationFixture(); t.after(() => f.close()); f.mode.value = 'no-usage';
  const authorized = await f.claimed(), receipt = value(await f.delegated.host.execute(authorized));
  assert.equal(receipt.status, 'completed'); assert.equal(receipt.usage[0].total, null); assert.equal(receipt.usage[0].complete, false);
  const report = value(await f.delegated.host.usage({ effectId: receipt.effectId, requestIds: [] }));
  assert.equal(report.usage.length, 1); assert.equal(report.complete, false);
  assert.equal(value(await f.delegated.host.usage({ effectId: receipt.effectId, requestIds: ['foreign'] })).complete, false);
  const collision = await f.delegated.host.execute({ ...authorized, effect: { ...authorized.effect, deadline: 7000 } });
  assert.equal(collision.error.code, 'EFK_IDEMPOTENCY_COLLISION'); assert.equal(f.requests.length, 1);
});

nativeTest('cp1/cp2: scoped tool refusal prevents child tool effects', async t => {
  const f = await delegationFixture({ allowChild: async () => ({ ok: false, error: fail('EFK_AUTHORITY_DENIED', 'scoped tool denied') }) });
  t.after(() => f.close()); f.mode.value = 'tools';
  const authorized = await f.claimed(), receipt = value(await f.delegated.host.execute(authorized));
  assert.equal(receipt.status, 'unknown'); assert.equal(f.executed.echo, 0); assert.equal(f.executed.failure, 0);
  assert.equal(f.executed.denied, 0); assert.equal(f.requests.length, 1);
});

nativeTest('cp1: host output limit above the scoped child budget is stopped before any model request', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  const authorized = await f.claimed(), plan = value(f.ports.plan());
  f.ports.plan = () => ({ ok: true, value: { ...plan, child: { ...plan.child, budget: { ...plan.child.budget, maxOutputTokens: 64 } } } });
  const receipt = value(await f.delegated.host.execute(authorized));
  assert.equal(receipt.status, 'unknown'); await deadline(f.handle.agent.whenIdle());
  assert.equal(f.requests.length, 0); assert.equal(receipt.usage.length, 0);
});

nativeTest('cp3: named child cancel never interrupts an unrelated real sibling or a settled effect', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  f.mode.value = 'hold'; const siblingStarted = f.started();
  const created = await f.ctx.agentTeams.spawnTeammate(f.handle.agent, { name: 'sibling', description: 'ordinary sibling',
    prompt: [{ type: 'text', text: 'ordinary' }], context: 'fresh', provider: 'spawn', signal: new AbortController().signal });
  const sibling = f.ctx.agents.get(created.member.id); await deadline(siblingStarted);
  f.mode.value = 'reply';
  const authorized = await f.claimed(), receipt = value(await f.delegated.host.execute(authorized));
  assert.equal(receipt.status, 'completed');
  assert.equal(value(await f.delegated.host.cancel({ sessionId: f.h.seed.sessionId, targetIds: [sibling.id] })).status, 'unknown');
  assert.equal(sibling.status, 'running'); assert.deepEqual(f.counts.interrupt, []);
  assert.equal(value(await f.delegated.host.cancel({ sessionId: f.h.seed.sessionId, targetIds: [receipt.effectId] })).status, 'unknown');
  assert.equal(sibling.status, 'running'); assert.deepEqual(f.counts.interrupt, []);
  f.mode.value = 'reply'; sibling.cancel({ kind: 'user' }, { keepInbox: true });
  await deadline(sibling.whenIdle()); await deadline(f.handle.agent.whenIdle());
});

nativeTest('DoD2 cp3: changed native owner is refused instead of becoming a second scheduler', async t => {
  const f = await delegationFixture(); t.after(() => f.close());
  value(await f.runtime.step(f.h.seed.sessionId)); const record = [...f.records.values()][0];
  const task = f.ctx.agentTeams.getTask(f.handle.agent, record.taskId);
  await f.ctx.agentTeams.updateTask(f.handle.agent, { taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: 'lead' });
  assert.equal((await f.delegated.host.observe(f.h.seed.sessionId)).error.code, 'EFK_HOST_BOARD_AUTHORITY_CONFLICT');
  assert.equal(f.counts.spawn, 1); assert.equal(f.requests.length, 1);
});

test('evidence: frozen manifests retain fork, 13 unknowns, delivery and cascade gaps', async t => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json', import.meta.url), 'utf8'));
  const unknown = Object.entries(manifest.capabilities).filter(([, row]) => row.status === 'unknown').map(([name]) => name);
  assert.equal(unknown.length, 13); for (const name of unknown) assert.equal(DSH_CAPABILITIES[name].status, 'unknown');
  assert.equal(DSH_CAPABILITIES.parentChildCancellation.status, 'unknown'); assert.equal(DSH_CAPABILITIES.teamMessageDelivery.status, 'unknown');
});
