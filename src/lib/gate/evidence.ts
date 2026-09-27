/**
 * Gate domain · evidence gate (pure judgement over collected bundles).
 *
 * Ported from `collectEvidence`'s two summary booleans (`src/lib/evidence.js:83-94`) and the
 * end-of-iteration verdict inputs (`src/lib/runner.js:739-767`). Collection itself — running the
 * commands, hashing outputs and writing the artifact — stays in `src/lib/evidence.ts`; this
 * module only judges an already-collected bundle, so it can be imported and tested without
 * executing anything.
 *
 * Imports: `src/types/**` + sibling gate modules.
 */

import type { EvidenceBundle, EvidenceGateInput, EvidenceGateResult, ObjectiveComparison } from '../../types/evidence.js';
import type { ObjectiveDirection } from '../../types/config.js';
import type { GateJudgementBase } from './fail-closed.js';
import { failingJudgement, isFiniteNumber, isRecord, passingJudgement, refusedJudgement } from './fail-closed.js';

/** Evidence judgement: `evidence_ok` plus the fail-closed fields. */
export interface EvidenceGateJudgement extends GateJudgementBase, EvidenceGateResult {}

/** `passed = code === 0 && !timed_out && !output_limited` — the one command-level predicate. */
export function casePassed(result: { code?: number | null; timed_out?: boolean; output_limited?: boolean }): boolean {
  return result.code === 0 && !result.timed_out && !result.output_limited;
}

/** `results.every(item => item.passed)` over any summarized case list. */
export function allCasesPassed(cases: readonly { passed?: boolean }[]): boolean {
  return cases.every((item) => item.passed === true);
}

/** `failed <= tolerance` — the private-holdout predicate, kept separate so it is testable. */
export function withinTolerance(failedCount: number, tolerance: number): boolean {
  return failedCount <= tolerance;
}

/** `finalNumericLine` succeeded: the score is a finite number. */
export function isValidObjectiveScore(score: unknown): boolean {
  return isFiniteNumber(score);
}

/** Recompute the public verdict from the per-case booleans instead of trusting the bundle flag. */
export function recomputeAllPublicPassed(bundle: EvidenceBundle): boolean {
  return allCasesPassed(bundle.public);
}

/** Recompute the private verdict from the per-case booleans and the contract tolerance. */
export function recomputeAllPrivateWithinTolerance(bundle: EvidenceBundle, tolerance: number): boolean {
  return withinTolerance(bundle.private.cases.filter((item) => item.passed !== true).length, tolerance);
}

/** Signed in the objective's own direction: `maximize` -> candidate - baseline. */
export function evaluateObjectiveComparison(
  baselineScore: number,
  candidateScore: number,
  direction: ObjectiveDirection,
  minDelta: number,
): ObjectiveComparison {
  const improvement = direction === 'maximize' ? candidateScore - baselineScore : baselineScore - candidateScore;
  return { baseline_score: baselineScore, candidate_score: candidateScore, improvement, min_delta: minDelta, meets_min_delta: improvement >= minDelta };
}

function scoreOf(bundle: EvidenceBundle): number | null {
  const score = bundle.objective?.score;
  return isFiniteNumber(score) ? score : null;
}

/**
 * Independent evidence-gate entry point.
 *
 * Fail-closed in three ways:
 *   - a missing bundle, tolerance, direction or `min_delta` returns `passed: false` with the
 *     offending fields in `missing`;
 *   - a bundle whose stored `all_public_passed` contradicts its own per-case results is refused
 *     as `EVIDENCE_BUNDLE_INCONSISTENT` (an independently recomputed flag always wins);
 *   - an unreadable/non-finite objective score is `OBJECTIVE_SCORE_INVALID`, never a pass.
 */
export function evaluateEvidenceGate(input: EvidenceGateInput | null | undefined): EvidenceGateJudgement {
  const empty: EvidenceGateResult = {
    all_public_passed: false,
    all_private_within_tolerance: false,
    objective_valid: false,
    comparison: null,
    evidence_ok: false,
  };
  if (!isRecord(input)) return failingJudgement(['input'], empty);
  const missing: string[] = [];
  if (!isRecord(input.baseline)) missing.push('baseline');
  if (!isRecord(input.candidate)) missing.push('candidate');
  if (!isFiniteNumber(input.tolerance) || (input.tolerance as number) < 0) missing.push('tolerance');
  if (input.direction !== 'maximize' && input.direction !== 'minimize') missing.push('direction');
  if (!isFiniteNumber(input.min_delta)) missing.push('min_delta');
  if (missing.length) return failingJudgement(missing, empty);

  const baseline = input.baseline as unknown as EvidenceBundle;
  const candidate = input.candidate as unknown as EvidenceBundle;
  const tolerance = input.tolerance as number;
  const minDelta = input.min_delta as number;
  const direction = input.direction as ObjectiveDirection;

  const allPublicPassed = recomputeAllPublicPassed(candidate);
  if (candidate.all_public_passed !== allPublicPassed) {
    return refusedJudgement('EVIDENCE_BUNDLE_INCONSISTENT', { ...empty, all_public_passed: allPublicPassed });
  }
  const allPrivateWithinTolerance = recomputeAllPrivateWithinTolerance(candidate, tolerance);

  const baselineScore = scoreOf(baseline);
  const candidateScore = scoreOf(candidate);
  const objectiveValid = baselineScore !== null && candidateScore !== null && candidate.objective?.valid_score === true;
  const comparison = objectiveValid && baselineScore !== null && candidateScore !== null
    ? evaluateObjectiveComparison(baselineScore, candidateScore, direction, minDelta)
    : null;
  const evidenceOk = allPublicPassed && allPrivateWithinTolerance && objectiveValid && comparison !== null && comparison.meets_min_delta;
  const result: EvidenceGateResult = {
    all_public_passed: allPublicPassed,
    all_private_within_tolerance: allPrivateWithinTolerance,
    objective_valid: objectiveValid,
    comparison,
    evidence_ok: evidenceOk,
  };
  if (evidenceOk) return passingJudgement(result);
  if (!allPublicPassed) return refusedJudgement('PUBLIC_TEST_FAILURE', result);
  if (!allPrivateWithinTolerance) return refusedJudgement('HIDDEN_REGRESSION', result);
  if (!objectiveValid) return refusedJudgement('OBJECTIVE_SCORE_INVALID', result);
  return refusedJudgement('NO_PRACTICAL_IMPROVEMENT', result);
}
