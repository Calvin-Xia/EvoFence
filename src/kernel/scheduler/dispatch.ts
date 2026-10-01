/**
 * One dispatch round: frontier → gates → claims, leases and reservations, with the reasons kept.
 *
 * The round is a pure fold over values. It starts from the journal-derived facts, walks the ready
 * frontier in fairness order, and for each node evaluates the gates in a fixed order so the answer
 * is auditable from the report alone:
 *
 *   concurrency → depth → reader/writer clash → lease capacity → budget reservation → claim
 *
 * The resource and budget gates are where `CONTRACTS.md §5` items 1, 2, 3 and 7 become real:
 *
 *   - A node gets a claim only after its leases are granted, and the claim owns those leases, so
 *     "at most one valid claim per attempt" and "at most one valid holder per exclusive resource"
 *     are decided in one step rather than two that can disagree.
 *   - Both dispatches in a round reserve against the **same** ledger (the fold threads it), so two
 *     concurrent workers hold two reservations against one pool instead of two copies of it. The
 *     reservation is per attempt and is never re-created: `settleDispatch` settles it verbatim, and
 *     missing usage keeps the reservation (`missingUsagePolicy: retain-reservation`) because nothing
 *     here invents a zero.
 *   - A partial grant is impossible: the lease table is a value, so refusing the second resource
 *     simply discards the first grant with it.
 */
import { reserve, settle } from '../policy/index.js';
import type { BudgetLedger, BudgetTransition, RequestRole } from '../policy/index.js';
import { claimFor, claimIdFor, recordClaim } from './claim.js';
import { advanceFairness, orderFrontier } from './fairness.js';
import { computeFrontier, dispatchableEntries } from './frontier.js';
import { emptyLeaseTable, grantLease, liveGrants, toLeaseRef } from './lease.js';
import { declarationsOf, resourceConflicts } from './resources.js';
import type {
  Binding,
  DecisionReason,
  DispatchDecision,
  DispatchInput,
  DispatchRound,
  FrontierEntry,
  LeaseGrant,
  LeaseTable,
  ResourceDeclaration,
  SchedulerState,
} from './types.js';

/** A fresh session state: no claims, an empty lease table, revision 0. */
export function emptyState(): SchedulerState {
  return { revision: 0, claims: [], leases: emptyLeaseTable() };
}

/** What a receipt reported about a dispatched request's usage. `null` micros means "not known". */
export interface UsageObservation {
  readonly micros: number | null;
  readonly complete: boolean;
  readonly digest: string;
}

/**
 * Settle a dispatch's reservation from its receipt. The observation is passed through unchanged —
 * the one thing this lane must not do is turn "usage unknown" into a zero.
 */
export function settleDispatch(
  budget: BudgetLedger,
  reservationRef: string,
  usage: UsageObservation,
): BudgetTransition {
  return settle(budget, {
    requestId: reservationRef,
    micros: usage.micros,
    complete: usage.complete,
    digest: usage.digest,
  });
}

/** The first request of a dispatched attempt; later requests of the same attempt hang off it. */
export const DISPATCH_REQUEST_ROLE: RequestRole = 'worker';

function defer(nodeId: string, reasons: readonly DecisionReason[]): DispatchDecision {
  return { nodeId, verdict: 'defer', reasons, claim: null, leases: [], reservationRef: null };
}

interface LeaseAttempt {
  readonly leases: LeaseTable;
  readonly granted: readonly LeaseGrant[];
  readonly reasons: readonly DecisionReason[];
}

/** Grant every declared resource, or none: the table is a value, so a refusal drops the lot. */
function grantAll(
  table: LeaseTable,
  declarations: readonly ResourceDeclaration[],
  binding: Binding,
  now: DispatchInput['now'],
  leaseTtlMs: number,
): LeaseAttempt {
  let leases = table;
  const granted: LeaseGrant[] = [];
  for (const declaration of declarations) {
    const attempt = grantLease(
      leases,
      {
        resourceId: declaration.resourceId,
        ownerClaimId: claimIdFor(binding),
        epoch: binding.epoch,
        mode: declaration.mode,
        maxHolders: declaration.maxHolders,
        ttlMs: leaseTtlMs,
      },
      now,
    );
    if (attempt.grant === null) {
      return {
        leases: table,
        granted: [],
        reasons: [
          {
            code: declaration.mode === 'exclusive' ? 'writer-held' : 'quota-full',
            detail: attempt.error?.message ?? declaration.resourceId,
          },
        ],
      };
    }
    leases = attempt.table;
    granted.push(attempt.grant);
  }
  return { leases, granted, reasons: [] };
}

