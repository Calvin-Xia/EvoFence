/** Real host credentials + current kernel claim, never a model-selected owner/name. */
import { fail } from '../../protocol/index.js';
import { canonical } from '../../kernel/store/index.js';
import { budgetWithin, delegate, err, grantIsLive, ok, scopeWithin, type AuthorizedEffect, type HostResult } from '../../runtime/host-port/index.js';
import type { NativeAgent } from './types.js';
import type { DelegationContext, DelegationPlan, DelegationPorts, DelegationRecord, TeamAuthority } from './delegation-types.js';

export function authority(ctx: DelegationContext, ports: DelegationPorts, sessionId: string): HostResult<TeamAuthority & { teamId: string }> {
  const credential = ports.authority();
  const membership = ctx.agentTeams.tryMembership(credential.caller);
  if (membership === undefined || membership.role !== 'lead' || membership.root !== credential.caller
    || credential.caller.id !== sessionId) {
    return err(fail('EFK_AUTHORITY_DENIED', 'delegation needs the exact live host Lead credential', [sessionId]));
  }
  return ok({ ...credential, teamId: membership.id });
}
export function admission(ctx: DelegationContext, ports: DelegationPorts, authorized: AuthorizedEffect,
  plan: DelegationPlan): HostResult<{ record: DelegationRecord; caller: NativeAgent }> {
  const effect = authorized.effect;
  const admitted = authority(ctx, ports, effect.binding.sessionId);
  if (!admitted.ok) return admitted;
  const credential = admitted.value;
  if (effect.binding.hostSessionId !== null && effect.binding.hostSessionId !== credential.caller.id) {
    return err(fail('EFK_HOST_SESSION_MISMATCH', 'delegation effect names another native parent', [effect.effectId]));
  }
  if (canonical(authorized.grant) !== canonical(credential.grant)) {
    return err(fail('EFK_AUTHORITY_DENIED', 'effect grant is not the existing host authority grant', [effect.effectId]));
  }
  const state = ports.readKernel();
  if (!state.ok) return state;
  const current = state.value;
  const claim = current.scheduler.claims.find(c => canonical(c.binding) === canonical(effect.binding));
  if (current.dispatchMode !== 'active' || current.epoch !== effect.binding.epoch || claim === undefined
    || canonical(current.effects[effect.effectId]) !== canonical(effect)
    || !current.outbox.entries.some(e => e.effectId === effect.effectId && e.state === 'dispatched')) {
    return err(fail('EFK_CLAIM_CONFLICT', 'delegation requires the current committed kernel dispatch claim', [effect.effectId]));
  }
  const child = delegate(credential.grant, plan.child, ports.composition.ports.clock.now());
  if (!child.ok) return child;
  let childId: string | null = null, childName: string, fromSeq = 0;
  if (plan.target.kind === 'existing') {
    if (effect.payload.context!.isolation === 'fresh') {
      return err(fail('EFK_CAPABILITY_UNSUPPORTED', 'existing child transcript cannot satisfy fresh context', [effect.effectId]));
    }
    const target = plan.target;
    const member = ctx.agentTeams.listMembers(credential.caller).find(m => m.id === target.childId && m.role === 'teammate');
    const native = ctx.agents.get(target.childId);
    if (member === undefined || native === undefined || native.status !== 'idle') {
      return err(fail('EFK_HOST_SESSION_MISMATCH', 'handoff needs an exact idle member of this native Team', [plan.target.childId]));
    }
    childId = native.id; childName = member.name;
    fromSeq = native.session.snapshotEvents().at(-1)!.seq + 1;
  } else {
    // Fork/provider substitution is an unprobed boundary, not an implicit fallback.
    if (plan.target.provider !== 'spawn') return err(fail('EFK_CAPABILITY_UNSUPPORTED', 'only pinned fresh spawn is enabled'));
    childName = plan.target.name;
  }
  return ok({ caller: credential.caller, record: { key: effect.idempotencyKey, revision: 0,
    signature: canonical(authorized), effect, parentId: credential.caller.id, teamId: credential.teamId,
    claimId: claim.claimId, plan, grant: child.value, phase: 'prepared', childId, childName, fromSeq,
    messageId: null, taskId: null, receipt: null, usage: [], preSteps: 0, unconfirmed: false, gatedCalls: [], resultCalls: [] } });
}
/** Check the current live root/grant at each real child request, including after a restart. */
export function childAdmitted(ctx: DelegationContext, ports: DelegationPorts, record: DelegationRecord): boolean {
  const admitted = authority(ctx, ports, record.parentId);
  if (!admitted.ok) return false;
  const state = ports.readKernel();
  if (!state.ok) return false;
  const now = ports.composition.ports.clock.now();
  return admitted.value.grant.rootAuthorityRef === record.grant.rootAuthorityRef
    && admitted.value.grant.revocationEpoch === record.grant.revocationEpoch
    && grantIsLive(admitted.value.grant, now) && grantIsLive(record.grant, now)
    && scopeWithin(record.grant.scope, admitted.value.grant.scope) && budgetWithin(record.grant.budget, admitted.value.grant.budget)
    && state.value.dispatchMode === 'active' && state.value.epoch === record.effect.binding.epoch
    && now < record.effect.deadline && record.effect.leases.every(l => l.expiresAt > now && l.epoch === state.value.epoch)
    && state.value.scheduler.claims.some(c => c.claimId === record.claimId && canonical(c.binding) === canonical(record.effect.binding));
}
