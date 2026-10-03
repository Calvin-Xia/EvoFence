/**
 * The observable edge predicates of `SEMANTICS.md §3.0.1`, in one place.
 *
 * `decide`, the validators and readiness all ask the *same* questions of the same edges — that is
 * the point of the rev6 split of `hasRoutingOutgoing` / `hasBlockingConsumer` / `hasRealConsumer`.
 * Re-implementing "which edges count" per caller is exactly how the rules drift apart, so it is
 * implemented once here.
 */
import { evalPredicate, type PredicateEnv } from './predicate.js';
import {
  BLOCKING_EDGES,
  ROUTING_EDGES,
  type EdgeSpec,
  type EdgeType,
  type Predicate,
} from './types.js';

export function routingOutgoing(edges: readonly EdgeSpec[]): readonly EdgeSpec[] {
  return edges.filter((edge) => ROUTING_EDGES.includes(edge.type));
}

export function blockingOutgoing(edges: readonly EdgeSpec[]): readonly EdgeSpec[] {
  return edges.filter((edge) => BLOCKING_EDGES.includes(edge.type));
}

/** F5: the node has at least one `route`/`repair`/`fallback` out-edge. */
export function hasRoutingOutgoing(edges: readonly EdgeSpec[]): boolean {
  return edges.some((edge) => ROUTING_EDGES.includes(edge.type));
}

/** F6: the node is a blocking producer for at least one consumer. */
export function hasBlockingConsumer(edges: readonly EdgeSpec[]): boolean {
  return edges.some((edge) => BLOCKING_EDGES.includes(edge.type));
}

/** R4's predicate: `hasRoutingOutgoing ∨ hasBlockingConsumer`. Provenance does not count. */
export function hasRealConsumer(edges: readonly EdgeSpec[]): boolean {
  return hasRoutingOutgoing(edges) || hasBlockingConsumer(edges);
}

/** F7: some `repair`/`fallback` edge targets `nodeId`, so it can still receive a new attempt. */
export function hasDeclaredCover(edgesTo: readonly EdgeSpec[], nodeId: string): boolean {
  return edgesTo.some((edge) => edge.to === nodeId && (edge.type === 'repair' || edge.type === 'fallback'));
}

/** `when` is guaranteed non-null for `route`/`repair`/`fallback` by the edge shape gate. */
export function whenMatches(edge: EdgeSpec, env: PredicateEnv): boolean {
  const when: Predicate | null = edge.when;
  return when !== null && evalPredicate(when, env);
}

/** The first edge of `type` whose `when` matches, in declaration order (declaration order is truth). */
export function matchingOutgoing(
  edges: readonly EdgeSpec[],
  type: EdgeType,
  env: PredicateEnv,
): EdgeSpec | undefined {
  return edges.find((edge) => edge.type === type && whenMatches(edge, env));
}

/** Re-export so callers do not reach into `protocol` just for the decoded edge shape. */
export type Edge = EdgeSpec;
