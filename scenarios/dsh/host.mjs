import path from 'node:path';
import assert from 'node:assert/strict';
import { DSH_CAPABILITIES, ok, verifyBoardAuthority } from '../../dist/runtime/host-port/index.js';
import { ctx, roles, turn } from './native.mjs';
import { budget, drain } from './meter.mjs';
import { evidence, record, writeJson, value } from './io.mjs';

// The frozen runtime settles one reservation per invocation. All individual HTTP
// reservations remain separately visible in request-pool.json and MODEL-BUDGET.json.
function invocationUsage(requestId, rows) {
  const complete = rows.length > 0 && rows.every(r => r.tokens !== null && r.nativeUsage !== null);
  const sum = key => complete ? rows.reduce((n, r) => n + r.tokens[key], 0) : null;
  return { requestId, source: 'host-normalized', inputUncached: sum('inputUncached'), output: sum('output'),
    cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), total: sum('total'), reasoning: null,
    estimatedUsdMicros: complete ? rows.reduce((n, r) => n + Math.ceil(r.referenceUsd * 1e6), 0) : null,
    invoiceUsdMicros: null, complete, evidenceRefs: [] };
}
export function makeHost(parent, prompts, childPrompt, complete, continuedRequests = []) {
  let kernel;
  const links = new Map(), deliveries = new Map();
  const unknown = { status: 'unknown', coverage: [], evidenceRefs: [] };
  const host = {
    async observe() {
      const state = value(kernel.service.read(kernel.seed.sessionId));
      const claims = state.scheduler.claims;
      for (const [taskId, link] of links) {
        const task = ctx.agentTeams.listTasks(parent.agent).find(t => t.id === taskId);
        if (!claims.some(c => c.claimId === link.ownerClaimId) && task.ownerId !== undefined) {
          assert.equal(task.ownerId, link.childId, 'Board projection owner changed');
          await ctx.agentTeams.updateTask(parent.agent, { taskId, expectedRevision: task.revision, action: 'release' });
        }
      }
      const owners = ctx.agentTeams.listTasks(parent.agent).filter(t => t.ownerId !== undefined).map(t => {
        const link = links.get(t.id); assert(link && link.childId === t.ownerId, 'Unmapped board owner');
        return { nodeId: link.nodeId, attemptId: link.attemptId, ownerClaimId: link.ownerClaimId };
      });
      const observation = { host: 'dsh', boardOwners: owners, idle: parent.agent.status === 'idle', capabilities: DSH_CAPABILITIES,
        cancellation: unknown, recovery: unknown, isolation: unknown };
      value(verifyBoardAuthority(observation, claims.map(c => ({ nodeId: c.binding.nodeId, attemptId: c.binding.attemptId, ownerClaimId: c.claimId }))));
      record('board-projection-checked', { owners, claims: claims.map(c => c.claimId) }); return ok(observation);
    },
    async execute(authorized) {
      const e = authorized.effect, stage = e.binding.nodeId;
      const state = value(kernel.service.read(kernel.seed.sessionId));
      const claim = state.scheduler.claims.find(c => c.binding.nodeId === stage && c.binding.attemptId === e.binding.attemptId);
      assert(claim, 'Native dispatch requires an existing kernel claim');
      assert(!deliveries.has(e.effectId), 'Never replay a dispatched native effect');
      record('kernel-claim-consumed', { effectId: e.effectId, stage, claimId: claim.claimId });
      const fromRequest = budget.requests.length;
      let agent = parent.agent;
      if (e.kind === 'host.delegate') {
        const name = stage === 'verify' ? 'verifier-red' : stage === 'finish' ? 'verifier-final' : stage;
        const spawned = await ctx.agentTeams.spawnTeammate(parent.agent, { name, description: `Kernel claim ${claim.claimId}; ${stage}`,
          context: 'fresh', provider: 'spawn', prompt: [{ type: 'text', text: childPrompt(stage) }], signal: new AbortController().signal });
        agent = ctx.agents.get(spawned.member.id); roles.set(agent.id, stage === 'logic' || stage === 'tests' ? stage : 'verifier');
        record('child-created', { parentId: parent.agent.id, childId: agent.id, role: name, claimId: claim.claimId });
        const task = await ctx.agentTeams.createTask(parent.agent, { subject: `Kernel ${stage}`, description: `projection-only:${claim.claimId}`,
          writeScopes: stage === 'logic' ? ['src/lib/cli'] : stage === 'tests' ? ['test', 'docs'] : [] });
        links.set(task.id, { nodeId: stage, attemptId: e.binding.attemptId, ownerClaimId: claim.claimId, childId: agent.id });
        await ctx.agentTeams.updateTask(parent.agent, { taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: name });
        await agent.whenIdle(); await drain();
        const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end');
        assert(end && end.data.reason.kind !== 'error', 'Native worker failed');
      } else await turn(agent, prompts[stage]);
      assert(complete(stage), `Native stage did not produce required result: ${stage}`);
      await ctx.sessionPersistence.flush();
      const rows = budget.requests.filter((r, i) => r.sessionId === agent.id
        && (i >= fromRequest || (stage === 'integrate' && continuedRequests.includes(r.requestId))));
      const usage = invocationUsage(e.reservationRef, rows);
      assert(usage.complete, `Incomplete actual usage: ${stage}`);
      const receipt = { protocol: e.protocol, receiptId: `native-receipt:${e.effectId}`, effectId: e.effectId,
        binding: e.binding, hostInvocationId: `dsh-invocation:${agent.id}:${e.effectId}`, status: 'completed',
        artifactRefs: [], usage: [usage], observability: [`native-session:${agent.id}`, `kernel-claim:${claim.claimId}`], error: null };
      deliveries.set(e.effectId, receipt);
      writeJson(path.join(evidence, `invocation-${stage}.json`), { claim, receipt, requestIds: rows.map(r => r.requestId),
        sessionId: agent.id, events: agent.session.snapshotEvents() });
      record('native-stage-result', { stage, sessionId: agent.id, requestIds: rows.map(r => r.requestId) }); return ok(receipt);
    },
    async context() { return ok([]); },
    async usage(request) { return ok({ effectId: request.effectId, usage: deliveries.get(request.effectId).usage, complete: true }); },
    async reconcile() { throw new Error('No scenario unknown invocation may be blindly replayed'); },
    async cancel() { throw new Error('Interruption is exercised before graph dispatch through native Agent.cancel'); }
  };
  return { host, attach: k => { kernel = k; } };
}
