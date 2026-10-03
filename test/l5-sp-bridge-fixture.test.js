// All file fixtures are created by callers under os.tmpdir(); this module contains data only.
import { node, graph, predicate } from './l2-graph-fixtures.mjs';
import { createSPBridge } from '../dist/bridges/super-plumber/index.js';

export function fixture() {
  const common = { level: 1, status: 'pending', attempts: 0, max_attempts: 3,
    created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z' };
  const contract = { produces: 'report', consumed_by: [{ artifact: 'report', used_as: 'reference' }],
    validation: { required: true, method: 'cross_review' } };
  const delivery = { format: 'evofence.sp-snapshot/1',
    graph: { id: 'sp-example', version: '1.0', label: 'Delivery example',
      entry: { description: 'Prepare a report', defined_by: 'human', level: 0 },
      exit: { description: 'Deliver a report', acceptance_criteria: ['report preserved'], defined_by: 'human', level: 1 },
      root_context: { domain: 'fixture' }, class: 'program',
      fog: { id: 'format-coverage', description: 'native exports unknown', graduation: 'independent native check', ignited: ['n1'] } },
    nodes: [
      { ...common, id: 'n1', type: 'task', label: 'Write report', context: 'ctx1', priority: 1, reason: 'explicit source reason',
        plan: { description: 'Write a report', input_from: [{ node: 'ctx1', artifact: 'domain' }],
          required_context: [{ key: 'domain', source: 'ctx1' }], output_to: [{ node: 'n2', artifact: 'report' }] },
        expected_outcome: { definition_of_done: ['report exists'], quality_gates: [{ check: 'report', method: 'cross_review' }] },
        checkpoints: [{ id: 'cp1', label: 'write', status: 'pending', verifier: 'auto' }],
        execution_report: { summary: 'source note', artifacts: ['DO-NOT-READ/report.md'], blockers: [], notes: 'inert history',
          started_at: '2026-10-03T00:00:00Z', completed_at: '2026-10-03T00:00:01Z',
          verification: { verdict: 'pending', checked_at: '2026-10-03T00:00:01Z', note: 'not a DecisionRecord' } } },
      { ...common, id: 'n2', type: 'task', label: 'Consume report' },
      { ...common, id: 'ctx1', type: 'context', label: 'Context', boundary: 'fixture data',
        glossary: [{ term: 'report', definition: 'plain text data' }], contracts: [{ to: 'ctx2', contract }] },
      { ...common, id: 'ctx2', type: 'context', label: 'Second context' },
      { ...common, id: 'adr1', type: 'adr', status: 'accepted', label: 'Keep sources', decision: 'only copy snapshots',
        background: 'old truth stays untouched', considered_options: 'copy or rewrite', why: 'retain origin', consequences: 'explicit copy' },
    ], edges: [
      { id: 'e1', source: 'n1', target: 'n2', type: 'depends_on', reason: 'consume report after n1', contract },
      { id: 'e2', source: 'adr1', target: 'n1', type: 'decides', reason: 'delivery policy' },
      { id: 'e3', source: 'ctx1', target: 'ctx2', type: 'relates', rel_kind: 'upstream', reason: 'knowledge' },
      { id: 'e4', source: 'ctx1', target: 'n1', type: 'shares_context', reason: 'domain reference' },
    ] };
  const base = graph({ graphId: 'sp-example', revision: 0 });
  const { nodes, typedEdges, ...graphBindings } = base;
  const bindings = { graph: graphBindings,
    nodes: [node('n1', 'deterministic'), node('n2', 'deterministic', { terminal: true })], fallbacks: [] };
  return { delivery, bindings };
}
export function witnesses() {
  const calls = { hostPort: 0, journal: 0, decisions: 0, grants: 0, claims: 0 };
  const ports = { hostPort: { dispatchEffect: () => calls.hostPort++ }, journal: { append: () => calls.journal++ },
    decisions: { write: () => calls.decisions++ }, grants: { issue: () => calls.grants++ }, claims: { claim: () => calls.claims++ } };
  return { calls, ports, bridge: createSPBridge(ports) };
}
export function value(result) { if (!result.ok) throw Error(JSON.stringify(result.error)); return result.value; }
export function fallbackFixture() {
  const data = fixture();
  data.delivery.edges = [{ id: 'fallback1', source: 'n1', target: 'n2', type: 'fallback', reason: 'dead source alternative' }];
  data.bindings.fallbacks = [{ edgeId: 'fallback1', when: predicate('eq', 'outcome.ok', false), maxAttempts: 2 }];
  return data;
}
