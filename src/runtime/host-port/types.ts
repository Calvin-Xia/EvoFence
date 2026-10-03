/**
 * `runtime/host-port` — the typed contract between the kernel and a host adapter.
 *
 * This is the L2 stand-in for the `HostPort` row of `INTERFACES.md` §3: "原生
 * agent/tool/delegate/cancel/activate/reconcile；返回真实观察和工件引用" and, in words, the
 * brief's `observe` / `execute` / `cancel` / `reconcile` / `context` / `usage` plus the scoped
 * `DelegationGrant`.
 *
 * Two rules shape every signature below:
 *
 *   - an expected condition is a **typed result**, never a throw: `HostResult<T>` is the one
 *     business/error split, and the error arm is the frozen `ErrorEnvelope` from
 *     `src/protocol/errors.ts` (no second envelope is invented here);
 *   - a host that cannot do what was asked says so (`EFK_CAPABILITY_UNSUPPORTED`) instead of
 *     returning a receipt that looks like completion. `adr_0006` accepted that the two hosts
 *     differ; the port surfaces the difference rather than smoothing it away.
 *
 * Layering: `runtime` may import `protocol` only (`OWNERSHIP.md` §2 `allowedEdges`). No bare
 * specifier, no node builtin, no ambient clock — the `Clock` below is injected (I07), and module
 * scope only defines static data and functions: it calls no port, constructs no backend and
 * performs no I/O (I05).
 */
import type { Decoded, ErrorEnvelope } from '../../protocol/index.js';

export type Protocol = Decoded<'ProtocolVersion'>;
export type EffectKind = Decoded<'Effect'>['kind'];
export type ReceiptStatus = Decoded<'Receipt'>['status'];
export type Usage = Decoded<'Usage'>;
export type Scope = Decoded<'Scope'>;
export type BudgetPolicy = Decoded<'BudgetPolicy'>;
export type GuaranteeStrength = Decoded<'GuaranteeStrength'>;
export type CapabilityStatus = Decoded<'Status'>;
export type Instant = Decoded<'Instant'>;
export type Binding = Decoded<'Binding'>;
export type EffectPayload = Decoded<'EffectPayload'>;
export type ArtifactRef = Decoded<'ArtifactRef'>;

/**
 * The protocol's `Decoded` type assembles object types one level deep: a `$ref`ed field is typed
 * `Readonly<Record<string, unknown>>` even though `decode` validated it. The refinements below
 * restore the field-level types for the nested objects this layer actually reads. They are a
 * *narrower view of data the codec already accepted* — no second validation, no new invariant.
 */
export interface Effect extends Omit<Decoded<'Effect'>, 'binding' | 'payload' | 'inputRefs' | 'leases'> {
  readonly binding: Binding;
  readonly payload: EffectPayload;
  readonly inputRefs: readonly ArtifactRef[];
  readonly leases: readonly Decoded<'LeaseRef'>[];
}

/** A receipt, refined the same way. `error` is always the one frozen envelope. */
export interface Receipt extends Omit<Decoded<'Receipt'>, 'binding' | 'usage' | 'artifactRefs' | 'error'> {
  readonly binding: Binding;
  readonly usage: readonly Usage[];
  readonly artifactRefs: readonly ArtifactRef[];
  readonly error: ErrorEnvelope | null;
}

/** A context plan whose input packet keeps its `ArtifactRef` identity. */
export interface ContextPlan extends Omit<Decoded<'ContextPlan'>, 'inputRefs'> {
  readonly inputRefs: readonly ArtifactRef[];
}

/** A business result or the frozen error envelope. Mirrors the protocol's `Validated`. */
export type HostResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ErrorEnvelope };

/** Successful arm. */
export function ok<T>(value: T): HostResult<T> {
  return { ok: true, value };
}

/** Failed arm; the envelope is always built by `fail` from `src/protocol/errors.ts`. */
export function err<T>(error: ErrorEnvelope): HostResult<T> {
  return { ok: false, error };
}

/** Injected wall clock. Epoch milliseconds; the host layer never reads ambient time (I07). */
export interface Clock {
  now(): Instant;
}

/**
 * A host-issued scoped delegation (`ctx_host` glossary): the range, lifetime, remaining depth
 * and concurrency of a subtree the kernel may schedule.
 *
 * Per `OWNERSHIP.md` A06 / `SCHEMAS.md` S05, delegation **only shrinks**: a child scope is the
 * intersection with its parent, depth strictly decreases, and a revoked or expired grant can
 * never be used. `grant.ts` owns those rules; this is the data.
 */
export interface DelegationGrant {
  readonly grantId: string;
  readonly rootAuthorityRef: string;
  readonly scope: Scope;
  readonly budget: BudgetPolicy;
  readonly issuedEpoch: number;
  readonly expiresAt: Instant;
  readonly remainingDepth: number;
  readonly maxConcurrency: number;
  readonly revocationEpoch: number;
  readonly revoked: boolean;
}

