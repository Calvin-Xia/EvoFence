/**
 * Cyclicity checks: the dependency projection (3) and control-loop boundedness (9).
 *
 * Check 3 is the hard one — `dependency ∪ data` must be acyclic, and the point of computing it over
 * the union is that a `data` edge is as much a dependency as a `dependency` edge, so an "obvious"
 * DAG plus one back-pointing `data` edge is still a rejection.
 *
 * Check 9 accepts bounded control cycles: a control cycle is legal when every participant is inside
 * a declared `loop` body (loops are the only explicit cycle construct, `SEMANTICS.md §4`) or when
 * every internal edge is a `repair`/`fallback` that carries an `maxAttempts` bound.
 */
import type { EdgeSpec, GraphIssue, GraphSpec } from './types.js';
import { DEPENDENCY_PROJECTION, ROUTING_EDGES } from './types.js';

/** Tarjan's SCC, iterative so a deep chain cannot overflow the call stack. */
function stronglyConnected(nodeIds: readonly string[], edges: readonly (readonly [string, string])[]): readonly (readonly string[])[] {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const [from, to] of edges) adjacency.get(from)?.push(to);

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let next = 0;

  for (const root of nodeIds) {
    if (index.has(root)) continue;
    index.set(root, next);
    low.set(root, next);
    next += 1;
    stack.push(root);
    onStack.add(root);
    const work: { node: string; cursor: number }[] = [{ node: root, cursor: 0 }];

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbours = adjacency.get(frame.node) ?? [];
      if (frame.cursor < neighbours.length) {
        const neighbour = neighbours[frame.cursor];
        frame.cursor += 1;
        if (!index.has(neighbour)) {
          index.set(neighbour, next);
          low.set(neighbour, next);
          next += 1;
          stack.push(neighbour);
          onStack.add(neighbour);
          work.push({ node: neighbour, cursor: 0 });
        } else if (onStack.has(neighbour)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(neighbour) ?? 0));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1];
        low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          component.push(member);
          if (member === frame.node) break;
        }
        components.push(component);
      }
    }
  }
  return components;
}

/** Components that contain a real cycle: size > 1, or a node with a self-edge. */
function cyclicComponents(nodeIds: readonly string[], edges: readonly (readonly [string, string])[]): readonly (readonly string[])[] {
  const selfLoops = new Set(edges.filter(([from, to]) => from === to).map(([from]) => from));
  return stronglyConnected(nodeIds, edges).filter(
    (component) => component.length > 1 || component.some((member) => selfLoops.has(member)),
  );
}

function pairs(edges: readonly EdgeSpec[], types: readonly EdgeSpec['type'][]): readonly (readonly [string, string])[] {
  return edges.filter((edge) => types.includes(edge.type)).map((edge) => [edge.from, edge.to] as const);
}

/** Check 3 — `dependency ∪ data` must be acyclic. */
export function checkDependencyAcyclic(spec: GraphSpec): readonly GraphIssue[] {
  const nodeIds = spec.nodes.map((node) => node.nodeId);
  const cycles = cyclicComponents(nodeIds, pairs(spec.typedEdges, DEPENDENCY_PROJECTION));
  return cycles.map((component) => ({
    check: 3,
    code: 'EFK_GRAPH_DEPENDENCY_CYCLE' as const,
    message: `dependency projection has a cycle: ${component.slice().sort().join(' -> ')}`,
  }));
}

/** Nodes inside an explicit loop: a declared loop body, or the node that hosts the loop. */
function loopParticipants(spec: GraphSpec): ReadonlySet<string> {
  const participants = new Set<string>();
  for (const node of spec.nodes) {
    if (node.loop === null) continue;
    participants.add(node.nodeId);
    for (const bodyId of node.loop.bodyNodeIds) participants.add(bodyId);
  }
  return participants;
}

/** Check 9 — every reachable control cycle is bounded (inside a loop, or all repairable). */
export function checkTermination(spec: GraphSpec): readonly GraphIssue[] {
  const nodeIds = spec.nodes.map((node) => node.nodeId);
  const control = spec.typedEdges.filter((edge) => ROUTING_EDGES.includes(edge.type));
  const cycles = cyclicComponents(nodeIds, control.map((edge) => [edge.from, edge.to] as const));
  const participants = loopParticipants(spec);
  const issues: GraphIssue[] = [];

  for (const component of cycles) {
    const members = new Set(component);
    const internal = control.filter((edge) => members.has(edge.from) && members.has(edge.to));
    const allRepairable = internal.every((edge) => edge.type === 'repair' || edge.type === 'fallback');
    const allInLoop = component.every((member) => participants.has(member));
    if (!allRepairable && !allInLoop) {
      issues.push({
        check: 9,
        code: 'EFK_GRAPH_NON_TERMINATING',
        message: `control cycle has no bound: ${component.slice().sort().join(' -> ')}`,
      });
    }
  }
  return issues;
}
