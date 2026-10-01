// Fixture measurements are honest about their evidenceKind; product imports use this build's dist.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFS } from '../dist/protocol/index.js';
import { canonical, createMemoryArtifactStore } from '../dist/storage/index.js';
import { testsProvider, outcomeProvider, artifactProvider, hostProvider, createTaskEvaluator } from '../dist/kernel/evaluation/index.js';
import { task as taskFixture } from './l2-policy-fixtures.js';
import { bindingFor, PROTOCOL } from './l2-scheduler-fixtures.mjs';

export const digest = { digest: bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
export const issuer = { actorId: 'eval-1', kind: 'evaluator', identityRef: null };
export const kernel = { actorId: 'kernel', kind: 'kernel', identityRef: null };
export function value(result) { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; }
export function schema(name) { return { name, version: '1.1.0', digest: digest.digest(canonical(DEFS[name] ?? { name })) }; }
export function contract(options = {}) {
  const task = taskFixture({ ...options, requiredOutcomes: options.requiredOutcomes ?? [
    { outcomeId: 'out-1', description: 'deliver the requested behavior', schema: schema('Deliverable'), evidenceKinds: ['native-fixture'] },
  ] });
  return { ...task, acceptance: { ...task.acceptance, outcomeSchema: schema('OutcomeObservation'), ...options.acceptance } };
}
export function registration(options = {}) {
  const base = (id, name, producer, privateTests = false) => ({ id, version: '1', schema: schema(name),
    producer, evidenceKind: 'native-fixture', privateTests });
  const providers = [testsProvider(base('tests', 'TestsObservation', issuer, true)),
    outcomeProvider(base('outcomes', 'OutcomeObservation', issuer)),
    artifactProvider(base('artifacts', 'Deliverable', kernel)),
    hostProvider(base('host', 'Receipt', options.hostProducer ?? kernel))];
  return { issuer, version: '1', providers, selected: providers.map(p => p.id), ...options };
}
export function fixture(options = {}) {
  const task = contract({ requiredBranches: options.branches ?? [], ...options.task });
  const contractRef = { taskId: task.taskId, version: task.version, digest: digest.digest(canonical(task)) };
  const binding = bindingFor('nEval', { baseDigest: digest.digest('base') });
  const artifacts = createMemoryArtifactStore({ digest });
  const evidence = [];
  function put(id, name, data, changes = {}) {
    const bytes = typeof data === 'string' ? data : canonical(data);
    const ref = { protocol: PROTOCOL, id, digest: digest.digest(bytes), producer: kernel, binding,
      schema: schema(name), location: `fixture:${id}`, visibility: 'internal', expiresAt: null,
      partition: 'not-evaluation', ...changes };
    value(artifacts.put(ref, bytes)); evidence.push({ ref, bytes }); return ref;
  }
  const tests = put('private-tests-marker', 'TestsObservation', options.tests ?? { total: 4, passed: 4, failed: 0, skipped: 0, exitCode: 0 },
    { producer: issuer, visibility: 'private', partition: 'held-out' });
  const outcomes = put('outcomes', 'OutcomeObservation', options.outcomes ?? { outcomes: [{ outcomeId: 'out-1', met: true }] }, { producer: issuer });
  const product = put('product', 'Deliverable', options.product ?? 'actual deliverable bytes');
  const receipt = { protocol: PROTOCOL, receiptId: 'receipt', effectId: 'effect', hostInvocationId: 'invocation', binding,
    status: 'completed', artifactRefs: [product], usage: [], observability: ['native-result'], error: null };
  const receiptRef = put('receipt', 'Receipt', receipt);
  const report = { contractRef, binding, privateTestsPassed: true, requiredOutcomesMet: true,
    branchReport: [], artifactRefs: [tests, outcomes, product], actualDiffRef: null,
    runStatus: 'completed', usageComplete: true, privacyChecked: true, ...options.report };
  const context = { digest, at: 1000, binding, branches: new Map(), evidence, inputs: [receiptRef], repairAllowed: false };
  function branch(nodeId, changes = {}) {
    const branchBinding = { ...bindingFor(nodeId), graph: binding.graph, baseDigest: binding.baseDigest };
    context.branches.set(nodeId, branchBinding);
    const ref = put(`product:${nodeId}`, 'Deliverable', 'branch product', { binding: branchBinding });
    const run = put(`receipt:${nodeId}`, 'Receipt', { ...receipt, receiptId: `receipt:${nodeId}`,
      effectId: `effect:${nodeId}`, hostInvocationId: `invoke:${nodeId}`, binding: branchBinding, artifactRefs: [ref] }, { binding: branchBinding });
    const branchReport = { ...report, binding: branchBinding, branchReport: [], artifactRefs: [ref, run] };
    const evidenceRef = put(`report:${nodeId}`, 'TaskEvidenceReport', branchReport, { binding: branchBinding, producer: issuer });
    const decisionRef = put(`decision:${nodeId}`, 'DecisionRecord', { protocol: PROTOCOL, decisionId: `decision:${nodeId}`, kind: 'task',
      inputs: [evidenceRef, run], contractRef, taskEvidenceRef: evidenceRef, evaluationReceiptRef: null, activationReceiptRef: null,
      evaluatorVersion: '1', evaluationProtocolRef: null, outcome: 'completed', reasons: [], evidenceRefs: [ref],
      feedbackVisibility: 'internal', issuer, capabilityJudgement: null }, { binding: branchBinding, producer: issuer });
    const entry = { nodeId, binding: branchBinding, state: 'succeeded', artifactRefs: [ref, run], decisionRef, gapReason: null, ...changes };
    report.branchReport.push(entry); return entry;
  }
  return { task, report, context, put, branch, artifacts, tests, outcomes, product, receiptRef,
    evaluate: (reg = registration()) => createTaskEvaluator(reg, context).evaluateReport(task, report) };
}
