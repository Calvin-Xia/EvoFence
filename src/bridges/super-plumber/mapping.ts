import { reject } from './types.js';
import type { DeliverySnapshot, Json, LossEntry, Row } from './types.js';

const supported = (source: string, target: string, reason: string): LossEntry => ({ source, target, classification: 'supported', reason });
const lossy = (source: string, target: string, reason: string): LossEntry => ({ source, target, classification: 'lossy', reason });
const rejected = (source: string, reason: string): LossEntry => ({ source, target: 'rejected', classification: 'rejected', reason });
/** Each recognized enum and field has an executable classification, not a comment. */
export const MAPPINGS: readonly LossEntry[] = [
  ...['graph.entry', 'graph.exit', 'graph.fog', 'graph.review', 'graph.review.layers', 'task.plan',
    'task.plan.input_from', 'task.plan.output_to', 'task.plan.required_context', 'task.expected_outcome',
    'task.expected_outcome.quality_gates', 'task.checkpoints', 'task.execution_report',
    'task.execution_report.verification', 'context.glossary', 'context.contracts', 'edge.contract',
    'context.contracts.contract', 'contract.consumed_by', 'contract.validation', 'graph.nodes', 'graph.edges'].map(
    field => supported(field, 'delivery annotation container', 'Container and exact member presence retained')),
  supported('node.type.task', 'NodeSpec + delivery annotation', 'Caller supplies the complete bounded NodeSpec'),
  ...['context', 'adr'].map(type => supported(`node.type.${type}`, 'delivery annotation', 'Knowledge is preserved as data, never scheduled')),
  ...['checkpoint', 'decision', 'gate'].map(type => rejected(`node.type.${type}`, 'No equivalent execution/decision authority; author a new runtime node explicitly')),
  supported('edge.type.depends_on', 'EdgeSpec.dependency', 'Source is the prerequisite; target is the consumer'),
  lossy('edge.type.iterates', 'delivery annotation', 'Documentary only; no ordering, loop, repair or dependency is inferred'),
  lossy('edge.type.fallback', 'EdgeSpec.fallback', 'SP dead-node alternative is not runtime routing; explicit predicate and attempt bound required; no ordering or retry'),
  ...['shares_context', 'decides', 'relates'].map(type => supported(`edge.type.${type}`, 'delivery annotation', 'No scheduling or gate semantics')),
  ...['validates', 'fan_out', 'fan_in'].map(type => rejected(`edge.type.${type}`, 'Cannot infer an evaluator, parallel scope or required join branches')),
  supported('task.status.pending', 'initialStates.pending (data)', 'No claim, event, execution or state transition'),
  ...['failed', 'cancelled'].map(status => lossy(`task.status.${status}`, 'delivery annotation; runtime initial state pending', 'Historical failure/cancellation retained, not a runtime receipt')),
  ...['ready', 'running', 'passed', 'blocked'].map(status => rejected(`task.status.${status}`, 'Delivery lifecycle is not runtime authority or evidence')),
  ...['proposed', 'accepted', 'superseded'].map(status => supported(`adr.status.${status}`, 'delivery annotation', 'ADR record grants no runtime authority')),
  supported('context.status.pending', 'delivery annotation', 'Context is never an executing node'),
  ...['id', 'label', 'level', 'priority', 'context', 'attempts', 'max_attempts', 'created_at', 'updated_at', 'reason'].map(
    field => supported(`node.${field}`, 'delivery annotation', 'Exact source value retained; attempts and timestamps are not runtime counters')),
  ...['plan.description', 'plan.input_from.node', 'plan.input_from.artifact', 'plan.required_context.key', 'plan.required_context.source',
    'plan.output_to.node', 'plan.output_to.artifact', 'expected_outcome.definition_of_done', 'expected_outcome.quality_gates.check',
    'expected_outcome.quality_gates.method', 'checkpoints.id', 'checkpoints.label', 'checkpoints.status', 'checkpoints.verifier',
    'execution_report.summary', 'execution_report.artifacts', 'execution_report.blockers', 'execution_report.notes',
    'execution_report.started_at', 'execution_report.completed_at', 'execution_report.verification.verdict',
    'execution_report.verification.checked_at', 'execution_report.verification.note'].map(
    field => supported(`task.${field}`, 'delivery annotation', 'Text and artifact paths retained without reading artifacts or executing checks')),
  ...['boundary', 'glossary.term', 'glossary.definition', 'contracts.to'].map(
    field => supported(`context.${field}`, 'delivery annotation', 'Knowledge text/reference retained without context injection')),
  ...['decision', 'background', 'considered_options', 'why', 'consequences', 'superseded_by'].map(
    field => supported(`adr.${field}`, 'delivery annotation', 'ADR content retained; acceptance is not a DecisionRecord')),
  ...['produces', 'consumed_by.artifact', 'consumed_by.used_as', 'validation.required', 'validation.method'].map(
    field => supported(`contract.${field}`, 'edge.contract / context.contracts[].contract annotation', 'Contract text preserved; no digest/schema/evaluator qualification inferred')),
  ...['id', 'source', 'target', 'rel_kind', 'reason'].map(field => supported(`edge.${field}`, 'delivery annotation / EdgeSpec identity', 'Exact identity, direction and reason preserved')),
  ...['id', 'version', 'label', 'entry.description', 'entry.defined_by', 'entry.level', 'exit.description',
    'exit.acceptance_criteria', 'exit.defined_by', 'exit.level', 'root_context', 'class', 'fog.id', 'fog.description',
    'fog.graduation', 'fog.ignited', 'nodes.file', 'edges.file'].map(field => supported(`graph.${field}`, 'delivery annotation', 'Delivery metadata and manifest references retained without following files')),
  rejected('event.design_approved', 'SP approval journal events cannot become runtime events or credentials'),
  ...['review.status', 'review.by', 'review.at', 'review.layers.level', 'review.layers.by', 'review.layers.at', 'design_approved',
    'node.review', 'node.assigned_to'].map(field => lossy(field.startsWith('node.') ? field : `graph.${field}`,
    'delivery annotation only', 'Recorded prompt/review/assignment is not a grant, DecisionRecord, state transition, gate or uplift evidence')),
];

