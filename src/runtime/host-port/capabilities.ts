/**
 * The capability matrices and the requirement judge.
 *
 * A real host is not uniformly capable. `adr_0006` accepted two hosts with *semantic* parity and
 * *explicit* differences; `OWNERSHIP.md` I08 forbids a default backend or fallback. So this module
 * carries the two probe matrices verbatim-in-substance and turns "can this host do it" into a
 * typed answer.
 *
 * Source of the numbers (do not "improve" them here):
 *   - `docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json` — 15 verified, 1 partial,
 *     13 unknown; `teamMessageDelivery` (the `teamMessageDurable` check) is **unknown**, not
 *     "false" and not "true".
 *   - `docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json` — `reasoningHighGuarantee` is
 *     **partial**, `osSandbox` and `externalEffectReconciliation` and `nativeTeamGraphBoard` are
 *     **absent**, `costInvoice`/`providerCancelBilling` **unknown**.
 * A capability key that appears in neither matrix is `unknown`; absence of a probe is never read
 * as absence of the capability (`comparisonContract.statusMeaning` in both manifests).
 */
import { fail } from '../../protocol/index.js';
import { err, ok, type CapabilityEntry, type CapabilityMatrix, type CapabilityRequirement, type CapabilityStatus, type ContextPlan, type Effect, type EffectKind, type HostResult } from './types.js';

/** The statuses that make a "verified" demand true. `partial` is not `verified`. */
const VERIFIED: readonly CapabilityStatus[] = ['verified'];
/** A named subset is enough when the caller asked for the subset, not the whole guarantee. */
const VERIFIED_OR_PARTIAL: readonly CapabilityStatus[] = ['verified', 'partial'];

/** DSH 0.2.0-rc.2, transcribed from `probes/dsh/HOST-MANIFEST.json#capabilities`. */
export const DSH_CAPABILITIES: CapabilityMatrix = {
  nativeSessionBinding: { status: 'verified' },
  contextAndResources: { status: 'verified' },
  agentPreStep: { status: 'verified' },
  toolRequestGate: { status: 'verified' },
  toolResultObservation: { status: 'verified' },
  settledAndIdle: { status: 'verified' },
  usageTokens: { status: 'verified' },
  teamDelegation: { status: 'verified' },
  teamMessageDelivery: { status: 'unknown', limitation: 'queued alone is not delivered; needs a durable target ack' },
  nativeTeamGraphBoard: { status: 'verified' },
  teamTaskCas: { status: 'verified' },
  teamAuthorityIdentity: { status: 'verified' },
  sdkAbort: { status: 'verified' },
  transcriptRecovery: { status: 'verified' },
  projectionOrdering: { status: 'verified' },
  parentChildCancellation: { status: 'unknown', limitation: 'not exercised; no automatic cascade assumed' },
  toolCancellation: { status: 'unknown', limitation: 'no long-running tool dispatch' },
  diskCrashRecovery: { status: 'unknown', limitation: 'no native disk artifacts' },
  osSandbox: { status: 'unknown', limitation: 'hooks do not imply an OS sandbox' },
  externalEffectReconciliation: { status: 'unknown', limitation: 'no external effects/journal/outbox' },
  reasoningHighGuarantee: { status: 'unknown', limitation: 'fixture high parameter only' },
  costInvoice: { status: 'unknown', limitation: 'no paid requests/invoice query' },
  providerCancelBilling: { status: 'unknown', limitation: 'no vendor request/cancel' },
  existingIntegrationCompatibility: { status: 'unknown', limitation: 'declared engines/peers mismatch target' },
  grantWriteScopeEnforcement: { status: 'unknown', limitation: 'advisory writeScopes only' },
  teamWaitAndInterrupt: {
    status: 'partial',
    verifiedSubset: ['waitForChange signal cancellation', 'inactive-member interrupt status'],
    unverified: ['running-member interrupt', 'parent-child cancellation propagation'],
  },
  skillsPluginCoexistence: { status: 'unknown', limitation: 'no real skill discovery/GUI coexistence' },
  sessionCustomEntries: { status: 'unknown', limitation: 'not exercised on DSH' },
  sdkChildSessionIsolation: { status: 'verified' },
};

