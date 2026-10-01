/** Registered evaluator -> single graph decide -> atomic decision and attempt transitions. */
import { decode } from '../../protocol/index.js';
import type { Decoded } from '../../protocol/index.js';
import { decide, type NodeOutcome } from '../../kernel/graph/index.js';
import { verifyForConsumer, type ArtifactRef as ConsumerArtifact, type BindingExpectation } from '../../storage/artifacts/index.js';
import { canonical, storeFail } from '../../storage/index.js';
import { bindingFor, currentAttemptOf, nodeStateOf } from './project.js';
import { commit, event, idFor, putObject, transition } from './journal.js';
import type { ArtifactRef, CommandOutcome, RuntimeState, SessionPorts, SessionSeed, StoreResult } from './types.js';

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
  const ref = putObject(ports, state, decision.decisionId, 'DecisionRecord', decision, effect.binding, decision.issuer as Decoded<'ActorRef'>);
  if (!ref.ok) return ref;
  const events = [event(state, commandId, 'decision', 'decision.recorded',
    { binding: effect.binding, objectRef: ref.value, decisionId: decision.decisionId }),
  transition(state, commandId, 'outcome', effect.binding, 'verifying', judged.nodeState,
    { decisionId: decision.decisionId, objectRef: ref.value })];
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
