/** HostPort composition for fresh/continuable native teams. Kernel owns every claim. */
import { fail } from '../../protocol/index.js';
import { canonical } from '../../kernel/store/index.js';
import { readArtifact, type ArtifactRef as ConsumerArtifact } from '../../kernel/artifacts/index.js';
import { DSH_CAPABILITIES, capabilityGapError, err, judgeRequirements, ok, requiredCapabilities,
  usageIsComplete, type AuthorizedEffect, type HostPort, type HostResult, type Receipt,
  type CancelTarget, type ReconcileOutcome } from '../../runtime/host-port/index.js';
import { identity } from './mapping.js';
import { admission, authority } from './delegation-guards.js';
import { board, installDelegationHooks } from './delegation-hooks.js';
import { childUsage, inspectChild, save, unknownReceipt } from './delegation-evidence.js';
import type { NativeAgent } from './types.js';
import type { DelegationContext, DelegationPorts, DelegationRecord, DshDelegationBinding } from './delegation-types.js';
export type { DelegationContext, DelegationPorts, DelegationPlan, DelegationRecord, DelegationStore, TeamAuthority } from './delegation-types.js';

export function createDshDelegationBinding(ctx: DelegationContext, ports: DelegationPorts): DshDelegationBinding {
  if (ports.composition.version !== '0.2.0-rc.2') throw new Error('DSH delegation requires exact version 0.2.0-rc.2');
  const remove = installDelegationHooks(ctx, ports);
  let disposed = false;
  function current(record: DelegationRecord): HostResult<DelegationRecord> {
    const read = ports.store.get(record.key);
    return read.ok ? ok(read.value!) : read;
  }
  function rowsFor(targetId: string): HostResult<DelegationRecord | null> {
    const rows = ports.store.list();
    return rows.ok ? ok(rows.value.findLast(r => r.effect.effectId === targetId || (r.childId === targetId && r.phase !== 'settled'))
      ?? rows.value.findLast(r => r.childId === targetId) ?? null) : rows;
  }
  async function wait(child: NativeAgent, caller: NativeAgent): Promise<void> {
    if (child.status === 'idle') return;
    const controller = new AbortController();
    const activity = ctx.agentTeams.waitForChange(caller, 10000, controller.signal).catch(error => {
      if (!controller.signal.aborted) throw error;
    });
    try { await child.whenIdle(); }
    finally { controller.abort(); await activity; }
  }
  function settle(record: DelegationRecord): HostResult<Receipt> {
    const latest = current(record);
    if (!latest.ok) return latest;
    record = latest.value;
    if (record.phase === 'settled') return ok(record.receipt!);
    const snapshot = record.childId === null ? ok(null) : ports.snapshot(record.childId);
    if (!snapshot.ok) return snapshot;
    const child = snapshot.value;
    const observed = child === null ? ok(unknownReceipt(ports, record)) : inspectChild(ports, record, child);
    if (!observed.ok) return observed;
    const usage = child === null ? ok(record.usage) : childUsage(ports, record, child);
    if (!usage.ok) return usage;
    const saved = save(ports, record, { receipt: observed.value, usage: usage.value,
      phase: observed.value.status === 'unknown' ? 'unknown' : 'settled' });
    return saved.ok ? observed : saved;
  }
  async function project(record: DelegationRecord, caller: NativeAgent): Promise<HostResult<DelegationRecord>> {
    const task = await ctx.agentTeams.createTask(caller, { subject: `Kernel ${record.effect.binding.nodeId}`,
      description: `projection-only:${record.claimId}`, writeScopes: record.grant.scope.writeResources });
    const latest = current(record);
    if (!latest.ok) return latest;
    const saved = save(ports, latest.value, { taskId: task.id });
    if (!saved.ok) return saved;
    const checked = ports.projectBoard({ taskId: task.id, ownerSessionId: saved.value.childId!,
      nodeId: record.effect.binding.nodeId, attemptId: record.effect.binding.attemptId, ownerClaimId: record.claimId });
    if (!checked.ok) return checked;
    await ctx.agentTeams.updateTask(caller, { taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: record.childName });
    const synchronized = await board(ctx, ports);
    return synchronized.ok ? saved : synchronized;
  }
  async function execute(authorized: AuthorizedEffect): Promise<HostResult<Receipt>> {
    const effect = authorized.effect;
    if (disposed) return err(fail('EFK_HOST_SESSION_MISMATCH', 'delegation binding disposed'));
    const gaps = judgeRequirements(DSH_CAPABILITIES, requiredCapabilities(effect, authorized.demands));
    if (gaps.length > 0) return err(capabilityGapError(gaps, 'dsh'));
    const prior = ports.store.get(effect.idempotencyKey);
    if (!prior.ok) return prior;
    if (prior.value !== null) {
      const credential = authority(ctx, ports, effect.binding.sessionId);
      if (!credential.ok) return credential;
      if (prior.value.signature !== canonical(authorized)) return err(fail('EFK_IDEMPOTENCY_COLLISION', 'delegation key carries different bytes', [effect.effectId]));
      return prior.value.phase === 'settled' ? ok(prior.value.receipt!)
        : err(fail('EFK_EFFECT_NON_IDEMPOTENT_RETRY', 'claimed native delegation must reconcile, never resend', [effect.effectId]));
    }
    const plan = ports.plan(authorized);
    if (!plan.ok) return plan;
    const admitted = admission(ctx, ports, authorized, plan.value);
    if (!admitted.ok) return admitted;
    const synchronized = await board(ctx, ports);
    if (!synchronized.ok) return synchronized;
    const record = admitted.value.record, caller = admitted.value.caller;
    const prompt = [`Execute the kernel-admitted child graph ${canonical(effect.payload.graphRef)}.`,
      `Scoped grant ${record.grant.grantId}; kernel claim ${record.claimId}. Return actual products; kernel evaluates.`];
    const context = effect.payload.context as unknown as { inputRefs: ConsumerArtifact[] };
    for (const ref of context.inputRefs) {
      const read = readArtifact(ref, 'author', ports.composition.ports.clock.now(), ports.composition.ports.artifacts);
      if (!read.ok) return read;
      prompt.push(read.value);
    }
    // Atomic evidence reservation precedes the external call, shared across recovered instances.
    const rows = ports.store.list();
    if (!rows.ok) return rows;
    const active = rows.value.filter(r => r.phase !== 'settled');
    if (active.some(r => r.childName === record.childName || (record.childId !== null && r.childId === record.childId))
      || active.length >= authorized.grant.maxConcurrency) {
      return err(fail('EFK_CLAIM_CONFLICT', 'native child or parent delegation capacity is already owned', [effect.effectId]));
    }
    const stored = ports.store.put(record, null);
    if (!stored.ok) return stored;
    try {
      let childId: string, messageId: string | null = null;
      if (plan.value.target.kind === 'fresh') {
        const target = plan.value.target;
        const created = await ctx.agentTeams.spawnTeammate(caller, { name: target.name, description: target.description,
          provider: target.provider, context: 'fresh', prompt: prompt.map(text => ({ type: 'text', text })), signal: new AbortController().signal });
        childId = created.member.id;
      } else {
        childId = plan.value.target.childId;
        const sent = await ctx.agentTeams.sendMessage(caller, { target: record.childName,
          content: prompt.map(text => ({ type: 'text', text })), signal: new AbortController().signal });
        messageId = sent.messageId;
      }
      const latest = current(record);
      if (!latest.ok) return latest;
      const running = save(ports, latest.value, { childId, messageId, phase: 'running' });
      if (!running.ok) return running;
      const child = ctx.agents.get(childId);
      if (child === undefined) return settle(running.value);
      const projection = await project(running.value, caller);
      if (!projection.ok) return projection;
      await wait(child, caller);
      const checked = await board(ctx, ports);
      if (!checked.ok) return checked;
      return settle(projection.value);
    } catch {
      // Native/store errors can contain credentials. Preserve unknown and the dispatch evidence.
      const latest = current(record);
      if (!latest.ok) return latest;
      const receipt = unknownReceipt(ports, latest.value);
      const saved = save(ports, latest.value, { phase: 'unknown', receipt });
      return saved.ok ? ok(receipt) : saved;
    }
  }
  const host: HostPort = {
    ...ports.base,
    async observe(sessionId) {
      const admitted = authority(ctx, ports, sessionId);
      if (!admitted.ok) return admitted;
      return board(ctx, ports);
    },
    async execute(authorized) {
      if (authorized.effect.kind === 'host.delegate') return execute(authorized);
      if (authorized.effect.kind !== 'host.cancel') return ports.base.execute(authorized);
      const effect = authorized.effect;
      const outcome = await host.cancel({ sessionId: effect.binding.sessionId, targetIds: effect.payload.targetIds });
      if (!outcome.ok) return outcome;
      return ok({ protocol: effect.protocol, receiptId: identity(ports.composition, 'dsh-team-cancel', [effect.effectId, outcome.value.status]),
        effectId: effect.effectId, binding: effect.binding, hostInvocationId: null, status: outcome.value.status,
        artifactRefs: [], usage: [], observability: outcome.value.targets.flatMap(t => t.observability), error: outcome.value.error });
    },
    async cancel(request) {
      const admitted = authority(ctx, ports, request.sessionId);
      if (!admitted.ok) return admitted;
      const targets: CancelTarget[] = [];
      for (const targetId of request.targetIds) {
        const found = rowsFor(targetId);
        if (!found.ok) return found;
        const record = found.value;
        if (record === null) {
          const result = await ports.base.cancel({ sessionId: request.sessionId, targetIds: [targetId] });
          if (!result.ok) return result;
          targets.push(...result.value.targets); continue;
        }
        // Never interrupt ordinary work or a reused sibling on behalf of a settled effect.
        const child = record.childId === null ? undefined : ctx.agents.get(record.childId);
        if (record.phase !== 'settled' && child?.status === 'running') {
          const member = ctx.agentTeams.listMembers(admitted.value.caller).find(m => m.id === child.id && m.role === 'teammate');
          if (member === undefined || member.name !== record.childName) return err(fail('EFK_AUTHORITY_DENIED', 'cancel target is no longer this native child'));
          ctx.agentTeams.interrupt(admitted.value.caller, member.name);
          await wait(child, admitted.value.caller);
        }
        const snapshot = record.childId === null ? ok(null) : ports.snapshot(record.childId);
        if (!snapshot.ok) return snapshot;
        const aborted = record.phase === 'settled' ? record.receipt!.status === 'cancelled'
          : snapshot.value !== null && snapshot.value.idle && snapshot.value.events
            .filter(e => e.seq >= record.fromSeq).findLast(e => e.type === 'turn/end')?.data.reason?.kind === 'aborted';
        targets.push({ targetId, confirmation: aborted ? 'native-ack' : 'unconfirmed',
          observability: aborted ? [`child-native-aborted:${record.childId}`] : [] });
      }
      const confirmed = targets.every(t => t.confirmation !== 'unconfirmed');
      return ok({ status: confirmed ? 'cancelled' : 'unknown', targets,
        error: confirmed ? null : fail('EFK_CANCEL_UNCONFIRMED', 'named child stop is unconfirmed; no cascade claimed', request.targetIds) });
    },
    async reconcile(request) {
      const admitted = authority(ctx, ports, request.sessionId);
      if (!admitted.ok) return admitted;
      const outcomes: ReconcileOutcome[] = [];
      for (const targetId of request.targetIds) {
        const found = rowsFor(targetId);
        if (!found.ok) return found;
        if (found.value === null) {
          const result = await ports.base.reconcile({ sessionId: request.sessionId, targetIds: [targetId] });
          if (!result.ok) return result;
          outcomes.push(...result.value); continue;
        }
        const record = found.value;
        const result = record.phase === 'settled' ? ok(record.receipt!) : settle(record);
        if (!result.ok) return result;
        outcomes.push({ effectId: record.effect.effectId, verdict: result.value.status === 'unknown' ? 'unknown' : 'resolved',
          receipt: result.value, error: result.value.error });
      }
      return ok(outcomes);
    },
    async usage(request) {
      const found = rowsFor(request.effectId);
      if (!found.ok) return found;
      if (found.value === null) return ports.base.usage(request);
      const record = found.value;
      const snapshot = record.phase === 'settled' || record.childId === null ? ok(null) : ports.snapshot(record.childId);
      if (!snapshot.ok) return snapshot;
      const rows = snapshot.value === null ? ok(record.usage) : childUsage(ports, record, snapshot.value);
      if (!rows.ok) return rows;
      const selected = request.requestIds.length === 0 ? rows.value : rows.value.filter(r => request.requestIds.includes(r.requestId));
      return ok({ effectId: request.effectId, usage: selected, complete: usageIsComplete(selected)
        && request.requestIds.every(id => selected.some(r => r.requestId === id)) });
    },
  };
  return { host, dispose() { if (disposed) return; disposed = true; remove(); } };
}