/** Pi 0.87.1, transcribed from `probes/pi/HOST-MANIFEST.json#capabilities` (15 entries). */
export const PI_CAPABILITIES: CapabilityMatrix = {
  nativeSessionBinding: { status: 'verified' },
  contextAndResources: { status: 'verified' },
  toolRequestGate: { status: 'verified' },
  osSandbox: { status: 'absent', limitation: 'no OS sandbox was added or tested' },
  sessionCustomEntries: { status: 'verified' },
  settledAndIdle: { status: 'verified' },
  usageTokens: { status: 'verified' },
  costInvoice: { status: 'unknown', limitation: 'reference estimates only, no provider invoice' },
  sdkChildSessionIsolation: { status: 'verified' },
  nativeTeamGraphBoard: { status: 'absent', limitation: 'no built-in board parity' },
  sdkAbort: { status: 'verified' },
  providerCancelBilling: { status: 'unknown', limitation: 'vendor abort billing not probed' },
  transcriptRecovery: { status: 'verified' },
  externalEffectReconciliation: { status: 'absent', limitation: 'requires kernel journal/outbox' },
  reasoningHighGuarantee: {
    status: 'partial',
    verifiedSubset: ['thinking.enabled + reasoning_effort=high accepted (HTTP 200)'],
    unverified: ['server-tier reasoning guarantee'],
  },
};

/** The status a missing capability key has: unverified evidence, never `verified`. */
export function capabilityStatus(matrix: CapabilityMatrix, capability: string): CapabilityStatus {
  return matrix[capability]?.status ?? 'unknown';
}

/**
 * Reconcile reads native state; the same static demand serves `HostPort.reconcile` and its effect.
 * A module-level literal, not a call: module scope stays free of function execution (I05).
 */
export const RECONCILE_REQUIREMENTS: readonly CapabilityRequirement[] = [
  { capability: 'nativeSessionBinding', accepts: VERIFIED, because: 'reconcile reads native state for that session' },
  { capability: 'settledAndIdle', accepts: VERIFIED, because: 'an unresolved turn cannot be read as an outcome' },
];

/** The base demands of one effect kind, independent of payload. */
const BASE_REQUIREMENTS: Readonly<Record<EffectKind, readonly CapabilityRequirement[]>> = {
  'host.agent': [
    { capability: 'nativeSessionBinding', accepts: VERIFIED, because: 'a native loop must bind the real session' },
    { capability: 'contextAndResources', accepts: VERIFIED_OR_PARTIAL, because: 'the node packet is injected at a host seam' },
    { capability: 'settledAndIdle', accepts: VERIFIED, because: 'a receipt needs a settled turn, not an early idle' },
  ],
  'host.tool': [
    { capability: 'toolRequestGate', accepts: VERIFIED_OR_PARTIAL, because: 'the host gate is what actually blocks a tool call' },
  ],
  'host.delegate': [
    { capability: 'sdkChildSessionIsolation', accepts: VERIFIED_OR_PARTIAL, because: 'a child needs its own transcript identity' },
  ],
  // `host.cancel` carries no base demand on purpose (R6): a weak cancellation guarantee becomes
  // `unconfirmed`/`unknown` here, never a dispatch refusal. `cancelConfirmationCapability` names
  // the per-target guarantee the confirmation actually rests on.
  'host.cancel': [],
  'host.activate': [
    { capability: 'nativeSessionBinding', accepts: VERIFIED, because: 'activation targets one real host session' },
    { capability: 'settledAndIdle', accepts: VERIFIED, because: 'idle is a precondition, and the new snapshot must be real' },
  ],
  'host.reconcile': RECONCILE_REQUIREMENTS,
  'timer.wait': [
    { capability: 'settledAndIdle', accepts: VERIFIED_OR_PARTIAL, because: 'the injected clock/timer drives the wait' },
  ],
};

/**
 * The per-target guarantee a stop needs (`sdkAbort` for a loop, `toolCancellation` for a tool,
 * `parentChildCancellation` for a delegated child). R6 is explicit that a weak cancellation
 * guarantee is **not** a dispatch gate: the target comes back `unconfirmed`, the cancel result
 * stays `unknown`, and the cancellation action itself is never refused as unsupported.
 */
