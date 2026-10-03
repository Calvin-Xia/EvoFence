/**
 * Structural atomic checks of `SEMANTICS.md §5.1`: references (2), required fan-in (5) and
 * resource policy (7).
 *
 * These are pure functions over the spec: they answer "is this graph well-formed as written"
 * without needing runtime state. Each returns every issue it finds, tagged with its §5.1 item, so a
 * caller can report all problems at once; `validateGraph` orders them and picks the first.
 */
import type { EdgeSpec, GraphContext, GraphIssue, GraphSpec } from './types.js';
import { validatePredicate } from './predicate.js';

const ROUTING_TYPES = new Set(['route', 'repair', 'fallback']);

function ref(message: string): GraphIssue {
  return { check: 2, code: 'EFK_GRAPH_REFERENCE_INVALID', message };
}

function join(message: string): GraphIssue {
  return { check: 5, code: 'EFK_GRAPH_JOIN_INCOMPLETE', message };
}

function shape(message: string): GraphIssue {
  return { check: 2, code: 'EFK_SCHEMA_INVALID', message };
}

/**
 * Check 2 — every id resolves, ids are unique, and each edge carries only the slots its type owns
 * (S23: route only `when`, repair/fallback only `when`/`maxAttempts`, provenance only `relation`).
 */
export function checkReferences(spec: GraphSpec): readonly GraphIssue[] {
  const issues: GraphIssue[] = [];
  const nodeIds = new Set<string>();
  for (const node of spec.nodes) {
    if (nodeIds.has(node.nodeId)) issues.push(ref(`duplicate nodeId ${node.nodeId}`));
    nodeIds.add(node.nodeId);
  }

  const edgeIds = new Set<string>();
  for (const edge of spec.typedEdges) {
    if (edgeIds.has(edge.edgeId)) issues.push(ref(`duplicate edgeId ${edge.edgeId}`));
    edgeIds.add(edge.edgeId);
    if (!nodeIds.has(edge.from)) issues.push(ref(`edge ${edge.edgeId} from ghost node ${edge.from}`));
    if (!nodeIds.has(edge.to)) issues.push(ref(`edge ${edge.edgeId} to ghost node ${edge.to}`));
  }

  for (const node of spec.nodes) {
    for (const branch of node.requiredBranches) {
      if (!nodeIds.has(branch)) issues.push(ref(`node ${node.nodeId} requires ghost branch ${branch}`));
    }
    if (node.loop !== null) {
      for (const bodyId of node.loop.bodyNodeIds) {
        if (!nodeIds.has(bodyId)) issues.push(ref(`node ${node.nodeId} loop body has ghost node ${bodyId}`));
      }
    }
  }

  for (const joinId of spec.requiredJoins) {
    if (!nodeIds.has(joinId)) {
      issues.push(ref(`requiredJoins lists ghost node ${joinId}`));
      continue;
    }
    const node = spec.nodes.find((candidate) => candidate.nodeId === joinId);
    if (node !== undefined && node.kind !== 'join') issues.push(ref(`requiredJoins lists non-join node ${joinId}`));
  }

  for (const abandoned of spec.abandonedBranches) {
    if (!nodeIds.has(abandoned.nodeId)) issues.push(ref(`abandonedBranches names ghost node ${abandoned.nodeId}`));
  }

  for (const edge of spec.typedEdges) issues.push(...edgeShapeIssues(edge));
  return issues;
}

