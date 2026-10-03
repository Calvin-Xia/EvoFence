import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAPPINGS, mappingReport, renderLossReport, difference } from '../dist/bridges/super-plumber/index.js';
import { compileGraph } from '../dist/kernel/graph/index.js';
import { computeFrontier } from '../dist/kernel/scheduler/index.js';
import { fixture, fallbackFixture, witnesses, value } from './l5-sp-bridge-fixture.test.js';

const expectedEnums = {
  'node.type': ['task', 'checkpoint', 'decision', 'gate', 'context', 'adr'],
  'edge.type': ['depends_on', 'validates', 'shares_context', 'fan_out', 'fan_in', 'fallback', 'iterates', 'decides', 'relates'],
  'task.status': ['pending', 'ready', 'running', 'passed', 'failed', 'blocked', 'cancelled'],
  'adr.status': ['proposed', 'accepted', 'superseded'], 'context.status': ['pending'],
};
const requiredFields = [
  ...['id', 'label', 'level', 'priority', 'context', 'attempts', 'max_attempts', 'created_at', 'updated_at', 'reason', 'assigned_to', 'review'].map(x => 'node.' + x),
  ...['produces', 'consumed_by.artifact', 'consumed_by.used_as', 'validation.required', 'validation.method'].map(x => 'contract.' + x),
  ...['decision', 'background', 'considered_options', 'why', 'consequences', 'superseded_by'].map(x => 'adr.' + x),
  ...['boundary', 'glossary.term', 'glossary.definition', 'contracts.to', 'contracts.contract'].map(x => 'context.' + x),
  ...['id', 'source', 'target', 'rel_kind', 'reason', 'contract'].map(x => 'edge.' + x),
  ...['plan.description', 'plan.input_from.node', 'plan.input_from.artifact', 'plan.required_context.key', 'plan.required_context.source',
    'plan.output_to.node', 'plan.output_to.artifact', 'expected_outcome.definition_of_done', 'expected_outcome.quality_gates.check',
    'expected_outcome.quality_gates.method', 'checkpoints.id', 'checkpoints.label', 'checkpoints.status', 'checkpoints.verifier',
    'execution_report.summary', 'execution_report.artifacts', 'execution_report.blockers', 'execution_report.notes',
    'execution_report.started_at', 'execution_report.completed_at', 'execution_report.verification.verdict',
    'execution_report.verification.checked_at', 'execution_report.verification.note'].map(x => 'task.' + x),
  ...['id', 'version', 'label', 'entry.description', 'entry.defined_by', 'entry.level', 'exit.description',
    'exit.acceptance_criteria', 'exit.defined_by', 'exit.level', 'root_context', 'class', 'fog.id', 'fog.description',
    'fog.graduation', 'fog.ignited', 'review.status', 'review.by', 'review.at', 'review.layers.level', 'review.layers.by',
    'review.layers.at', 'design_approved', 'nodes.file', 'edges.file'].map(x => 'graph.' + x), 'event.design_approved',
];
test('cp1 mapping inventory covers every known SP enum and field', () => {
  const sources = MAPPINGS.map(row => row.source);
  assert.equal(new Set(sources).size, sources.length);
  for (const [prefix, values] of Object.entries(expectedEnums)) for (const item of values) assert.ok(sources.includes(prefix + '.' + item), 'unclassified: ' + prefix + '.' + item);
  for (const field of requiredFields) assert.ok(sources.includes(field), 'unclassified: ' + field);
  for (const row of MAPPINGS) {
    assert.ok(['supported', 'lossy', 'rejected'].includes(row.classification));
    assert.ok(row.target.length > 0 && row.reason.length > 0);
  }
  assert.deepEqual(mappingReport(), MAPPINGS);
});
test('cp2 supported export import export preserves every field and edge with empty machine difference', () => {
  const { delivery, bindings } = fixture(), { bridge } = witnesses();
  const imported = value(bridge.importData(delivery, bindings));
  const first = value(bridge.exportData(imported));
  const second = value(bridge.exportData(value(bridge.importData(first, bindings))));
  assert.deepEqual(first, delivery); assert.deepEqual(second, delivery);
  assert.deepEqual(difference(first, second), []); assert.deepEqual(imported.losses, []);
  assert.equal(imported.runtimeGraph.typedEdges[0].type, 'dependency');
  assert.equal(first.edges[0].reason, 'consume report after n1');
  assert.deepEqual(first.edges[0].contract, delivery.edges[0].contract);
});
test('cp2 explicit native SP records preserve manifest references without following paths', () => {
  const { delivery, bindings } = fixture(), { bridge, calls } = witnesses();
  delivery.graph.nodes = delivery.nodes.map(x => ({ file: `nodes/${x.id}.yaml` }));
  delivery.graph.edges = delivery.edges.map(x => ({ file: `edges/${x.id}.yaml` }));
  const packet = value(bridge.importRecords(delivery.graph, delivery.nodes, delivery.edges, bindings));
  const records = value(bridge.exportRecords(packet));
  assert.deepEqual(records, { graph: delivery.graph, nodes: delivery.nodes, edges: delivery.edges });
  assert.deepEqual(difference(value(bridge.exportData(packet)), delivery), []);
  assert.deepEqual(calls, { hostPort: 0, journal: 0, decisions: 0, grants: 0, claims: 0 });
  delivery.graph.nodes.pop();
  assert.equal(bridge.importRecords(delivery.graph, delivery.nodes, delivery.edges, bindings).error.code, 'EFK_GRAPH_REFERENCE_INVALID');
});
test('cp2 tracked loss report comes from one function and normalizes LF', () => {
  const doc = readFileSync(new URL('../docs/evofence-harness-kernel/L5-SP-BRIDGE-LOSS-REPORT.md', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  assert.equal(doc, renderLossReport());
  assert.equal(doc.replace(/\n/g, '\r\n').replace(/\r\n?/g, '\n'), renderLossReport());
});
function frontier(imported) {
  const compiled = compileGraph(imported.runtimeGraph); assert.equal(compiled.ok, true);
  const facts = { states: new Map(imported.initialStates.map(x => [x.nodeId, x.state])), artifacts: new Map(), holders: new Map(), seq: 0 };
  return computeFrontier(compiled.graph, facts, { claims: [] });
}
test('cp1 iterates remains an annotation and never affects frontier or dependency', () => {
  const { delivery, bindings } = fixture(), { bridge } = witnesses();
  const before = value(bridge.importData(delivery, bindings));
  delivery.edges.push({ id: 'iterate', source: 'n2', target: 'n1', type: 'iterates', reason: 'documentary reverse relation' });
  const after = value(bridge.importData(delivery, bindings));
  assert.deepEqual(after.runtimeGraph, before.runtimeGraph); assert.deepEqual(frontier(after), frontier(before));
  assert.ok(after.losses.some(x => x.source === 'edge.type.iterates'));
  assert.deepEqual(value(bridge.exportData(after)), delivery);
});
test('cp1 fallback is only fallback, preserves failure annotation and requires explicit bindings', () => {
  const { delivery, bindings } = fallbackFixture(), { bridge } = witnesses();
  delivery.nodes[0].status = 'failed'; delivery.nodes[0].reason = 'tool unavailable';
  const imported = value(bridge.importData(delivery, bindings));
  assert.deepEqual(imported.runtimeGraph.typedEdges.map(x => x.type), ['fallback']);
  assert.deepEqual(frontier(imported).map(x => x.readiness.state), ['ready', 'ready']);
  assert.equal(imported.delivery.nodes[0].status, 'failed'); assert.equal(imported.delivery.nodes[0].reason, 'tool unavailable');
  assert.deepEqual(imported.initialStates.map(x => x.state), ['pending', 'pending']);
  assert.ok(imported.losses.some(x => x.source === 'edge.type.fallback'));
  assert.deepEqual(value(bridge.exportData(imported)), delivery);
  bindings.fallbacks = [];
  assert.equal(bridge.importData(delivery, bindings).error.code, 'EFK_DEGRADATION_APPROVAL_REQUIRED');
});
test('cp3 review remains annotation with zero grants or decisions and unchanged frontier', () => {
  const { delivery, bindings } = fixture(), { bridge, calls } = witnesses();
  const before = value(bridge.importData(delivery, bindings));
  delivery.graph.review = { status: 'approved', by: 'fixture-reviewer', at: '2026-10-03', layers: [{ level: 'design', by: 'reviewer', at: '2026-10-03' }] };
  delivery.graph.design_approved = true;
  delivery.nodes[0].assigned_to = 'fixture-agent'; delivery.nodes[0].review = { status: 'self', by: 'self', at: '2026-10-03' };
  const after = value(bridge.importData(delivery, bindings));
  assert.deepEqual(after.runtimeGraph, before.runtimeGraph); assert.deepEqual(frontier(after), frontier(before));
  assert.deepEqual(calls, { hostPort: 0, journal: 0, decisions: 0, grants: 0, claims: 0 });
  assert.ok(after.losses.some(x => x.source === 'graph.design_approved'));
  assert.deepEqual(value(bridge.exportData(after)), delivery);
});
test('cp2 all conversion and imported pending execution paths have zero port calls', () => {
  const { delivery, bindings } = fixture(), { bridge, calls } = witnesses();
  const imported = value(bridge.importData(delivery, bindings)); value(bridge.exportData(imported));
  for (const method of ['claim', 'dispatchEffect', 'execute']) {
    const result = bridge[method](imported, { nodeId: 'n1' });
    assert.equal(result.ok, false); assert.equal(result.error.code, 'EFK_LEGACY_NOT_EXECUTABLE');
  }
  assert.equal(imported.executable, false);
  assert.equal(compileGraph(imported).ok, false, 'historical envelope must not be accepted as an executable graph');
  assert.deepEqual(calls, { hostPort: 0, journal: 0, decisions: 0, grants: 0, claims: 0 });
});
test('cp1 unsupported workflow statuses and edges are typed refusals', () => {
  const { bridge } = witnesses();
  for (const status of ['ready', 'running', 'passed', 'blocked', 'made-up']) {
    const { delivery, bindings } = fixture(); delivery.nodes[0].status = status;
    assert.equal(bridge.importData(delivery, bindings).ok, false, status);
  }
  for (const type of ['validates', 'fan_out', 'fan_in', 'unknown']) {
    const { delivery, bindings } = fixture(); delivery.edges[0].type = type;
    assert.equal(bridge.importData(delivery, bindings).ok, false, type);
  }
  for (const type of ['checkpoint', 'decision', 'gate']) {
    const { delivery, bindings } = fixture(); delivery.nodes[0].type = type;
    assert.equal(bridge.importData(delivery, bindings).error.code, 'EFK_CAPABILITY_UNSUPPORTED');
  }
});
test('cp1 malformed fields versions references runtime bounds and native manifests are refused', () => {
  const { bridge } = witnesses();
  const edits = [
    x => x.delivery.format = 'native-unversioned', x => x.delivery.nodes[0].secretGrant = 'forbidden',
    x => x.delivery.edges[0].contract.validation.required = 'yes', x => x.delivery.nodes[0].attempts = -1,
    x => x.delivery.nodes.push(structuredClone(x.delivery.nodes[0])), x => x.delivery.edges[0].target = 'missing',
    x => x.bindings.nodes.pop(), x => x.bindings.graph.graphLimits.maxAttempts = 0,
    x => x.delivery.nodes = [{ file: 'nodes/pending.yaml' }], x => x.delivery.edges[0].contract = { surprise: true },
    x => x.delivery.graph.root_context = null, x => x.bindings.graph = null,
    x => x.delivery.edges[0].contract.validation.method = 'run imported shell',
  ];
  for (const edit of edits) { const data = fixture(); edit(data); assert.equal(bridge.importData(data.delivery, data.bindings).ok, false); }
});
test('cp2 export rejects runtime edits and forged execution qualification without silently losing them', () => {
  const { delivery, bindings } = fixture(), { bridge } = witnesses();
  const imported = value(bridge.importData(delivery, bindings));
  imported.runtimeGraph.nodes[0].termination.maxAttempts = 9;
  assert.equal(bridge.exportData(imported).error.code, 'EFK_SOURCE_PIN_DRIFT');
  imported.executable = true;
  assert.equal(bridge.exportData(imported).error.code, 'EFK_LEGACY_NOT_EXECUTABLE');
});
test('cp2 conversion copies caller data and report rows rather than mutating them', () => {
  const { delivery, bindings } = fixture(), { bridge } = witnesses();
  const before = structuredClone({ delivery, bindings }), imported = value(bridge.importData(delivery, bindings));
  imported.delivery.nodes[0].reason = 'changed imported copy'; imported.runtimeGraph.nodes[0].termination.maxAttempts = 10;
  const report = mappingReport(); report[0].reason = 'changed report';
  assert.deepEqual({ delivery, bindings }, before); assert.notEqual(MAPPINGS[0].reason, 'changed report');
});
