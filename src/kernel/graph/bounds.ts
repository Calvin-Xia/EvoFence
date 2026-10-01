/**
 * Bounds (8) and the terminal requirement (10).
 *
 * Check 8 covers the boundary items the JSON schema cannot see from inside one node: the graph-level
 * `graphLimits` ceiling against node/loop/edge declarations, and the "unbounded repair" refusal —
 * a `repair`/`fallback` edge without `maxAttempts` would let a cycle retry forever, which is the
 * first half of the DoD. (`LoopSpec`'s own "at least two bound kinds" is enforced by the frozen
 * schema's `allOf`, so a raw `compileGraph` call rejects it before this runs; there is one gate.)
 *
 * Check 10 is R4: a node with no routing and no blocking out-edge produces work nobody consumes, so
 * it must be declared `terminal`. That is also the reason `decide`'s `INV` fallback is unreachable
 * on a compiled graph.
 */
import type { EdgeSpec, GraphIssue, GraphSpec } from './types.js';
import { hasRealConsumer } from './edges.js';

/** Check 8 — graph limits vs declared attempts/loops, and every repair route is bounded. */
export function checkBounds(spec: GraphSpec): readonly GraphIssue[] {
  const issues: GraphIssue[] = [];
  const bound = (message: string): void => {
    issues.push({ check: 8, code: 'EFK_GRAPH_BOUND_INVALID', message });
  };
  const limits = spec.graphLimits;
  if (spec.nodes.length > limits.maxNodes) bound(`graph has ${spec.nodes.length} nodes over maxNodes ${limits.maxNodes}`);

  for (const edge of spec.typedEdges) {
    if ((edge.type === 'repair' || edge.type === 'fallback') && edge.maxAttempts === null) {
      bound(`${edge.type} edge ${edge.edgeId} has no maxAttempts; unbounded repair is refused`);
    }
    if (edge.maxAttempts !== null && edge.maxAttempts > limits.maxAttempts) {
      bound(`edge ${edge.edgeId} maxAttempts ${edge.maxAttempts} exceeds graph maxAttempts ${limits.maxAttempts}`);
    }
  }

  for (const node of spec.nodes) {
    if (node.termination.maxAttempts > limits.maxAttempts) {
      bound(`node ${node.nodeId} maxAttempts ${node.termination.maxAttempts} exceeds graph maxAttempts ${limits.maxAttempts}`);
    }
    if (node.loop !== null && node.loop.maxDepth !== undefined && node.loop.maxDepth > limits.maxDepth) {
      bound(`node ${node.nodeId} loop maxDepth ${node.loop.maxDepth} exceeds graph maxDepth ${limits.maxDepth}`);
    }
  }
  return issues;
}

/**
 * Check 10 (R4) — `hasRealConsumer(N) = false` requires `terminal: true`. Provenance edges do not
 * count as consumers, which is why a provenance-only node must also be terminal.
 */
export function checkTerminalRequired(spec: GraphSpec): readonly GraphIssue[] {
  const outgoing = new Map<string, EdgeSpec[]>();
  for (const edge of spec.typedEdges) {
    const list = outgoing.get(edge.from);
    if (list === undefined) outgoing.set(edge.from, [edge]);
    else list.push(edge);
  }
  const issues: GraphIssue[] = [];
  for (const node of spec.nodes) {
    if (node.terminal) continue;
    if (!hasRealConsumer(outgoing.get(node.nodeId) ?? [])) {
      issues.push({
        check: 10,
        code: 'EFK_GRAPH_TERMINAL_REQUIRED',
        message: `node ${node.nodeId} has no real consumer and is not terminal`,
      });
    }
  }
  return issues;
}
