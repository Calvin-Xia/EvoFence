/**
 * The patch transaction (`SEMANTICS.md §5.1`/`§5.2`).
 *
 * A `GraphPatch` is committed whole or not at all: revision CAS, active-node protection, the eleven
 * atomic checks, and the abandonment rules all run before a new revision is published. The two
 * protected things are exactly the DoD: inputs of a `leased`/`running`/`verifying`/`unknown`/
 * `cancelling` node cannot change in place (change the node, or rebind its `data` edge, and the
 * transaction is refused), and a branch can only leave by being abandoned — with a reason — never by
 * deleting its evidence.
 *
 * `typedEdges` is the revision's **complete** edge set (the frozen field is "显式完整新边集"), so a
 * patch that omits an edge removes it; there is no implicit carry-over.
 */
import { decodeRuntimeVersion, fail } from '../../protocol/index.js';
import type { ErrorEnvelope } from '../../protocol/index.js';
import type {
  CompiledGraph,
  EdgeSpec,
  GraphAuthority,
  GraphContext,
  GraphDiff,
  GraphIssue,
  GraphPatch,
  GraphSpec,
  NodeSpec,
  NodeState,
} from './types.js';
import { MUTATION_LOCKED_STATES } from './types.js';
import { checkAuthority } from './abandonment.js';
import { buildGraph } from './compile.js';
import { joinNodeIds } from './structural.js';
import { validateGraph } from './validate.js';
import { sameSchema } from './artifacts.js';

/** A node's current state, so the patch can classify it against `MUTATION_LOCKED_STATES`. */
export interface ActiveNode {
  readonly nodeId: string;
  readonly state: NodeState;
}

/** The outside facts a patch needs: its authority ceiling, plus the evidence it may not delete. */
export interface PatchContext extends GraphContext {
  readonly authority: GraphAuthority;
  /** Nodes currently in a mutation-locked state (`SEMANTICS.md §5.2`). */
  readonly activeNodes?: readonly ActiveNode[];
  /** Nodes that produced artifacts, decisions or failures. */
  readonly evidenceNodeIds?: readonly string[];
  /** `authorityRef` values allowed to abandon a contract-required branch. */
  readonly contractAuthorityRefs?: readonly string[];
}

export type PatchResult =
  | {
      readonly ok: true;
      readonly graph: CompiledGraph;
      readonly fromRevision: number;
      readonly toRevision: number;
      readonly diff: GraphDiff;
    }
  | { readonly ok: false; readonly error: ErrorEnvelope };

function refuse(code: GraphIssue['code'], message: string): PatchResult {
  return { ok: false, error: fail(code, message) };
}

function edgeBindingChanged(edge: EdgeSpec, previous: EdgeSpec | undefined): boolean {
  if (edge.type !== 'data') return false;
  if (previous === undefined) return edge.artifact !== null;
  if (edge.expect === null || previous.expect === null) return edge.expect !== previous.expect;
  if (!sameSchema(edge.expect, previous.expect)) return true;
  if (edge.artifact === null || previous.artifact === null) return edge.artifact !== previous.artifact;
  return edge.artifact.digest !== previous.artifact.digest || !sameSchema(edge.artifact.schema, previous.artifact.schema);
}

interface Candidate {
  readonly ok: true;
  readonly spec: GraphSpec;
}
type CandidateResult = Candidate | { readonly ok: false; readonly error: ErrorEnvelope };

/** Build the next `GraphSpec` from `patch`. Structural reference errors abort here. */
function buildCandidate(current: CompiledGraph, patch: GraphPatch): CandidateResult {
  const nodes = new Map<string, NodeSpec>(current.nodes);
  for (const removed of patch.removals) {
    if (!nodes.delete(removed)) return { ok: false, error: fail('EFK_GRAPH_REFERENCE_INVALID', `removal names node ${removed} that does not exist`) };
  }
  for (const change of patch.changes) {
    if (!nodes.has(change.nodeId)) return { ok: false, error: fail('EFK_GRAPH_REFERENCE_INVALID', `change names node ${change.nodeId} that does not exist`) };
    nodes.set(change.nodeId, change);
  }
  for (const add of patch.adds) {
    if (nodes.has(add.nodeId)) return { ok: false, error: fail('EFK_GRAPH_REFERENCE_INVALID', `add names node ${add.nodeId} that already exists`) };
    nodes.set(add.nodeId, add);
  }

  if (nodes.size === 0) {
    // The candidate is assembled, not decoded, so the schema's `nodes.minItems: 1` is re-applied here.
    return { ok: false, error: fail('EFK_SCHEMA_INVALID', 'a graph patch cannot remove every node') };
  }

  const spec: GraphSpec = {
    protocol: patch.protocol,
    graphId: current.graphId,
    revision: patch.expectedRevision + 1,
    taskContractRef: current.spec.taskContractRef,
    nodes: [...nodes.values()],
    typedEdges: patch.typedEdges,
    requiredJoins: [],
    resourcePolicy: current.spec.resourcePolicy,
    graphLimits: current.spec.graphLimits,
    abandonedBranches: patch.abandonedBranches,
  };
  const withJoins: GraphSpec = { ...spec, requiredJoins: joinNodeIds(spec) };
  return { ok: true, spec: withJoins };
}