/**
 * The committed-and-authorized view of an `Effect` that `execute` accepts — the frozen
 * `AuthorizedEffect` of `INTERFACES.md` §3, "不是另一种线格式".
 *
 * `demands` carries node-level capability requirements the kernel already negotiated but that
 * have no `Effect` field (a server-tier reasoning demand, a child-cascade demand). Judging them
 * here is what makes "host cannot do this" a typed answer instead of a silent downgrade.
 */
export interface AuthorizedEffect {
  readonly effect: Effect;
  readonly grant: DelegationGrant;
  readonly demands?: readonly CapabilityRequirement[];
}

/** One capability the caller needs, and the statuses that actually satisfy it. */
export interface CapabilityRequirement {
  readonly capability: string;
  readonly accepts: readonly CapabilityStatus[];
  /** Why this is required, quoted into the typed failure so the gap is self-explaining. */
  readonly because: string;
}

/** What the host observed about itself for one capability. Matches the probe manifests' four values. */
export interface CapabilityEntry {
  readonly status: CapabilityStatus;
  readonly verifiedSubset?: readonly string[];
  readonly unverified?: readonly string[];
  readonly limitation?: string;
}

/** The probe manifests as a status map. A key that is absent is `unknown`, never `verified`. */
export type CapabilityMatrix = Readonly<Record<string, CapabilityEntry>>;

/** A native board task owner, read back through `observe` for the A15 check. */
export interface BoardOwner {
  readonly nodeId: string;
  readonly attemptId: string;
  readonly ownerClaimId: string;
}

/** What `observe` returns: native state, not a kernel projection. */
export interface HostObservation {
  readonly host: string;
  readonly idle: boolean;
  readonly capabilities: CapabilityMatrix;
  readonly cancellation: GuaranteeStrength;
  readonly recovery: GuaranteeStrength;
  readonly isolation: GuaranteeStrength;
  readonly boardOwners: readonly BoardOwner[];
}

/** One target of a cancel request and how far the host could confirm it. */
export interface CancelTarget {
  readonly targetId: string;
  readonly confirmation: 'native-ack' | 'not-executed' | 'unconfirmed';
  readonly observability: readonly string[];
}

/**
 * The result of `cancel`.
 *
 * `status: 'unknown'` with `error.code === 'EFK_CANCEL_UNCONFIRMED'` is the honest answer when
 * the host cannot confirm a stop; human review R6 ruled that an unconfirmed cancel stays
 * `unknown` and is not a task-hard failure.
 */
export interface CancelOutcome {
  readonly status: 'cancelled' | 'unknown';
  readonly targets: readonly CancelTarget[];
  readonly error: ErrorEnvelope | null;
}

/** A cancel request names the real sessions/effects to stop. */
export interface CancelRequest {
  readonly sessionId: string;
  readonly targetIds: readonly string[];
}

/** A reconcile request names the effects whose actual outcome is unknown. */
export interface ReconcileRequest {
  readonly sessionId: string;
  readonly targetIds: readonly string[];
}

/**
 * `resolved` means real evidence settled the effect (a completed/failed receipt is attached);
 * `not-executed` means the kernel can prove it never dispatched; `unknown` means the evidence is
 * still insufficient and the effect must stay unknown.
 */
export type ReconcileVerdict = 'resolved' | 'not-executed' | 'unknown';

export interface ReconcileOutcome {
  readonly effectId: string;
  readonly verdict: ReconcileVerdict;
  readonly receipt: Receipt | null;
  readonly error: ErrorEnvelope | null;
}

/** A context injection request: a finite packet plus the isolation level asked for. */
export interface ContextRequest {
  readonly sessionId: string;
  readonly plan: ContextPlan;
}

/** The host's acknowledgement of an injection, or a typed refusal. */
export interface ContextInjection {
  readonly isolation: ContextPlan['isolation'];
  readonly preservedHostResources: boolean;
  readonly injectedRefs: readonly ArtifactRef[];
}

/** A usage lookup for one effect, by the request identities the host recorded. */
export interface UsageRequest {
  readonly effectId: string;
  readonly requestIds: readonly string[];
}

/**
 * Usage as the host recorded it. An empty list with `complete: false` means "not recorded", not
 * "free": `SCHEMAS.md` S14 forbids turning a missing meter into a zero.
 */
export interface UsageReport {
  readonly effectId: string;
  readonly usage: readonly Usage[];
  readonly complete: boolean;
}

/** The injected port the runtime calls. One instance per host session; never a module singleton. */
export interface HostPort {
  observe(sessionId: string): Promise<HostResult<HostObservation>>;
  execute(authorized: AuthorizedEffect): Promise<HostResult<Receipt>>;
  cancel(request: CancelRequest): Promise<HostResult<CancelOutcome>>;
  reconcile(request: ReconcileRequest): Promise<HostResult<readonly ReconcileOutcome[]>>;
  context(request: ContextRequest): Promise<HostResult<ContextInjection>>;
  usage(request: UsageRequest): Promise<HostResult<UsageReport>>;
}
