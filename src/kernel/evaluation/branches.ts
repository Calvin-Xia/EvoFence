/** A11: produce one entry per required branch, including missing/failed/cancelled attempts. */
import { decode } from '../../protocol/index.js';
import { bindingMismatches, checkBinding } from '../artifacts/index.js';
import { canonical, storeFail, storeOk } from '../store/index.js';
import type { StoreResult } from '../store/index.js';
import type { BranchEvidence, EvaluationContext, EvaluationGap, Registration, TaskContract, TaskEvidenceReport } from './types.js';

export function evaluateBranches(task: TaskContract, report: TaskEvidenceReport, context: EvaluationContext, issuer: Registration['issuer']): StoreResult<{
  readonly branches: readonly BranchEvidence[]; readonly gaps: readonly EvaluationGap[];
}> {
  const branches: BranchEvidence[] = [], gaps: EvaluationGap[] = [];
  for (const nodeId of task.requiredBranches) {
    const candidates = report.branchReport.filter(b => b.nodeId === nodeId);
    const expected = context.branches.get(nodeId);
    const branch = candidates.length === 1 ? candidates[0] : {
      nodeId, binding: null, state: null, artifactRefs: [], decisionRef: null, gapReason: null,
    };
    let gapReason: string | null = null;
    if (candidates.length !== 1) gapReason = candidates.length === 0 ? 'branch-missing' : 'branch-duplicate';
    else if (branch.binding === null || expected === undefined) gapReason = 'branch-binding-missing';
    else if (bindingMismatches(branch.binding, expected).length > 0 || expected.nodeId !== nodeId) gapReason = 'branch-binding-stale';
    else if (branch.state !== 'succeeded') {
      gapReason = `branch-state-${branch.state === null ? 'missing' : branch.state}`;
    } else if (branch.artifactRefs.length === 0 || branch.decisionRef === null) gapReason = 'branch-evidence-missing';
    else {
      for (const ref of [...branch.artifactRefs, branch.decisionRef]) {
        const bound = checkBinding(ref, { productKind: 'node-product', binding: expected, schema: ref.schema });
        if (!bound.ok) return storeFail(bound.error.code, 'branch observation does not match the current branch attempt');
        if (!context.evidence.some(e => canonical(e.ref) === canonical(ref) && e.bytes.trim().length > 0)) {
          gapReason = 'branch-bytes-missing';
        }
      }
      const runs = context.evidence.filter(e => branch.artifactRefs.some(ref => canonical(ref) === canonical(e.ref))
        && e.ref.schema.name === 'Receipt');
      let observed = false;
      for (const run of runs) {
        let input: unknown;
        try { input = JSON.parse(run.bytes); }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; input = null; }
        const receipt = decode('Receipt', input);
        observed ||= receipt.ok && receipt.value.status === 'completed' && receipt.value.observability.length > 0
          && canonical(receipt.value.binding) === canonical(expected);
      }
      if (!observed) gapReason = 'branch-run-evidence-missing';
      if (task.scope.workspaceRef !== null && !branch.artifactRefs.some(ref => ref.schema.name === 'ActualDiff'
        && context.evidence.some(e => canonical(e.ref) === canonical(ref) && e.bytes.trim().length > 0))) {
        gapReason = 'branch-diff-missing';
      }
      const bytes = context.evidence.find(e => canonical(e.ref) === canonical(branch.decisionRef))?.bytes;
      if (bytes !== undefined) {
        let input: unknown;
        try { input = JSON.parse(bytes); }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; input = null; }
        const decision = decode('DecisionRecord', input);
        if (!decision.ok || branch.decisionRef.schema.name !== 'DecisionRecord' || decision.value.kind !== 'task'
          || decision.value.outcome !== 'completed' || canonical(decision.value.issuer) !== canonical(issuer)
          || canonical(branch.decisionRef.producer) !== canonical(issuer)
          || canonical(decision.value.contractRef) !== canonical(report.contractRef)
          || canonical((decision.value.taskEvidenceRef as { binding: unknown }).binding) !== canonical(expected)
          || !decision.value.inputs.some(ref => runs.some(run => canonical(ref) === canonical(run.ref)))) {
          gapReason = 'branch-decision-invalid';
        }
      }
    }
    branches.push({ ...branch, gapReason });
    if (gapReason !== null) gaps.push({ gapReason, branchId: nodeId, refs: branch.artifactRefs,
      status: gapReason === 'branch-state-failed' || gapReason === 'branch-state-cancelled' ? 'failed' : 'unknown',
      repair: 'Collect the current branch products and evaluator decision; repair failed branches in a new attempt.' });
  }
  if (report.branchReport.some(b => !task.requiredBranches.includes(b.nodeId))) {
    gaps.push({ gapReason: 'branch-unexpected', branchId: null, refs: [], status: 'unknown',
      repair: 'Submit exactly the contract requiredBranches set, retaining every failed and cancelled entry.' });
  }
  return storeOk({ branches, gaps });
}
