import { parseDocument } from 'yaml';
import { compileGraph } from '../../kernel/graph/index.js';
import type { EdgeSpec, GraphSpec } from '../../kernel/graph/index.js';
import { decode } from '../../protocol/index.js';
import { lossesFor } from './loss.js';
import { list, object, validateSnapshot } from './mapping.js';
import { boundary, checkedPath, readText, reject } from './types.js';
import type { BridgeResult, FileScope, ImportedDelivery, RuntimeBindings } from './types.js';

function uniqueIds(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) reject('EFK_GRAPH_REFERENCE_INVALID', 'duplicate SP identifiers');
  for (const id of ids) {
    if (!decode('Id', id).ok) reject('EFK_SCHEMA_INVALID', 'invalid SP identifier');
  }
}
export function translateDelivery(value: unknown, configuration: RuntimeBindings): ImportedDelivery {
  const delivery = validateSnapshot(value);
  const bindings = structuredClone(configuration);
  object(bindings, ['graph', 'nodes', 'fallbacks'], ['graph', 'nodes', 'fallbacks']);
  object(bindings.graph, ['protocol', 'graphId', 'revision', 'taskContractRef', 'requiredJoins', 'resourcePolicy', 'graphLimits', 'abandonedBranches'],
    ['protocol', 'graphId', 'revision', 'taskContractRef', 'requiredJoins', 'resourcePolicy', 'graphLimits', 'abandonedBranches']);
  list(bindings.nodes); list(bindings.fallbacks);
  for (const node of bindings.nodes) {
    const decoded = decode('NodeSpec', node);
    if (!decoded.ok) reject(decoded.error.code, decoded.error.message);
  }
  for (const fallback of bindings.fallbacks) {
    object(fallback, ['edgeId', 'when', 'maxAttempts'], ['edgeId', 'when', 'maxAttempts']);
  }
  const tasks = delivery.nodes.filter(node => node.type === 'task');
  for (const key of ['nodes', 'edges'] as const) {
    if (Object.hasOwn(delivery.graph, key) && (delivery.graph[key] as unknown[]).length !== delivery[key].length) {
      reject('EFK_GRAPH_REFERENCE_INVALID', 'explicit manifest and supplied record counts must agree');
    }
  }
  uniqueIds(delivery.nodes.map(node => node.id as string));
  uniqueIds(delivery.edges.map(edge => edge.id as string));
  const byId = new Map(delivery.nodes.map(node => [node.id, node]));
  if (tasks.length === 0 || differenceIds(tasks.map(node => node.id as string), bindings.nodes.map(node => node.nodeId))) {
    reject('EFK_GRAPH_REFERENCE_INVALID', 'every task requires exactly one explicit runtime NodeSpec');
  }
  if (bindings.graph.graphId !== delivery.graph.id) reject('EFK_GRAPH_REFERENCE_INVALID', 'runtime graph identity must match the explicit delivery snapshot');
  const fallbackIds = delivery.edges.filter(edge => edge.type === 'fallback').map(edge => edge.id as string);
  if (differenceIds(fallbackIds, bindings.fallbacks.map(edge => edge.edgeId))) {
    reject('EFK_DEGRADATION_APPROVAL_REQUIRED', 'each fallback requires an explicit runtime predicate and attempt bound');
  }
  const fallbackBindings = new Map(bindings.fallbacks.map(edge => [edge.edgeId, edge]));
  const edges: EdgeSpec[] = [];
  for (const row of delivery.edges) {
    if (!byId.has(row.source) || !byId.has(row.target)) reject('EFK_GRAPH_REFERENCE_INVALID', 'SP edge endpoint does not exist');
    if (row.type !== 'depends_on' && row.type !== 'fallback') continue;
    if (byId.get(row.source)!.type !== 'task' || byId.get(row.target)!.type !== 'task') {
      reject('EFK_CAPABILITY_UNSUPPORTED', 'execution edges cannot claim knowledge vertices');
    }
    const edge: EdgeSpec = { edgeId: row.id as string, type: row.type === 'depends_on' ? 'dependency' : 'fallback',
      from: row.source as string, to: row.target as string, when: null, artifact: null, expect: null, maxAttempts: null, relation: null };
    if (row.type === 'fallback') {
      const explicit = fallbackBindings.get(edge.edgeId)!;
      if (explicit.when === null || explicit.maxAttempts === null) reject('EFK_DEGRADATION_APPROVAL_REQUIRED', 'fallback needs a predicate and bound');
      edges.push({ ...edge, when: explicit.when, maxAttempts: explicit.maxAttempts });
    } else edges.push(edge);
  }
  const graph: GraphSpec = { ...bindings.graph, nodes: bindings.nodes, typedEdges: edges };
  const compiled = compileGraph(graph);
  if (!compiled.ok) reject(compiled.error.code, compiled.error.message);
  return { classification: 'historical-delivery', executable: false,
    delivery: structuredClone(delivery), runtimeGraph: structuredClone(compiled.graph.spec), bindings,
    initialStates: tasks.map(node => ({ nodeId: node.id as string, state: 'pending' })), losses: lossesFor(delivery) };
}
function differenceIds(a: readonly string[], b: readonly string[]): boolean {
  return new Set(b).size !== b.length || a.length !== b.length || a.some(id => !b.includes(id));
}
export function importDelivery(value: unknown, bindings: RuntimeBindings): BridgeResult<ImportedDelivery> {
  return boundary(() => translateDelivery(value, bindings));
}
export function importDeliveryFile(file: string, scope: FileScope, bindings: RuntimeBindings): BridgeResult<ImportedDelivery> {
  return boundary(() => {
    const source = readText(checkedPath(file, scope, false));
    // Malformed external YAML is an input error; unexpected converter bugs still propagate.
    let value: unknown;
    try {
      const document = parseDocument(source, { uniqueKeys: true });
      if (document.errors.length > 0) reject('EFK_SCHEMA_INVALID', 'invalid SP snapshot YAML');
      value = document.toJS({ maxAliasCount: 100 });
    } catch { reject('EFK_SCHEMA_INVALID', 'invalid SP snapshot YAML or unsupported aliases'); }
    return translateDelivery(value, bindings);
  });
}
