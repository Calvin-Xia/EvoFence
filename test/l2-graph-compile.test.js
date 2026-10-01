/**
 * `l2_graph_model` — compile and the eleven atomic checks of `SEMANTICS.md §5.1`.
 *
 * The accept cases are the graph summaries of `EXAMPLES.md` (1, 2, 9); the fail cases are one
 * negative control per check, so every refusal is falsifiable. `validateGraph` returning `[]` for a
 * valid example is the anti-tautology anchor: the same call that reports a rejection also reports
 * nothing for a graph the spec calls legal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { compileGraph, validateGraph } from '../dist/kernel/graph/index.js';
import * as fx from './l2-graph-fixtures.mjs';

/** Assert a rejection and return its frozen code. */
function refusal(result) {
  assert.equal(result.ok, false, `expected a typed refusal, got ${JSON.stringify(result.graph?.graphId)}`);
  return result.error.code;
}

function accepted(result) {
  assert.equal(result.ok, true, `expected acceptance, got ${JSON.stringify(result.error)}`);
  return result.graph;
}

test('example 1 — a single agent with one bounded loop compiles', () => {
  const graph = accepted(compileGraph(fx.singleAgentSpec()));
  assert.equal(graph.nodes.size, 1);
  assert.deepEqual(graph.joinIds, []);
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.resourcePolicy.size, 2);
});

test('example 2 — the multi-agent graph compiles and indexes its join', () => {
  const graph = accepted(compileGraph(fx.multiAgentSpec()));
  assert.deepEqual(graph.joinIds, ['nJ']);
  assert.equal(graph.edgesFrom('nV').length, 2);
  assert.equal(graph.edgesTo('nJ').length, 3);
});

test('example 9 — a provenance-only node is legal once it is terminal', () => {
  accepted(compileGraph(fx.provenanceSpec()));
});

test('example 2 is accepted by validateGraph with no issue (negative control for the checks)', () => {
  const graph = accepted(compileGraph(fx.multiAgentSpec()));
  assert.deepEqual(validateGraph(graph.spec), []);
});

test('check 1 — an unsupported namespace is refused by the codec before anything else', () => {
  const spec = fx.singleAgentSpec();
  spec.protocol = { namespace: 'evofence.runtime/2', schemaVersion: '1.1.0' };
  assert.equal(refusal(compileGraph(spec)), 'EFK_SCHEMA_INVALID');
});

test('check 1 — a missing required field is refused', () => {
  const spec = fx.singleAgentSpec();
  delete spec.graphLimits;
  assert.equal(refusal(compileGraph(spec)), 'EFK_SCHEMA_INVALID');
});

test('check 2 — a ghost edge endpoint is refused', () => {
  const spec = fx.abandonSpec();
  spec.typedEdges[0].to = 'nGhost';
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_REFERENCE_INVALID');
});

test('check 2 — a duplicate nodeId is refused', () => {
  const spec = fx.abandonSpec();
  spec.nodes.push(fx.node('nD', 'deterministic', { terminal: true }));
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_REFERENCE_INVALID');
});

test('check 2 — a dependency edge carrying a slot it does not own is refused', () => {
  const spec = fx.abandonSpec();
  spec.typedEdges[0].when = fx.predicate('true');
  assert.equal(refusal(compileGraph(spec)), 'EFK_SCHEMA_INVALID');
});

test('check 2 — a malformed predicate AST is refused', () => {
  const spec = fx.fallbackSpec();
  spec.typedEdges[0].when = fx.predicate('eq');
  assert.equal(refusal(compileGraph(spec)), 'EFK_SCHEMA_INVALID');
  const second = fx.fallbackSpec();
  second.typedEdges[0].when = fx.predicate('all', null, null, []);
  assert.equal(refusal(compileGraph(second)), 'EFK_SCHEMA_INVALID');
});

test('check 3 — a hidden dependency ring through a data edge is refused', () => {
  const spec = fx.graph({
    nodes: [
      fx.node('nA', 'agent', { outputSchemas: [fx.SCHEMA_REPORT] }),
      fx.node('nM', 'agent', { terminal: true }),
    ],
    typedEdges: [
      fx.edge('e-a-m', 'data', 'nA', 'nM', { expect: fx.SCHEMA_REPORT }),
      fx.edge('e-m-a', 'dependency', 'nM', 'nA'),
    ],
  });
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_DEPENDENCY_CYCLE');
  // Negative control: dropping the back edge leaves a legal chain, so the cycle is what refuses it.
  spec.typedEdges = spec.typedEdges.slice(0, 1);
  accepted(compileGraph(spec));
});

test('check 4 — an expect selector no producer output matches is refused', () => {
  const spec = fx.dataSpec();
  spec.typedEdges[0].expect = fx.SCHEMA_OTHER;
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_INPUT_STALE');
});

test('check 4 — a bound artifact from another producer is refused', () => {
  const spec = fx.dataSpec();
  spec.typedEdges[0].artifact = fx.artifact('a-report', 'e', 'nOther', 'g-data');
  assert.equal(refusal(compileGraph(spec)), 'EFK_ARTIFACT_BINDING_MISMATCH');
});

