/** Absolute task acceptance; no baseline, capability benefit, graph transition or journal mutation. */
import { decode, DEFS } from '../../protocol/index.js';
import { bindingMismatches, checkBinding, withheldReason } from '../artifacts/index.js';
import type { ArtifactRef } from '../artifacts/index.js';
import { canonical, storeFail, storeOk } from '../store/index.js';
import type { StoreResult } from '../store/index.js';
import { evaluateBranches } from './branches.js';
import type { DecisionRecord, EvaluationContext, EvaluationGap, Measurement, Registration,
  TaskContract, TaskEvaluation, TaskEvidenceReport, TaskOutcome } from './types.js';

/** Registration is explicit and construction does not touch a port. */
export function createTaskEvaluator(registration: Registration, context: EvaluationContext) {
  const selected = registration.selected.map(id => registration.providers.find(p => p.id === id));
  function evaluateReport(task: TaskContract, report: TaskEvidenceReport): StoreResult<TaskEvaluation> {
    const contract = decode('TaskContract', task);
    if (!contract.ok) return storeFail(contract.error.code, 'task contract does not satisfy the frozen codec');
    const decoded = decode('TaskEvidenceReport', report);
    if (!decoded.ok) return storeFail(decoded.error.code, 'task evidence does not satisfy the frozen codec');
    if (registration.issuer.kind !== 'evaluator' || task.acceptance.evaluatorId !== registration.issuer.actorId
      || task.acceptance.evaluatorVersion !== registration.version || selected.some(p => p === undefined)
      || new Set(registration.selected).size !== registration.selected.length
      || new Set(registration.providers.map(p => p.id)).size !== registration.providers.length
      || registration.providers.some(p => p.privateTests && p.metric !== 'tests')) {
      return storeFail('EFK_DECISION_AUTHORITY_DENIED', 'task evaluator registration/selection does not match the contract');
    }
    if (task.taskId !== report.contractRef.taskId || task.version !== report.contractRef.version
      || context.digest.digest(canonical(task)) !== report.contractRef.digest
      || bindingMismatches(report.binding, context.binding).length > 0) {
      return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'task report differs from the pinned contract/current attempt');
    }
    const providers = selected as Registration['providers'];
    if (providers.some(p => p.metric === 'outcome' && canonical(p.schema) !== canonical(task.acceptance.outcomeSchema))) {
      return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'outcome provider does not match the contract acceptance schema');
    }
    const gaps: EvaluationGap[] = [], measurements: Measurement[] = [];
    const gap = (gapReason: string, repair: string, status: EvaluationGap['status'], refs: readonly ArtifactRef[] = []) => {
      gaps.push({ gapReason, repair, status, refs, branchId: null });
    };
    const requiredRefs = [...report.artifactRefs, ...context.inputs];
    if (report.actualDiffRef !== null) requiredRefs.push(report.actualDiffRef);
    for (const ref of requiredRefs) {
      const bound = checkBinding(ref, { productKind: 'node-product', binding: context.binding, schema: ref.schema });
      if (!bound.ok) return storeFail(bound.error.code, 'observation does not match the current task attempt');
    }
    for (const item of context.evidence) {
      if (context.digest.digest(item.bytes) !== item.ref.digest) {
        return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', 'measurement bytes differ from their pinned digest');
      }
    }
    const mainEvidence = context.evidence.filter(e => requiredRefs.some(ref => canonical(ref) === canonical(e.ref)));
    const mainRefs = mainEvidence.map(e => e.ref);
    for (const ref of requiredRefs) {
      if (!mainRefs.some(r => canonical(ref) === canonical(r))) gap('artifact-bytes-missing', 'Collect the referenced artifact bytes for this attempt.', 'unknown');
    }
    for (const ref of task.acceptance.checkRefs) {
      if (!context.evidence.some(e => canonical(ref) === canonical(e.ref))) gap('check-definition-missing', 'Load the pinned acceptance check definition.', 'unknown');
    }
    for (const metric of ['tests', 'outcome', 'artifact', 'host'] as const) {
      if (!providers.some(p => p.metric === metric)) gap(`${metric}-provider-missing`, `Register and select the required ${metric} measurement provider.`, 'unknown');
    }
    if (report.privateTestsPassed !== null && !providers.some(p => p.metric === 'tests' && p.privateTests)) {
      gap('private-tests-evidence-missing', 'Collect private acceptance evidence through the registered evaluator.', 'unknown');
    }
    for (const p of providers) {
      const result = p.measure(task, mainEvidence);
      if (!result.ok) return result;
      if (p.privateTests) for (const ref of result.value.refs) {
        const access = withheldReason(ref, 'author');
        if (!access.ok) return access;
        if (access.value === 'none') return storeFail('EFK_PRIVACY_VIOLATION', 'private tests observation must be evaluator-only');
      }
      measurements.push(result.value);
      if (result.value.status !== 'passed') gap(result.value.gapReason!, result.value.repair, result.value.status, result.value.refs);
    }
    for (const outcome of task.requiredOutcomes) {
      if (!providers.some((p, i) => p.metric === 'artifact' && outcome.evidenceKinds.includes(p.evidenceKind)
        && canonical(p.schema) === canonical(outcome.schema) && measurements[i].status === 'passed'
        && measurements[i].outcomeIds.includes(outcome.outcomeId))) {
        gap('outcome-artifact-missing', `Produce and verify declared outcome ${outcome.outcomeId}.`, 'unknown');
      }
    }
    const branches = evaluateBranches(task, report, context, registration.issuer);
    if (!branches.ok) return branches;
    gaps.push(...branches.value.gaps);
    if (task.scope.workspaceRef !== null && (report.actualDiffRef === null || report.actualDiffRef.schema.name !== 'ActualDiff'
      || !mainEvidence.some(e => canonical(e.ref) === canonical(report.actualDiffRef) && e.bytes.trim().length > 0))) {
      gap('actual-diff-missing', 'Collect the actual diff against the attempt base snapshot.', 'unknown');
    }
    if (!report.privacyChecked) gap('privacy-not-checked', 'Complete the artifact audience check before requesting reevaluation.', 'unknown');
    if (!report.usageComplete) gap('usage-incomplete', 'Reconcile missing usage; retain the outstanding reservation.', 'unknown');
    if (report.runStatus !== 'completed') gap(`run-${report.runStatus}`, report.runStatus === 'needs-human'
      ? 'Obtain the missing human decision or authorization.' : 'Reconcile the observed run status before requesting a new attempt.',
      report.runStatus === 'needs-human' ? 'needs-human' : ['incomplete', 'timeout', 'cancelled'].includes(report.runStatus) ? 'failed' : 'unknown');
    const failed = gaps.some(g => g.status === 'failed');
    const unknown = gaps.some(g => g.status === 'unknown');
    // Unknown mandatory acceptance dominates repair: never speculate that an unmeasured item passed.
    const outcome: TaskOutcome = unknown ? 'unknown'
      : gaps.some(g => g.status === 'needs-human') ? 'needs-human'
      : failed ? context.repairAllowed ? 'repair' : 'failed' : 'completed';
    const tests = measurements.filter((_m, i) => providers[i].privateTests);
    const outcomes = measurements.filter(m => m.metric === 'outcome');
    const normalized: TaskEvidenceReport = { ...report, branchReport: branches.value.branches,
      privateTestsPassed: providers.some(p => p.privateTests)
        ? tests.some(m => m.status === 'failed') ? false : tests.every(m => m.status === 'passed') ? true : null : null,
      requiredOutcomesMet: outcomes.some(m => m.status === 'failed') ? false
        : outcomes.length > 0 && outcomes.every(m => m.status === 'passed') ? true : null };
    let visibility: ArtifactRef['visibility'] = 'internal';
    for (const ref of [...requiredRefs, ...branches.value.branches.flatMap(b => [...b.artifactRefs,
      ...(b.decisionRef === null ? [] : [b.decisionRef])])]) {
      const withheld = withheldReason(ref, 'author');
      if (!withheld.ok) return withheld;
      if (withheld.value !== 'none') visibility = 'private';
    }
    const reportBytes = canonical(normalized), digest = context.digest.digest(reportBytes);
    const evidenceRef: ArtifactRef = { protocol: task.protocol, id: `task-evidence:${digest.slice(7, 39)}`,
      digest, producer: registration.issuer, binding: context.binding,
      schema: { name: 'TaskEvidenceReport', version: task.protocol.schemaVersion,
        digest: context.digest.digest(canonical(DEFS.TaskEvidenceReport)) },
      location: `evaluation:${context.binding.sessionId}:${digest.slice(7, 39)}`, visibility,
      expiresAt: null, partition: 'not-evaluation' };
    const evidenceRefs = [...new Map(context.evidence.map(e => [canonical(e.ref), e.ref])).values()];
    const reasons = [...new Set(gaps.map(g => g.gapReason))];
    const decision: DecisionRecord = { protocol: task.protocol,
      decisionId: `task-decision:${context.digest.digest(canonical([digest, registration.issuer, registration.version,
        providers.map(p => [p.id, p.version]), outcome, reasons])).slice(7, 39)}`, kind: 'task',
      inputs: [...new Map([...context.inputs, evidenceRef].map(r => [canonical(r), r])).values()],
      contractRef: report.contractRef, taskEvidenceRef: evidenceRef, evaluationReceiptRef: null,
      activationReceiptRef: null, evaluatorVersion: registration.version, evaluationProtocolRef: null,
      outcome, reasons, evidenceRefs, feedbackVisibility: task.privacy.feedbackVisibility,
      issuer: registration.issuer, capabilityJudgement: null };
    return storeOk({ decision, report: normalized, reportBytes, measurements, gaps });
  }
  return { issuer: registration.issuer, evaluateReport,
    /** The typed EvaluatorPort surface returns the DecisionRecord; inspection is evaluator-only. */
    evaluateTask(task: TaskContract, report: TaskEvidenceReport): StoreResult<DecisionRecord> {
      const evaluated = evaluateReport(task, report);
      return evaluated.ok ? storeOk(evaluated.value.decision) : evaluated;
    } };
}
