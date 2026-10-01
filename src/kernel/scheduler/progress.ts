/**
 * Progress: does the graph have work, is it finished, or is it stalled — and on what.
 *
 * The scheduler's answer to "不会等待已终止 worker 形成死锁" is that it never reports a wait it
 * cannot justify. Every frontier entry that is not dispatchable gets a typed reason, and the reason
 * for a wait distinguishes three genuinely different situations:
 *
 *   - `waiting-on-repair` — the blocker terminated, but `repair`/`fallback` edges cover it, so the
 *     declared recovery path (`SEMANTICS.md §3.1`, rule B1) still exists.
 *   - `blocked-by-terminated-worker` — the blocker terminated and **nothing covers it**. No amount
 *     of waiting changes it; only a graph patch does. This is the state that must be surfaced, not
 *     sat on: `progress.status` is `stalled`, never `dispatchable`.
 *   - `lease-expired` / `claim-without-lease` — the exact attempt has no live lease, including an
 *     attempt that never had a resource. That is insufficient evidence of worker liveness; it
 *     needs explicit reclamation/reconciliation rather than an indefinite in-flight wait.
 *
 * `blockedBy` is the unfiltered list of blockers that terminated — failed *and* cancelled — so a
 * cancelled branch cannot quietly vanish from the report (`SEMANTICS.md §5.3`, `SCHEMAS.md` S20).
 */
import { hasDeclaredCover } from '../graph/index.js';
import type { CompiledGraph, NodeFacts, NodeState } from '../graph/index.js';
import type { Instant } from '../../protocol/index.js';
import { classifyClaim, liveAttemptClaims } from './activity.js';
import { compareClaims } from './claim.js';
import { joinGate } from './fanin.js';
import type {
  DispatchRound,
  FrontierEntry,
  ProgressReport,
  ProgressStatus,
  SchedulerState,
  StallEntry,
  StallReason,
} from './types.js';

export interface ProgressInput {
  readonly graph: CompiledGraph;
  readonly facts: NodeFacts;
  readonly state: SchedulerState;
  readonly now: Instant;
  readonly round: DispatchRound;
}

interface WaitReason {
  readonly reason: StallReason;
  readonly detail: string;
  readonly blockedBy: readonly string[];
}

/** `failed` and `cancelled` are the two terminal non-success states a wait can be stuck on. */
function terminated(state: NodeState | null | undefined): boolean {
  return state === 'failed' || state === 'cancelled';
}

function classify(
  graph: CompiledGraph,
  states: ReadonlyMap<string, NodeState | null>,
  detail: string,
  subject: readonly string[],
): WaitReason {
  const gone = subject.filter((nodeId) => terminated(states.get(nodeId)));
  const uncertain = subject.filter((nodeId) => states.get(nodeId) === 'unknown');
  const hard = gone.filter((nodeId) => !hasDeclaredCover(graph.edgesTo(nodeId), nodeId));
  if (hard.length > 0) return { reason: 'blocked-by-terminated-worker', detail, blockedBy: gone };
  if (uncertain.length > 0) return { reason: 'reconcile-required', detail, blockedBy: uncertain };
  if (gone.length > 0) return { reason: 'waiting-on-repair', detail, blockedBy: gone };
  return { reason: 'waiting-on-live-upstream', detail, blockedBy: [] };
}

function waitingStall(graph: CompiledGraph, facts: NodeFacts, entry: FrontierEntry): StallEntry {
  const gap = entry.readiness.state === 'waiting' ? entry.readiness.gap : null;
  if (gap === null) {
    return {
      nodeId: entry.nodeId,
      disposition: entry.disposition,
      reason: 'waiting-on-live-upstream',
      detail: 'no gap reported',
      blockedBy: [],
    };
  }
  if (gap.kind === 'join-incomplete') {
    const gate = joinGate(graph, facts, entry.nodeId);
    return {
      nodeId: entry.nodeId,
      disposition: entry.disposition,
      ...classify(
        graph,
        new Map(gate.branchReport.map((branch) => [branch.nodeId, branch.state])),
        `required branch(es) ${gate.missing.join(', ')} are not succeeded; join status is ${gate.status}`,
        gate.missing,
      ),
    };
  }
  if (gap.kind === 'resource-unavailable') {
    return {
      nodeId: entry.nodeId,
      disposition: entry.disposition,
      reason: 'resource-unavailable',
      detail: `resource ${gap.node} has no releasable path (maxHolders 0 or an abandoned holder)`,
      blockedBy: [],
    };
  }
  return {
    nodeId: entry.nodeId,
    disposition: entry.disposition,
    ...classify(graph, facts.states, `upstream ${gap.node} has not succeeded (gap ${gap.kind})`, [gap.node]),
  };
}

function stateStall(entry: FrontierEntry, liveClaim: boolean): StallEntry | null {
  switch (entry.disposition) {
    case 'active':
      return liveClaim ? null : {
        nodeId: entry.nodeId,
        disposition: entry.disposition,
        reason: 'reconcile-required',
        detail: 'active journal state has no live claim; establish the actual effect before retrying',
        blockedBy: [entry.nodeId],
      };
    case 'halted':
      return {
        nodeId: entry.nodeId,
        disposition: entry.disposition,
        reason: 'awaiting-new-attempt',
        detail: 'node is failed; only a covered repair/fallback edge or a graph patch revives it',
        blockedBy: [],
      };
    case 'unknown':
      return {
        nodeId: entry.nodeId,
        disposition: entry.disposition,
        reason: 'reconcile-required',
        detail: 'the actual external effect is unverified; reconcile first, never re-dispatch',
        blockedBy: [],
      };
    case 'cancelling':
      return {
        nodeId: entry.nodeId,
        disposition: entry.disposition,
        reason: 'cancellation-in-flight',
        detail: 'awaiting the host confirmation that releases the leases',
        blockedBy: [],
      };
    default:
      return null;
  }
}

export function progress(input: ProgressInput): ProgressReport {
  const { graph, facts, state, now, round } = input;
  const stalls: StallEntry[] = [];

  for (const entry of round.frontier) {
    // Read all current claims, including this round's new ones and multiple attempts of a node.
    const claims = state.claims.filter((claim) => claim.binding.nodeId === entry.nodeId).sort(compareClaims);
    let liveClaim = false;
    for (const claim of claims) {
      const activity = classifyClaim(claim, state.leases, now);
      if (activity === 'live') {
        liveClaim = true;
        continue;
      }
      stalls.push({
        nodeId: entry.nodeId,
        disposition: entry.disposition,
        reason: activity,
        detail: `claim ${claim.claimId} (${entry.nodeId},${claim.binding.attemptOrdinal},${claim.binding.epoch}) holds no live lease at ${now}; reclaim explicitly, not counted as in-flight work`,
        blockedBy: [entry.nodeId],
      });
    }
    if (claims.length > 0 && !liveClaim && (entry.disposition === 'claimed' || entry.disposition === 'active')) continue;
    if (entry.disposition === 'waiting') {
      stalls.push(waitingStall(graph, facts, entry));
      continue;
    }
    const stuck = stateStall(entry, liveClaim);
    if (stuck !== null) stalls.push(stuck);
  }

  const inFlight = liveAttemptClaims(round.frontier, state, now).length > 0;
  const status: ProgressStatus =
    round.frontier.length === 0 ? 'complete' : inFlight ? 'dispatchable' : 'stalled';

  return {
    status,
    frontier: round.frontier,
    stalls,
    deferred: round.decisions.filter((decision) => decision.verdict === 'defer'),
  };
}