/** Structural diff by id; edge equality is structural on decoder-shaped values. */
export function diffGraphs(from: GraphSpec, to: GraphSpec): GraphDiff {
  const before = new Map(from.nodes.map((node) => [node.nodeId, JSON.stringify(node)]));
  const after = new Map(to.nodes.map((node) => [node.nodeId, JSON.stringify(node)]));
  const edgesBefore = new Map(from.typedEdges.map((edge) => [edge.edgeId, JSON.stringify(edge)]));
  const edgesAfter = new Map(to.typedEdges.map((edge) => [edge.edgeId, JSON.stringify(edge)]));

  return {
    addedNodes: to.nodes.filter((node) => !before.has(node.nodeId)).map((node) => node.nodeId),
    removedNodes: from.nodes.filter((node) => !after.has(node.nodeId)).map((node) => node.nodeId),
    changedNodes: to.nodes.filter((node) => before.has(node.nodeId) && before.get(node.nodeId) !== after.get(node.nodeId)).map((node) => node.nodeId),
    addedEdges: to.typedEdges.filter((edge) => !edgesBefore.has(edge.edgeId)).map((edge) => edge.edgeId),
    removedEdges: from.typedEdges.filter((edge) => !edgesAfter.has(edge.edgeId)).map((edge) => edge.edgeId),
    changedEdges: to.typedEdges.filter((edge) => edgesBefore.has(edge.edgeId) && edgesBefore.get(edge.edgeId) !== edgesAfter.get(edge.edgeId)).map((edge) => edge.edgeId),
  };
}

/** Commit a patch atomically, or return the one refusal that stopped it. */
export function applyGraphPatch(current: CompiledGraph, patch: GraphPatch, context: PatchContext): PatchResult {
  const version = decodeRuntimeVersion(patch.protocol);
  if (!version.ok) return version;

  if (patch.graphId !== current.graphId) {
    return refuse('EFK_GRAPH_REFERENCE_INVALID', `patch targets ${patch.graphId}, not ${current.graphId}`);
  }
  if (patch.expectedRevision !== current.revision) {
    return refuse('EFK_REVISION_CONFLICT', `expectedRevision ${patch.expectedRevision} != graph revision ${current.revision}`);
  }

  const locked = new Set(
    (context.activeNodes ?? [])
      .filter((active) => MUTATION_LOCKED_STATES.includes(active.state))
      .map((active) => active.nodeId),
  );
  for (const nodeId of [...patch.changes.map((node) => node.nodeId), ...patch.removals]) {
    if (locked.has(nodeId)) {
      return refuse('EFK_GRAPH_ACTIVE_NODE_MUTATION', `node ${nodeId} is mid-flight and cannot be changed in place`);
    }
  }
  for (const edge of patch.typedEdges) {
    if (!locked.has(edge.to)) continue;
    const previous = current.edges.find((candidate) => candidate.edgeId === edge.edgeId);
    if (edgeBindingChanged(edge, previous)) {
      return refuse('EFK_GRAPH_ACTIVE_NODE_MUTATION', `data input of mid-flight node ${edge.to} cannot change in place`);
    }
  }

  const candidate = buildCandidate(current, patch);
  if (!candidate.ok) return candidate;

  const issues = [
    ...validateGraph(candidate.spec, {
      contractBranches: context.contractBranches,
      evidenceNodeIds: context.evidenceNodeIds,
      contractAuthorityRefs: context.contractAuthorityRefs,
      removedNodeIds: patch.removals,
      priorAbandonedNodeIds: [...current.abandoned.keys()],
    }),
    ...checkAuthority(patch, candidate.spec, context.authority),
  ].sort((left, right) => left.check - right.check);

  const first = issues[0];
  if (first !== undefined) return refuse(first.code, first.message);

  return {
    ok: true,
    graph: buildGraph(candidate.spec),
    fromRevision: current.revision,
    toRevision: candidate.spec.revision,
    diff: diffGraphs(current.spec, candidate.spec),
  };
}
