import { decode } from '../../protocol/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { bytes, frozen, json, publish, same } from './artifacts.js';
import { loadRegistration, preregister } from './preregistration.js';
import { observe } from './observations.js';
import { judge, metrics } from './judgement.js';
import type { StatisticalVerdict } from './judgement.js';
import { statistics } from './statistics.js';
import type { ArtifactRef, CapabilityJudgement, DecisionRecord, EvolutionEvaluation,
  EvolutionPorts, EvaluationReceipt, Pair, Preregistration, Registration } from './types.js';

/** Unique evolution decision service. It produces no task verdict, promotion or activation. */
export function createEvolutionEvaluator(registrationInput: Registration, ports: EvolutionPorts) {
  const registration: Registration = frozen(JSON.parse(canonical(registrationInput)) as Registration);
  function evaluateCapability(ref: ArtifactRef, at: number): StoreResult<EvolutionEvaluation> {
    const time = decode('Instant', at); if (!time.ok) return time;
    const loaded = loadRegistration(ref, at, registration, ports); if (!loaded.ok) return loaded;
    const registered = loaded.value, plan = registered.plan;
    const measured = observe(registered, at, registration, ports); if (!measured.ok) return measured;
    const observations = measured.value;
    const evidenceExpiry = [ref, plan.protocolRef, plan.analysisScriptRef, ...plan.dataSplitRefs,
      ...plan.hosts.flatMap(h => [h.manifestRef, h.model.payloadRef!]),
      ...registered.splits.flatMap(s => s.samples.flatMap(x => [x.contractRef, x.privateTestsRef])),
      ...observations.flatMap(o => [o.ref, ...o.run.artifactRefs, o.run.actualDiffRef, ...o.evidenceRefs])]
      .concat(plan.approvalRef === null ? [] : [plan.approvalRef], plan.budget === null ? [] :
        [plan.budget.authorizationRef, plan.budget.priceRef].filter((r): r is ArtifactRef => r !== null) as ArtifactRef[])
      .map(r => r.expiresAt).filter((x): x is number => x !== null);
    if (plan.candidate.candidate.expiresAt !== null) evidenceExpiry.push(plan.candidate.candidate.expiresAt);
    const expiresAt = evidenceExpiry.length === 0 ? null : Math.min(...evidenceExpiry);
    const judgements: CapabilityJudgement[] = [], analyses: ArtifactRef[] = [], reasons: string[] = [];
    const selected = registered.splits.find(s => s.partition === plan.partition)!.samples;
    const totalKnown = observations.every(o => o.costMicros !== null && o.judgingCostMicros !== null)
      ? observations.reduce((sum, o) => sum + o.costMicros! + o.judgingCostMicros!, 0) : null;
    const requestCount = observations.reduce((sum, o) => sum + o.requestCount, 0);
    const budgetExceeded = plan.budget !== null && (requestCount > plan.budget.maxRequests ||
      (plan.budget.maxUsdMicros !== null && totalKnown !== null && totalKnown > plan.budget.maxUsdMicros));
    for (const host of plan.hosts) for (const trialId of plan.trialIds) for (const seed of plan.seeds) {
      let predecessorPositive = true;
      for (const comparison of plan.comparisons) {
        const [treatmentArm, controlArm] = comparison.split('-');
        const runs = observations.filter(o => o.run.hostId === host.hostId && o.run.trialId === trialId && o.run.seed === seed);
        const pairs: Pair[] = [];
        for (const sample of selected) {
          const control = runs.find(o => o.run.instanceId === sample.instanceId && o.run.arm === controlArm);
          const treatment = runs.find(o => o.run.instanceId === sample.instanceId && o.run.arm === treatmentArm);
          if (control !== undefined && treatment !== undefined) pairs.push({ sample, control, treatment });
        }
        const missing = runs.filter(o => o.run.arm === controlArm || o.run.arm === treatmentArm).length !== 2 * pairs.length;
        const stats = statistics(pairs, comparison === 'B-A' ? 0.15 : 0.10, plan.bootstrapSeed, plan.bootstrapReplicates, plan.plannedN, ports.digest);
        const statistical: StatisticalVerdict = predecessorPositive ? judge(registered, host, stats, pairs, missing)
          : { look: 'other' as const, verdict: 'exploratory_only' as const, reason: 'fixed-sequence-closed', continueSampling: false };
        const multi = metrics(pairs);
        const usageComplete = runs.every(o => o.usageComplete && o.judgingUsageComplete);
        const provenanceMeasured = runs.every(o => o.run.usage.every(u => ['provider', 'host-normalized'].includes(u.source)));
        const costBasis = !usageComplete ? 'unknown' : provenanceMeasured ? 'measured-usage-estimate' : 'estimate';
        const analysis = publish({ preregistrationRef: ref, analysisScriptRef: plan.analysisScriptRef,
          evaluatorVersion: registration.version, verifier: { issuer: ports.verifier.issuer, version: ports.verifier.version },
          hostId: host.hostId, hostVersion: host.version, model: host.model, trialId, seed, comparison,
          statistics: stats, metrics: multi, statistical, selectionRule: plan.selectionRule,
          sensitivityDisagrees: stats.bcaMvePositive !== null && stats.bcaMvePositive !== (statistical.verdict === 'positive'),
          orderSeed: plan.orderSeed, bootstrapSeed: plan.bootstrapSeed, requiredSampleIds: selected.map(s => s.instanceId),
          observedRuns: runs.map(o => ({ runRef: o.ref, verificationRef: o.evidenceRefs[0],
            runId: o.run.runId, arm: o.run.arm, seed: o.run.seed, trialId: o.run.trialId,
            success: o.success, costMicros: o.costMicros, usageComplete: o.usageComplete, incomplete: o.incomplete,
            uncertain: o.uncertain, polluted: o.polluted, judgingCostMicros: o.judgingCostMicros,
            retainedReservationMicros: o.retainedReservationMicros, requestCount: o.requestCount })),
          budget: { authorized: registered.budgetAuthorized, totalMicros: totalKnown, requestCount,
            exceeded: budgetExceeded, retainedReservationMicros: observations.reduce((sum, o) => sum + o.retainedReservationMicros, 0),
            missingUsagePolicy: 'retain-reservation' },
          judgingCostMicros: runs.every(o => o.judgingCostMicros !== null) ? runs.reduce((sum, o) => sum + o.judgingCostMicros!, 0) : null,
          evidenceKind: plan.evidenceKind, qualityIsSecondary: true, clusterUnit: 'repo',
          deff: new Set(selected.map(s => s.repoId)).size === selected.length ? 1 : null,
        }, 'EvolutionAnalysis', registration.issuer, plan.partition, ports); if (!analysis.ok) return analysis;
        analyses.push(analysis.value);
        const judgement: CapabilityJudgement = { cellStatus: host.cellStatus, look: statistical.look, verdict: statistical.verdict,
          protocolRef: plan.protocolRef, analysisRef: analysis.value, costBasis,
          guardrailCost: budgetExceeded ? 'failed' : multi.guardrailCost, guardrailWall: multi.guardrailWall,
          guardrailTruncation: multi.guardrailTruncation };
        judgements.push(judgement); reasons.push(statistical.reason);
        predecessorPositive = statistical.verdict === 'positive';
      }
    }
    const usageComplete = observations.length > 0 && observations.every(o => o.usageComplete && o.judgingUsageComplete);
    const benefitClaimAllowed = usageComplete && judgements.every(j => j.verdict === 'positive' && j.cellStatus === 'complete' &&
      j.look === 'CONFIRMATORY_LOOK' && j.guardrailCost === 'passed' && j.guardrailWall === 'passed' && j.guardrailTruncation === 'passed');
    if (!usageComplete) reasons.push('usage-incomplete');
    if (budgetExceeded) reasons.push('budget-exceeded');
    if (judgements.some(j => [j.guardrailCost, j.guardrailWall, j.guardrailTruncation].some(g => g !== 'passed'))) reasons.push('guardrails-not-passed');
    const evidenceRefs = [ref, plan.analysisScriptRef, ...plan.candidate.candidate.contentRefs, ...plan.candidate.candidate.sourceTraces,
      ...analyses]; // Each analysis retains the complete run/verification inventory by immutable reference.
    const receipt: EvaluationReceipt = { evaluationId: `evaluation:${ports.digest.digest(canonical([ref, analyses])).slice(7, 39)}`,
      candidate: plan.candidate.candidate.asset, baseDigest: plan.baseDigest, dependencyRefs: plan.candidate.candidate.dependencies,
      protocolRef: plan.protocolRef, dataSplitRefs: plan.dataSplitRefs, hostManifestRefs: plan.hosts.map(h => h.manifestRef),
      modelBindings: [...new Map(plan.hosts.map(h => [canonical(h.model), h.model])).values()], requiredJudgements: judgements, usageComplete,
      evidenceRefs: [...new Map(evidenceRefs.map(r => [canonical(r), r])).values()] };
    const valid = decode('EvaluationReceipt', receipt); if (!valid.ok) return valid;
    const receiptRef = publish(receipt, 'EvaluationReceipt', registration.issuer, plan.partition, ports, undefined, expiresAt); if (!receiptRef.ok) return receiptRef;
    const outcome = benefitClaimAllowed ? 'validated' : judgements.some(j => j.verdict === 'negative') ? 'rejected' : 'inconclusive';
    const decision: DecisionRecord = { protocol: receiptRef.value.protocol,
      decisionId: `candidate-decision:${receiptRef.value.digest.slice(7, 39)}`, kind: 'candidate',
      inputs: plan.candidate.candidate.contentRefs, contractRef: null, taskEvidenceRef: null,
      evaluationReceiptRef: receiptRef.value, activationReceiptRef: null, evaluatorVersion: registration.version,
      evaluationProtocolRef: plan.protocolRef, outcome, reasons: [...new Set(reasons)], evidenceRefs: receipt.evidenceRefs,
      feedbackVisibility: 'private', issuer: registration.issuer, capabilityJudgement: judgements[0] };
    const d = decode('DecisionRecord', decision); if (!d.ok) return d;
    const decisionRef = publish(decision, 'DecisionRecord', registration.issuer, plan.partition, ports, undefined, expiresAt); if (!decisionRef.ok) return decisionRef;
    return storeOk({ receipt, receiptRef: receiptRef.value, decision, decisionRef: decisionRef.value, benefitClaimAllowed, reasons: decision.reasons });
  }
  /** Same authority/path, never a second set of candidate acceptance rules. */
  function evaluateCandidate(ref: ArtifactRef, at: number): StoreResult<EvolutionEvaluation> { return evaluateCapability(ref, at); }
  /** l4_promotion consumes this port before its separate grant/journal decision. No promotion here. */
  function evaluationForPromotion(evaluation: EvolutionEvaluation, at: number): StoreResult<EvaluationReceipt> {
    const time = decode('Instant', at); if (!time.ok) return time;
    if (evaluation.decision.kind !== 'candidate' || !same(evaluation.decision.issuer, registration.issuer) ||
      !same(evaluation.receiptRef.producer, registration.issuer) || !same(evaluation.decisionRef.producer, registration.issuer)) {
      return storeFail('EFK_DECISION_AUTHORITY_DENIED', 'promotion requires the registered evolution authority, never a task verdict');
    }
    for (const ref of [evaluation.receiptRef, evaluation.decisionRef]) {
      const proof = ports.authority.verify(ref); if (!proof.ok) return proof;
    }
    const receipt = json(evaluation.receiptRef, at, ports); if (!receipt.ok) return receipt;
    const decision = json(evaluation.decisionRef, at, ports); if (!decision.ok) return decision;
    if (!same(receipt.value, evaluation.receipt) || !same(decision.value, evaluation.decision) ||
      !same(evaluation.decision.evaluationReceiptRef, evaluation.receiptRef)) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'promotion substituted evaluation material');
    // Use authoritative receipt/decision content, never a caller's benefitClaimAllowed boolean.
    const r = evaluation.receipt;
    if (evaluation.decision.outcome !== 'validated' || !r.usageComplete || r.requiredJudgements.length === 0 ||
      r.requiredJudgements.some(j => j.verdict !== 'positive' || j.look !== 'CONFIRMATORY_LOOK' || j.cellStatus !== 'complete' ||
        j.guardrailCost !== 'passed' || j.guardrailWall !== 'passed' || j.guardrailTruncation !== 'passed')) {
      return storeFail('EFK_EVALUATION_INSUFFICIENT', 'failed/uncertain/underpowered evaluation cannot qualify for promotion');
    }
    for (const ref of [r.protocolRef, ...r.dataSplitRefs, ...r.hostManifestRefs, ...r.evidenceRefs,
      ...r.requiredJudgements.map(j => j.analysisRef)]) { const available = bytes(ref, at, ports); if (!available.ok) return available; }
    return storeOk(r);
  }
  return { issuer: registration.issuer, preregister: (plan: Preregistration, at: number) => preregister(plan, at, registration, ports),
    evaluateCapability, evaluateCandidate, evaluationForPromotion };
}
