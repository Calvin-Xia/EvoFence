/**
 * Compilation: turn a `GraphSpec` into the indexed, validated plan every other function reads.
 *
 * `compileGraph` is the boundary. It runs the protocol decode (schema shape), the version gate
 * (`decodeRuntimeVersion`, check 1), the nine pure checks of `validateGraph`, and only then builds
 * the index — a rejected graph never produces a plan. `buildGraph` is the pure indexer, kept
 * separate so the patch transaction can build a candidate and validate it before publishing.
 */
import { decode, decodeRuntimeVersion, fail } from '../../protocol/index.js';
import type {
  CompileResult,
  CompiledGraph,
  EdgeSpec,
  GraphContext,
  NodeSpec,
  GraphSpec,
} from './types.js';
import { validateGraph } from './validate.js';

function indexBy<T>(items: readonly T[], key: (item: T) => string): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const item of items) map.set(key(item), item);
  return map;
}

function groupEdges(edges: readonly EdgeSpec[], side: 'from' | 'to'): ReadonlyMap<string, readonly EdgeSpec[]> {
  const grouped = new Map<string, EdgeSpec[]>();
  for (const edge of edges) {
    const key = edge[side];
    const list = grouped.get(key);
    if (list === undefined) grouped.set(key, [edge]);
    else list.push(edge);
  }
  return grouped;
}

/** Pure indexer. Assumes the spec already passed acceptance; it does not re-check anything. */
export function buildGraph(spec: GraphSpec): CompiledGraph {
  const nodes = indexBy<NodeSpec>(spec.nodes, (node) => node.nodeId);
  const outgoing = groupEdges(spec.typedEdges, 'from');
  const incoming = groupEdges(spec.typedEdges, 'to');
  const abandoned = indexBy(spec.abandonedBranches, (branch) => branch.nodeId);
  const resourcePolicy = indexBy(spec.resourcePolicy, (entry) => entry.resourceId);
  return {
    graphId: spec.graphId,
    revision: spec.revision,
    spec,
    nodes,
    edges: spec.typedEdges,
    joinIds: spec.nodes.filter((node) => node.kind === 'join').map((node) => node.nodeId),
    abandoned,
    resourcePolicy,
    node: (nodeId) => nodes.get(nodeId),
    edgesFrom: (nodeId) => outgoing.get(nodeId) ?? [],
    edgesTo: (nodeId) => incoming.get(nodeId) ?? [],
    isAbandoned: (nodeId) => abandoned.has(nodeId),
  };
}

/** Decode, gate the version, validate all nine pure checks, then index. */
export function compileGraph(value: unknown, context: GraphContext = {}): CompileResult {
  const decoded = decode('GraphSpec', value);
  if (!decoded.ok) return decoded;
  // The codec validated the full shape against the frozen table; the cast only restores the nested
  // object types that `Decoded` renders as `Record<string, unknown>` (see `Refined` in types.ts).
  const spec = decoded.value as unknown as GraphSpec;
  const version = decodeRuntimeVersion(spec.protocol);
  if (!version.ok) return version;
  const issue = validateGraph(spec, context)[0];
  if (issue !== undefined) return { ok: false, error: fail(issue.code, issue.message) };
  return { ok: true, graph: buildGraph(spec) };
}
