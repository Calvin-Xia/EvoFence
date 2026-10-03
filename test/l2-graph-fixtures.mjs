/**
 * Shared wire fixtures for the `l2_graph_model` tests.
 *
 * This module is loaded by `node --test` (anything under `test/` is), but it declares no tests: it
 * only builds plain, schema-shaped objects. Every fixture is a complete wire object so that
 * `compileGraph` exercises the real codec, not a shortcut.
 *
 * The example graph builders mirror the worked examples of
 * `docs/evofence-harness-kernel/spec/graph/EXAMPLES.md`; the tests assert the accept/fail outcomes
 * those examples state.
 */
export const PROTOCOL = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };

export const digest = (char) => `sha256:${char.repeat(64)}`;

export const SCHEMA_REPORT = { name: 'report', version: '1', digest: digest('a') };
export const SCHEMA_PATCH = { name: 'patch', version: '1', digest: digest('b') };
export const SCHEMA_OTHER = { name: 'other', version: '1', digest: digest('f') };

export const AUTHORITY = { grantRefs: ['grant-1'], nodeIds: null, capabilities: null };

export function contextPlan(overrides = {}) {
  return { inputRefs: [], maxTokens: 4096, preserveHostResources: true, isolation: 'current', ...overrides };
}

export function modelRequirement(overrides = {}) {
  return { providerModel: null, reasoningRequested: null, reasoningGuarantee: 'payload-only', payloadRef: null, ...overrides };
}

export function termination(maxAttempts = 3) {
  return {
    maxAttempts,
    maxActiveWallMs: 600000,
    cancelMode: 'stop-and-confirm',
    unknownPolicy: 'reconcile',
    excludeHumanWait: true,
  };
}

export function node(nodeId, kind, overrides = {}) {
  return {
    nodeId,
    kind,
    inputRefs: [],
    outputSchemas: [],
    loop: null,
    subgraph: null,
    contextPlan: contextPlan(),
    toolRequirements: [],
    modelRequirements: modelRequirement(),
    resources: { exclusive: [], shared: [] },
    termination: termination(),
    terminal: false,
    requiredBranches: [],
    ...overrides,
  };
}

export function edge(edgeId, type, from, to, overrides = {}) {
  return { edgeId, type, from, to, when: null, artifact: null, expect: null, maxAttempts: null, relation: null, ...overrides };
}

export function predicate(op, path = null, value = null, children = []) {
  return { op, path, value, children };
}

export function loop(overrides = {}) {
  return { bodyNodeIds: [], stop: ['body-success'], carry: [], ...overrides };
}

export function binding(nodeId, graphId = 'g-1', attemptOrdinal = 1) {
  return {
    sessionId: 's-1',
    hostSessionId: null,
    graph: { graphId, revision: 1, digest: digest('d') },
    nodeId,
    attemptId: `${nodeId}-a${attemptOrdinal}`,
    attemptOrdinal,
    epoch: 1,
    baseDigest: null,
  };
}

export function artifact(id, digestChar, nodeId, graphId = 'g-1', schema = SCHEMA_REPORT) {
  return {
    protocol: PROTOCOL,
    id,
    digest: digest(digestChar),
    producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null },
    binding: nodeId === null ? null : binding(nodeId, graphId),
    schema,
    location: `artifact://${id}`,
    visibility: 'internal',
    expiresAt: null,
    partition: 'not-evaluation',
  };
}

export function graph(overrides = {}) {
  return {
    protocol: PROTOCOL,
    graphId: 'g-1',
    revision: 1,
    taskContractRef: { taskId: 'task-1', version: 1, digest: digest('c') },
    nodes: [],
    typedEdges: [],
    requiredJoins: [],
    resourcePolicy: [],
    graphLimits: { maxNodes: 16, maxConcurrentAgents: 2, maxDepth: 3, maxAttempts: 4 },
    abandonedBranches: [],
    ...overrides,
  };
}

export function patch(graphId, overrides = {}) {
  return {
    protocol: PROTOCOL,
    graphId,
    expectedRevision: 1,
    adds: [],
    changes: [],
    removals: [],
    typedEdges: [],
    abandonedBranches: [],
    reason: 'test patch',
    authorityRef: 'grant-1',
    ...overrides,
  };
}

/** Example 1: a single agent with a bounded loop and exclusive/shared resources. */
export function singleAgentSpec() {
  return graph({
    graphId: 'g-single',
    nodes: [
      node('n1', 'agent', {
        terminal: true,
        loop: loop({ bodyNodeIds: ['n1'], maxIterations: 3, maxWallClock: 1200000, stop: ['body-success', 'bound-exhausted'] }),
        resources: { exclusive: ['workspaceWrite'], shared: ['workspaceRead'] },
        outputSchemas: [SCHEMA_PATCH],
      }),
    ],
    resourcePolicy: [
      { resourceId: 'workspaceWrite', mode: 'exclusive', maxHolders: 1 },
      { resourceId: 'workspaceRead', mode: 'shared', maxHolders: 4 },
    ],
  });
}

