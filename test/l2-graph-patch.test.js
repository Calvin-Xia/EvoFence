/**
 * `l2_graph_model` — the patch transaction (`SEMANTICS.md §5.1`/`§5.2`).
 *
 * The two DoD guarantees are the focus: a patch cannot change a mid-flight node's input, and a
 * branch can only leave by being abandoned (with a reason), never by deleting its evidence. Each
 * refusal is paired with the revision that *does* commit, so the test proves the check is the
 * discriminator rather than a blanket rejection. Example 5 (mid-flight mutation) and example 10
 * (abandon + fan-in) are encoded directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyGraphPatch, compileGraph, decide } from '../dist/kernel/graph/index.js';
import * as fx from './l2-graph-fixtures.mjs';

const AUTHORITY = fx.AUTHORITY;

function graphOf(spec) {
  const result = compileGraph(spec);
  assert.equal(result.ok, true, `fixture must compile: ${JSON.stringify(result.error)}`);
  return result.graph;
}

function refusal(result) {
  assert.equal(result.ok, false, 'expected a typed refusal');
  return result.error.code;
}

function committed(result) {
  assert.equal(result.ok, true, `expected a commit, got ${JSON.stringify(result.error)}`);
  return result;
}

test('CAS — a patch whose expectedRevision is stale is refused', () => {
  const graph = graphOf(fx.abandonSpec());
  const result = applyGraphPatch(graph, fx.patch(graph.graphId, { expectedRevision: 2 }), { authority: AUTHORITY });
  assert.equal(refusal(result), 'EFK_REVISION_CONFLICT');
});

test('a patch for another graph is refused', () => {
  const graph = graphOf(fx.abandonSpec());
  const result = applyGraphPatch(graph, fx.patch('g-other'), { authority: AUTHORITY });
  assert.equal(refusal(result), 'EFK_GRAPH_REFERENCE_INVALID');
});

test('example 5 — changing a running node is refused (expectedRevision matches)', () => {
  const graph = graphOf(fx.multiAgentSpec());
  const changed = fx.multiAgentSpec().nodes.find((node) => node.nodeId === 'nA');
  const result = applyGraphPatch(
    graph,
    fx.patch(graph.graphId, { changes: [changed] }),
    { authority: AUTHORITY, activeNodes: [{ nodeId: 'nA', state: 'running' }] },
  );
  assert.equal(refusal(result), 'EFK_GRAPH_ACTIVE_NODE_MUTATION');
});

test('example 5 — every mutation-locked state blocks an in-place change', () => {
  const graph = graphOf(fx.multiAgentSpec());
  const changed = fx.multiAgentSpec().nodes.find((node) => node.nodeId === 'nA');
  for (const state of ['leased', 'running', 'verifying', 'unknown', 'cancelling']) {
    const result = applyGraphPatch(graph, fx.patch(graph.graphId, { changes: [changed] }), {
      authority: AUTHORITY,
      activeNodes: [{ nodeId: 'nA', state }],
    });
    assert.equal(refusal(result), 'EFK_GRAPH_ACTIVE_NODE_MUTATION', `state ${state} must block`);
  }
  const ready = applyGraphPatch(
    graph,
    fx.patch(graph.graphId, { changes: [changed], typedEdges: fx.multiAgentSpec().typedEdges }),
    { authority: AUTHORITY, activeNodes: [{ nodeId: 'nA', state: 'ready' }] },
  );
  committed(ready);
});

test('example 5 — after the node is no longer mid-flight the new revision commits', () => {
  const graph = graphOf(fx.multiAgentSpec());
  const nS = fx.node('nS', 'deterministic');
  const edges = [...fx.multiAgentSpec().typedEdges, fx.edge('e-s-j', 'dependency', 'nS', 'nJ')];
  const result = committed(
    applyGraphPatch(graph, fx.patch(graph.graphId, { adds: [nS], typedEdges: edges }), { authority: AUTHORITY }),
  );
  assert.equal(result.fromRevision, 1);
  assert.equal(result.toRevision, 2);
  assert.deepEqual(result.diff.addedNodes, ['nS']);
  assert.deepEqual(result.diff.addedEdges, ['e-s-j']);
  assert.equal(result.graph.revision, 2);
});

test('check 6 — an authorityRef outside the grant is refused', () => {
  const graph = graphOf(fx.abandonSpec());
  const result = applyGraphPatch(graph, fx.patch(graph.graphId, { authorityRef: 'grant-other' }), { authority: AUTHORITY });
  assert.equal(refusal(result), 'EFK_GRAPH_AUTHORITY_ESCALATION');
});

test('check 6 — a node outside the granted node scope is refused', () => {
  const graph = graphOf(fx.abandonSpec());
  const nNew = fx.node('nNew', 'agent', { terminal: true });
  const result = applyGraphPatch(graph, fx.patch(graph.graphId, { adds: [nNew] }), {
    authority: { grantRefs: ['grant-1'], nodeIds: ['nB', 'nD'], capabilities: null },
  });
  assert.equal(refusal(result), 'EFK_GRAPH_AUTHORITY_ESCALATION');
});

test('check 6 — a capability the grant does not cover is refused', () => {
  const graph = graphOf(fx.abandonSpec());
  const nNew = fx.node('nNew', 'agent', {
    terminal: true,
    toolRequirements: [{ capability: 'network-egress', mode: 'hard', evidenceKinds: ['static'], coverage: [], alternativeIds: [] }],
  });
  const result = applyGraphPatch(graph, fx.patch(graph.graphId, { adds: [nNew] }), {
    authority: { grantRefs: ['grant-1'], nodeIds: null, capabilities: ['local-tools'] },
  });
  assert.equal(refusal(result), 'EFK_GRAPH_AUTHORITY_ESCALATION');
});

test('check 11 — removing a node that produced evidence is refused', () => {
  const graph = graphOf(fx.multiAgentSpec());
  const edges = fx.multiAgentSpec().typedEdges.filter((edge) => edge.edgeId !== 'e-v-done');
  const patch = fx.patch(graph.graphId, { removals: ['nDone'], typedEdges: edges });
  assert.equal(refusal(applyGraphPatch(graph, patch, { authority: AUTHORITY, evidenceNodeIds: ['nDone'] })), 'EFK_GRAPH_EVIDENCE_REMOVAL');
  // Negative control: the same patch commits once no evidence is attached to the removed node.
  committed(applyGraphPatch(graph, patch, { authority: AUTHORITY, evidenceNodeIds: [] }));
});

test('check 11 — an abandonment cannot be dropped from a later revision', () => {
  const spec = fx.abandonSpec();
  spec.abandonedBranches = [{ nodeId: 'nB', authorityRef: 'grant-1', reason: 'dropped', at: 9 }];
  const graph = graphOf(spec);
  const keepEdges = fx.patch(graph.graphId, { typedEdges: fx.abandonSpec().typedEdges });
  assert.equal(refusal(applyGraphPatch(graph, keepEdges, { authority: AUTHORITY })), 'EFK_GRAPH_EVIDENCE_REMOVAL');
});

test('check 11 — an abandoned branch cannot be removed either', () => {
  const spec = fx.abandonSpec();
  spec.abandonedBranches = [{ nodeId: 'nB', authorityRef: 'grant-1', reason: 'dropped', at: 9 }];
  const graph = graphOf(spec);
  const result = applyGraphPatch(graph, fx.patch(graph.graphId, { removals: ['nB'], typedEdges: [] }), { authority: AUTHORITY });
  assert.equal(refusal(result), 'EFK_GRAPH_EVIDENCE_REMOVAL');
});

test('example 10 — abandoning a branch commits and the consumer then fails via B2', () => {
  const graph = graphOf(fx.abandonSpec());
  const result = committed(
    applyGraphPatch(
      graph,
      fx.patch(graph.graphId, {
        typedEdges: fx.abandonSpec().typedEdges,
        abandonedBranches: [{ nodeId: 'nB', authorityRef: 'grant-1', reason: 'branch dropped by user', at: 9 }],
      }),
      { authority: AUTHORITY },
    ),
  );
  assert.equal(result.graph.abandoned.has('nB'), true);
  // R5: the branch's evidence stays -- nB is still a node of the revision.
  assert.equal(result.graph.nodes.has('nB'), true);
  const dropped = decide(result.graph, { kind: 'upstream-terminal', nodeId: 'nD', upstreamId: 'nB', seq: 40 });
  assert.equal(dropped.rule, 'B2');
  assert.equal(dropped.nodeState, 'failed');
});

test('check 11 — abandoning a contract branch needs contract-level authority', () => {
  const graph = graphOf(fx.abandonSpec());
  const result = applyGraphPatch(
    graph,
    fx.patch(graph.graphId, {
      typedEdges: fx.abandonSpec().typedEdges,
      abandonedBranches: [{ nodeId: 'nB', authorityRef: 'grant-1', reason: 'dropped', at: 9 }],
    }),
    { authority: AUTHORITY, contractBranches: ['nB'] },
  );
  assert.equal(refusal(result), 'EFK_GRAPH_AUTHORITY_ESCALATION');
});

test('example 4 path C — rebinding a mid-flight consumer is refused', () => {
  const graph = graphOf(fx.dataSpec({ bound: 'e' }));
  const rebound = fx.edge('e-g-c', 'data', 'nG', 'nC', { expect: fx.SCHEMA_REPORT, artifact: fx.artifact('a-report', '1', 'nG', 'g-data') });
  const result = applyGraphPatch(graph, fx.patch(graph.graphId, { typedEdges: [rebound] }), {
    authority: AUTHORITY,
    activeNodes: [{ nodeId: 'nC', state: 'running' }],
  });
  assert.equal(refusal(result), 'EFK_GRAPH_ACTIVE_NODE_MUTATION');
});

test('example 4 path B — an explicit rebind commits and shows up as a changed edge', () => {
  const graph = graphOf(fx.dataSpec({ bound: 'e' }));
  const rebound = fx.edge('e-g-c', 'data', 'nG', 'nC', { expect: fx.SCHEMA_REPORT, artifact: fx.artifact('a-report', '1', 'nG', 'g-data') });
  const result = committed(applyGraphPatch(graph, fx.patch(graph.graphId, { typedEdges: [rebound] }), { authority: AUTHORITY }));
  assert.deepEqual(result.diff.changedEdges, ['e-g-c']);
  assert.equal(result.graph.edges[0].artifact.digest, fx.digest('1'));
});

test('typedEdges is the complete new edge set — omitting an edge removes it', () => {
  const graph = graphOf(fx.multiAgentSpec());
  const edges = fx.multiAgentSpec().typedEdges.filter((edge) => edge.edgeId !== 'e-v-m');
  const result = committed(applyGraphPatch(graph, fx.patch(graph.graphId, { typedEdges: edges }), { authority: AUTHORITY }));
  assert.deepEqual(result.diff.removedEdges, ['e-v-m']);
  assert.equal(result.graph.edges.some((edge) => edge.edgeId === 'e-v-m'), false);
});

test('a patch cannot remove every node', () => {
  const graph = graphOf(fx.abandonSpec());
  const result = applyGraphPatch(graph, fx.patch(graph.graphId, { removals: ['nB', 'nD'], typedEdges: [] }), { authority: AUTHORITY });
  assert.equal(refusal(result), 'EFK_SCHEMA_INVALID');
});

test('the candidate revision is re-validated against all eleven checks', () => {
  const graph = graphOf(fx.multiAgentSpec());
  const unbounded = fx.edge('e-v-n', 'repair', 'nV', 'nM', { when: fx.predicate('eq', 'decision.outcome', 'repair') });
  const edges = fx.multiAgentSpec().typedEdges.filter((edge) => edge.edgeId !== 'e-v-m').concat(unbounded);
  const result = applyGraphPatch(graph, fx.patch(graph.graphId, { typedEdges: edges }), { authority: AUTHORITY });
  assert.equal(refusal(result), 'EFK_GRAPH_BOUND_INVALID');
});

test('a contract-branch abandonment commits when the contract authority covers it', () => {
  const graph = graphOf(fx.abandonSpec());
  const result = committed(
    applyGraphPatch(
      graph,
      fx.patch(graph.graphId, {
        typedEdges: fx.abandonSpec().typedEdges,
        abandonedBranches: [{ nodeId: 'nB', authorityRef: 'grant-contract', reason: 'scope withdrawn', at: 9 }],
      }),
      { authority: AUTHORITY, contractBranches: ['nB'], contractAuthorityRefs: ['grant-contract'] },
    ),
  );
  assert.equal(result.graph.abandoned.has('nB'), true);
});
