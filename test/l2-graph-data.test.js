/**
 * `l2_graph_model` — `data` binding and readiness (examples 4 and 9, plus `§2.2` resources).
 *
 * Example 4's three paths are the spine: a future artifact becomes consumable when the producer's
 * output matches the selector; a re-produced digest does not silently replace a bound one; and a
 * mid-flight consumer is protected by the patch transaction (covered in `l2-graph-patch`).
 * Example 9 is the counter-case: a provenance edge gates nothing at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { compileGraph, consumable, dataEdgeIssues, evaluateReadiness, sameSchema } from '../dist/kernel/graph/index.js';
import * as fx from './l2-graph-fixtures.mjs';

function graphOf(spec) {
  const result = compileGraph(spec);
  assert.equal(result.ok, true, `fixture must compile: ${JSON.stringify(result.error)}`);
  return result.graph;
}

const noHolders = new Map();
const noArtifacts = new Map();

test('sameSchema compares name, exact version and content digest', () => {
  assert.equal(sameSchema(fx.SCHEMA_REPORT, { ...fx.SCHEMA_REPORT }), true);
  assert.equal(sameSchema(fx.SCHEMA_REPORT, fx.SCHEMA_OTHER), false);
});

test('example 4 path A — a future artifact becomes consumable once the producer emits it', () => {
  const graph = graphOf(fx.dataSpec());
  const produced = fx.artifact('a-report', 'e', 'nG', 'g-data');
  assert.equal(consumable(graph.edges[0], produced), true);
  const readiness = evaluateReadiness(graph, 'nC', {
    states: new Map([['nG', 'succeeded']]),
    artifacts: new Map([['nG', produced]]),
    holders: noHolders,
    seq: 3,
  });
  assert.equal(readiness.state, 'ready');
});

test('example 4 path A negative control — no produced artifact yet means waiting', () => {
  const graph = graphOf(fx.dataSpec());
  const readiness = evaluateReadiness(graph, 'nC', {
    states: new Map([['nG', 'succeeded']]),
    artifacts: noArtifacts,
    holders: noHolders,
    seq: 3,
  });
  assert.equal(readiness.state, 'waiting');
  assert.equal(readiness.gap.kind, 'input-artifact-stale');
});

test('example 4 path B — a re-produced digest does not replace a bound one', () => {
  const graph = graphOf(fx.dataSpec({ bound: 'e' }));
  const newer = fx.artifact('a-report', '1', 'nG', 'g-data');
  const readiness = evaluateReadiness(graph, 'nC', {
    states: new Map([['nG', 'succeeded']]),
    artifacts: new Map([['nG', newer]]),
    holders: noHolders,
    seq: 4,
  });
  assert.equal(readiness.state, 'waiting');
  assert.equal(readiness.gap.kind, 'input-artifact-stale');
});

test('example 4 path B — after the explicit rebind the consumer is ready on the new digest', () => {
  const rebound = fx.dataSpec({ bound: '1' });
  const graph = graphOf(rebound);
  const readiness = evaluateReadiness(graph, 'nC', {
    states: new Map([['nG', 'succeeded']]),
    artifacts: new Map([['nG', fx.artifact('a-report', '1', 'nG', 'g-data')]]),
    holders: noHolders,
    seq: 4,
  });
  assert.equal(readiness.state, 'ready');
});

test('check 4 — an ambiguous producer output selector is refused', () => {
  const producer = fx.node('nG', 'deterministic', { outputSchemas: [fx.SCHEMA_REPORT, { ...fx.SCHEMA_REPORT }] });
  const edge = fx.edge('e-g-c', 'data', 'nG', 'nC', { expect: fx.SCHEMA_REPORT });
  const issues = dataEdgeIssues(edge, producer);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'EFK_GRAPH_INPUT_STALE');
});

test('readiness — a dependency upstream that has not succeeded waits', () => {
  const graph = graphOf(fx.abandonSpec());
  const readiness = evaluateReadiness(graph, 'nD', {
    states: new Map([['nB', 'running']]),
    artifacts: noArtifacts,
    holders: noHolders,
    seq: 2,
  });
  assert.equal(readiness.state, 'waiting');
  assert.equal(readiness.gap.kind, 'upstream-terminal');
});

test('readiness — an abandoned dependency upstream fails the consumer via B2', () => {
  const spec = fx.abandonSpec();
  spec.abandonedBranches = [{ nodeId: 'nB', authorityRef: 'grant-1', reason: 'dropped', at: 9 }];
  const graph = graphOf(spec);
  const readiness = evaluateReadiness(graph, 'nD', {
    states: new Map([['nB', 'failed']]),
    artifacts: noArtifacts,
    holders: noHolders,
    seq: 2,
  });
  assert.equal(readiness.state, 'failed');
  assert.equal(readiness.rule, 'B2');
});

test('readiness — a succeeded dependency makes the consumer ready', () => {
  const graph = graphOf(fx.abandonSpec());
  const readiness = evaluateReadiness(graph, 'nD', {
    states: new Map([['nB', 'succeeded']]),
    artifacts: noArtifacts,
    holders: noHolders,
    seq: 2,
  });
  assert.equal(readiness.state, 'ready');
});

test('readiness — an exclusive resource held by another node is a race, not a wait', () => {
  const graph = graphOf(fx.singleAgentSpec());
  const contended = evaluateReadiness(graph, 'n1', {
    states: new Map(),
    artifacts: noArtifacts,
    holders: new Map([['workspaceWrite', { active: 1, abandoned: 0 }]]),
    seq: 1,
  });
  assert.equal(contended.state, 'ready');
});

test('readiness — a resource with no releasable path is a wait', () => {
  const graph = graphOf(fx.singleAgentSpec());
  for (const holders of [
    new Map([['workspaceWrite', { active: 0, abandoned: 1 }]]),
    new Map([['workspaceWrite', { active: 1, abandoned: 0 }], ['workspaceRead', { active: 9, abandoned: 9 }]]),
  ]) {
    const readiness = evaluateReadiness(graph, 'n1', { states: new Map(), artifacts: noArtifacts, holders, seq: 1 });
    assert.equal(readiness.state, 'waiting');
    assert.equal(readiness.gap.kind, 'resource-unavailable');
  }
});

test('example 9 — a provenance edge never gates the target', () => {
  const graph = graphOf(fx.provenanceSpec());
  const readiness = evaluateReadiness(graph, 'nY', {
    states: new Map([['nX', 'failed']]),
    artifacts: noArtifacts,
    holders: noHolders,
    seq: 1,
  });
  assert.equal(readiness.state, 'ready');
});

test('readiness — an unknown node is an INV, not a silent ready', () => {
  const graph = graphOf(fx.provenanceSpec());
  const readiness = evaluateReadiness(graph, 'nGhost', { states: new Map(), artifacts: noArtifacts, holders: noHolders, seq: 1 });
  assert.equal(readiness.state, 'failed');
  assert.equal(readiness.rule, 'INV');
});
