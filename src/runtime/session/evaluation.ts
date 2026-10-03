/** Registered evaluator -> single graph decide -> atomic decision and attempt transitions. */
import { decode, DEFS } from '../../protocol/index.js';
import type { Decoded } from '../../protocol/index.js';
import { decide, type NodeOutcome } from '../../kernel/graph/index.js';
import { verifyForConsumer, type ArtifactRef as ConsumerArtifact, type BindingExpectation } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import { createTaskEvaluator, type Registration, type TaskContract, type TaskEvidenceReport } from '../../kernel/evaluation/index.js';
import { withheldReason, type AdmittedArtifact } from '../../kernel/artifacts/index.js';
import { bindingFor, currentAttemptOf, nodeStateOf } from './project.js';
import { commit, event, idFor, transition } from './journal.js';
import type { ArtifactRef, CommandOutcome, EventDraft, Receipt, RuntimeState, SessionPorts, SessionSeed, StoreResult } from './types.js';

/** Production adapter for the registered task service. Existing journal/repair logic remains below. */
export function createRuntimeTaskEvaluator(options: { readonly task: TaskContract; readonly registration: Registration;
  readonly artifacts: SessionPorts['artifacts']; readonly clock: SessionPorts['clock']; readonly digest: SessionPorts['digest'];
  /** Evaluator-owned observation path, including private measurements that never enter host receipts. */
  readonly observations: (seed: SessionSeed, state: RuntimeState, receipt: Receipt) => Promise<StoreResult<readonly ConsumerArtifact[]>> }) {
  return { issuer: options.registration.issuer as unknown as Decoded<'ActorRef'>,
    async evaluateTask(seed: SessionSeed, state: RuntimeState, receipt: Receipt) {
      const applied = [...state.events].reverse().find(e => e.type === 'receipt.applied' && e.payload.objectRef!.id === receipt.receiptId)!;
      const receiptRef = applied.payload.objectRef!;
      const observations = await options.observations(seed, state, receipt);
      if (!observations.ok) return observations;
      const artifactRefs = [...receipt.artifactRefs as unknown as ConsumerArtifact[], ...observations.value];
      const branches = new Map(options.task.requiredBranches.map(nodeId => [nodeId,
        bindingFor(state, seed, nodeId) as unknown as BindingExpectation]));
      const branchReport = options.task.requiredBranches.map(nodeId => {
        const binding = branches.get(nodeId)!;
        const product = [...state.events].reverse().find(e => e.type === 'receipt.applied'
          && canonical(e.payload.binding) === canonical(binding));
        const decision = [...state.events].reverse().find(e => e.type === 'decision.recorded'
          && canonical(e.payload.binding) === canonical(binding));
        return { nodeId, binding, state: nodeStateOf(state, nodeId, binding.attemptOrdinal),
          artifactRefs: product === undefined ? [] : [...state.receipts[product.payload.objectRef!.id].artifactRefs,
            product.payload.objectRef!] as unknown as ConsumerArtifact[],
          decisionRef: decision === undefined ? null : decision.payload.objectRef as unknown as ConsumerArtifact,
          gapReason: null };
      });
      const report: TaskEvidenceReport = { contractRef: seed.graph.spec.taskContractRef,
        binding: receipt.binding as unknown as BindingExpectation,
        privateTestsPassed: null, requiredOutcomesMet: null, branchReport,
        artifactRefs,
        actualDiffRef: artifactRefs.find(ref => ref.schema.name === 'ActualDiff') ?? null,
        runStatus: receipt.status === 'completed' ? 'completed' : receipt.status === 'unknown' ? 'unknown'
          : receipt.status === 'cancelled' ? 'cancelled' : 'incomplete',
        usageComplete: state.usageIssues.length === 0 && !state.budget.reservations.some(r => r.requestId === receipt.effectId
          || r.requestId === state.effects[receipt.effectId].reservationRef), privacyChecked: true };
      const at = options.clock.now(), evidence: AdmittedArtifact[] = [];
      const refs = [...report.artifactRefs, receiptRef as unknown as ConsumerArtifact,
        ...branchReport.flatMap(b => [...b.artifactRefs, ...(b.decisionRef === null ? [] : [b.decisionRef])]),
        ...options.task.acceptance.checkRefs];
      for (const ref of new Map(refs.map(r => [canonical(r), r])).values()) {
        const checkDefinition = options.task.acceptance.checkRefs.some(r => canonical(r) === canonical(ref));
        const expectation = checkDefinition ? { productKind: 'pre-source' as const, binding: null, schema: ref.schema }
          : { productKind: 'node-product' as const, binding: ref.binding !== null && branches.has(ref.binding.nodeId)
            ? branches.get(ref.binding.nodeId)! : report.binding, schema: ref.schema };
        const admitted = verifyForConsumer({ role: 'evaluator', refs: [ref], at, expectation }, options.artifacts);
        // Unavailable referenced bytes are an explicit acceptance gap, not successful evidence.
        if (!admitted.ok) {
          if (admitted.error.code === 'EFK_ARTIFACT_UNAVAILABLE') continue;
          return storeFail(admitted.error.code, 'task observation admission failed');
        }
        evidence.push(...admitted.value.evidence);
      }
      const repairAllowed = seed.graph.edgesFrom(receipt.binding.nodeId).some(edge => edge.type === 'repair'
        && currentAttemptOf(state, edge.to) < seed.graph.node(edge.to)!.termination.maxAttempts);
      const service = createTaskEvaluator(options.registration, { digest: options.digest, at,
        binding: report.binding, branches, evidence, inputs: [receiptRef as unknown as ConsumerArtifact], repairAllowed });
      const evaluated = service.evaluateReport(options.task, report);
      if (!evaluated.ok) return evaluated;
      const saved = options.artifacts.put(evaluated.value.decision.taskEvidenceRef as unknown as ArtifactRef, evaluated.value.reportBytes);
      return saved.ok ? { ok: true as const, value: evaluated.value.decision } : saved;
    } };
}

