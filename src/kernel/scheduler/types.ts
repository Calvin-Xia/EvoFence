/**
 * The scheduler lane's internal contract.
 *
 * Scope: turn a compiled graph plus journal-derived facts into an *explainable* dispatch decision,
 * own the runtime lease table that serialises writers, and report a stalled graph instead of
 * waiting forever on a worker that already terminated. Nothing here reads a clock, opens a store or
 * talks to a host: the instant is injected, the budget ledger is passed in, and every exported
 * function is a pure function of its arguments (`OWNERSHIP.md` I05/I07).
 *
 * Field names are the frozen ones. `Binding`/`LeaseRef` come from `src/protocol/**`; `NodeState`,
 * `Readiness`, `NodeFacts` and `CompiledGraph` from `src/kernel/graph/**`; `BudgetLedger` from
 * `src/kernel/policy/**`. There is no second claim/lease/reservation vocabulary — the frozen
 * `SCHEMAS.md §3` choice that a claim and a reservation have no wire object is respected: they are
 * internal state here, and only their ids cross a boundary (`LeaseRef.ownerClaimId`,
 * `Effect.reservationRef`).
 */
import type { Decoded, Instant } from '../../protocol/index.js';
import type { CompiledGraph, NodeFacts, NodeKind, NodeState, Readiness } from '../graph/index.js';
import type { BudgetLedger } from '../policy/index.js';

/** The attempt binding every claim, lease and reservation hangs off. */
export type Binding = Decoded<'Binding'>;
/** The frozen lease reference (`SCHEMAS.md` `$defs.LeaseRef`). */
export type LeaseRef = Decoded<'LeaseRef'>;
/** `ResourcePolicy.mode` (`SEMANTICS.md §3.2`). */
export type ResourceMode = 'exclusive' | 'shared';

/**
 * A claim: the single valid owner of one node attempt.
 *
 * `SCHEMAS.md §3` gives a claim no wire object on purpose — its lifetime is one store CAS
 * transaction. `claimId` is therefore the attempt identity: the store's unique key is
 * `(sessionId, nodeId, attemptOrdinal, epoch)` and the `Binding` already carries all four, so one
 * id names the attempt, its claim and its reservation instead of three drifting copies.
 */
export interface Claim {
  readonly claimId: string;
  readonly binding: Binding;
  readonly claimedAt: Instant;
}

/**
 * One granted lease. `mode` is the `ResourcePolicy.mode` in force when it was granted: a later
 * graph revision changes the policy, never a lease that is already out.
 */
export interface LeaseGrant {
  readonly resourceId: string;
  readonly ownerClaimId: string;
  readonly epoch: number;
  readonly fencingToken: number;
  readonly mode: ResourceMode;
  readonly expiresAt: Instant;
}

/**
 * The lease table of one session.
 *
 * `grants` keeps every grant ever issued, including expired ones — the same "archive, never erase"
 * rule the rest of the kernel applies to stale receipts and failure evidence. Liveness is decided
 * by `liveGrants(table, now)`, and keeping the expired rows is what lets the scheduler tell "this
 * claim's lease expired" apart from "this claim never had one".
 */
export interface LeaseTable {
  readonly grants: readonly LeaseGrant[];
  /** Monotonic and never reused, so an expired token can never match a later grant. */
  readonly nextFencingToken: number;
}

/**
 * What the scheduler owns between rounds. Deliberately *not* node states: those are the journal's
 * derived projection (`SCHEMAS.md` S25) and arrive here as `NodeFacts`. A second copy of them
 * would be a second truth source.
 */
export interface SchedulerState {
  /** CAS revision; `node.claim` compares it and refuses on mismatch. */
  readonly revision: number;
  readonly claims: readonly Claim[];
  readonly leases: LeaseTable;
}

/** Why a node got this verdict, in the order the gates were evaluated. */
export type DecisionCode =
  | 'ready'
  | 'resources-granted'
  | 'budget-reserved'
  | 'claimed'
  | 'active'
  | 'halted'
  | 'waiting'
  | 'unknown'
  | 'cancelling'
  | 'concurrency-limit'
  | 'depth-limit'
  | 'writer-held'
  | 'quota-full'
  | 'mode-conflict'
  | 'budget-exhausted';

export interface DecisionReason {
  readonly code: DecisionCode;
  readonly detail: string;
}

