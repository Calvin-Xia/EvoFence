/**
 * Starvation control for the frontier order.
 *
 * A resource race has a loser every round, and "declaration order first" would let the same node
 * lose forever. The order is therefore
 *
 *   1. how many consecutive rounds the node was passed over (descending),
 *   2. how many times it has been dispatched (ascending),
 *   3. declaration order (ascending) — the deterministic tiebreak.
 *
 * All three inputs are values the round already produces, so the resulting order is explainable
 * from the report rather than from hidden state, and identical inputs always give the same order
 * (`I07`).
 */
import type { FairnessState, FrontierEntry } from './types.js';

export function emptyFairness(): FairnessState {
  return { deferStreak: {}, dispatches: {} };
}

function streakOf(fairness: FairnessState, nodeId: string): number {
  return fairness.deferStreak[nodeId] ?? 0;
}

function dispatchesOf(fairness: FairnessState, nodeId: string): number {
  return fairness.dispatches[nodeId] ?? 0;
}

/** Deterministic starvation-free order for the nodes that may start this round. */
export function orderFrontier(
  entries: readonly FrontierEntry[],
  fairness: FairnessState,
  declarationOrder: readonly string[],
): readonly FrontierEntry[] {
  const rank = new Map(declarationOrder.map((nodeId, index) => [nodeId, index]));
  return [...entries].sort((left, right) => {
    const streak = streakOf(fairness, right.nodeId) - streakOf(fairness, left.nodeId);
    if (streak !== 0) return streak;
    const dispatches = dispatchesOf(fairness, left.nodeId) - dispatchesOf(fairness, right.nodeId);
    if (dispatches !== 0) return dispatches;
    return (rank.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER);
  });
}

/** Fold one round's outcome back into the counters. */
export function advanceFairness(
  fairness: FairnessState,
  dispatched: readonly string[],
  deferred: readonly string[],
): FairnessState {
  const deferStreak: Record<string, number> = { ...fairness.deferStreak };
  const dispatches: Record<string, number> = { ...fairness.dispatches };
  for (const nodeId of deferred) deferStreak[nodeId] = streakOf(fairness, nodeId) + 1;
  for (const nodeId of dispatched) {
    deferStreak[nodeId] = 0;
    dispatches[nodeId] = dispatchesOf(fairness, nodeId) + 1;
  }
  return { deferStreak, dispatches };
}
