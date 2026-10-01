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
 *   - `lease-expired` — a claim holds no live lease at the injected instant (the worker was claimed
 *     and leased, then died without a receipt). The claim is dead weight; the round must not count
 *     it as in-flight work, or the graph would wait on a corpse forever.
 *
 * `blockedBy` is the unfiltered list of blockers that terminated — failed *and* cancelled — so a
 * cancelled branch cannot quietly vanish from the report (`SEMANTICS.md §5.3`, `SCHEMAS.md` S20).
 */
import { hasDeclaredCover } from '../graph/index.js';
import type { CompiledGraph, NodeFacts, NodeState } from '../graph/index.js';
import type { Instant } from '../../protocol/index.js';
import { joinGate } from './fanin.js';
import { liveGrants } from './lease.js';
import type {
  Claim,
  DispatchRound,
  FrontierEntry,
  LeaseTable,
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
  facts: NodeFacts,
  detail: string,
  subject: readonly string[],
): WaitReason {
  const gone = subject.filter((nodeId) => terminated(facts.states.get(nodeId)));
  const hard = gone.filter((nodeId) => !hasDeclaredCover(graph.edgesTo(nodeId), nodeId));
  if (hard.length > 0) return { reason: 'blocked-by-terminated-worker', detail, blockedBy: gone };
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
        facts,
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
    ...classify(graph, facts, `upstream ${gap.node} has not succeeded (gap ${gap.kind})`, [gap.node]),
  };
}

/** Owned a lease, and none of them is live at `now`: the claim's worker is gone. */
function hasExpiredLease(claim: Claim, table: LeaseTable, now: Instant): boolean {
  const owned = table.grants.filter((grant) => grant.ownerClaimId === claim.claimId);
  if (owned.length === 0) return false;
  return !liveGrants(table, now).some((grant) => grant.ownerClaimId === claim.claimId);
}

function stateStall(entry: FrontierEntry): StallEntry | null {
  switch (entry.disposition) {
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
  const expired = new Set<string>();

  for (const entry of round.frontier) {
    if (entry.claim !== null && hasExpiredLease(entry.claim, state.leases, now)) {
      expired.add(entry.nodeId);
      stalls.push({
        nodeId: entry.nodeId,
        disposition: entry.disposition,
        reason: 'lease-expired',
        detail: `claim ${entry.claim.claimId} holds no live lease at ${now}; not counted as in-flight work`,
        blockedBy: [],
      });
      continue;
    }
    if (entry.disposition === 'waiting') {
      stalls.push(waitingStall(graph, facts, entry));
      continue;
    }
    const stuck = stateStall(entry);
    if (stuck !== null) stalls.push(stuck);
  }

  const dispatched = round.decisions.some((decision) => decision.verdict === 'dispatch');
  const inFlight = round.frontier.some(
    (entry) => (entry.disposition === 'claimed' || entry.disposition === 'active') && !expired.has(entry.nodeId),
  );
  const status: ProgressStatus =
    round.frontier.length === 0 ? 'complete' : dispatched || inFlight ? 'dispatchable' : 'stalled';

  return {
    status,
    frontier: round.frontier,
    stalls,
    deferred: round.decisions.filter((decision) => decision.verdict === 'defer'),
  };
}