export function mapping(source: string): LossEntry {
  const row = MAPPINGS.find(item => item.source === source);
  if (row === undefined) reject('EFK_SCHEMA_INVALID', 'unclassified SP field or enum: ' + source);
  if (row.classification === 'rejected') reject('EFK_CAPABILITY_UNSUPPORTED', source + ': ' + row.reason);
  return row;
}
export function object(value: unknown, allowed: readonly string[] | null, required: readonly string[]): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) reject('EFK_SCHEMA_INVALID', 'expected SP object');
  const row = value as Row;
  if (allowed !== null && Object.keys(row).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(row, key))) {
    reject('EFK_SCHEMA_INVALID', 'missing or unknown SP fields');
  }
  return row;
}
export function list(value: unknown): Json[] {
  if (!Array.isArray(value)) reject('EFK_SCHEMA_INVALID', 'expected SP array');
  return value;
}
function string(value: unknown): void {
  if (typeof value !== 'string') reject('EFK_SCHEMA_INVALID', 'expected SP text');
}
function integer(value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) reject('EFK_SCHEMA_INVALID', 'expected nonnegative SP integer');
}
function strings(value: unknown): void { list(value).forEach(string); }
function enumValue(value: unknown, values: readonly string[]): void {
  if (typeof value !== 'string' || !values.includes(value)) reject('EFK_SCHEMA_INVALID', 'unknown SP enum');
}
function json(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || ancestors.has(value) || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    reject('EFK_SCHEMA_INVALID', 'SP snapshot must be finite acyclic plain JSON data');
  }
  ancestors.add(value);
  Object.values(value).forEach(child => json(child, ancestors));
  ancestors.delete(value);
}
function fields(row: Row, prefix: string, validators: Record<string, (value: Json) => void>): void {
  for (const [key, value] of Object.entries(row)) { mapping(prefix + '.' + key); validators[key](value); }
}
function contract(value: Json): void {
  const row = object(value, ['produces', 'consumed_by', 'validation'], []);
  fields(row, 'contract', {
    produces: string,
    consumed_by: value => list(value).forEach(item => {
      const child = object(item, ['artifact', 'used_as'], ['artifact', 'used_as']);
      fields(child, 'contract.consumed_by', { artifact: string, used_as: string });
    }),
    validation: value => {
      const child = object(value, ['required', 'method'], ['required', 'method']);
      fields(child, 'contract.validation', { required: value => {
        if (typeof value !== 'boolean') reject('EFK_SCHEMA_INVALID', 'expected contract boolean');
      }, method: value => enumValue(value, ['auto', 'cross_review', 'human']) });
    },
  });
}
// Container keys are classified through their leaf fields, avoiding duplicate loss entries.
function nested(value: Json, allowed: string[], required: string[], prefix: string, validators: Record<string, (value: Json) => void>): void {
  const row = object(value, allowed, required);
  for (const [key, child] of Object.entries(row)) {
    mapping(prefix + '.' + key);
    validators[key](child);
  }
}
const texts = (keys: string[]) => Object.fromEntries(keys.map(key => [key, string]));
function review(value: Json): void {
  nested(value, ['status', 'by', 'at', 'layers'], ['status', 'by', 'at'], 'graph.review', {
    status: value => enumValue(value, ['approved', 'self', 'unreviewed']), by: string, at: string,
    layers: value => list(value).forEach(item => nested(item, ['level', 'by', 'at'], ['level', 'by', 'at'], 'graph.review.layers', texts(['level', 'by', 'at']))),
  });
}
function plan(value: Json): void {
  nested(value, ['description', 'input_from', 'required_context', 'output_to'], ['description'], 'task.plan', {
    description: string,
    ...Object.fromEntries(['input_from', 'output_to', 'required_context'].map(key => [key, (value: Json) => {
      const keys = key === 'required_context' ? ['key', 'source'] : ['node', 'artifact'];
      list(value).forEach(item => nested(item, keys, keys, 'task.plan.' + key, texts(keys)));
    }])),
  });
}
function report(value: Json): void {
  const keys = ['summary', 'artifacts', 'blockers', 'notes', 'started_at', 'completed_at', 'verification'];
  nested(value, keys, ['summary'], 'task.execution_report', {
    ...texts(['summary', 'notes', 'started_at', 'completed_at']), artifacts: strings, blockers: strings,
    verification: value => nested(value, ['verdict', 'checked_at', 'note'], ['verdict'], 'task.execution_report.verification', {
      verdict: value => enumValue(value, ['pending', 'passed', 'failed']), checked_at: string, note: string,
    }),
  });
}
export function validateSnapshot(value: unknown): DeliverySnapshot {
  json(value);
  const root = object(value, ['format', 'graph', 'nodes', 'edges'], ['format', 'graph', 'nodes', 'edges']);
  if (root.format !== 'evofence.sp-snapshot/1') reject('EFK_PROTOCOL_UNSUPPORTED', 'explicit evofence.sp-snapshot/1 envelope required');
  const graphKeys = ['id', 'version', 'label', 'entry', 'exit', 'root_context', 'review', 'fog', 'class', 'design_approved', 'nodes', 'edges'];
  const graph = object(root.graph, graphKeys, ['id', 'version', 'label', 'entry', 'exit']);
  nested(graph, graphKeys, [], 'graph', {
    ...texts(['id', 'version', 'label']),
    entry: value => nested(value, ['description', 'defined_by', 'level'], ['description', 'defined_by', 'level'], 'graph.entry', {
      description: string, defined_by: value => enumValue(value, ['human', 'llm']), level: integer,
    }),
    exit: value => nested(value, ['description', 'acceptance_criteria', 'defined_by', 'level'], ['description', 'acceptance_criteria', 'defined_by', 'level'], 'graph.exit', {
      description: string, acceptance_criteria: strings, defined_by: value => enumValue(value, ['human', 'llm']), level: integer,
    }), root_context: value => { object(value, null, []); },
    ...Object.fromEntries(['nodes', 'edges'].map(key => [key, (value: Json) => {
      list(value).forEach(item => nested(item, ['file'], ['file'], 'graph.' + key, { file: string }));
    }])),
    review, class: value => enumValue(value, ['quick', 'standard', 'program']),
    design_approved: value => { if (typeof value !== 'boolean') reject('EFK_SCHEMA_INVALID', 'expected review boolean'); },
    fog: value => nested(value, ['id', 'description', 'graduation', 'ignited'], ['id', 'description', 'graduation'], 'graph.fog', {
      ...texts(['id', 'description', 'graduation']), ignited: strings,
    }),
  });
  const common = ['id', 'type', 'label', 'level', 'priority', 'context', 'status', 'assigned_to', 'attempts', 'max_attempts', 'created_at', 'updated_at', 'reason', 'review'];
  const taskKeys = ['plan', 'expected_outcome', 'checkpoints', 'execution_report'];
  const contextKeys = ['boundary', 'glossary', 'contracts'];
  const adrKeys = ['decision', 'background', 'considered_options', 'why', 'consequences', 'superseded_by'];
  const nodes = list(root.nodes).map(value => {
    const candidate = object(value, [...common, ...taskKeys, ...contextKeys, ...adrKeys], ['id', 'type', 'label', 'level', 'status', 'attempts', 'max_attempts', 'created_at', 'updated_at']);
    mapping('node.type.' + candidate.type);
    const type = candidate.type as string, status = candidate.status as string;
    mapping(type + '.status.' + status);
    const row = object(candidate, [...common, ...(type === 'task' ? taskKeys : type === 'context' ? contextKeys : adrKeys)], type === 'adr' ? ['decision'] : []);
    for (const key of common.filter(key => key !== 'type' && key !== 'status' && key !== 'review')) {
      if (Object.hasOwn(row, key)) { mapping('node.' + key); (['level', 'priority', 'attempts', 'max_attempts'].includes(key) ? integer : string)(row[key]); }
    }
    if (Object.hasOwn(row, 'review')) { mapping('node.review'); review(row.review); }
    if (Object.hasOwn(row, 'plan')) plan(row.plan);
    if (Object.hasOwn(row, 'execution_report')) report(row.execution_report);
    if (Object.hasOwn(row, 'expected_outcome')) nested(row.expected_outcome, ['definition_of_done', 'quality_gates'], ['definition_of_done'], 'task.expected_outcome', {
      definition_of_done: strings, quality_gates: value => list(value).forEach(item => nested(item, ['check', 'method'], ['check', 'method'], 'task.expected_outcome.quality_gates', {
        check: string, method: value => enumValue(value, ['auto', 'cross_review', 'human']),
      })),
    });
    if (Object.hasOwn(row, 'checkpoints')) list(row.checkpoints).forEach(value => nested(value, ['id', 'label', 'status', 'verifier'], ['id', 'label', 'status', 'verifier'], 'task.checkpoints', {
      id: string, label: string, status: value => enumValue(value, ['pending', 'running', 'passed', 'failed', 'skipped']), verifier: value => enumValue(value, ['auto', 'cross_review', 'human']),
    }));
    for (const key of adrKeys) if (Object.hasOwn(row, key)) { mapping('adr.' + key); string(row[key]); }
    if (type === 'adr' && (row.decision === '' || status === 'superseded' && (typeof row.superseded_by !== 'string' || row.superseded_by === ''))) {
      reject('EFK_SCHEMA_INVALID', 'ADR decision and supersession reference must be explicit');
    }
    if (Object.hasOwn(row, 'boundary')) { mapping('context.boundary'); string(row.boundary); }
    if (Object.hasOwn(row, 'glossary')) list(row.glossary).forEach(value => nested(value, ['term', 'definition'], ['term', 'definition'], 'context.glossary', texts(['term', 'definition'])));
    if (Object.hasOwn(row, 'contracts')) list(row.contracts).forEach(value => {
      const child = object(value, ['to', 'contract'], ['to', 'contract']); mapping('context.contracts.to'); string(child.to); contract(child.contract);
    });
    return row;
  });
  const edges = list(root.edges).map(value => {
    const row = object(value, ['id', 'source', 'target', 'type', 'contract', 'rel_kind', 'reason'], ['id', 'source', 'target', 'type']);
    mapping('edge.type.' + row.type);
    for (const key of ['id', 'source', 'target', 'rel_kind', 'reason']) if (Object.hasOwn(row, key)) { mapping('edge.' + key); string(row[key]); }
    if (Object.hasOwn(row, 'contract')) contract(row.contract);
    return row;
  });
  return { format: 'evofence.sp-snapshot/1', graph, nodes, edges };
}
