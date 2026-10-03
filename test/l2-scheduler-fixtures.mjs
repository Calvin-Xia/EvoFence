/**
 * Wire fixtures for the `l2_scheduler` tests.
 *
 * Loaded by `node --test` (anything under `test/` is) but declares no tests: it only builds
 * schema-shaped objects and compiles them through the real `compileGraph`, so every test exercises
 * the same codec the kernel uses rather than a hand-rolled shortcut.
 *
 * The graphs mirror the resource/fan-in shapes of `spec/graph/EXAMPLES.md` (example 1's
 * exclusive/shared pair, example 2's integration writer and join, example 10's uncovered upstream).
 */
import assert from 'node:assert/strict';

import { compileGraph } from '../dist/kernel/graph/index.js';
import { openBudgetLedger, RESERVE_PER_REQUEST_MICROS } from '../dist/kernel/policy/index.js';
import { emptyFairness, emptyState } from '../dist/kernel/scheduler/index.js';

export const PROTOCOL = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };

export const digest = (char) => `sha256:${char.repeat(64)}`;

export function node(nodeId, overrides = {}) {
  return {
    nodeId,
    kind: 'agent',
    inputRefs: [],
    outputSchemas: [],
    loop: null,
    subgraph: null,
    contextPlan: { inputRefs: [], maxTokens: 4096, preserveHostResources: true, isolation: 'current' },
    toolRequirements: [],
    modelRequirements: {
      providerModel: null,
      reasoningRequested: null,
      reasoningGuarantee: 'payload-only',
      payloadRef: null,
    },
    resources: { exclusive: [], shared: [] },
    termination: {
      maxAttempts: 3,
      maxActiveWallMs: 600000,
      cancelMode: 'stop-and-confirm',
      unknownPolicy: 'reconcile',
      excludeHumanWait: true,
    },
    terminal: false,
    requiredBranches: [],
    ...overrides,
  };
}

export function edge(edgeId, type, from, to, overrides = {}) {
  return {
    edgeId,
    type,
    from,
    to,
    when: null,
    artifact: null,
    expect: null,
    maxAttempts: null,
    relation: null,
    ...overrides,
  };
}

export function predicate(op, path = null, value = null, children = []) {
  return { op, path, value, children };
}

