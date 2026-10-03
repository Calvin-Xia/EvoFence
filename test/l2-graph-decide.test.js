/**
 * `l2_graph_model` — the `decide(event)` entry point and fan-in.
 *
 * One test per rule (`A1–A6`, `B1–B3`, `INV`) plus the `EXAMPLES.md` outcomes they encode:
 * example 2 (route/repair, complete branch report), example 3 (fallback keeps the failure), example
 * 8 (no matching route fails), example 10 (B1 before B2). The negative controls are the counter-cases
 * the examples name explicitly — "repair must not reuse the attempt", "the report must not drop the
 * failed branch", "the graph revision is not an escape hatch".
 *
 * `INV` is exercised with a hand-built plan precisely because a compiled graph cannot reach it
 * (check 10 rejects the shape) — it is the bypass alarm, not a state-machine edge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { compileGraph, decide, evaluateJoin, stateFromDecision } from '../dist/kernel/graph/index.js';
import * as fx from './l2-graph-fixtures.mjs';

const graphOf = (spec) => {
  const result = compileGraph(spec);
  assert.equal(result.ok, true, `fixture must compile: ${JSON.stringify(result.error)}`);
  return result.graph;
};

const outcome = (nodeId, state, nodeOutcome) => ({ kind: 'outcome', nodeId, state, outcome: nodeOutcome });
const upstream = (nodeId, upstreamId) => ({ kind: 'upstream-terminal', nodeId, upstreamId, seq: 42 });

test('A1 — a terminal node is decided by its TaskDecision', () => {
  const graph = graphOf(fx.singleAgentSpec());
  const done = decide(graph, outcome('n1', 'verifying', { ok: true, reason: '', decision: 'completed' }));
  assert.equal(done.rule, 'A1');
  assert.equal(done.nodeState, 'succeeded');
  assert.deepEqual(done.graphActions, []);
  const failed = decide(graph, outcome('n1', 'verifying', { ok: false, reason: 'patch-conflict', decision: 'failed' }));
  assert.equal(failed.nodeState, 'failed');
  assert.equal(failed.reason, 'patch-conflict');
});

test('A2 — a matching route is enabled and the node resolves via the TaskDecision', () => {
  const graph = graphOf(fx.multiAgentSpec());
  const done = decide(graph, outcome('nV', 'verifying', { ok: true, reason: '', decision: 'completed' }));
  assert.equal(done.rule, 'A2');
  assert.equal(done.nodeState, 'succeeded');
  assert.deepEqual(done.graphActions, [{ kind: 'enable', nodeId: 'nDone' }]);
});

test('A3 — a repair edge gives the target a new attempt and leaves the trigger failed', () => {
  const graph = graphOf(fx.multiAgentSpec());
  const repaired = decide(graph, outcome('nV', 'verifying', { ok: false, reason: 'integration-incomplete', decision: 'repair' }));
  assert.equal(repaired.rule, 'A3');
  assert.equal(repaired.nodeState, 'failed');
  assert.equal(repaired.reason, 'integration-incomplete');
  assert.deepEqual(repaired.graphActions, [
    { kind: 'new-attempt', nodeId: 'nM', previousReason: 'integration-incomplete' },
    { kind: 'enable', nodeId: 'nM' },
  ]);
  // Negative control: the repair targets nM, it does not resurrect nV on the same attempt.
  assert.equal(repaired.graphActions[0].nodeId, 'nM');
});

test('A4 — a matching fallback enables its target and keeps the original failure', () => {
  const graph = graphOf(fx.fallbackSpec());
  const fell = decide(graph, outcome('nX', 'verifying', { ok: false, reason: 'tool-unavailable', decision: 'failed' }));
  assert.equal(fell.rule, 'A4');
  assert.equal(fell.nodeState, 'failed');
  assert.equal(fell.reason, 'tool-unavailable');
  assert.deepEqual(fell.graphActions, [{ kind: 'enable', nodeId: 'nY' }]);
  // Negative control (example 3): cancelled/skipped is the wrong "clean" answer.
  assert.notEqual(fell.nodeState, 'cancelled');
});

test('A5 — a declared routing edge that does not match fails the node, preserving the outcome', () => {
  const graph = graphOf(fx.multiAgentSpec());
  const needsHuman = decide(graph, outcome('nV', 'verifying', { ok: true, reason: '', decision: 'needs-human' }));
  assert.equal(needsHuman.rule, 'A5');
  assert.equal(needsHuman.nodeState, 'failed');
  assert.equal(needsHuman.reason, 'no-matching-route');
  assert.deepEqual(needsHuman.graphActions, []);
});

test('A4 negative control — a failure whose reason does not match the when predicate does not fall back', () => {
  const graph = graphOf(fx.fallbackSpec());
  const other = decide(graph, outcome('nX', 'verifying', { ok: false, reason: 'boom', decision: 'failed' }));
  assert.equal(other.rule, 'A5');
  assert.deepEqual(other.graphActions, []);
});

test('A6 — a blocking-only producer resolves from its own outcome', () => {
  const graph = graphOf(fx.multiAgentSpec());
  const ok = decide(graph, outcome('nA', 'verifying', { ok: true, reason: '', decision: 'completed' }));
  assert.equal(ok.rule, 'A6');
  assert.equal(ok.nodeState, 'succeeded');
  assert.deepEqual(ok.graphActions, []);
  const bad = decide(graph, outcome('nA', 'verifying', { ok: false, reason: 'compile-failed', decision: 'failed' }));
  assert.equal(bad.rule, 'A6');
  assert.equal(bad.nodeState, 'failed');
  assert.equal(bad.reason, 'compile-failed');
});

test('A5 precedes A6 — routing out-edges without a match win over a blocking consumer', () => {
  const spec = fx.graph({
    nodes: [
      fx.node('nP', 'agent'),
      fx.node('nRoute', 'agent', { terminal: true }),
      fx.node('nUse', 'agent', { terminal: true }),
    ],
    typedEdges: [
      fx.edge('e-p-route', 'route', 'nP', 'nRoute', { when: fx.predicate('eq', 'decision.outcome', 'completed') }),
      fx.edge('e-p-use', 'dependency', 'nP', 'nUse'),
    ],
  });
  const result = decide(graphOf(spec), outcome('nP', 'verifying', { ok: true, reason: '', decision: 'needs-human' }));
  assert.equal(result.rule, 'A5');
  assert.deepEqual(result.graphActions, []);
});

test('B3 — an un-abandoned, uncovered upstream gap is waiting', () => {
  const graph = graphOf(fx.abandonSpec());
  const waiting = decide(graph, upstream('nD', 'nB'));
  assert.equal(waiting.rule, 'B3');
  assert.equal(waiting.nodeState, 'waiting');
  assert.deepEqual(waiting.gap, { kind: 'upstream-terminal', node: 'nB', at: 42 });
});

test('B1 — a declared repair/fallback cover makes the gap a wait, not a failure', () => {
  const graph = graphOf(fx.abandonWithCoverSpec());
  const covered = decide(graph, upstream('nD', 'nB'));
  assert.equal(covered.rule, 'B1');
  assert.equal(covered.nodeState, 'waiting');
});

test('B2 — an abandoned upstream with no cover fails the consumer', () => {
  const spec = fx.abandonSpec();
  spec.abandonedBranches = [{ nodeId: 'nB', authorityRef: 'grant-1', reason: 'branch dropped', at: 9 }];
  const graph = graphOf(spec);
  const dropped = decide(graph, upstream('nD', 'nB'));
  assert.equal(dropped.rule, 'B2');
  assert.equal(dropped.nodeState, 'failed');
  assert.equal(dropped.reason, 'upstream-abandoned');
});

test('B1 precedes B2 — cover short-circuits abandonment', () => {
  const spec = fx.abandonWithCoverSpec();
  spec.abandonedBranches = [{ nodeId: 'nB', authorityRef: 'grant-1', reason: 'dropped but repairable', at: 9 }];
  const graph = graphOf(spec);
  const covered = decide(graph, upstream('nD', 'nB'));
  assert.equal(covered.rule, 'B1');
  assert.equal(covered.nodeState, 'waiting');
});

test('INV — a bypassed graph alarms and leaves the node where it was', () => {
  const plan = {
    node: () => ({ nodeId: 'nBad', kind: 'agent', terminal: false }),
    edgesFrom: () => [{ edgeId: 'e1', type: 'provenance', from: 'nBad', to: 'nY', when: null, artifact: null, expect: null, maxAttempts: null, relation: 'r' }],
    edgesTo: () => [],
    isAbandoned: () => false,
  };
  const result = decide(plan, outcome('nBad', 'verifying', { ok: true, reason: '', decision: 'completed' }));
  assert.equal(result.rule, 'INV');
  assert.equal(result.nodeState, 'verifying');
  assert.deepEqual(result.graphActions, []);
  assert.equal(result.violation.code, 'EFK_INVARIANT_VIOLATION');
});

test('evaluateJoin — all branches succeeded means verifying', () => {
  const graph = graphOf(fx.joinSpec());
  const branches = new Map([
    ['nA', { state: 'succeeded', binding: null, artifactRefs: [], decisionRef: null, gapReason: null }],
    ['nB', { state: 'succeeded', binding: null, artifactRefs: [], decisionRef: null, gapReason: null }],
  ]);
  const evaluation = evaluateJoin(graph, 'nJ', { seq: 5, branches });
  assert.equal(evaluation.status, 'verifying');
  assert.deepEqual(evaluation.branchReport.map((entry) => entry.nodeId), ['nA', 'nB']);
});

test('evaluateJoin — a failed branch keeps the join waiting and stays in the report', () => {
  const graph = graphOf(fx.joinSpec());
  const branches = new Map([['nA', { state: 'succeeded', binding: null, artifactRefs: [], decisionRef: null, gapReason: null }]]);
  const evaluation = evaluateJoin(graph, 'nJ', { seq: 5, branches });
  assert.equal(evaluation.status, 'waiting');
  assert.deepEqual(evaluation.rules, ['B3']);
  // Negative control (example 2): the missing branch is reported, never filtered to look green.
  assert.deepEqual(evaluation.branchReport.map((entry) => entry.nodeId), ['nA', 'nB']);
  const dropped = evaluation.branchReport.find((entry) => entry.nodeId === 'nB');
  assert.equal(dropped.state, null);
  assert.equal(dropped.gapReason, 'upstream-terminal');
});

test('evaluateJoin — an abandoned branch with no cover fails the join', () => {
  const graph = graphOf(fx.joinSpec({ abandoned: true }));
  const branches = new Map([['nA', { state: 'succeeded', binding: null, artifactRefs: [], decisionRef: null, gapReason: null }]]);
  const evaluation = evaluateJoin(graph, 'nJ', { seq: 5, branches });
  assert.equal(evaluation.status, 'failed');
  assert.deepEqual(evaluation.rules, ['B2']);
});

test('evaluateJoin — a non-join id is an INV, not a silent success', () => {
  const graph = graphOf(fx.joinSpec());
  const evaluation = evaluateJoin(graph, 'nA', { seq: 1, branches: new Map() });
  assert.equal(evaluation.status, 'failed');
  assert.deepEqual(evaluation.rules, ['INV']);
  assert.equal(evaluation.violation.code, 'EFK_INVARIANT_VIOLATION');
});

test('stateFromDecision — the TaskDecision outcome mapping is fixed', () => {
  assert.equal(stateFromDecision('completed'), 'succeeded');
  assert.equal(stateFromDecision('repair'), 'failed');
  assert.equal(stateFromDecision('failed'), 'failed');
  assert.equal(stateFromDecision('needs-human'), 'waiting');
  assert.equal(stateFromDecision('unknown'), 'unknown');
});
