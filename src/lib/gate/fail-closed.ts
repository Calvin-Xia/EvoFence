/**
 * Gate domain · fail-closed plumbing shared by every judgement entry point.
 *
 * Every judgement in this domain answers three questions at once: did it pass, why, and which
 * input was missing or unusable. The third field is the one that makes the difference between
 * fail-closed and fail-open: an entry point that cannot see its input must return
 * `passed: false` with the offending field paths, never `true` by default.
 *
 * Imports: `src/types/**` only.
 */

import type { GateReason } from '../../types/gate.js';

/** Reason reported whenever a judgement ran without the input it needed. */
export const GATE_INPUT_MISSING = 'GATE_INPUT_MISSING';

/** The shared shape of every judgement result in this domain. */
export interface GateJudgementBase {
  /**
   * Fail-closed summary flag. `false` means "do not proceed": either the check failed, or the
   * input needed to make the check was absent.
   */
  passed: boolean;
  /** `null` when `passed` is true; otherwise the machine-readable refusal reason. */
  reason: GateReason | null;
  /** Dotted paths of the fields that were absent/unusable, in the order they were checked. */
  missing: string[];
}

/** A plain (non-array, non-null) object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A present, non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** A finite number. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A non-negative integer. */
export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

/**
 * Build a fail-closed judgement for absent or unusable input.
 *
 * `extra` carries the face-specific empty values (empty violation list, `exhausted: false`,
 * `drifted: true`, …) so the returned object still satisfies the face's own result contract.
 */
export function failingJudgement<T extends object>(
  missing: string[],
  extra: T,
  reason: GateReason = GATE_INPUT_MISSING,
): GateJudgementBase & T {
  return { ...extra, passed: false, reason, missing };
}

/** Build a passing judgement. */
export function passingJudgement<T extends object>(extra: T): GateJudgementBase & T {
  return { ...extra, passed: true, reason: null, missing: [] };
}

/** Build a failing judgement from a real (non-missing) gate refusal. */
export function refusedJudgement<T extends object>(
  reason: GateReason,
  extra: T,
  missing: string[] = [],
): GateJudgementBase & T {
  return { ...extra, passed: false, reason, missing };
}
