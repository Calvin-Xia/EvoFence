/**
 * The ready frontier: every node still in play this round, with the one reason it cannot start.
 *
 * Readiness itself is the graph lane's judgement — `evaluateReadiness` reuses `decide`, so B1/B2/B3
 * have a single implementation and this lane never re-derives "is this upstream satisfied". What
 * this module adds is the part the graph does not know about: whether the node already owns a
 * claim, whether its journal state has moved on (`leased`/`running`/`verifying`/`unknown`), and
 * whether it stopped for good (`failed`/`cancelled`).
 *
 * Two deliberate inclusions:
 *
 *   - A `failed` node stays in the frontier as `halted`. It is not dispatchable, but dropping it
 *     would erase the failure from the report — the same rule `SEMANTICS.md §5.3` applies to join
 *     branch reports.
 *   - `succeeded`, `cancelled` and abandoned nodes are *settled* and leave the frontier. A
 *     cancelled branch is not lost by this: it still appears in every join report that requires it
 *     (`progress.ts` cites those branch ids verbatim).
 */
import { evaluateReadiness } from '../graph/index.js';
import type { CompiledGraph, NodeFacts, NodeState, Readiness } from '../graph/index.js';
import { findClaim } from './claim.js';
import { joinGate } from './fanin.js';
import type { Claim, FrontierDisposition, FrontierEntry, SchedulerState } from './types.js';

function settled(state: NodeState | null): boolean {
  return state === 'succeeded' || state === 'cancelled';
}

function dispositionOf(state: NodeState | null, readiness: Readiness): FrontierDisposition {
  switch (state) {
    case 'leased':
    case 'running':
    case 'verifying':
      return 'active';
    case 'failed':
      return 'halted';
    case 'unknown':
      return 'unknown';
    case 'cancelling':
      return 'cancelling';
    case 'waiting':
      return 'waiting';
    default:
      // `pending`/`ready` and "never reported": readiness decides, and its `failed` answer is the
      // B2 shape (an abandoned upstream) that the journal is about to write as `failed`.
      if (readiness.state === 'ready') return 'dispatchable';
      return readiness.state === 'waiting' ? 'waiting' : 'halted';
  }
}

export function computeFrontier(
  graph: CompiledGraph,
  facts: NodeFacts,
  state: SchedulerState,
): readonly FrontierEntry[] {
  const entries: FrontierEntry[] = [];
  for (const node of graph.spec.nodes) {
    if (graph.isAbandoned(node.nodeId)) continue;
    const nodeState = facts.states.get(node.nodeId) ?? null;
    if (settled(nodeState)) continue;
    const claim: Claim | null = findClaim(state.claims, node.nodeId) ?? null;
    // Optional branch facts are valid for non-join graphs, but not for an outstanding join.
    if (node.kind === 'join') joinGate(graph, facts, node.nodeId);
    const readiness = evaluateReadiness(graph, node.nodeId, facts);
    const disposition = dispositionOf(nodeState, readiness);
    entries.push({
      nodeId: node.nodeId,
      kind: node.kind,
      state: nodeState,
      disposition: claim !== null && (nodeState === null || nodeState === 'pending' || nodeState === 'ready')
        ? 'claimed' : disposition,
      readiness,
      claim,
    });
  }
  return entries;
}

/** Nodes ready to start, in declaration order; the fairness order is applied afterwards. */
export function dispatchableEntries(frontier: readonly FrontierEntry[]): readonly FrontierEntry[] {
  return frontier.filter((entry) => entry.disposition === 'dispatchable');
}
