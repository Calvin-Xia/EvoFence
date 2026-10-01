/**
 * The fake host — a deterministic `HostPort` whose capability matrix and guarantees are the real
 * probe matrices from `capabilities.ts`.
 *
 * It is a **test double, not a default backend**: nothing here is constructed at import time and
 * there is no module-level instance, so `createFakeHost` is the only way to get one (I05/I08).
 * The scripted outcomes live in `HostScript` and are keyed by real effect ids, so a test states
 * the fault it is injecting instead of relying on timing.
 *
 * What it will not do:
 *   - run an effect the host cannot do — `capabilityGate` answers `EFK_CAPABILITY_UNSUPPORTED`
 *     before any native call, and no receipt is recorded;
 *   - re-apply a re-delivered request — the same `idempotencyKey` returns the recorded receipt
 *     (`EFK_IDEMPOTENCY_COLLISION` if a different effect claims it);
 *   - blindly re-run a non-idempotent effect whose outcome is `unknown`
 *     (`EFK_EFFECT_NON_IDEMPOTENT_RETRY`; reconcile first);
 *   - report an unconfirmed cancel as done — the outcome is `unknown` plus
 *     `EFK_CANCEL_UNCONFIRMED` (human review R6);
 *   - invoke anything during `reconcile`, which only reads back what was recorded.
 */
import { CURRENT_SCHEMA_VERSION, RUNTIME_NAMESPACE, fail } from '../../protocol/index.js';
import { cancelRequirements, capabilityGate, contextRequirements, reconcileRequirements, requiredCapabilities } from './capabilities.js';
import { dedupeUsage, stableStringify, usageIsComplete } from './usage.js';
import {
  err,
  ok,
  type ArtifactRef,
  type AuthorizedEffect,
  type BoardOwner,
  type CancelOutcome,
  type CancelRequest,
  type CapabilityMatrix,
  type Clock,
  type ContextInjection,
  type ContextRequest,
  type Effect,
  type EffectKind,
  type GuaranteeStrength,
  type HostObservation,
  type HostPort,
  type HostResult,
  type Receipt,
  type ReceiptStatus,
  type Usage,
  type UsageReport,
  type UsageRequest,
  type ReconcileOutcome,
  type ReconcileRequest,
} from './types.js';

/** The frozen envelope every receipt carries. Read from the protocol table, never re-typed. */
const PROTOCOL = { namespace: RUNTIME_NAMESPACE, schemaVersion: CURRENT_SCHEMA_VERSION } as const;

/** Effects with an external side effect: after `unknown`, a re-dispatch is a blind retry. */
const IDEMPOTENT_KINDS: readonly EffectKind[] = ['timer.wait', 'host.reconcile', 'host.cancel'];

/** The scripted behaviour for one fake host. Every key is a real effect id. */
export interface HostScript {
  /** Default `completed`; `unknown` is how a disconnect or an unreadable turn is injected. */
  readonly outcomes?: Readonly<Record<string, ReceiptStatus>>;
  /** Real evidence that settles a previously `unknown` effect. Absent means "still unknown". */
  readonly reconcile?: Readonly<Record<string, 'completed' | 'failed' | 'not-executed'>>;
  readonly usage?: Readonly<Record<string, readonly Usage[]>>;
  readonly artifacts?: Readonly<Record<string, readonly ArtifactRef[]>>;
  readonly hostInvocationId?: Readonly<Record<string, string>>;
  /** Per-target cancel confirmations, for hosts whose cancellation guarantee is only `partial`. */
  readonly cancelConfirmed?: Readonly<Record<string, boolean>>;
}

export interface FakeHostConfig {
  readonly host: string;
  readonly clock: Clock;
  readonly capabilities: CapabilityMatrix;
  readonly cancellation: GuaranteeStrength;
  readonly recovery: GuaranteeStrength;
  readonly isolation: GuaranteeStrength;
  readonly idle?: boolean;
  readonly boardOwners?: readonly BoardOwner[];
  readonly script?: HostScript;
}

