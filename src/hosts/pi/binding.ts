import { fail, type ErrorEnvelope } from '../../protocol/index.js';
import { err, ok, stableStringify, judgeRequirements, requiredCapabilities,
  capabilityGapError, usageIsComplete, type AuthorizedEffect, type ContextPlan, type HostResult,
  type Receipt, type Usage, type HostPort } from '../../runtime/host-port/index.js';
import { appendPiRecord, readPiRecords, type PiRecord } from './entries.js';
import { addPiUsage, mapPiUsage, invocationUsage } from './usage.js';
import type { PiBinding, PiEvents, PiEventResults, PiExtensionAPI, PiOptions } from './types.js';
import { PI_SESSION_CAPABILITIES } from './capabilities.js';

export const PI_VERSION = '0.99.2';
interface Run {
  readonly authorized: AuthorizedEffect; readonly invocation: string;
  readonly requests: string[]; rows: readonly Usage[]; currentRequest: string | null;
  started: boolean; ended: boolean; settled: boolean; stopReason: string | null; interrupted: boolean;
}
/** Native persistent session only. This adapter owns hooks, never host resources/lifetime. */
export function bindPiSession(api: PiExtensionAPI, options: PiOptions): HostResult<PiBinding> {
  if (options.version !== PI_VERSION) return err(fail('EFK_SOURCE_PIN_DRIFT', `Pi ${options.version} is not pinned ${PI_VERSION}`));
  let attached = false, idle = false, unloaded = false, fault: ErrorEnvelope | null = null;
  let active: Run | null = null;
  let packet: readonly unknown[] = [];
  const effects = new Map<string, PiRecord>();
  const byKey = new Map<string, string>();
  const pending = new Map<string, Promise<HostResult<Receipt>>>();
  const unsubs: (() => void)[] = [];
  const sessionMatches = () => options.session().sessionManager.getSessionId() === options.hostSessionId;
  const isIdle = () => attached && fault === null && idle && active === null && sessionMatches() && options.session().isIdle;
  function poison(error: ErrorEnvelope): void {
    fault = error; idle = false;
    options.fault(error);
  }
  function sessionGate(id: string): HostResult<void> {
    if (id !== options.kernelSessionId || !attached || !sessionMatches()) {
      return err(fail('EFK_HOST_SESSION_MISMATCH', 'Pi binding is detached or belongs to a different session', [id]));
    }
    if (fault !== null) return err(fault);
    return ok(undefined);
  }
  function record(kind: PiRecord['kind'], authorized: AuthorizedEffect | null, receipt: Receipt | null): void {
    const entry: PiRecord = { version: 1, kernelSessionId: options.kernelSessionId,
      hostSessionId: options.hostSessionId, kind, effect: authorized?.effect ?? null, receipt,
      requestUsage: active?.rows ?? [], requestIds: [...(active?.requests ?? [])] };
    appendPiRecord(api, entry);
    if (entry.effect !== null) {
      effects.set(entry.effect.effectId, entry);
      byKey.set(entry.effect.idempotencyKey, entry.effect.effectId);
    }
  }
  function stop(): void {
    attached = false; idle = false; packet = [];
    if (active !== null) active.interrupted = true;
  }
  function on<K extends keyof PiEvents>(name: K,
    handler: (event: PiEvents[K]) => PiEventResults[K] | Promise<PiEventResults[K]>): void {
    unsubs.push(api.on(name, async (event, ctx) => {
      if (unloaded) return;
      if (ctx.sessionManager.getSessionId() !== options.hostSessionId) { stop(); return; }
      try { return await handler(event); }
      catch {
        // Pi itself catches hook failures and continues. Latch kernel failure, preserve ordinary host work.
        poison(fail('EFK_HOST_EXECUTION_FAILED', `Pi ${name} hook failed; kernel progress stopped`));
        if (name === 'tool_call') return { block: true, reason: 'EvoFence hook failed' } as PiEventResults[K];
        return;
      }
    }));
  }
  on('session_start', () => {
    const manager = options.session().sessionManager;
    if (!sessionMatches() || manager.getSessionFile() === undefined) {
      poison(fail('EFK_HOST_SESSION_MISMATCH', 'Pi requires the existing disk-backed session')); return;
    }
    const restored = readPiRecords(manager, options.kernelSessionId, options.hostSessionId);
    if (!restored.ok) { poison(restored.error); return; }
    for (const r of restored.value) {
      if (r.effect === null) continue;
      const prior = effects.get(r.effect.effectId);
      const owner = byKey.get(r.effect.idempotencyKey);
      if ((prior !== undefined && stableStringify(prior.effect) !== stableStringify(r.effect))
        || (owner !== undefined && owner !== r.effect.effectId)) {
        poison(fail('EFK_IDEMPOTENCY_COLLISION', 'restored Pi dispatch has conflicting identity')); return;
      }
      if (prior?.receipt !== null && prior?.receipt !== undefined && r.receipt !== null
        && stableStringify(prior.receipt) !== stableStringify(r.receipt)) {
        poison(fail('EFK_USAGE_CONFLICT', 'restored Pi receipts conflict')); return;
      }
      effects.set(r.effect.effectId, r); byKey.set(r.effect.idempotencyKey, r.effect.effectId);
    }
    attached = true; idle = options.session().isIdle;
    if (!restored.value.some(r => r.kind === 'binding')) record('binding', null, null);
  });
  on('session_shutdown', stop);
  on('agent_start', () => { idle = false; });
  on('context', event => {
    if (!attached || fault !== null || active === null || !active.started) return;
    return { messages: [...event.messages, ...packet] };
  });
  on('before_provider_request', () => {
    if (active === null || !active.started) return;
    const id = `${active.invocation}:request:${active.requests.length + 1}`;
    active.requests.push(id); active.currentRequest = id;
  });
  on('message_end', event => {
    if (active === null || !active.started || event.message.role !== 'assistant') return;
    active.stopReason = event.message.stopReason ?? null;
    if (active.currentRequest === null) return; // no request telemetry: final completeness stays false
    const mapped = mapPiUsage(active.currentRequest, event.message, options.usageEvidence?.(active.currentRequest, event.message));
    if (!mapped.ok) { poison(mapped.error); return; }
    const deduped = addPiUsage(active.rows, mapped.value);
    if (!deduped.ok) { poison(deduped.error); return; }
    active.rows = deduped.value;
  });
  on('tool_call', async event => {
    if (active === null || !active.started) return; // ordinary user tools are host-owned
    if (!attached || fault !== null) return { block: true, reason: 'EvoFence binding cannot authorize this call' };
    const allowed = await options.toolGate(active.authorized, event);
    if (!allowed.ok) return { block: true, reason: allowed.error.message };
  });
  on('tool_result', async event => { if (active !== null && active.started && attached && fault === null) await options.toolResult(active.authorized, event); });
  on('agent_end', async () => {
    if (active !== null && active.started) { await options.agentEnd?.(active.authorized); active.ended = true; }
    // An awaited end is still before retry/compaction/queued continuations.
  });
  on('agent_settled', () => { idle = true; if (active !== null && active.started) active.settled = true; });

  async function context(request: Parameters<HostPort['context']>[0]): ReturnType<HostPort['context']> {
    const gate = sessionGate(request.sessionId);
    if (!gate.ok) return gate;
    if (request.plan.isolation !== 'current') return err(fail('EFK_CAPABILITY_UNSUPPORTED', 'fresh context requires a separately authorized SDK child lane'));
    const resolved = await options.context(request.plan);
    if (!resolved.ok) return resolved;
    const current = sessionGate(request.sessionId); // asynchronous resolver may span unload/session replacement
    if (!current.ok) return current;
    packet = resolved.value;
    return ok({ isolation: request.plan.isolation, preservedHostResources: true, injectedRefs: request.plan.inputRefs });
  }
  function makeReceipt(run: Run, status: Receipt['status'], error: ErrorEnvelope | null): Receipt {
    const effect = run.authorized.effect;
    return { protocol: effect.protocol, receiptId: `${run.invocation}:receipt`, effectId: effect.effectId,
      hostInvocationId: run.invocation, binding: effect.binding, status, artifactRefs: [],
      usage: [invocationUsage(effect.reservationRef!, run.rows, run.requests)],
      observability: [`pi:${options.hostSessionId}:${status}`], error };
  }
  async function invoke(run: Run): Promise<HostResult<Receipt>> {
    const effect = run.authorized.effect;
    try {
      const plan = effect.payload.context as ContextPlan | null;
      if (plan !== null) {
        const injected = await context({ sessionId: effect.binding.sessionId, plan });
        if (!injected.ok) return injected;
      }
      const prompt = await options.prompt(run.authorized);
      const gate = sessionGate(effect.binding.sessionId);
      if (!gate.ok) return gate;
      if (run.interrupted) {
        const receipt = { ...makeReceipt(run, 'not-executed', null), hostInvocationId: null, usage: [] };
        record('receipt', run.authorized, receipt); return ok(receipt);
      }
      if (!idle || !options.session().isIdle) return err(fail('EFK_HOST_REVISION_CONFLICT', 'Pi became busy while preparing context/prompt'));
      if (effect.deadline <= options.clock.now()) return err(fail('EFK_LEASE_STALE', 'Pi effect expired during prompt preparation'));
      record('dispatch', run.authorized, null); // restart can only reconcile this, never rerun it
      run.started = true;
      await options.session().prompt(prompt);
      await options.session().waitForIdle();
      const complete = run.requests.length > 0 && run.rows.length === run.requests.length && usageIsComplete(run.rows);
      const error = fault ?? (run.interrupted || !attached || !sessionMatches() || !run.ended || !run.settled
        ? fail('EFK_EFFECT_UNKNOWN', 'Pi invocation lost its binding or final settlement', [effect.effectId])
        : !complete ? fail('EFK_USAGE_INCOMPLETE', 'Pi invocation lacks complete usage; retain its reservation', [effect.effectId]) : null);
      const status = error !== null ? 'unknown' : run.stopReason === 'aborted' ? 'cancelled'
        : run.stopReason === 'error' ? 'failed' : run.stopReason === 'stop' ? 'completed' : 'unknown';
      const receipt = makeReceipt(run, status, error ?? (status === 'unknown' ? fail('EFK_EFFECT_UNKNOWN', 'Pi has no terminal assistant outcome') : null));
      if (attached && sessionMatches()) record('receipt', run.authorized, receipt);
      else effects.set(effect.effectId, { version: 1, kernelSessionId: options.kernelSessionId,
        hostSessionId: options.hostSessionId, kind: 'receipt', effect, receipt, requestUsage: run.rows, requestIds: [...run.requests] });
      return ok(receipt);
    } catch {
      poison(fail('EFK_EFFECT_UNKNOWN', 'Pi invocation/entry write failed; reconcile before retry', [effect.effectId]));
      const receipt = makeReceipt(run, 'unknown', fault);
      effects.set(effect.effectId, { version: 1, kernelSessionId: options.kernelSessionId,
        hostSessionId: options.hostSessionId, kind: 'receipt', effect, receipt, requestUsage: run.rows, requestIds: [...run.requests] });
      return ok(receipt);
    } finally { active = null; packet = []; }
  }
  async function execute(authorized: AuthorizedEffect): Promise<HostResult<Receipt>> {
    const { effect } = authorized;
    const gate = sessionGate(effect.binding.sessionId);
    if (!gate.ok) return gate;
    if (effect.binding.hostSessionId !== null && effect.binding.hostSessionId !== options.hostSessionId) {
      return err(fail('EFK_HOST_SESSION_MISMATCH', 'effect names another native Pi session'));
    }
    const owner = byKey.get(effect.idempotencyKey);
    const prior = effects.get(effect.effectId);
    if ((owner !== undefined && owner !== effect.effectId) || (prior !== undefined && stableStringify(prior.effect) !== stableStringify(effect))) {
      return err(fail('EFK_IDEMPOTENCY_COLLISION', 'Pi effect identity was reused with different bytes'));
    }
    if (pending.has(effect.effectId)) return pending.get(effect.effectId)!;
    if (prior !== undefined) {
      if (prior.receipt !== null && prior.receipt.status !== 'unknown') return ok(prior.receipt);
      return err(fail('EFK_EFFECT_NON_IDEMPOTENT_RETRY', 'Pi dispatch outcome is unknown; do not prompt again'));
    }
    const gaps = judgeRequirements(PI_SESSION_CAPABILITIES, requiredCapabilities(effect, authorized.demands ?? []));
    if (gaps.length > 0) return err(capabilityGapError(gaps, 'pi'));
    if (effect.kind !== 'host.agent') return err(fail('EFK_CAPABILITY_UNSUPPORTED', `${effect.kind} belongs to a separate host operation binding`));
    if (!isIdle()) return err(fail('EFK_HOST_REVISION_CONFLICT', 'Pi session is busy; dispatch only at an external safe point'));
    if (effect.deadline <= options.clock.now()) return err(fail('EFK_LEASE_STALE', 'Pi effect deadline expired before prompt'));
    const run: Run = { authorized, invocation: `pi:${options.hostSessionId}:${effect.effectId}`,
      requests: [], rows: [], currentRequest: null, started: false, ended: false, settled: false, stopReason: null, interrupted: false };
    active = run;
    const work = invoke(run); pending.set(effect.effectId, work);
    try { return await work; } finally { pending.delete(effect.effectId); }
  }
  const host: HostPort = {
    execute, context,
    async observe(id) {
      const gate = sessionGate(id); if (!gate.ok) return gate;
      const guarantee = (status: 'partial' | 'verified', coverage: string[]) => ({ status, coverage, evidenceRefs: [] });
      return ok({ host: 'pi', idle: isIdle(), capabilities: PI_SESSION_CAPABILITIES,
        cancellation: guarantee('partial', ['native-session-abort; provider billing unknown']),
        recovery: guarantee('partial', ['transcript/custom-entry readback; not kernel journal']),
        isolation: guarantee('partial', ['same-user current-session packet']), boardOwners: [] });
    },
    async cancel(request) {
      const gate = sessionGate(request.sessionId); if (!gate.ok) return gate;
      const run = active;
      const owned = run !== null && request.targetIds.includes(run.authorized.effect.effectId);
      const preparedOnly = owned && !run.started;
      if (preparedOnly) run.interrupted = true;
      let ack = false;
      if (owned && !preparedOnly) {
        try { await options.session().abort(); ack = attached && sessionMatches() && run.settled && options.session().isIdle; }
        catch { poison(fail('EFK_CANCEL_UNCONFIRMED', 'Pi abort failed; keep target unknown')); }
      }
      const targets = request.targetIds.map(targetId => ({ targetId,
        confirmation: owned && targetId === run!.authorized.effect.effectId
          ? preparedOnly ? 'not-executed' as const : ack ? 'native-ack' as const : 'unconfirmed' as const : 'unconfirmed' as const,
        observability: owned && targetId === run!.authorized.effect.effectId
          ? preparedOnly ? ['pi:cancelled-before-dispatch'] : ack ? [`pi:${options.hostSessionId}:abort-idle-ack`] : [] : [] }));
      const confirmed = targets.every(t => t.confirmation !== 'unconfirmed');
      return ok({ status: confirmed ? 'cancelled' : 'unknown', targets,
        error: confirmed ? null : fail('EFK_CANCEL_UNCONFIRMED', 'Pi did not confirm every target; unrelated host work retained', request.targetIds) });
    },
    async reconcile(request) {
      const gate = sessionGate(request.sessionId); if (!gate.ok) return gate;
      return ok(request.targetIds.map(effectId => {
        const receipt = effects.get(effectId)?.receipt ?? null;
        if (receipt?.status === 'not-executed') return { effectId, verdict: 'not-executed' as const, receipt: null, error: null };
        return receipt !== null && receipt.status !== 'unknown'
          ? { effectId, verdict: 'resolved' as const, receipt, error: null }
          : { effectId, verdict: 'unknown' as const, receipt, error: fail('EFK_EFFECT_UNKNOWN', 'no actual Pi terminal receipt; no redispatch', [effectId]) };
      }));
    },
    async usage(request) {
      const current = active?.authorized.effect.effectId === request.effectId ? active : null;
      const record = effects.get(request.effectId);
      const rows = current !== null ? current.rows : record?.requestUsage ?? [];
      const expected = request.requestIds.length > 0 ? request.requestIds : current?.requests ?? record?.requestIds ?? [];
      const selected = request.requestIds.length === 0 ? rows : rows.filter(r => request.requestIds.includes(r.requestId));
      return ok({ effectId: request.effectId, usage: selected, complete: usageIsComplete(selected)
        && expected.length > 0 && expected.every(id => selected.some(r => r.requestId === id)) });
    },
  };
  return ok({ host, unload() { stop(); unloaded = true; for (const off of unsubs) off(); },
    state: () => ({ attached, idle: isIdle(), fault, activeEffectId: active?.authorized.effect.effectId ?? null }),
    receipt: id => effects.get(id)?.receipt ?? null });
}
