/** Scoped gates run inside the native waterfalls, preserving the host's permissions. */
import { canonical } from '../../kernel/store/index.js';
import { fail } from '../../protocol/index.js';
import { err, ok, type HostObservation, type HostResult } from '../../runtime/host-port/index.js';
import { childAdmitted } from './delegation-guards.js';
import { save } from './delegation-evidence.js';
import type { NativeAgent } from './types.js';
import type { DelegationContext, DelegationPorts, DelegationRecord } from './delegation-types.js';

function active(ctx: DelegationContext, ports: DelegationPorts, agent: NativeAgent): HostResult<DelegationRecord | null> {
  const rows = ports.store.list();
  if (!rows.ok) return rows;
  const membership = ctx.agentTeams.tryMembership(agent);
  if (membership === undefined || membership.role !== 'teammate') return ok(null);
  const record = rows.value.find(r => r.teamId === membership.id && r.phase !== 'settled'
    && (r.childId === agent.id || (r.childId === null && r.childName === membership.name)));
  if (record === undefined) return ok(null);
  return record.childId === null ? save(ports, record, { childId: agent.id }) : ok(record);
}
export function installDelegationHooks(ctx: DelegationContext, ports: DelegationPorts): () => void {
  const removers = [
    ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
      // Native background failure/cancel notices can wake the Lead without a new reservation.
      // Only notices from our recorded child are parked; ordinary user turns still pass.
      const last = (messages as { role?: string; source?: { kind?: string; senderSessionId?: string } }[])
        .findLast(m => m.role === 'user');
      if (last?.source?.kind === 'subagent-settled') {
        const rows = ports.store.list();
        if (!rows.ok) return { kind: 'reject' };
        if (rows.value.some(r => r.parentId === agent.id && r.childId === last.source?.senderSessionId)) return { kind: 'reject' };
      }
      const found = active(ctx, ports, agent);
      if (!found.ok) return { kind: 'reject' };
      if (found.value === null) return next();
      const record = found.value;
      const count = record.preSteps + 1;
      const allowed = count === 1 && childAdmitted(ctx, ports, record)
        && agent.options.maxTokens !== undefined && agent.options.maxTokens <= record.grant.budget.maxOutputTokens;
      const recorded = save(ports, record, { preSteps: count, unconfirmed: !allowed });
      if (!recorded.ok || !allowed) return { kind: 'reject' };
      return next();
    }),
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.agent === undefined) return next();
      const found = active(ctx, ports, exec.agent);
      if (!found.ok) return { kind: 'deny', reason: found.error.code };
      if (found.value === null) return next();
      const record = found.value;
      if (!childAdmitted(ctx, ports, record)) return { kind: 'deny', reason: 'EFK_AUTHORITY_DENIED' };
      const admitted = await ports.allowChild(record.grant, exec);
      if (!admitted.ok) return { kind: 'deny', reason: admitted.error.code };
      const saved = save(ports, record, { gatedCalls: [...record.gatedCalls, exec.callId] });
      return saved.ok ? next() : { kind: 'deny', reason: saved.error.code };
    }),
    ctx.on('tools/result', (exec) => {
      if (exec.agent === undefined) return;
      const found = active(ctx, ports, exec.agent);
      if (!found.ok) throw new Error(found.error.code);
      if (found.value === null) return;
      const stored = save(ports, found.value, { resultCalls: [...found.value.resultCalls, exec.callId] });
      if (!stored.ok) throw new Error(stored.error.code);
    }),
  ];
  return () => { for (const remove of removers.reverse()) remove(); };
}
export async function board(ctx: DelegationContext, ports: DelegationPorts): Promise<HostResult<HostObservation>> {
  const rows = ports.store.list();
  if (!rows.ok) return rows;
  const state = ports.readKernel();
  if (!state.ok) return state;
  for (const record of rows.value) {
    if (record.taskId === null) continue;
    const claim = state.value.scheduler.claims.find(c => c.claimId === record.claimId
      && canonical(c.binding) === canonical(record.effect.binding));
    if (claim === undefined || claim.binding.epoch !== state.value.epoch) {
      const caller = ports.authority().caller;
      const task = caller.session.snapshotEvents().findLast(e => e.type === 'team/task' && e.data.task?.id === record.taskId)?.data.task;
      if (task?.ownerId !== undefined) {
        if (task.ownerId !== record.childId) return err(fail('EFK_HOST_BOARD_AUTHORITY_CONFLICT', 'native projection owner changed outside the kernel', [record.taskId]));
        // Kernel released the real claim. Release only its exact native projection; no new owner.
        await ctx.agentTeams.updateTask(caller, { taskId: record.taskId,
          expectedRevision: (task as typeof task & { revision: number }).revision, action: 'release' });
      }
      continue;
    }
    const projected = ports.projectBoard({ taskId: record.taskId, ownerSessionId: record.childId!,
      nodeId: claim.binding.nodeId, attemptId: claim.binding.attemptId, ownerClaimId: claim.claimId });
    if (!projected.ok) return projected;
  }
  // Native enumeration (base HostPort) catches independent owners and changed mappings.
  return ports.base.observe(ports.authority().caller.id);
}