/** Introspection for tests: counts, so "replay invoked nothing" is a number, not a claim. */
export interface FakeHostStats {
  readonly invocations: number;
  readonly dispatched: number;
  readonly receipts: number;
}

export interface FakeHost extends HostPort {
  stats(): FakeHostStats;
  receiptFor(effectId: string): Receipt | null;
  journal(): readonly { effectId: string; receipt: Receipt }[];
}

function statusError(status: ReceiptStatus, effect: Effect) {
  if (status === 'failed') return fail('EFK_HOST_EXECUTION_FAILED', `${effect.kind} failed at ${effect.effectId}`, [effect.effectId]);
  if (status === 'unknown') return fail('EFK_EFFECT_UNKNOWN', `${effect.kind} outcome is unknown; reconcile before retrying`, [effect.effectId]);
  return null;
}

/**
 * Build the fake host. All state is per instance; the clock and the matrices are injected.
 */
export function createFakeHost(config: FakeHostConfig): FakeHost {
  const script: HostScript = config.script ?? {};
  const receiptsByKey = new Map<string, { effectId: string; digest: string; receipt: Receipt }>();
  const lastReceipt = new Map<string, Receipt>();
  const lastStatus = new Map<string, ReceiptStatus>();
  const effects = new Map<string, Effect>();
  const dispatched = new Set<string>();
  let invocations = 0;

  function buildReceipt(effect: Effect, status: ReceiptStatus, error: Receipt['error'], suffix = ''): Receipt {
    const invocation = script.hostInvocationId?.[effect.effectId] ?? `invocation:${effect.effectId}`;
    return {
      protocol: PROTOCOL,
      receiptId: `receipt:${effect.effectId}:${effect.idempotencyKey}${suffix}`,
      effectId: effect.effectId,
      hostInvocationId: status === 'unknown' ? null : invocation,
      binding: effect.binding,
      status,
      artifactRefs: status === 'completed' ? [...(script.artifacts?.[effect.effectId] ?? [])] : [],
      usage: [...(script.usage?.[effect.effectId] ?? [])],
      observability: status === 'unknown' ? [] : [`${config.host}-native`],
      error,
    };
  }

  function record(effect: Effect, receipt: Receipt): void {
    receiptsByKey.set(effect.idempotencyKey, { effectId: effect.effectId, digest: stableStringify(effect), receipt });
    lastReceipt.set(effect.effectId, receipt);
    lastStatus.set(effect.effectId, receipt.status);
    if (receipt.status !== 'not-executed') dispatched.add(effect.effectId);
  }

  async function execute(authorized: AuthorizedEffect): Promise<HostResult<Receipt>> {
    const { effect } = authorized;
    const digest = stableStringify(effect);
    const cached = receiptsByKey.get(effect.idempotencyKey);
    if (cached !== undefined) {
      if (cached.effectId !== effect.effectId || cached.digest !== digest) {
        return err(fail('EFK_IDEMPOTENCY_COLLISION', `idempotencyKey ${effect.idempotencyKey} already names a different intention`, [effect.effectId, cached.effectId]));
      }
      return ok(cached.receipt);
    }
    const allowed = capabilityGate(config.host, config.capabilities, requiredCapabilities(effect, authorized.demands ?? []));
    if (!allowed.ok) return allowed;
    if (config.clock.now() > effect.deadline) {
      const expired = buildReceipt(effect, 'not-executed', null);
      record(effect, expired);
      return ok(expired);
    }
    if (dispatched.has(effect.effectId) && lastStatus.get(effect.effectId) === 'unknown' && !IDEMPOTENT_KINDS.includes(effect.kind)) {
      return err(fail('EFK_EFFECT_NON_IDEMPOTENT_RETRY', `${effect.kind} ${effect.effectId} is unknown; reconcile and re-authorize, do not re-dispatch`, [effect.effectId]));
    }
    invocations += 1;
    effects.set(effect.effectId, effect);
    const status = script.outcomes?.[effect.effectId] ?? 'completed';
    const receipt = buildReceipt(effect, status, statusError(status, effect));
    record(effect, receipt);
    return ok(receipt);
  }

  async function cancel(request: CancelRequest): Promise<HostResult<CancelOutcome>> {
    const allowed = capabilityGate(config.host, config.capabilities, cancelRequirements(request.targetIds.length));
    if (!allowed.ok) return allowed;
    const targets = request.targetIds.map((targetId) => {
      if (!dispatched.has(targetId)) return { targetId, confirmation: 'not-executed' as const, observability: [] as string[] };
      const confirmed = script.cancelConfirmed?.[targetId] ?? config.cancellation.status === 'verified';
      return confirmed
        ? { targetId, confirmation: 'native-ack' as const, observability: [`${config.host}-abort-ack`] }
        : { targetId, confirmation: 'unconfirmed' as const, observability: [] as string[] };
    });
    const unconfirmed = targets.filter((target) => target.confirmation === 'unconfirmed').map((target) => target.targetId);
    if (unconfirmed.length > 0) {
      return ok({
        status: 'unknown',
        targets,
        error: fail('EFK_CANCEL_UNCONFIRMED', `${config.host} did not confirm every cancel target`, unconfirmed),
      });
    }
    return ok({ status: 'cancelled', targets, error: null });
  }

  async function reconcile(request: ReconcileRequest): Promise<HostResult<readonly ReconcileOutcome[]>> {
    const allowed = capabilityGate(config.host, config.capabilities, reconcileRequirements());
    if (!allowed.ok) return allowed;
    const outcomes = request.targetIds.map((effectId): ReconcileOutcome => {
      const effect = effects.get(effectId);
      if (effect === undefined) return { effectId, verdict: 'not-executed', receipt: null, error: null };
      const resolved = script.reconcile?.[effectId];
      if (resolved === undefined) {
        return { effectId, verdict: 'unknown', receipt: lastReceipt.get(effectId) ?? null, error: fail('EFK_EFFECT_UNKNOWN', `no evidence yet for ${effectId}`, [effectId]) };
      }
      if (resolved === 'not-executed') return { effectId, verdict: 'not-executed', receipt: null, error: null };
      const receipt = buildReceipt(effect, resolved, statusError(resolved, effect), ':reconciled');
      record(effect, receipt);
      return { effectId, verdict: 'resolved', receipt, error: null };
    });
    return ok(outcomes);
  }

  async function context(request: ContextRequest): Promise<HostResult<ContextInjection>> {
    const allowed = capabilityGate(config.host, config.capabilities, contextRequirements(request.plan));
    if (!allowed.ok) return allowed;
    return ok({ isolation: request.plan.isolation, preservedHostResources: true, injectedRefs: [...request.plan.inputRefs] });
  }

  async function usage(request: UsageRequest): Promise<HostResult<UsageReport>> {
    const recorded = script.usage?.[request.effectId] ?? [];
    const selected = request.requestIds.length === 0 ? recorded : recorded.filter((row) => request.requestIds.includes(row.requestId));
    const settled = dedupeUsage(selected);
    if (!settled.ok) return settled;
    return ok({ effectId: request.effectId, usage: settled.value, complete: usageIsComplete(settled.value) });
  }

  async function observe(_sessionId: string): Promise<HostResult<HostObservation>> {
    return ok({
      host: config.host,
      idle: config.idle ?? true,
      capabilities: config.capabilities,
      cancellation: config.cancellation,
      recovery: config.recovery,
      isolation: config.isolation,
      boardOwners: [...(config.boardOwners ?? [])],
    });
  }

  return {
    observe,
    execute,
    cancel,
    reconcile,
    context,
    usage,
    stats: () => ({ invocations, dispatched: dispatched.size, receipts: lastReceipt.size }),
    receiptFor: (effectId: string) => lastReceipt.get(effectId) ?? null,
    journal: () => [...lastReceipt.entries()].map(([effectId, receipt]) => ({ effectId, receipt })),
  };
}