export function graph(overrides = {}) {
  return {
    protocol: PROTOCOL,
    graphId: 'g-sched',
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

export function compiled(spec) {
  const result = compileGraph(spec);
  assert.equal(result.ok, true, `fixture must compile: ${JSON.stringify(result.error)}`);
  return result.graph;
}

export function bindingFor(nodeId, overrides = {}) {
  const attemptOrdinal = overrides.attemptOrdinal ?? 1;
  return {
    sessionId: 's-1',
    hostSessionId: null,
    graph: { graphId: 'g-sched', revision: 1, digest: digest('d') },
    nodeId,
    attemptId: `${nodeId}-a${attemptOrdinal}`,
    attemptOrdinal,
    epoch: 1,
    baseDigest: null,
    ...overrides,
  };
}

export function factsOf({ states = {}, artifacts = {}, holders = {}, branches = {}, seq = 1 } = {}) {
  return {
    states: new Map(Object.entries(states)),
    artifacts: new Map(Object.entries(artifacts)),
    holders: new Map(Object.entries(holders)),
    seq,
    branches: new Map(Object.entries(branches)),
  };
}

/** One `BranchFacts` entry for a join's branch map. */
export function branchFacts(state) {
  return { state, binding: null, artifactRefs: [], decisionRef: null, gapReason: null };
}

export function budgetPolicy(overrides = {}) {
  return {
    poolId: 'pool-1',
    category: 'development',
    authorizationRef: null,
    maxRequests: 8,
    maxInputTokens: 60000,
    maxOutputTokens: 4096,
    maxUsdMicros: null,
    maxWallMs: 600000,
    maxConcurrentRequests: 4,
    priceRef: null,
    missingUsagePolicy: 'retain-reservation',
    ...overrides,
  };
}

export function budgetLedger(overrides = {}) {
  const opened = openBudgetLedger(budgetPolicy(overrides), RESERVE_PER_REQUEST_MICROS);
  assert.equal(opened.ok, true, `fixture budget must open: ${JSON.stringify(opened.error)}`);
  return opened.value;
}

/** A complete `DispatchInput`; every field can be overridden per test. */
export function roundInput(spec, overrides = {}) {
  return {
    graph: compiled(spec),
    facts: factsOf(),
    state: emptyState(),
    budget: budgetLedger(),
    fairness: emptyFairness(),
    bindingFor: (nodeId) => bindingFor(nodeId),
    now: 1000,
    leaseTtlMs: 100,
    maxConcurrentAgents: 2,
    depth: 0,
    maxDepth: 3,
    ...overrides,
  };
}

/** Two producers fighting for the single integration writer (`CONTRACTS.md §5.7`). */
export function writerContentionSpec() {
  const resources = { exclusive: ['integrationWriter'], shared: [] };
  return graph({
    graphId: 'g-writer',
    nodes: [node('nW1', { terminal: true, resources }), node('nW2', { terminal: true, resources })],
    resourcePolicy: [{ resourceId: 'integrationWriter', mode: 'exclusive', maxHolders: 1 }],
    graphLimits: { maxNodes: 8, maxConcurrentAgents: 2, maxDepth: 2, maxAttempts: 4 },
  });
}

/** Two writers on disjoint scopes: the concurrency the model allows. */
export function independentSpec() {
  return graph({
    graphId: 'g-independent',
    nodes: [
      node('nA', { terminal: true, resources: { exclusive: ['scopeA'], shared: [] } }),
      node('nB', { terminal: true, resources: { exclusive: ['scopeB'], shared: [] } }),
    ],
    resourcePolicy: [
      { resourceId: 'scopeA', mode: 'exclusive', maxHolders: 1 },
      { resourceId: 'scopeB', mode: 'exclusive', maxHolders: 1 },
    ],
    graphLimits: { maxNodes: 8, maxConcurrentAgents: 2, maxDepth: 2, maxAttempts: 4 },
  });
}

/** Three readers of one shared, quota-2 resource. */
export function sharedQuotaSpec() {
  const resources = { exclusive: [], shared: ['workspaceRead'] };
  return graph({
    graphId: 'g-shared',
    nodes: [
      node('nR1', { terminal: true, resources }),
      node('nR2', { terminal: true, resources }),
      node('nR3', { terminal: true, resources }),
    ],
    resourcePolicy: [{ resourceId: 'workspaceRead', mode: 'shared', maxHolders: 2 }],
    graphLimits: { maxNodes: 8, maxConcurrentAgents: 3, maxDepth: 2, maxAttempts: 4 },
  });
}

/** A join over three branches; `states` decides which ones are still outstanding. */
export function joinSpec() {
  return graph({
    graphId: 'g-join',
    nodes: [
      node('nA'),
      node('nB'),
      node('nC'),
      node('nJ', { kind: 'join', requiredBranches: ['nA', 'nB', 'nC'], terminal: true }),
    ],
    typedEdges: [
      edge('e-a-j', 'dependency', 'nA', 'nJ'),
      edge('e-b-j', 'dependency', 'nB', 'nJ'),
      edge('e-c-j', 'dependency', 'nC', 'nJ'),
    ],
    requiredJoins: ['nJ'],
  });
}

/** One producer feeding a terminal consumer; used for the uncovered-upstream stall. */
export function uncoveredUpstreamSpec({ cover = false } = {}) {
  return graph({
    graphId: cover ? 'g-covered' : 'g-uncovered',
    nodes: [
      node('nWork'),
      node('nD', { terminal: true }),
      ...(cover ? [node('nZ')] : []),
    ],
    typedEdges: [
      edge('e-w-d', 'dependency', 'nWork', 'nD'),
      ...(cover
        ? [edge('e-z-w', 'repair', 'nZ', 'nWork', { when: predicate('eq', 'decision.outcome', 'repair'), maxAttempts: 1 })]
        : []),
    ],
  });
}

/** Three nodes with no resources, declared in this order. */
export function plainSpec() {
  return graph({
    graphId: 'g-plain',
    nodes: [node('nFirst', { terminal: true }), node('nX', { terminal: true }), node('nY', { terminal: true })],
    graphLimits: { maxNodes: 8, maxConcurrentAgents: 2, maxDepth: 2, maxAttempts: 4 },
  });
}

/** A single writer of the integration resource. */
export function soloWriterSpec() {
  return graph({
    graphId: 'g-solo',
    nodes: [node('nW1', { terminal: true, resources: { exclusive: ['integrationWriter'], shared: [] } })],
    resourcePolicy: [{ resourceId: 'integrationWriter', mode: 'exclusive', maxHolders: 1 }],
  });
}
