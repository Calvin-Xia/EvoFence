/** Feedback is a separate audience view, never a DecisionRecord with private fields removed ad hoc. */
import { partitionFeedback, withheldReason } from '../artifacts/index.js';
import type { Audience, ArtifactRef } from '../artifacts/index.js';
import { storeOk } from '../store/index.js';
import type { StoreResult } from '../store/index.js';
import type { TaskEvaluation, TaskOutcome } from './types.js';

export interface TaskFeedback {
  readonly outcome: TaskOutcome;
  readonly gaps: readonly { readonly gapReason: string; readonly repair: string;
    readonly branchId: string | null; readonly refs: readonly ArtifactRef[] }[];
  readonly withheld: number;
}
export function feedbackFor(evaluation: TaskEvaluation, audience: Audience): StoreResult<TaskFeedback> {
  const gaps: TaskFeedback['gaps'][number][] = [];
  let withheld = 0;
  for (const gap of evaluation.gaps) {
    const partition = partitionFeedback(gap.refs, audience);
    if (!partition.ok) return partition;
    const count = partition.value.withheldPartition + partition.value.withheldVisibility;
    withheld += count;
    // Private diagnostic detail/provider identity/branch label is not executable-agent feedback.
    gaps.push(count > 0 ? { gapReason: 'restricted-acceptance-unmet', branchId: null, refs: [],
      repair: 'Repair the behavior against the public task contract, then request independent reevaluation.' }
      : { gapReason: gap.gapReason, repair: gap.repair, branchId: gap.branchId, refs: partition.value.visible });
  }
  if (audience !== 'evaluator') {
    const report = withheldReason(evaluation.decision.taskEvidenceRef, audience);
    if (!report.ok) return report;
    if (report.value !== 'none' && gaps.length === 0 && evaluation.decision.outcome !== 'completed') {
      gaps.push({ gapReason: 'restricted-acceptance-unmet', branchId: null, refs: [],
        repair: 'Request independent reevaluation against the public task contract.' });
    }
  }
  return storeOk({ outcome: evaluation.decision.outcome, gaps, withheld });
}
