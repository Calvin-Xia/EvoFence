import type { CapabilityJudgement, HostBinding, Pair, RegisteredPlan, Statistics } from './types.js';
import { quantile } from './statistics.js';
export interface StatisticalVerdict {
  readonly look: CapabilityJudgement['look']; readonly verdict: CapabilityJudgement['verdict'];
  readonly reason: string; readonly continueSampling: boolean;
}
/** METRICS v3 §5.2: the sole ordered statistical decision; guardrails remain separate. */
export function judge(registered: RegisteredPlan, host: HostBinding, stats: Statistics, pairs: readonly Pair[], missing: boolean): StatisticalVerdict {
  const p = registered.plan;
  const look = stats.n === p.stopping.futilityN ? 'FUTILITY_LOOK' : stats.n >= p.stopping.confirmatoryN ? 'CONFIRMATORY_LOOK' : 'other';
  const result = (verdict: StatisticalVerdict['verdict'], reason: string, continueSampling = false): StatisticalVerdict => ({ look, verdict, reason, continueSampling });
  if (host.cellStatus !== 'complete') return result('blocked', host.cellStatus);
  const runs = pairs.flatMap(p => [p.control, p.treatment]);
  if (runs.some(o => o.polluted) || (runs.length > 0 && runs.filter(o => !o.usageComplete).length / runs.length > 0.05)) return result('inconclusive', 'degraded-data');
  // Missing budget/T0/independent mandatory measurements never create a confirmatory qualification.
  if (!registered.budgetAuthorized) return result('inconclusive', 'budget-missing');
  if (!registered.t0Approved || p.evidenceKind !== 'unseen' || p.partition !== 'held-out') return result('exploratory_only', 'not-confirmatory-evidence');
  if (missing) return result('exploratory_only', 'incomplete-inventory');
  if (runs.some(o => o.uncertain)) return result('inconclusive', 'measurement-uncertain');
  if (look === 'FUTILITY_LOOK') {
    if (stats.conditionalPower === null || stats.conditionalPower < p.stopping.futilityThreshold) return result('inconclusive', 'futility');
    return result('exploratory_only', 'continue-sampling', true); // continue is control flow, never a receipt verdict.
  }
  if (look !== 'CONFIRMATORY_LOOK' || stats.n < p.plannedN) return result('exploratory_only', 'insufficient-samples');
  if (stats.n01 + stats.n10 < 25) return result('inconclusive', 'discordance-floor');
  if (stats.zMve === null) return result('inconclusive', 'uncertain-standard-error');
  if (stats.zMve >= 1.960) return result('positive', 'mve-positive');
  if (stats.zMve <= -1.960) return result('negative', 'mve-negative');
  return result('inconclusive', 'ci-spans-mve');
}
export function metrics(pairs: readonly Pair[]) {
  function arm(which: 'control' | 'treatment') {
    const runs = pairs.map(p => p[which]), n = runs.length, successes = runs.filter(o => o.success === 1).length;
    const cost = runs.some(o => o.costMicros === null) ? null : runs.reduce((sum, o) => sum + o.costMicros!, 0);
    const scores = runs.filter(o => o.success === 1 && o.quality !== null && o.qualityReliable).map(o => o.quality!);
    return { n, successes, costMicros: cost, costPerSuccess: cost !== null && successes > 0 ? cost / successes : null,
      wallP90: n > 0 ? quantile(runs.map(o => o.run.wallMs).sort((a, b) => a - b), 0.9) : null,
      incompleteRate: n > 0 ? runs.filter(o => o.incomplete).length / n : null,
      qualityMean: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      qualityStatus: runs.some(o => o.success === 1 && (!o.qualityReliable || o.quality === null)) ? 'inconclusive' : 'reported',
      ittComposite: n > 0 && runs.every(o => o.success === 0 || (o.quality !== null && o.qualityReliable))
        ? runs.reduce((sum, o) => sum + o.success * (o.quality === null ? 0 : o.quality / 100), 0) / n : null,
      humanWaitMs: runs.reduce((sum, o) => sum + o.run.humanWaitMs, 0) };
  }
  const control = arm('control'), treatment = arm('treatment');
  const gate = (a: number | null, b: number | null, max: (x: number) => number): 'unknown' | 'passed' | 'failed' =>
    a === null || b === null ? 'unknown' : b <= max(a) ? 'passed' : 'failed';
  return { control, treatment,
    guardrailCost: gate(control.costPerSuccess, treatment.costPerSuccess, x => 2 * x),
    guardrailWall: gate(control.wallP90, treatment.wallP90, x => 1.5 * x),
    guardrailTruncation: gate(control.incompleteRate, treatment.incompleteRate, x => x + 0.10) };
}