export async function evaluateSession(ports: SessionPorts, seed: SessionSeed, state: RuntimeState, effectId: string): Promise<StoreResult<CommandOutcome>> {
  const effect = state.effects[effectId];
  if (effect === undefined) return storeFail('EFK_ARTIFACT_UNAVAILABLE', 'evaluation has no committed effect', [effectId]);
  const receiptEvent = [...state.events].reverse().find(e => e.type === 'receipt.applied' && e.payload.effectId === effectId);
  if (receiptEvent === undefined) return storeFail('EFK_EFFECT_UNKNOWN', 'evaluation has no applied receipt', [effectId]);
  const receipt = state.receipts[receiptEvent.payload.objectRef!.id];
  if (nodeStateOf(state, effect.binding.nodeId, effect.binding.attemptOrdinal) !== 'verifying' || effect.binding.epoch !== state.epoch) {
    return storeFail('EFK_EFFECT_UNKNOWN', 'only the current verifying attempt can be evaluated', [effectId]);
  }
  const response = await ports.evaluator.evaluateTask(seed, state, receipt);
  if (!response.ok) return response;
  const decoded = decode('DecisionRecord', response.value);
  if (!decoded.ok) return decoded;
  const decision = decoded.value;
  // External evaluator boundary: registered issuer, task contract and exact evidence binding.
  if (decision.kind !== 'task' || canonical(decision.issuer) !== canonical(ports.evaluator.issuer)
    || canonical(decision.contractRef) !== canonical(seed.graph.spec.taskContractRef)
    || !decision.inputs.some(ref => ref.id === receiptEvent.payload.objectRef!.id && ref.digest === receiptEvent.payload.objectRef!.digest)) {
    return storeFail('EFK_DECISION_AUTHORITY_DENIED', 'decision issuer/contract/receipt does not match the registered evaluation', [decision.decisionId]);
  }
  const evidence = decision.taskEvidenceRef as ConsumerArtifact;
  const admitted = verifyForConsumer({ role: 'evaluator', refs: [evidence], at: ports.clock.now(),
    expectation: { productKind: 'node-product', binding: effect.binding as unknown as BindingExpectation, schema: evidence.schema } }, ports.artifacts);
  if (!admitted.ok) return admitted;
  let evidenceValue: unknown;
  try { evidenceValue = JSON.parse(admitted.value.evidence[0].bytes); }
  catch (error) {
    // Real serialized evidence boundary, not a fallback for internal faults.
    if (!(error instanceof SyntaxError)) throw error;
    return storeFail('EFK_SCHEMA_INVALID', 'task evidence is not JSON', [evidence.id]);
  }
  const report = decode('TaskEvidenceReport', evidenceValue);
  if (!report.ok) return report;
  if (evidence.schema.name !== 'TaskEvidenceReport' || canonical(report.value.binding) !== canonical(effect.binding)
    || canonical(report.value.contractRef) !== canonical(seed.graph.spec.taskContractRef)) {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'task evidence answers another contract/attempt', [evidence.id]);
  }
  const outcome: NodeOutcome = { ok: receipt.status === 'completed', reason: decision.reasons.join(':') || receipt.status,
    decision: decision.outcome as NodeOutcome['decision'] };
  const judged = decide(seed.graph, { kind: 'outcome', nodeId: effect.binding.nodeId, state: 'verifying', outcome });
  if (judged.violation !== null) return { ok: false, error: judged.violation };
  const commandId = idFor(ports, 'evaluation', [effectId, decision.decisionId]);
  // A13: the whole record/report is evaluator-only when any nested reference is restricted.
  let visibility: ConsumerArtifact['visibility'] = 'internal';
  for (const input of [...decision.inputs, ...decision.evidenceRefs, decision.taskEvidenceRef]) {
    const access = withheldReason(input as ConsumerArtifact, 'author');
    if (!access.ok) return access;
    if (access.value !== 'none') visibility = 'private';
  }
  const bytes = canonical(decision);
  const object: ArtifactRef = { protocol: state.protocol, id: decision.decisionId, digest: ports.digest.digest(bytes),
    producer: decision.issuer, binding: effect.binding, schema: { name: 'DecisionRecord', version: state.protocol.schemaVersion,
      digest: ports.digest.digest(canonical(DEFS.DecisionRecord)) }, location: `journal:${state.sessionId}:${decision.decisionId}`,
    visibility, expiresAt: null, partition: 'not-evaluation' };
  const stored = ports.artifacts.put(object, bytes);
  const ref = stored.ok ? storeOk(object) : stored;
  if (!ref.ok) return ref;
  const events: EventDraft[] = [{ ...event(state, commandId, 'decision', 'decision.recorded',
    { binding: effect.binding, objectRef: ref.value, decisionId: decision.decisionId }), visibility },
  { ...transition(state, commandId, 'outcome', effect.binding, 'verifying', judged.nodeState,
    { decisionId: decision.decisionId, objectRef: ref.value }), visibility }];
  for (const action of judged.graphActions) {
    if (action.kind === 'new-attempt') {
      const targetState = nodeStateOf(state, action.nodeId, currentAttemptOf(state, action.nodeId));
      if (action.nodeId !== effect.binding.nodeId && (targetState === 'leased' || targetState === 'running'
        || targetState === 'verifying' || targetState === 'unknown' || targetState === 'cancelling')) {
        return storeFail('EFK_GRAPH_ACTIVE_NODE_MUTATION', 'repair cannot supersede an active target attempt', [action.nodeId]);
      }
      const attempt = currentAttemptOf(state, action.nodeId) + 1;
      if (attempt > seed.graph.node(action.nodeId)!.termination.maxAttempts) return storeFail('EFK_GRAPH_BOUND_INVALID', 'repair attempt bound exhausted', [action.nodeId]);
      events.push(transition(state, commandId, `repair:${events.length}`, bindingFor(state, seed, action.nodeId, attempt), null, 'pending'));
    } else if (!judged.graphActions.some(a => a.kind === 'new-attempt' && a.nodeId === action.nodeId)) {
      const attempt = currentAttemptOf(state, action.nodeId);
      const before = nodeStateOf(state, action.nodeId, attempt);
      if (before === null || before === 'waiting') events.push(transition(state, commandId, `enable:${events.length}`, bindingFor(state, seed, action.nodeId), before, 'pending'));
    }
  }
  return commit(ports, state, { commandId, expectedRevision: state.revision }, { events, effects: [], receipts: [] });
}