export function cancelConfirmationCapability(kind: EffectKind): string {
  if (kind === 'host.tool') return 'toolCancellation';
  if (kind === 'host.delegate') return 'parentChildCancellation';
  return 'sdkAbort';
}

/** A fresh transcript needs child-session identity; an additive packet needs the context seam. */
export function contextRequirements(plan: ContextPlan): readonly CapabilityRequirement[] {
  const requirements: CapabilityRequirement[] = [
    { capability: 'contextAndResources', accepts: VERIFIED_OR_PARTIAL, because: 'the node packet is injected at a host seam' },
  ];
  if (plan.isolation === 'fresh') {
    requirements.push({
      capability: 'sdkChildSessionIsolation',
      accepts: VERIFIED_OR_PARTIAL,
      because: 'a fresh transcript needs its own child session identity',
    });
  }
  return requirements;
}

/** Payload-dependent demands: the `EffectPayload` fields that change what the host must prove. */
function payloadRequirements(effect: Effect): readonly CapabilityRequirement[] {
  const requirements: CapabilityRequirement[] = [];
  if (effect.payload.deliveryGuarantee === 'acknowledged-durable') {
    requirements.push({
      capability: 'teamMessageDelivery',
      accepts: VERIFIED,
      because: 'acknowledged-durable without a target consumption ack cannot be completed',
    });
  }
  return requirements;
}

/** Everything the host must prove for this effect, base plus payload plus caller `demands`. */
export function requiredCapabilities(
  effect: Effect,
  demands: readonly CapabilityRequirement[] = [],
): readonly CapabilityRequirement[] {
  // `host.cancel` deliberately contributes no base demand: R6 forbids letting a weak cancel
  // guarantee become a dispatch refusal, so the per-target confirmation carries the honesty.
  return [...BASE_REQUIREMENTS[effect.kind], ...payloadRequirements(effect), ...demands];
}

/** A requirement the matrix does not satisfy, kept in full so the failure explains itself. */
export interface CapabilityGap {
  readonly capability: string;
  readonly required: readonly CapabilityStatus[];
  readonly observed: CapabilityStatus;
  readonly because: string;
}

/**
 * The judge. A requirement is satisfied when the observed status is one of `accepts`; `partial`
 * only satisfies a demand that explicitly lists it. Unknown never satisfies anything.
 */
export function judgeRequirements(
  matrix: CapabilityMatrix,
  requirements: readonly CapabilityRequirement[],
): readonly CapabilityGap[] {
  const gaps: CapabilityGap[] = [];
  for (const requirement of requirements) {
    const observed = capabilityStatus(matrix, requirement.capability);
    if (!requirement.accepts.includes(observed)) {
      gaps.push({ capability: requirement.capability, required: requirement.accepts, observed, because: requirement.because });
    }
  }
  return gaps;
}

/** A stable, sorted error message listing every unmet capability exactly once. */
export function capabilityGapError(gaps: readonly CapabilityGap[], host: string) {
  const names = [...new Set(gaps.map((gap) => gap.capability))].sort();
  const detail = gaps.map((gap) => `${gap.capability} observed ${gap.observed} (needed ${gap.required.join('/')}): ${gap.because}`).join('; ');
  return fail('EFK_CAPABILITY_UNSUPPORTED', `${host} cannot satisfy ${names.join(', ')} — ${detail}`, names);
}

/**
 * The one gate both `execute` and `cancel` pass through before any native call.
 *
 * This is a contract/evidence gate (brief §1.6 exception ①): it is the only place the host's real
 * capability is compared to the demand, and it runs before the external action, so removing it
 * would let an unsupported effect reach the host and be reported as done.
 */
export function capabilityGate(
  host: string,
  matrix: CapabilityMatrix,
  requirements: readonly CapabilityRequirement[],
): HostResult<true> {
  const gaps = judgeRequirements(matrix, requirements);
  if (gaps.length > 0) return err(capabilityGapError(gaps, host));
  return ok(true);
}
