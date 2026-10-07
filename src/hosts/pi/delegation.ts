import { fail, type ErrorEnvelope } from '../../protocol/index.js';
import { err, ok, stableStringify, requiredCapabilities, judgeRequirements, capabilityGapError,
  type AuthorizedEffect, type HostPort, type HostResult, type Receipt, type CancelOutcome } from '../../runtime/host-port/index.js';
import { PI_VERSION } from './binding.js';
import { PI_SESSION_CAPABILITIES } from './capabilities.js';
import { invocationUsage } from './usage.js';
import { checkPiChildPlan, PI_DELEGATION_ENTRY, readPiDelegations } from './delegation-records.js';
import type { PiChildExecutor, PiChildSpec, PiDelegationBinding, PiDelegationOptions, PiDelegationRecord } from './delegation-types.js';
import type { PiExtensionAPI } from './types.js';

interface ChildRun {
  record: PiDelegationRecord; child: PiChildExecutor | null;
  interrupted: boolean; dispatched: boolean;
}
/** Host-side executor, not a board owner. Inject this HostPort at the parent's kernel safe point. */
export function bindPiDelegation(options: PiDelegationOptions): HostResult<PiDelegationBinding> {
  if (options.version !== PI_VERSION) return err(fail('EFK_SOURCE_PIN_DRIFT', 'delegation requires the approved Pi 0.99.2'));
  if (options.manager.getSessionId() !== options.parentSessionId || options.manager.getSessionFile() === undefined) {
    return err(fail('EFK_HOST_SESSION_MISMATCH', 'delegation requires the existing persistent parent'));
  }
  const restored = readPiDelegations(options);
  if (!restored.ok) return restored;
  let open = true;
  const records = new Map<string, PiDelegationRecord>(), identities = new Map<string, AuthorizedEffect>();
  const keys = new Map<string, string>(), runs = new Map<string, ChildRun>();
  const pending = new Map<string, Promise<HostResult<Receipt>>>();
  const capabilities = { ...PI_SESSION_CAPABILITIES,
    // Audit G04: this used to claim `verified` with no evidence while `capabilities.ts` said
    // `unknown` for the same key. Neither has evidence, and the limitation is "same-user, no board",
    // so the delegation path reports a bounded `partial` with its verified and unverified subsets.
    sdkChildSessionIsolation: { status: 'partial' as const,
      verifiedSubset: ['explicit SDK factory selected by the caller'],
      unverified: ['cross-session isolation (same user, no OS boundary)', 'board/ownership boundary'],
      limitation: 'explicit SDK factory; same-user, no board' },
    parentChildCancellation: { status: 'partial' as const, verifiedSubset: ['owned-child abort/idle; parent shutdown'],
      unverified: ['provider cancel billing', 'process-kill acknowledgement'] } };
  for (const r of restored.value) {
    const id = r.authorized.effect.effectId, prior = records.get(id), owner = keys.get(r.authorized.effect.idempotencyKey);
    if ((prior !== undefined && (stableStringify(prior.authorized) !== stableStringify(r.authorized)
      || stableStringify(prior.plan) !== stableStringify(r.plan) || (prior.childSessionId !== null && prior.childSessionId !== r.childSessionId)))
      || (owner !== undefined && owner !== id)) return err(fail('EFK_IDEMPOTENCY_COLLISION', 'restored delegation identity changed'));
    if (prior?.receipt !== null && prior?.receipt !== undefined && prior.receipt.status !== 'unknown'
      && stableStringify(prior.receipt) !== stableStringify(r.receipt)) return err(fail('EFK_USAGE_CONFLICT', 'restored terminal receipt changed'));
    records.set(id, r); identities.set(id, r.authorized); keys.set(r.authorized.effect.idempotencyKey, id);
  }
  function save(r: PiDelegationRecord): void {
    records.set(r.authorized.effect.effectId, r);
    options.append(PI_DELEGATION_ENTRY, r);
  }
  function spec(r: PiDelegationRecord): PiChildSpec {
    return { parentSessionId: options.parentSessionId, kernelSessionId: options.kernelSessionId,
      invocationId: `pi-delegate:${options.parentSessionId}:${r.authorized.effect.effectId}`, model: options.model,
      deadline: Math.min(r.authorized.effect.deadline, r.childGrant.expiresAt),
      graphRef: r.authorized.effect.payload.graphRef!, context: r.authorized.effect.payload.context,
      grant: r.childGrant, capabilities: r.plan.capabilities, requests: {
        poolId: options.requests.poolId,
        beforeRequest(id, owner, policy, bounds) {
          if (owner !== `pi-delegate:${options.parentSessionId}:${r.authorized.effect.effectId}`
            || stableStringify(policy) !== stableStringify(r.childGrant.budget)) {
            return err(fail('EFK_BUDGET_NOT_AUTHORIZED', 'child transport attempted to replace its inherited budget owner'));
          }
          return options.requests.beforeRequest(id, owner, policy, bounds);
        },
        record(row) {
          const owned = options.requests.report(`pi-delegate:${options.parentSessionId}:${r.authorized.effect.effectId}`);
          return owned.requestIds.includes(row.requestId) ? options.requests.record(row)
            : err(fail('EFK_BUDGET_NOT_AUTHORIZED', 'child cannot settle another invocation request', [row.requestId]));
        },
      } };
  }
  function receipt(r: PiDelegationRecord, status: Receipt['status'], error: ErrorEnvelope | null): Receipt {
    const effect = r.authorized.effect, s = spec(r), report = options.requests.report(s.invocationId);
    return { protocol: effect.protocol, receiptId: status === 'unknown'
      ? `${s.invocationId}:observation:${options.manager.getEntries().length}` : `${s.invocationId}:receipt`, effectId: effect.effectId,
      hostInvocationId: status === 'not-executed' ? null : s.invocationId, binding: effect.binding,
      status, artifactRefs: [], usage: status === 'not-executed' ? [] : [invocationUsage(effect.reservationRef!, report.usage, report.requestIds)],
      observability: [`pi:parent:${options.parentSessionId}`, `pi:child:${r.childSessionId}`, `pi:delegation:${status}`], error };
  }
  function finish(r: PiDelegationRecord, result: Receipt): Receipt {
    save({ ...r, phase: 'receipt', receipt: result }); return result;
  }
  function sessionGate(id: string): HostResult<void> {
    return id === options.kernelSessionId && options.manager.getSessionId() === options.parentSessionId
      ? ok(undefined) : err(fail('EFK_HOST_SESSION_MISMATCH', 'delegation belongs to another parent/kernel session'));
  }
  async function invoke(authorized: AuthorizedEffect): Promise<HostResult<Receipt>> {
    const { effect } = authorized;
    let run: ChildRun | null = null;
    try {
      const planned = await options.plan(authorized);
      if (!planned.ok) return planned;
      const grant = checkPiChildPlan(options, authorized, planned.value);
      if (!grant.ok) return grant;
      const r: PiDelegationRecord = { version: 1, parentSessionId: options.parentSessionId,
        kernelSessionId: options.kernelSessionId, authorized, plan: planned.value, childGrant: grant.value,
        childSessionId: null, phase: 'prepared', receipt: null };
      run = { record: r, child: null, interrupted: !open, dispatched: false }; runs.set(effect.effectId, run);
      save(r);
      if (run.interrupted) return ok(finish(r, receipt(r, 'not-executed', null)));
      const made = await options.create(spec(r));
      if (!made.ok) return ok(finish(r, receipt(r, 'unknown', made.error)));
      if (made.value.sessionId === options.parentSessionId || [...runs.values()].some(other => other !== run && other.child?.sessionId === made.value.sessionId)) {
        return ok(finish(r, receipt(r, 'unknown', fail('EFK_HOST_SESSION_MISMATCH', 'SDK child reused an owned/parent identity'))));
      }
      run.child = made.value;
      run.record = { ...r, childSessionId: made.value.sessionId, phase: 'created' }; save(run.record);
      // Async creation can span parent exit, expiry, or a session switch. This is a dispatch gate.
      const live = checkPiChildPlan(options, authorized, planned.value);
      if (run.interrupted || !open || !live.ok || !sessionGate(effect.binding.sessionId).ok || effect.deadline <= options.clock.now()) {
        return ok(finish(run.record, receipt(run.record, 'not-executed', null)));
      }
      run.record = { ...run.record, phase: 'dispatched' }; save(run.record); run.dispatched = true;
      const results: Receipt[] = [];
      for (const childEffect of run.record.plan.effects) {
        if (run.interrupted || !open) break;
        if (childEffect.deadline <= options.clock.now() || run.record.childGrant.expiresAt <= options.clock.now()) {
          return ok(finish(run.record, receipt(run.record, 'unknown', fail('EFK_LEASE_STALE', 'child grant/deadline expired between graph operations'))));
        }
        const result = await run.child.host.execute({ effect: childEffect, grant: run.record.childGrant, demands: authorized.demands });
        if (!result.ok) return ok(finish(run.record, receipt(run.record, 'unknown', result.error)));
        if (result.value.effectId !== childEffect.effectId || stableStringify(result.value.binding) !== stableStringify(childEffect.binding)) {
          return ok(finish(run.record, receipt(run.record, 'unknown', fail('EFK_ARTIFACT_BINDING_MISMATCH', 'native child receipt answers another graph operation'))));
        }
        results.push(result.value);
        if (result.value.status !== 'completed') break;
      }
      return ok(finish(run.record, aggregate(run.record, results, run.interrupted)));
    } catch {
      // Native factory/transport/entry failure has an uncertain effect; never retry or erase spend.
      if (run === null) return err(fail('EFK_EFFECT_UNKNOWN', 'delegation preparation failed; kernel outbox must reconcile'));
      const result = receipt(run.record, 'unknown', fail('EFK_EFFECT_UNKNOWN', 'child execution/persistence failed; reconcile before retry'));
      records.set(effect.effectId, { ...run.record, phase: 'receipt', receipt: result });
      return ok(result);
    } finally {
      run?.child?.dispose(); runs.delete(effect.effectId);
    }
  }
  function aggregate(r: PiDelegationRecord, results: readonly Receipt[], interrupted: boolean): Receipt {
    const usage = receipt(r, 'unknown', null).usage[0];
    const error = interrupted ? fail('EFK_EFFECT_UNKNOWN', 'parent lifetime interrupted child; reconcile actual native outcome')
      : results.length !== r.plan.effects.length || results.some(row => row.status === 'unknown')
        ? fail('EFK_EFFECT_UNKNOWN', 'child graph lacks every terminal native receipt')
        : !usage.complete ? fail('EFK_USAGE_INCOMPLETE', 'child usage missing; retain parent/child reservations') : null;
    const status = error !== null ? 'unknown' : results.some(row => row.status === 'cancelled') ? 'cancelled'
      : results.some(row => row.status === 'failed') ? 'failed' : 'completed';
    return { ...receipt(r, status, error), artifactRefs: results.flatMap(row => row.artifactRefs) };
  }
  async function execute(authorized: AuthorizedEffect): Promise<HostResult<Receipt>> {
    const effect = authorized.effect;
    if (effect.kind === 'host.cancel') {
      const stopped = await cancel({ sessionId: effect.binding.sessionId, targetIds: effect.payload.targetIds });
      if (!stopped.ok) return stopped;
      return ok({ protocol: effect.protocol, receiptId: `pi-delegate:cancel:${effect.effectId}`, effectId: effect.effectId,
        hostInvocationId: null, binding: effect.binding, status: stopped.value.status, artifactRefs: [], usage: [],
        observability: stopped.value.targets.flatMap(t => t.observability), error: stopped.value.error });
    }
    if (effect.kind !== 'host.delegate') return options.parent.execute(authorized);
    const gate = sessionGate(effect.binding.sessionId); if (!gate.ok) return gate;
    if (effect.binding.hostSessionId !== null && effect.binding.hostSessionId !== options.parentSessionId) {
      return err(fail('EFK_HOST_SESSION_MISMATCH', 'delegate names a different native parent'));
    }
    const prior = identities.get(effect.effectId), owner = keys.get(effect.idempotencyKey);
    if ((prior !== undefined && stableStringify(prior) !== stableStringify(authorized)) || (owner !== undefined && owner !== effect.effectId)) {
      return err(fail('EFK_IDEMPOTENCY_COLLISION', 'delegation identity reused with different authority/bytes'));
    }
    if (pending.has(effect.effectId)) return pending.get(effect.effectId)!;
    const recorded = records.get(effect.effectId);
    if (recorded !== undefined) return recorded.receipt !== null && recorded.receipt.status !== 'unknown'
      ? ok(recorded.receipt) : err(fail('EFK_EFFECT_NON_IDEMPOTENT_RETRY', 'recorded child must reconcile; never replay'));
    if (!open) return err(fail('EFK_HOST_SESSION_MISMATCH', 'parent delegation lifetime closed'));
    const gaps = judgeRequirements(capabilities, requiredCapabilities(effect, authorized.demands));
    if (gaps.length > 0) return err(capabilityGapError(gaps, 'pi-delegation'));
    if (effect.payload.graphRef === null || effect.payload.context === null || effect.reservationRef === null) {
      return err(fail('EFK_SCHEMA_INVALID', 'delegate requires graphRef, context and parent reservation'));
    }
    if (effect.deadline <= options.clock.now()) return err(fail('EFK_LEASE_STALE', 'delegation deadline expired'));
    if (pending.size >= authorized.grant.maxConcurrency) return err(fail('EFK_BUDGET_EXHAUSTED', 'parent child concurrency exhausted'));
    identities.set(effect.effectId, authorized); keys.set(effect.idempotencyKey, effect.effectId);
    const work = invoke(authorized); pending.set(effect.effectId, work);
    try { return await work; } finally { pending.delete(effect.effectId); }
  }
  async function cancel(request: Parameters<HostPort['cancel']>[0]): Promise<HostResult<CancelOutcome>> {
    const gate = sessionGate(request.sessionId); if (!gate.ok) return gate;
    const targets: CancelOutcome['targets'][number][] = [];
    for (const targetId of request.targetIds) {
      const run = [...runs.values()].find(r => r.record.authorized.effect.effectId === targetId
        || r.child?.sessionId === targetId || r.record.plan.effects.some(e => e.effectId === targetId));
      if (run === undefined) {
        const parent = await options.parent.cancel({ ...request, targetIds: [targetId] });
        if (!parent.ok) return parent;
        targets.push(...parent.value.targets); continue;
      }
      run.interrupted = true;
      if (!run.dispatched) { targets.push({ targetId, confirmation: 'not-executed', observability: ['pi:child-not-dispatched'] }); continue; }
      try {
        const stopped = await run.child!.host.cancel({ sessionId: options.kernelSessionId, targetIds: run.record.plan.effects.map(e => e.effectId) });
        const ack = stopped.ok && stopped.value.status === 'cancelled';
        targets.push({ targetId, confirmation: ack ? 'native-ack' : 'unconfirmed', observability: ack ? ['pi:owned-child-abort-idle'] : [] });
      } catch { targets.push({ targetId, confirmation: 'unconfirmed', observability: ['pi:child-abort-exception'] }); }
    }
    const confirmed = targets.every(t => t.confirmation !== 'unconfirmed');
    return ok({ status: confirmed ? 'cancelled' : 'unknown', targets,
      error: confirmed ? null : fail('EFK_CANCEL_UNCONFIRMED', 'not every named child/parent target acknowledged cancellation') });
  }
  const host: HostPort = {
    execute, cancel, context: request => options.parent.context(request),
    async observe(id) {
      const observed = await options.parent.observe(id);
      return observed.ok ? ok({ ...observed.value, idle: observed.value.idle && pending.size === 0 && open, capabilities }) : observed;
    },
    async usage(request) {
      const r = records.get(request.effectId);
      if (r === undefined) return options.parent.usage(request);
      const report = options.requests.report(spec(r).invocationId);
      const ids = request.requestIds.length === 0 ? report.requestIds : request.requestIds;
      const rows = report.usage.filter(row => ids.includes(row.requestId));
      return ok({ effectId: request.effectId, usage: rows,
        complete: ids.length > 0 && ids.every(id => rows.some(row => row.requestId === id && row.complete)) });
    },
    async reconcile(request) {
      const gate = sessionGate(request.sessionId); if (!gate.ok) return gate;
      const outcomes = [];
      for (const effectId of request.targetIds) {
        let r = records.get(effectId);
        if (r === undefined) {
          const parent = await options.parent.reconcile({ ...request, targetIds: [effectId] });
          if (!parent.ok) return parent; outcomes.push(...parent.value); continue;
        }
        if ((r.receipt === null || r.receipt.status === 'unknown') && !pending.has(effectId) && r.childSessionId !== null) {
          const reopened = await options.restore(spec(r), r.childSessionId);
          if (!reopened.ok) return reopened;
          try {
            if (reopened.value.sessionId !== r.childSessionId) return err(fail('EFK_HOST_SESSION_MISMATCH', 'restore opened another child'));
            const read = await reopened.value.host.reconcile({ sessionId: options.kernelSessionId, targetIds: r.plan.effects.map(e => e.effectId) });
            if (!read.ok) return read;
            if (read.value.every(o => o.verdict === 'resolved' && o.receipt !== null)) {
              const result = aggregate(r, read.value.map(o => o.receipt!), false);
              finish(r, result); r = records.get(effectId)!;
            }
          } finally { reopened.value.dispose(); }
        }
        const result = r.receipt;
        outcomes.push({ effectId, verdict: result?.status === 'not-executed' ? 'not-executed' as const
          : result !== null && result.status !== 'unknown' ? 'resolved' as const : 'unknown' as const,
          receipt: result, error: result === null || result.status === 'unknown' ? fail('EFK_EFFECT_UNKNOWN', 'no actual child outcome; no replay') : null });
      }
      return ok(outcomes);
    },
  };
  return ok({ host, receipt: id => records.get(id)?.receipt ?? null,
    async close(reason) {
      open = false;
      const stopped = await cancel({ sessionId: options.kernelSessionId, targetIds: [...runs.keys()] });
      await Promise.all(pending.values());
      return stopped.ok && stopped.value.status === 'cancelled' ? ok(undefined)
        : err(fail('EFK_CANCEL_UNCONFIRMED', `parent ${reason}: child stop not confirmed`));
    } });
}

/** Register only the parent lifecycle seam. The owner awaits close on unload/exception as well. */
export function attachPiDelegation(api: PiExtensionAPI, options: PiDelegationOptions): HostResult<PiDelegationBinding> {
  const bound = bindPiDelegation(options);
  if (!bound.ok) return bound;
  const off = api.on('session_shutdown', async (_event, context) => {
    if (context.sessionManager.getSessionId() !== options.parentSessionId) return;
    const closed = await bound.value.close('shutdown');
    if (!closed.ok) throw new Error(closed.error.message);
  });
  return ok({ ...bound.value, async close(reason) { off(); return bound.value.close(reason); } });
}