/** One node's verdict for one round: dispatched, or deferred with every reason that blocked it. */
export interface DispatchDecision {
  readonly nodeId: string;
  readonly verdict: 'dispatch' | 'defer';
  readonly reasons: readonly DecisionReason[];
  /** Set on `dispatch`: the claim this node now owns. */
  readonly claim: Claim | null;
  /** Set on `dispatch`: the leases the work is performed under. */
  readonly leases: readonly LeaseRef[];
  /** Set on `dispatch`: the reservation the attempt's first request is charged to. */
  readonly reservationRef: string | null;
}

/**
 * Where one node stands this round. `dispatchable` is readiness *plus* "not already claimed or
 * running"; the other values are the explicit reasons a node is in play but cannot start.
 */
export type FrontierDisposition =
  | 'dispatchable'
  | 'claimed'
  | 'active'
  | 'halted'
  | 'waiting'
  | 'unknown'
  | 'cancelling';

export interface FrontierEntry {
  readonly nodeId: string;
  readonly kind: NodeKind;
  /** The journal-derived state; `null` means the node has not reported yet (first attempt). */
  readonly state: NodeState | null;
  readonly disposition: FrontierDisposition;
  readonly readiness: Readiness;
  readonly claim: Claim | null;
}

/**
 * Starvation control. Ordering is by (defer streak desc, dispatches asc, declaration order), so a
 * node that keeps losing the resource race moves to the front instead of being passed over forever.
 */
export interface FairnessState {
  readonly deferStreak: Readonly<Record<string, number>>;
  readonly dispatches: Readonly<Record<string, number>>;
}

/** A named resource as one node declares it, with the mode and cap from the graph-level policy. */
export interface ResourceDeclaration {
  readonly resourceId: string;
  readonly mode: ResourceMode;
  readonly maxHolders: number;
}

/** A reader/writer clash between a candidate declaration and a lease that is already out. */
export interface ResourceConflict {
  readonly resourceId: string;
  readonly declared: ResourceMode;
  readonly live: ResourceMode;
  readonly ownerClaimId: string;
}

export interface DispatchInput {
  readonly graph: CompiledGraph;
  readonly facts: NodeFacts;
  readonly state: SchedulerState;
  readonly budget: BudgetLedger;
  readonly fairness: FairnessState;
  /** The binding for the node's current attempt; the kernel owns attempt identity, not the lane. */
  readonly bindingFor: (nodeId: string) => Binding;
  readonly now: Instant;
  /** Lease TTL in milliseconds, added to `now`. */
  readonly leaseTtlMs: number;
  /** `GraphLimits.maxConcurrentAgents`: native sessions in flight. */
  readonly maxConcurrentAgents: number;
  /** Nesting depth of the subgraph being scheduled, and its cap (`GraphLimits.maxDepth`). */
  readonly depth: number;
  readonly maxDepth: number;
}

export interface DispatchRound {
  readonly state: SchedulerState;
  readonly budget: BudgetLedger;
  readonly fairness: FairnessState;
  readonly frontier: readonly FrontierEntry[];
  readonly decisions: readonly DispatchDecision[];
}

/**
 * Why a node cannot advance. `blocked-by-terminated-worker` is the one that must never be softened
 * into a wait: the upstream is gone, no declared cover can revive it, and only a graph patch
 * changes that.
 */
export type StallReason =
  | 'blocked-by-terminated-worker'
  | 'waiting-on-repair'
  | 'waiting-on-live-upstream'
  | 'resource-unavailable'
  | 'awaiting-new-attempt'
  | 'reconcile-required'
  | 'cancellation-in-flight'
  | 'claim-without-lease'
  | 'lease-expired';

export interface StallEntry {
  readonly nodeId: string;
  readonly disposition: FrontierDisposition;
  readonly reason: StallReason;
  readonly detail: string;
  /** Every blocker, unfiltered; a lease-less claim names its own node explicitly. */
  readonly blockedBy: readonly string[];
}

export type ProgressStatus = 'dispatchable' | 'stalled' | 'complete';

export interface ProgressReport {
  readonly status: ProgressStatus;
  readonly frontier: readonly FrontierEntry[];
  readonly stalls: readonly StallEntry[];
  /** Ready nodes this round could not start, verbatim — the resource/budget side of "stalled". */
  readonly deferred: readonly DispatchDecision[];
}
