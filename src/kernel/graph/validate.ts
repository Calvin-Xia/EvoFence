/**
 * The graph acceptance gate: the eleven atomic checks of `SEMANTICS.md §5.1`, composed in one
 * place and returned in check order.
 *
 *  1 schema/version      — enforced by `compileGraph` (protocol decode + version gate)
 *  2 references/shape    — `checkReferences`
 *  3 dependency acyclic  — `checkDependencyAcyclic`
 *  4 data consumable     — `checkDataConsumable`
 *  5 required fan-in     — `checkFanIn`
 *  6 authority scope     — `checkAuthority` (patch path; see `applyGraphPatch`)
 *  7 resource conflict   — `checkResources`
 *  8 attempt/loop bounds — `checkBounds`
 *  9 reachable bound     — `checkTermination`
 * 10 R4 terminal        — `checkTerminalRequired`
 * 11 R5 abandonment     — `checkAbandonment`
 *
 * An empty result means the graph is accepted. The first issue (lowest check, then declaration
 * order) is the one a transaction reports, so refusals are deterministic.
 */
import type { GraphContext, GraphIssue, GraphSpec, NodeSpec } from './types.js';
import { dataEdgeIssues } from './artifacts.js';
import { checkAbandonment, type PatchContext } from './abandonment.js';
import { checkBounds, checkTerminalRequired } from './bounds.js';
import { checkDependencyAcyclic, checkTermination } from './cycle.js';
import { checkFanIn, checkReferences, checkResources } from './structural.js';

/** Check 4 — every `data` edge's expect selector resolves against its producer. */
export function checkDataConsumable(spec: GraphSpec): readonly GraphIssue[] {
  const producers = new Map<string, NodeSpec>();
  for (const node of spec.nodes) producers.set(node.nodeId, node);
  const issues: GraphIssue[] = [];
  for (const edge of spec.typedEdges) {
    if (edge.type !== 'data') continue;
    const producer = producers.get(edge.from);
    if (producer === undefined) continue;
    issues.push(...dataEdgeIssues(edge, producer));
  }
  return issues;
}

/** Runs checks 2–5 and 7–11. Version (1) and patch authority (6) are transaction boundaries. */
export function validateGraph(spec: GraphSpec, context: PatchContext = {}): readonly GraphIssue[] {
  const issues: GraphIssue[] = [
    ...checkReferences(spec),
    ...checkDependencyAcyclic(spec),
    ...checkDataConsumable(spec),
    ...checkFanIn(spec, context),
    ...checkResources(spec),
    ...checkBounds(spec),
    ...checkTermination(spec),
    ...checkTerminalRequired(spec),
    ...checkAbandonment(spec, context),
  ];
  return issues.sort((left, right) => left.check - right.check);
}

/** The single refusal a transaction reports: the lowest-numbered check, message intact. */
export function firstIssue(issues: readonly GraphIssue[]): GraphIssue | undefined {
  return issues[0];
}

export type { GraphContext };
