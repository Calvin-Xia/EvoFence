/** Native HostPort: this session's loop and ToolRuntime; no child CLI or second scheduler. */
import { fail } from '../../protocol/index.js';
import { readArtifact, type ArtifactRef as ConsumerArtifact } from '../../kernel/artifacts/index.js';
import { canonical } from '../../kernel/store/index.js';
import { DSH_CAPABILITIES, capabilityGapError, contextRequirements, err, judgeRequirements, ok,
  requiredCapabilities, usageIsComplete, type ContextPlan, type Effect, type HostPort, type HostResult,
  type HostGuarantee, type Receipt, type ReconcileOutcome } from '../../runtime/host-port/index.js';
import { healthy, stopEvolution, unexpected } from './health.js';
import { identity, invocationUsage, nativeBoard, reservedUsage } from './mapping.js';
import type { DshComposition, DshSession, NativeContext, RunningEffect } from './types.js';

export function contextPacket(composition: DshComposition, plan: ContextPlan): HostResult<string[]> {
  if (plan.isolation === 'fresh') return err(fail('EFK_CAPABILITY_UNSUPPORTED', 'fresh context requires the explicit delegation binding'));
  const gaps = judgeRequirements(DSH_CAPABILITIES, contextRequirements(plan));
  if (gaps.length > 0) return err(capabilityGapError(gaps, 'dsh'));
  const packet: string[] = [];
  for (const ref of plan.inputRefs) {
    const bytes = readArtifact(ref as ConsumerArtifact, 'author', composition.ports.clock.now(), composition.ports.artifacts);
    if (!bytes.ok) return bytes;
    packet.push(bytes.value);
  }
  return ok(packet);
}
function receipt(session: DshSession, composition: DshComposition, effect: Effect, status: Receipt['status'],
  invocation: string | null, observability: string[], error: Receipt['error'] = null): Receipt {
  return { protocol: effect.protocol, receiptId: identity(composition, 'dsh-receipt', [effect.effectId, status, invocation]),
    effectId: effect.effectId, hostInvocationId: invocation, binding: effect.binding,
    status, artifactRefs: [], usage: reservedUsage(effect, session.usages.get(effect.effectId) ?? []), observability, error };
}
export function createDshHost(ctx: NativeContext, composition: DshComposition, getSession: () => DshSession): HostPort {
  function sessionFor(id: string): HostResult<DshSession> {
    const session = getSession();
    if (session.request.sessionId !== id || ctx.agents.get(session.agent.id) !== session.agent) {
      return err(fail('EFK_HOST_SESSION_MISMATCH', 'native session identity is no longer current', [id]));
    }
    const health = healthy(session);
    return health.ok ? ok(session) : health;
  }
  const host: HostPort = {
    async observe(id) {
      const admitted = sessionFor(id);
      if (!admitted.ok) return admitted;
      const session = admitted.value;
      const board = nativeBoard(session);
      if (!board.ok) { stopEvolution(session, composition, board.error); return board; }
      // Audit G18: `verified` would need a non-empty evidence tuple, and nothing below has evidence.
      const guarantee = (status: 'absent' | 'partial' | 'unknown', coverage: string[]): HostGuarantee => ({ status, coverage, evidenceRefs: [] });
      return ok({ host: 'dsh', idle: session.agent.status === 'idle', capabilities: DSH_CAPABILITIES,
        cancellation: guarantee('partial', ['native-loop-signal-and-idle']),
        recovery: guarantee('partial', ['native-transcript-reopen']), isolation: guarantee('unknown', []), boardOwners: board.value });
    },
    async context(request) {
      const admitted = sessionFor(request.sessionId);
      if (!admitted.ok) return admitted;
      const packet = contextPacket(composition, request.plan);
      if (!packet.ok) return packet;
      admitted.value.contextText = packet.value;
      return ok({ isolation: request.plan.isolation, preservedHostResources: true, injectedRefs: request.plan.inputRefs });
    },
    async execute(authorized) {
      const effect = authorized.effect;
      const admitted = sessionFor(effect.binding.sessionId);
      if (!admitted.ok) return admitted;
      const session = admitted.value;
      if (effect.binding.hostSessionId !== null && effect.binding.hostSessionId !== session.agent.id) {
        return err(fail('EFK_HOST_SESSION_MISMATCH', 'effect names another native session', [effect.effectId]));
      }
      const gaps = judgeRequirements(DSH_CAPABILITIES, requiredCapabilities(effect, authorized.demands));
      if (gaps.length > 0) return err(capabilityGapError(gaps, 'dsh'));
      if (effect.kind !== 'host.agent' && effect.kind !== 'host.tool' && effect.kind !== 'host.cancel') {
        return err(fail('EFK_CAPABILITY_UNSUPPORTED', `DSH session binding does not implement ${effect.kind}`, [effect.effectId]));
      }
      const signature = canonical(effect);
      const prior = session.dispatched.get(effect.idempotencyKey);
      if (prior !== undefined) {
        if (prior !== signature) return err(fail('EFK_IDEMPOTENCY_COLLISION', 'effect key carries different bytes', [effect.effectId]));
        const known = session.receipts.get(effect.effectId);
        return known !== undefined && known.status !== 'unknown' ? ok(known)
          : err(fail('EFK_EFFECT_NON_IDEMPOTENT_RETRY', 'unconfirmed native dispatch cannot be repeated', [effect.effectId]));
      }
      if (effect.kind === 'host.cancel') {
        const outcome = await host.cancel({ sessionId: effect.binding.sessionId, targetIds: effect.payload.targetIds });
        if (!outcome.ok) return outcome;
        return ok(receipt(session, composition, effect, outcome.value.status, null,
          outcome.value.targets.flatMap(t => t.observability), outcome.value.error));
      }
      if (session.agent.status !== 'idle' || session.running !== null) {
        return err(fail('EFK_REVISION_CONFLICT', 'native session is busy; continue after its ordinary work settles', [session.agent.id]));
      }
      // One reservation is one model invocation in the existing runtime. A missing/unbounded
      // native maxTokens is a real budget gap, not permission to replace the user's model options.
      if (effect.kind === 'host.agent' && (session.agent.options.maxTokens === undefined
        || session.agent.options.maxTokens > session.request.policy.maxOutputTokens)) {
        return err(fail('EFK_BUDGET_NOT_AUTHORIZED', 'existing native output limit exceeds the session budget', [effect.effectId]));
      }
      if (effect.payload.context !== null) {
        const injected = await host.context({ sessionId: effect.binding.sessionId, plan: effect.payload.context as unknown as ContextPlan });
        if (!injected.ok) return injected;
      }
      let args: unknown;
      if (effect.kind === 'host.tool') {
        const bytes = readArtifact(effect.payload.argumentsRef as ConsumerArtifact, 'author', composition.ports.clock.now(), composition.ports.artifacts);
        if (!bytes.ok) return bytes;
        try { args = JSON.parse(bytes.value); }
        catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          return err(fail('EFK_SCHEMA_INVALID', 'native tool arguments are not JSON', [effect.effectId]));
        }
      }
      const running: RunningEffect = { effect, fromSeq: session.agent.session.snapshotEvents().length,
        preSteps: 0, toolGates: new Set(), toolResults: new Set(), eventSeqs: new Set() };
      session.running = running;
      session.dispatched.set(effect.idempotencyKey, signature);
      try {
        let status: Receipt['status'];
        let nativeId: string | null;
        const observability: string[] = [];
        if (effect.kind === 'host.agent') {
          session.agent.followup(composition.helpers.message(`EvoFence node ${effect.binding.nodeId}; execute the admitted context packet.`));
          await session.agent.whenIdle();
          const events = session.agent.session.snapshotEvents().slice(running.fromSeq);
          const usage = invocationUsage(session, composition, events);
          if (!usage.ok) { stopEvolution(session, composition, usage.error); return usage; }
          session.usages.set(effect.effectId, usage.value);
          if (usage.value.length > 1) stopEvolution(session, composition,
            fail('EFK_USAGE_INCOMPLETE', 'multiple native invocations cannot settle one reserved request; reconcile and re-authorize', [effect.effectId]));
          const end = events.findLast(e => e.type === 'turn/end');
          const invoked = events.some(e => e.type === 'assistant/message' || e.type === 'assistant/attempt');
          nativeId = invoked ? identity(composition, 'dsh-turn', [session.agent.id, end?.data.turn, running.fromSeq]) : null;
          status = end?.data.reason?.kind === 'completed' ? 'completed' : end?.data.reason?.kind === 'aborted' ? 'cancelled'
            : end?.data.reason?.kind === 'error' ? 'failed' : 'unknown';
          // A removed callback is reachable even with a healthy native loop. Transcript outcome
          // alone cannot confirm our policy/context path; pause, preserve the actual host log.
          if (running.preSteps !== 1 || events.some(e => !running.eventSeqs.has(e.seq))
            || events.some(e => e.type === 'tool/call' && (!running.toolGates.has(e.data.callId!) || !running.toolResults.has(e.data.callId!)))) {
            unexpected(session, composition, 'hook-coverage');
          }
          observability.push(...events.map(e => identity(composition, 'dsh-event', [session.agent.id, e.seq])));
        } else {
          nativeId = identity(composition, 'dsh-tool', [session.agent.id, effect.effectId]);
          const result = await ctx.tools.execute({ agent: session.agent, callId: nativeId, name: effect.payload.toolName!,
            arguments: args, signal: new AbortController().signal });
          status = result.isError ? 'failed' : 'completed';
          if (!running.toolGates.has(nativeId) || !running.toolResults.has(nativeId)) unexpected(session, composition, 'tool-hook-coverage');
          observability.push(nativeId);
        }
        if (session.fault !== null || session.disposed) status = 'unknown';
        const result = receipt(session, composition, effect, status, nativeId, observability, session.fault);
        session.receipts.set(effect.effectId, result);
        return ok(result);
      } catch {
        const error = unexpected(session, composition, 'native-execute');
        const result = receipt(session, composition, effect, 'unknown', null, [], error);
        session.receipts.set(effect.effectId, result);
        return ok(result);
      } finally { session.running = null; session.contextText = []; }
    },
    async usage(request) {
      const session = getSession();
      const rows = session.usages.get(request.effectId) ?? [];
      const selected = request.requestIds.length === 0 ? rows : rows.filter(r => request.requestIds.includes(r.requestId));
      return ok({ effectId: request.effectId, usage: selected, complete: usageIsComplete(selected)
        && request.requestIds.every(id => selected.some(r => r.requestId === id)) });
    },
    async cancel(request) {
      const admitted = sessionFor(request.sessionId);
      if (!admitted.ok) return admitted;
      const session = admitted.value;
      // Tool and delegated-child stop guarantees remain unknown. Only this binding's active
      // loop is cancellable; an arbitrary id must never cancel the user's ordinary work.
      const active = session.running;
      const matches = active !== null && active.effect.kind === 'host.agent' && request.targetIds.includes(active.effect.effectId);
      if (matches) { session.agent.cancel({ kind: 'user' }, { keepInbox: true }); await session.agent.whenIdle(); }
      const aborted = matches && session.agent.session.snapshotEvents().slice(active.fromSeq)
        .some(e => e.type === 'turn/end' && e.data.reason?.kind === 'aborted');
      const targets = request.targetIds.map(targetId => ({ targetId,
        confirmation: aborted && targetId === active!.effect.effectId ? 'native-ack' as const : 'unconfirmed' as const,
        observability: aborted && targetId === active!.effect.effectId ? ['native-aborted-turn-and-idle'] : [] }));
      const confirmed = targets.length > 0 && targets.every(t => t.confirmation === 'native-ack');
      return ok({ status: confirmed ? 'cancelled' : 'unknown', targets,
        error: confirmed ? null : fail('EFK_CANCEL_UNCONFIRMED', 'native cancellation targets are unconfirmed', request.targetIds) });
    },
    async reconcile(request) {
      const session = getSession();
      if (request.sessionId !== session.request.sessionId) return err(fail('EFK_HOST_SESSION_MISMATCH', 'reconcile names another session'));
      const outcomes: ReconcileOutcome[] = request.targetIds.map(effectId => {
        const known = session.receipts.get(effectId);
        return known !== undefined && known.status !== 'unknown'
          ? { effectId, verdict: 'resolved', receipt: known, error: null }
          : { effectId, verdict: 'unknown', receipt: null, error: fail('EFK_EFFECT_UNKNOWN', 'no confirmed native receipt; do not replay', [effectId]) };
      });
      return ok(outcomes);
    },
  };
  return host;
}
