/**
 * Gate domain · isolation gate (worktree boundary, not an OS sandbox).
 *
 * The four checks 0.3.0 performs (`docs/refactor-inventory.md` §6.4):
 *   1. the `.git` pointer digest before vs after an agent phase (`WORKTREE_METADATA_CHANGED`,
 *      `src/lib/git.js:53-73`, checked at `src/lib/runner.js:561`, `:641`);
 *   2. the private holdout must be git-ignored (`HOLDOUT_NOT_IGNORED`, `runner.js:348-352`);
 *   3. the two explicit CLI opt-ins the adapter cannot provide for itself
 *      (`*_SANDBOX_REQUIRED`, `PRIVATE_ORACLE_READABLE`, `runner.js:364-385`);
 *   4. the holdout's readability opt-in while a holdout exists.
 *
 * BOUNDARY: EvoFence claims worktree isolation only. A `true` here never means "sandboxed".
 *
 * Imports: `src/types/**` + sibling gate modules.
 */

import type { WorktreeMetadataSnapshot } from '../../types/exec.js';
import type { GateJudgementBase } from './fail-closed.js';
import type { IsolationGateInput, IsolationGateResult } from '../../types/gate.js';
import { failingJudgement, isNonEmptyString, isRecord, passingJudgement, refusedJudgement } from './fail-closed.js';

/** Isolation judgement. */
export interface IsolationGateJudgement extends GateJudgementBase, IsolationGateResult {}

const ISOLATED: IsolationGateResult = { isolated: true, reason: null, metadata_restored: false };
const NOT_ISOLATED: IsolationGateResult = { isolated: false, reason: null, metadata_restored: false };

/** Digest-only comparison of the two `.git` pointer snapshots. */
export function worktreeMetadataMatches(
  expected: WorktreeMetadataSnapshot,
  observed: WorktreeMetadataSnapshot | null,
): boolean {
  return observed !== null && isNonEmptyString(observed.sha256) && observed.sha256 === expected.sha256;
}

function snapshotMissing(value: unknown, label: string, missing: string[]): boolean {
  if (value === null || value === undefined) return false;
  if (!isRecord(value) || !isNonEmptyString(value.sha256)) {
    missing.push(label);
    return true;
  }
  return false;
}

/**
 * Independent isolation-gate entry point.
 *
 * Fail-closed: a snapshot that exists on one side and not the other, an unreadable pointer, a
 * non-boolean flag, or an absent input all return `passed: false` naming the offending fields.
 * `metadata_restored` is `true` exactly when the caller must restore the original pointer from
 * the expected snapshot.
 */
export function evaluateIsolationGate(input: IsolationGateInput | null | undefined): IsolationGateJudgement {
  if (!isRecord(input)) return failingJudgement(['input'], NOT_ISOLATED);
  const missing: string[] = [];
  for (const flag of ['unisolated_agent_accepted', 'readable_holdout_accepted', 'adapter_requires_sandbox']) {
    if (typeof input[flag] !== 'boolean') missing.push(flag);
  }
  if (typeof input.holdout_ignored !== 'boolean' && input.holdout_ignored !== undefined) missing.push('holdout_ignored');
  snapshotMissing(input.expected_metadata, 'expected_metadata', missing);
  snapshotMissing(input.observed_metadata, 'observed_metadata', missing);
  if (missing.length) return failingJudgement(missing, NOT_ISOLATED);

  if (input.adapter_requires_sandbox && !input.unisolated_agent_accepted) {
    return refusedJudgement('SANDBOX_REQUIRED', NOT_ISOLATED);
  }
  if (input.holdout_ignored === false) return refusedJudgement('HOLDOUT_NOT_IGNORED', NOT_ISOLATED);
  if (input.holdout_ignored !== undefined && !input.readable_holdout_accepted) {
    return refusedJudgement('PRIVATE_ORACLE_READABLE', NOT_ISOLATED);
  }

  const expected = (input.expected_metadata ?? null) as WorktreeMetadataSnapshot | null;
  const observed = (input.observed_metadata ?? null) as WorktreeMetadataSnapshot | null;
  if (expected === null && observed !== null) {
    return refusedJudgement('WORKTREE_METADATA_UNEXPECTED', { ...NOT_ISOLATED, metadata_restored: false });
  }
  if (expected !== null && !worktreeMetadataMatches(expected, observed)) {
    return refusedJudgement('WORKTREE_METADATA_CHANGED', { isolated: false, reason: null, metadata_restored: true });
  }
  return passingJudgement(ISOLATED);
}
