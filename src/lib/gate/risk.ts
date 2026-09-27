/**
 * Gate domain · risk gate (the fifth gate: it does not decide alone, it colours the verdict).
 *
 * Ported verbatim from `src/lib/policy.js:108-140` (0.3.0): base score 0.05, additive surface /
 * capability / security-path / test-path / metric-mismatch penalties, clamped to `[0, 1]` and
 * rounded to two decimals. Band thresholds and their verdicts live in `verdict.ts`.
 *
 * Imports: `src/types/**` + sibling gate modules.
 */

import type { EvoFenceContract } from '../../types/config.js';
import type { RiskAssessment, RiskBand } from '../../types/gate.js';
import { isRecord } from './fail-closed.js';

/** The proposal slice this module reads. */
export interface RiskProposalView {
  requested_capabilities?: readonly unknown[] | null;
  expected_effect?: { primary_metric?: string } | null;
}

/** The contract slice this module reads. */
export type RiskContract = Pick<EvoFenceContract, 'objective'>;

const SECURITY_SURFACE = /(^|\/)(auth|security|permissions?|policy|workflow)(\/|\.|$)/i;
const TEST_SURFACE = /(^|\/)(test|tests)(\/|$)|\.(test|spec)\.[^.]+$/i;

/** Score one change set; the caller maps `band` to a verdict. */
export function assessRisk(
  paths: readonly string[],
  proposal: RiskProposalView | null | undefined,
  contract: RiskContract,
): RiskAssessment {
  const reasons: string[] = [];
  let score = 0.05;
  if (paths.length > 20) {
    score += 0.35;
    reasons.push('large_change_surface');
  } else if (paths.length > 8) {
    score += 0.2;
    reasons.push('broad_change_surface');
  } else if (paths.length > 3) {
    score += 0.1;
    reasons.push('multi_file_change');
  }

  const requested = proposal?.requested_capabilities ?? [];
  if (requested.length > 0) {
    score += 0.3;
    reasons.push('capability_request_requires_escalation');
  }
  if (paths.some((name) => SECURITY_SURFACE.test(name))) {
    score += 0.35;
    reasons.push('security_or_policy_surface');
  }
  if (paths.some((name) => TEST_SURFACE.test(name))) {
    score += 1;
    reasons.push('test_surface_changed');
  }
  if (proposal?.expected_effect?.primary_metric && proposal.expected_effect.primary_metric !== contract.objective.name) {
    score += 0.15;
    reasons.push('proposal_metric_mismatch');
  }
  score = Math.min(1, Math.round(score * 100) / 100);
  const band: RiskBand = score < 0.3 ? 'LOW' : score < 0.65 ? 'MEDIUM' : score < 0.9 ? 'HIGH' : 'CRITICAL';
  return { score, band, reasons };
}

/** `true` when the value is a risk assessment the verdict mapper can trust. */
export function isRiskAssessment(value: unknown): value is RiskAssessment {
  return isRecord(value) && typeof value.score === 'number' && typeof value.band === 'string'
    && ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(value.band as string);
}