function edgeShapeIssues(edge: EdgeSpec): readonly GraphIssue[] {
  const issues: GraphIssue[] = [];
  const onlyArtifactSlotsFree = edge.artifact === null && edge.expect === null && edge.relation === null;
  if (edge.type === 'dependency') {
    if (edge.when !== null || edge.artifact !== null || edge.expect !== null || edge.maxAttempts !== null || edge.relation !== null) {
      issues.push(shape(`dependency edge ${edge.edgeId} carries a slot it does not own`));
    }
    return issues;
  }
  if (edge.type === 'data') {
    if (edge.when !== null || edge.maxAttempts !== null || edge.relation !== null) {
      issues.push(shape(`data edge ${edge.edgeId} carries a slot it does not own`));
    }
    return issues;
  }
  if (edge.type === 'route') {
    if (edge.when === null) issues.push(shape(`route edge ${edge.edgeId} needs a when predicate`));
    if (!onlyArtifactSlotsFree || edge.maxAttempts !== null) {
      issues.push(shape(`route edge ${edge.edgeId} carries a slot it does not own`));
    }
  } else if (edge.type === 'repair' || edge.type === 'fallback') {
    if (edge.when === null) issues.push(shape(`${edge.type} edge ${edge.edgeId} needs a when predicate`));
    if (!onlyArtifactSlotsFree) issues.push(shape(`${edge.type} edge ${edge.edgeId} carries a slot it does not own`));
  } else if (edge.relation === null) {
    issues.push(shape(`provenance edge ${edge.edgeId} needs a relation`));
  } else if (edge.when !== null || edge.artifact !== null || edge.expect !== null || edge.maxAttempts !== null) {
    issues.push(shape(`provenance edge ${edge.edgeId} carries a slot it does not own`));
  }
  if (edge.when !== null && ROUTING_TYPES.has(edge.type)) {
    const failure = validatePredicate(edge.when, `edge ${edge.edgeId}.when`);
    if (failure !== null) issues.push({ check: 2, code: failure.code, message: failure.message });
  }
  return issues;
}

/** Check 5 — `requiredJoins` covers exactly the join nodes, and every join declares real branches. */
export function checkFanIn(spec: GraphSpec, context: GraphContext = {}): readonly GraphIssue[] {
  const issues: GraphIssue[] = [];
  const declared = new Set(spec.requiredJoins);
  for (const node of spec.nodes) {
    if (node.kind === 'join') {
      if (!declared.has(node.nodeId)) issues.push(join(`join node ${node.nodeId} is missing from requiredJoins`));
      if (node.requiredBranches.length === 0) issues.push(join(`join node ${node.nodeId} declares no requiredBranches`));
      if (node.requiredBranches.includes(node.nodeId)) issues.push(join(`join node ${node.nodeId} requires itself`));
    } else if (node.requiredBranches.length !== 0) {
      issues.push(join(`non-join node ${node.nodeId} declares requiredBranches`));
    }
  }
  const nodeIds = new Set(spec.nodes.map((node) => node.nodeId));
  for (const branch of context.contractBranches ?? []) {
    if (!nodeIds.has(branch)) issues.push(join(`contract-required branch ${branch} has no node in this graph`));
  }
  return issues;
}

/** Check 7 — resource declarations agree with the graph-level policy; exclusivity is a policy fact. */
export function checkResources(spec: GraphSpec): readonly GraphIssue[] {
  const issues: GraphIssue[] = [];
  const conflict = (message: string): void => {
    issues.push({ check: 7, code: 'EFK_GRAPH_RESOURCE_CONFLICT', message });
  };
  const policy = new Map<string, GraphSpec['resourcePolicy'][number]>();
  for (const entry of spec.resourcePolicy) {
    if (policy.has(entry.resourceId)) conflict(`resourcePolicy declares ${entry.resourceId} twice`);
    policy.set(entry.resourceId, entry);
  }
  for (const node of spec.nodes) {
    const { exclusive, shared } = node.resources;
    for (const resourceId of exclusive) {
      if (shared.includes(resourceId)) conflict(`node ${node.nodeId} declares ${resourceId} both exclusive and shared`);
      const entry = policy.get(resourceId);
      if (entry === undefined) conflict(`node ${node.nodeId} declares ${resourceId} with no resourcePolicy`);
      else if (entry.mode !== 'exclusive') conflict(`node ${node.nodeId} requires ${resourceId} exclusive but policy is ${entry.mode}`);
    }
    for (const resourceId of shared) {
      const entry = policy.get(resourceId);
      if (entry === undefined) conflict(`node ${node.nodeId} declares ${resourceId} with no resourcePolicy`);
      else if (entry.mode !== 'shared') conflict(`node ${node.nodeId} declares ${resourceId} shared but policy is ${entry.mode}`);
    }
  }
  return issues;
}
/** Nodes with at least one `join` kind, in declaration order. */
export function joinNodeIds(spec: GraphSpec): readonly string[] {
  return spec.nodes.filter((node) => node.kind === 'join').map((node) => node.nodeId);
}