/** The gates that need no write: concurrency, depth, then reader/writer clashes. */
function preGates(
  entry: FrontierEntry,
  declarations: readonly ResourceDeclaration[],
  live: readonly LeaseGrant[],
  inFlight: number,
  maxConcurrentAgents: number,
  depth: number,
  maxDepth: number,
): readonly DecisionReason[] {
  const reasons: DecisionReason[] = [];
  if (inFlight >= maxConcurrentAgents) {
    reasons.push({
      code: 'concurrency-limit',
      detail: `${inFlight} native session(s) in flight, cap is ${maxConcurrentAgents}`,
    });
  }
  if (depth >= maxDepth) {
    reasons.push({ code: 'depth-limit', detail: `subgraph depth ${depth} reached maxDepth ${maxDepth}` });
  }
  for (const conflict of resourceConflicts(declarations, live)) {
    reasons.push({
      code: 'mode-conflict',
      detail: `${conflict.resourceId} is declared ${conflict.declared} but held ${conflict.live} by ${conflict.ownerClaimId}`,
    });
  }
  return reasons;
}

/**
 * Run one scheduling round. `input.state` and `input.budget` are not mutated; the round returns the
 * successors, so a caller can discard a round without side effects.
 */
export function dispatchRound(input: DispatchInput): DispatchRound {
  const frontier = computeFrontier(input.graph, input.facts, input.state);
  const ordered = orderFrontier(
    dispatchableEntries(frontier),
    input.fairness,
    input.graph.spec.nodes.map((node) => node.nodeId),
  );

  let state = input.state;
  let budget = input.budget;
  let inFlight = state.claims.length;
  const decisions: DispatchDecision[] = [];
  const dispatched: string[] = [];
  const deferred: string[] = [];

  for (const entry of ordered) {
    const declarations = declarationsOf(input.graph, entry.nodeId);
    const live = liveGrants(state.leases, input.now);
    const reasons = [
      ...preGates(
        entry,
        declarations,
        live,
        inFlight,
        input.maxConcurrentAgents,
        input.depth,
        input.maxDepth,
      ),
    ];
    if (reasons.length > 0) {
      deferred.push(entry.nodeId);
      decisions.push(defer(entry.nodeId, reasons));
      continue;
    }

    const binding = input.bindingFor(entry.nodeId);
    const leaseAttempt = grantAll(state.leases, declarations, binding, input.now, input.leaseTtlMs);
    if (leaseAttempt.reasons.length > 0) {
      deferred.push(entry.nodeId);
      decisions.push(defer(entry.nodeId, leaseAttempt.reasons));
      continue;
    }

    const reservationRef = claimIdFor(binding);
    const reservation = reserve(budget, {
      requestId: reservationRef,
      role: DISPATCH_REQUEST_ROLE,
      parentRequestId: null,
    });
    if (reservation.error !== null) {
      deferred.push(entry.nodeId);
      decisions.push(defer(entry.nodeId, [{ code: 'budget-exhausted', detail: reservation.error.message }]));
      continue;
    }

    budget = reservation.ledger;
    const claim = claimFor(binding, input.now);
    state = recordClaim({ ...state, leases: leaseAttempt.leases }, claim);
    inFlight += 1;
    dispatched.push(entry.nodeId);
    decisions.push({
      nodeId: entry.nodeId,
      verdict: 'dispatch',
      reasons: [
        { code: 'ready', detail: 'inputs satisfied and no reader/writer clash' },
        {
          code: 'resources-granted',
          detail:
            leaseAttempt.granted.length === 0
              ? 'node declares no resource'
              : leaseAttempt.granted.map((grant) => `${grant.resourceId}#${grant.fencingToken}`).join(', '),
        },
        { code: 'budget-reserved', detail: reservationRef },
      ],
      claim,
      leases: leaseAttempt.granted.map(toLeaseRef),
      reservationRef,
    });
  }

  return {
    state,
    budget,
    fairness: advanceFairness(input.fairness, dispatched, deferred),
    frontier,
    decisions,
  };
}
