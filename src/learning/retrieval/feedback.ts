import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import type { RetrievalResult, UsageFeedback } from './types.js';

/** Complete reported feedback for selected assets. It never upgrades eligibility or activation. */
export function recordUsage(result: RetrievalResult, feedback: readonly UsageFeedback[]): StoreResult<RetrievalResult> {
  const selected = result.attribution.filter(a => a.retrieved && a.entryIds.length > 0);
  if (feedback.length !== selected.length) return storeFail('EFK_SCHEMA_INVALID', 'usage feedback must cover every selected asset');
  const reports = new Map<string, UsageFeedback>();
  for (const report of feedback) {
    const key = canonical(report.asset);
    if (reports.has(key) || !selected.some(a => canonical(a.asset) === key) ||
        !['used', 'ignored'].includes(report.disposition) || typeof report.reason !== 'string' || report.reason.trim().length === 0) {
      return storeFail('EFK_SCHEMA_INVALID', 'usage feedback is duplicated, unselected or lacks an explicit reason');
    }
    reports.set(key, report);
  }
  return storeOk({ ...result, attribution: result.attribution.map(a => {
    const report = reports.get(canonical(a.asset));
    return report === undefined ? a : { ...a, disposition: report.disposition, feedbackReason: report.reason };
  }) });
}
