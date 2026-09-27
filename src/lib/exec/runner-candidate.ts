/**
 * Exec domain · candidate checks and worktree teardown (0.3.0 `checkTaskFile`,
 * `checkFinalCandidate`, `ensurePrivateIgnored`, `removeCandidate`).
 *
 * The *verdicts* of the contract/evidence gates stay in the gate domain; this module only
 * orchestrates them against one candidate and owns the isolation-side cleanup.
 */
import path from 'node:path';
import { checkChangedPaths, matchesGlob } from '../policy.js';
import { assertInside, stableStringify } from '../fs.js';
import { EvoFenceError } from './errors.js';
import { removeWorktree } from '../git.js';
import { runProcess } from '../process.js';
import type { Claims, EvoFenceContract, Proposal } from '../../types/index.js';

/** Result of the candidate file/claims check; extra keys carry the violation detail. */
export interface FileCheckResult {
  accepted: boolean;
  code?: string;
  [key: string]: unknown;
}

export function checkTaskFile(contract: EvoFenceContract, actualPaths: string[], proposal: Proposal, claims: Claims): FileCheckResult {
  const violations = checkChangedPaths(actualPaths, contract);
  if (violations.length) return { accepted: false, code: 'POLICY_VIOLATION', violations };
  if (!actualPaths.length) return { accepted: false, code: 'NO_CHANGE', message: 'The candidate did not change any project file.' };
  const undeclared = actualPaths.filter((filename) => !proposal.changed_surface.some((pattern) => matchesGlob(filename, pattern)));
  if (undeclared.length) return { accepted: false, code: 'UNDECLARED_CHANGE', paths: undeclared };
  const claimsPaths = [...new Set(claims.files_changed.map((name) => name.replaceAll('\\', '/')))].sort();
  const actual = [...actualPaths].sort();
  if (stableStringify(claimsPaths) !== stableStringify(actual)) return { accepted: false, code: 'CLAIMS_DIFF_MISMATCH', expected: actual, declared: claimsPaths };
  const builtInCapabilities = new Set<string>(['filesystem:scoped_write', 'shell:evidence_commands_only']);
  const approvedCapabilities = new Set(proposal.requested_capabilities.map((item) => typeof item === 'string' ? item : item?.capability).filter((item): item is string => typeof item === 'string'));
  const used = claims.capabilities_used.filter((item) => typeof item !== 'string' || (!builtInCapabilities.has(item) && !approvedCapabilities.has(item)));
  if (used.length) return { accepted: false, code: 'CAPABILITY_VIOLATION', capabilities_used: used };
  if (claims.missing_evidence.length) return { accepted: false, code: 'INSUFFICIENT_EVIDENCE', missing_evidence: claims.missing_evidence };
  return { accepted: true };
}

/** `checkTaskFile` plus the before/after evidence-diff digest recheck. */
export function checkFinalCandidate(contract: EvoFenceContract, actualPaths: string[], proposal: Proposal, claims: Claims, beforeEvidenceHash: string, afterEvidenceHash: string): FileCheckResult {
  const fileCheck = checkTaskFile(contract, actualPaths, proposal, claims);
  if (!fileCheck.accepted) return fileCheck;
  if (beforeEvidenceHash !== afterEvidenceHash) {
    return { accepted: false, code: 'EVIDENCE_MODIFIED_CANDIDATE', before_evidence_sha256: beforeEvidenceHash, after_evidence_sha256: afterEvidenceHash };
  }
  return { accepted: true };
}

/** Refuse to start unless the private holdout is ignored by Git. */
export async function ensurePrivateIgnored(root: string): Promise<void> {
  const file = path.join(root, '.evofence', 'private', 'holdout.yaml');
  const check = await runProcess('git', ['check-ignore', '-q', file], { cwd: root, timeoutMs: 10000, maxOutputBytes: 10000 });
  if (check.code !== 0) throw new EvoFenceError('HOLDOUT_NOT_IGNORED', 'The private holdout file must be excluded from Git. Keep private regression tests out of commits and worktrees.');
}

/** Remove one candidate worktree; a missing worktree is tolerated. */
export async function removeCandidate(root: string, worktree: string, tempRoot: string): Promise<void> {
  assertInside(tempRoot, worktree);
  await removeWorktree(root, worktree).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