/** Example 2: two producers, one integration writer, a join, a fresh verifier, and repair. */
export function multiAgentSpec() {
  return graph({
    graphId: 'g-multi',
    nodes: [
      node('nA', 'agent', { outputSchemas: [SCHEMA_PATCH], resources: { exclusive: ['scopeA'], shared: [] } }),
      node('nB', 'agent', { outputSchemas: [SCHEMA_PATCH], resources: { exclusive: ['scopeB'], shared: [] } }),
      node('nM', 'agent', { resources: { exclusive: ['integrationWriter'], shared: [] } }),
      node('nV', 'agent', { contextPlan: contextPlan({ isolation: 'fresh' }) }),
      node('nJ', 'join', { requiredBranches: ['nA', 'nB', 'nM'] }),
      node('nDone', 'deterministic', { terminal: true }),
    ],
    typedEdges: [
      edge('e-a-m', 'data', 'nA', 'nM', { expect: SCHEMA_PATCH }),
      edge('e-b-m', 'data', 'nB', 'nM', { expect: SCHEMA_PATCH }),
      edge('e-a-j', 'dependency', 'nA', 'nJ'),
      edge('e-b-j', 'dependency', 'nB', 'nJ'),
      edge('e-m-j', 'dependency', 'nM', 'nJ'),
      edge('e-j-v', 'dependency', 'nJ', 'nV'),
      edge('e-v-done', 'route', 'nV', 'nDone', { when: predicate('eq', 'decision.outcome', 'completed') }),
      edge('e-v-m', 'repair', 'nV', 'nM', { when: predicate('eq', 'decision.outcome', 'repair'), maxAttempts: 2 }),
    ],
    requiredJoins: ['nJ'],
    resourcePolicy: [
      { resourceId: 'scopeA', mode: 'exclusive', maxHolders: 1 },
      { resourceId: 'scopeB', mode: 'exclusive', maxHolders: 1 },
      { resourceId: 'integrationWriter', mode: 'exclusive', maxHolders: 1 },
    ],
  });
}

/** Example 3: a route pair plus a fallback that keeps the original failure. */
export function fallbackSpec() {
  return graph({
    graphId: 'g-fallback',
    nodes: [node('nT', 'deterministic'), node('nX', 'agent'), node('nY', 'agent', { terminal: true })],
    typedEdges: [
      edge('e-t-x', 'route', 'nT', 'nX', { when: predicate('eq', 'env.hasTool', true) }),
      edge('e-t-y', 'route', 'nT', 'nY', { when: predicate('eq', 'env.hasTool', false) }),
      edge('e-x-y', 'fallback', 'nX', 'nY', {
        when: predicate('all', null, null, [predicate('eq', 'self.failed', true), predicate('eq', 'self.reason', 'tool-unavailable')]),
        maxAttempts: 1,
      }),
    ],
  });
}

/** Example 4: a producer/consumer `data` edge, optionally already bound to a digest. */
export function dataSpec({ bound = null } = {}) {
  return graph({
    graphId: 'g-data',
    nodes: [node('nG', 'deterministic', { outputSchemas: [SCHEMA_REPORT] }), node('nC', 'agent', { terminal: true })],
    typedEdges: [
      edge('e-g-c', 'data', 'nG', 'nC', {
        expect: SCHEMA_REPORT,
        artifact: bound === null ? null : artifact('a-report', bound, 'nG', 'g-data'),
      }),
    ],
  });
}

/** Example 9: a provenance edge that must not gate scheduling. */
export function provenanceSpec() {
  return graph({
    graphId: 'g-prov',
    nodes: [node('nX', 'agent', { terminal: true }), node('nY', 'agent', { terminal: true })],
    typedEdges: [edge('e-x-y', 'provenance', 'nX', 'nY', { relation: 'derived-from' })],
  });
}

/** Example 10 path A/B: nB feeds nD with no cover. */
export function abandonSpec() {
  return graph({
    graphId: 'g-abandon',
    nodes: [node('nB', 'agent'), node('nD', 'agent', { terminal: true })],
    typedEdges: [edge('e-b-d', 'dependency', 'nB', 'nD')],
  });
}

/** Example 10 path A2/C: a declared `repair(nZ -> nB)` is cover for nB. */
export function abandonWithCoverSpec() {
  return graph({
    graphId: 'g-abandon',
    nodes: [node('nB', 'agent'), node('nD', 'agent', { terminal: true }), node('nZ', 'agent')],
    typedEdges: [
      edge('e-b-d', 'dependency', 'nB', 'nD'),
      edge('e-z-b', 'repair', 'nZ', 'nB', { when: predicate('eq', 'decision.outcome', 'repair'), maxAttempts: 1 }),
    ],
  });
}

/** A terminal join over two branches; used to exercise the complete branch report. */
export function joinSpec({ abandoned = false } = {}) {
  return graph({
    graphId: 'g-join',
    nodes: [node('nA', 'agent'), node('nB', 'agent'), node('nJ', 'join', { requiredBranches: ['nA', 'nB'], terminal: true })],
    typedEdges: [edge('e-a-j', 'dependency', 'nA', 'nJ'), edge('e-b-j', 'dependency', 'nB', 'nJ')],
    requiredJoins: ['nJ'],
    abandonedBranches: abandoned ? [{ nodeId: 'nB', authorityRef: 'grant-1', reason: 'branch dropped', at: 9 }] : [],
  });
}