test('check 4 — a bound artifact whose schema does not satisfy expect is refused', () => {
  const spec = fx.dataSpec();
  spec.typedEdges[0].artifact = fx.artifact('a-report', 'e', 'nG', 'g-data', fx.SCHEMA_OTHER);
  assert.equal(refusal(compileGraph(spec)), 'EFK_ARTIFACT_BINDING_MISMATCH');
});

test('check 5 — a join node missing from requiredJoins is refused', () => {
  const spec = fx.multiAgentSpec();
  spec.requiredJoins = [];
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_JOIN_INCOMPLETE');
});

test('check 5 — a join with no requiredBranches is refused', () => {
  const spec = fx.multiAgentSpec();
  spec.nodes.find((node) => node.nodeId === 'nJ').requiredBranches = [];
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_JOIN_INCOMPLETE');
});

test('check 5 — a contract branch with no node is refused', () => {
  const result = compileGraph(fx.multiAgentSpec(), { contractBranches: ['nMissing'] });
  assert.equal(refusal(result), 'EFK_GRAPH_JOIN_INCOMPLETE');
});

test('check 7 — an exclusive resource with no policy is refused', () => {
  const spec = fx.abandonSpec();
  spec.nodes[0].resources = { exclusive: ['writer'], shared: [] };
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_RESOURCE_CONFLICT');
});

test('check 7 — declaring shared a resource the policy makes exclusive is refused', () => {
  const spec = fx.graph({
    nodes: [fx.node('n1', 'agent', { terminal: true, resources: { exclusive: [], shared: ['writer'] } })],
    resourcePolicy: [{ resourceId: 'writer', mode: 'exclusive', maxHolders: 1 }],
  });
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_RESOURCE_CONFLICT');
});

test('check 8 — a repair edge without maxAttempts is refused as unbounded', () => {
  const spec = fx.multiAgentSpec();
  spec.typedEdges.find((edge) => edge.type === 'repair').maxAttempts = null;
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_BOUND_INVALID');
  // Negative control: the bounded repair of example 2 compiles.
  accepted(compileGraph(fx.multiAgentSpec()));
});

test('check 8 — exceeding graphLimits.maxNodes is refused', () => {
  const spec = fx.multiAgentSpec();
  spec.graphLimits.maxNodes = 3;
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_BOUND_INVALID');
});

test('check 9 — an unbounded control cycle is refused', () => {
  const cycle = () => [
    fx.edge('e-l-m', 'route', 'nL', 'nM', { when: fx.predicate('eq', 'decision.outcome', 'completed') }),
    fx.edge('e-m-l', 'route', 'nM', 'nL', { when: fx.predicate('eq', 'decision.outcome', 'completed') }),
  ];
  const spec = fx.graph({ nodes: [fx.node('nL', 'agent'), fx.node('nM', 'agent')], typedEdges: cycle() });
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_NON_TERMINATING');
});

test('check 9 — the same control cycle is legal inside a bounded loop body', () => {
  const spec = fx.graph({
    nodes: [
      fx.node('nL', 'agent', { loop: fx.loop({ bodyNodeIds: ['nL', 'nM'], maxIterations: 2, maxWallClock: 60000, stop: ['body-success', 'bound-exhausted'] }) }),
      fx.node('nM', 'agent'),
    ],
    typedEdges: [
      fx.edge('e-l-m', 'route', 'nL', 'nM', { when: fx.predicate('eq', 'decision.outcome', 'completed') }),
      fx.edge('e-m-l', 'route', 'nM', 'nL', { when: fx.predicate('eq', 'decision.outcome', 'completed') }),
    ],
  });
  accepted(compileGraph(spec));
});

test('check 10 — a non-terminal node with no real consumer is refused', () => {
  const spec = fx.graph({ nodes: [fx.node('nAlone', 'agent')] });
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_TERMINAL_REQUIRED');
});

test('check 10 — a provenance-only, non-terminal node is refused', () => {
  const spec = fx.provenanceSpec();
  spec.nodes.find((node) => node.nodeId === 'nX').terminal = false;
  assert.equal(refusal(compileGraph(spec)), 'EFK_GRAPH_TERMINAL_REQUIRED');
});

test('check 11 — abandonment requires a non-empty reason and authorityRef (schema gate)', () => {
  const spec = fx.abandonSpec();
  spec.abandonedBranches = [{ nodeId: 'nB', authorityRef: 'grant-1', reason: '', at: 7 }];
  assert.equal(refusal(compileGraph(spec)), 'EFK_SCHEMA_INVALID');
  const second = fx.abandonSpec();
  second.abandonedBranches = [{ nodeId: 'nB', authorityRef: 'grant-1', reason: 'ok', at: 7 }, { nodeId: 'nB', authorityRef: 'grant-1', reason: 'again', at: 8 }];
  assert.equal(refusal(compileGraph(second)), 'EFK_GRAPH_EVIDENCE_REMOVAL');
});

test('schema gate — a loop declaring fewer than two bound kinds is refused', () => {
  const spec = fx.singleAgentSpec();
  spec.nodes[0].loop = fx.loop({ bodyNodeIds: ['n1'], maxIterations: 3, stop: ['body-success'] });
  assert.equal(refusal(compileGraph(spec)), 'EFK_SCHEMA_INVALID');
});
