/**
 * Readiness (`SEMANTICS.md §2.2`, `§3.1`, `§3.2`).
 *
 * Answers one question: can `nodeId` be `ready` now, and if not, what is it waiting on. It reuses
 * `decide` for every "upstream did not succeed" branch, so B1/B2/B3 have exactly one implementation.
 *
 * Resource readiness is the subtle part. `ready` already includes "all `exclusive` reservable and
 * `shared` quota available"; what keeps a node out of `ready` is a resource with **no releasable
 * path** (`maxHolders: 0`, or a holder that was abandoned). Plain contention — a resource currently
 * held by someone else — stays `ready` and is rescheduled, so it is not a `waiting` gap at all.
 */
import { consumable } from './artifacts.js';
import { decide, evaluateJoin, type BranchFacts } from './decide.js';
import type { ArtifactRef, CompiledGraph, DecideRule, Gap, NodeState } from './types.js';

/** Current holder counts for one named resource. `abandoned` holders have no release path. */
export interface HolderCount {
  readonly active: number;
  readonly abandoned: number;
}

export interface NodeFacts {
  /** Current state per node id; an absent node has not reported yet. */
  readonly states: ReadonlyMap<string, NodeState>;
  /** Latest produced artifact per producer node id. */
  readonly artifacts: ReadonlyMap<string, ArtifactRef | null>;
  /** Current holders per resource id. */
  readonly holders: ReadonlyMap<string, HolderCount>;
  /** Journal sequence the facts were observed at. */
  readonly seq: number;
  /** Branch facts for join evaluation; absent branches count as missing. */
  readonly branches?: ReadonlyMap<string, BranchFacts>;
}

export type Readiness =
  | { readonly state: 'ready' }
  | { readonly state: 'waiting'; readonly gap: Gap }
  | { readonly state: 'failed'; readonly reason: string; readonly rule: DecideRule };

const READY: Readiness = { state: 'ready' };

function failed(reason: string, rule: DecideRule): Readiness {
  return { state: 'failed', reason, rule };
}

function waiting(kind: Gap['kind'], node: string, at: number): Readiness {
  return { state: 'waiting', gap: { kind, node, at } };
}

function joinReadiness(graph: CompiledGraph, joinId: string, facts: NodeFacts): Readiness {
  const evaluation = evaluateJoin(graph, joinId, {
    seq: facts.seq,
    branches: facts.branches ?? new Map<string, BranchFacts>(),
  });
  if (evaluation.violation !== null) return failed('invariant', 'INV');
  if (evaluation.status === 'failed') return failed('upstream-abandoned', 'B2');
  if (evaluation.status === 'waiting') return waiting('join-incomplete', joinId, facts.seq);
  return READY;
}

/** Compute readiness for one node from the current facts. Pure; takes no clock and no I/O. */
export function evaluateReadiness(graph: CompiledGraph, nodeId: string, facts: NodeFacts): Readiness {
  const node = graph.node(nodeId);
  if (node === undefined) return failed('unknown-node', 'INV');
  if (node.kind === 'join') return joinReadiness(graph, nodeId, facts);

  for (const edge of graph.edgesTo(nodeId)) {
    if (edge.type !== 'dependency' && edge.type !== 'data') continue;
    const upstream = facts.states.get(edge.from) ?? null;
    if (upstream !== 'succeeded') {
      const result = decide(graph, { kind: 'upstream-terminal', nodeId, upstreamId: edge.from, seq: facts.seq });
      if (result.rule === 'B2') return failed(result.reason ?? 'upstream-abandoned', 'B2');
      return waiting('upstream-terminal', edge.from, facts.seq);
    }
    if (edge.type === 'data' && !consumable(edge, facts.artifacts.get(edge.from) ?? null)) {
      return waiting('input-artifact-stale', edge.from, facts.seq);
    }
  }

  const declared = [...node.resources.exclusive, ...node.resources.shared];
  for (const resourceId of declared) {
    const policy = graph.resourcePolicy.get(resourceId);
    if (policy === undefined) return failed('resource-policy-missing', 'INV');
    const holders = facts.holders.get(resourceId) ?? { active: 0, abandoned: 0 };
    if (policy.maxHolders === 0 || holders.abandoned > 0) {
      return waiting('resource-unavailable', resourceId, facts.seq);
    }
  }
  return READY;
}
