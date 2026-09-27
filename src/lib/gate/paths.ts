/**
 * Gate domain · isolation gate, path half.
 *
 * The two path rules: a candidate may not touch a protected path, and it may only touch the
 * declared evolution surface. Ported verbatim from `src/lib/policy.js:3-73` (0.3.0).
 *
 * `BUILTIN_PROTECTED` is 19 entries (the inventory's earlier "21" was a counting error, see
 * `docs/refactor-inventory-review.md` F5) and is merged with `contract.protected_paths` on
 * every call — never mutated.
 *
 * Imports: `src/types/**` + sibling gate modules.
 */

import type { EvoFenceContract } from '../../types/config.js';
import type { PathViolation } from '../../types/gate.js';
import type { GateJudgementBase } from './fail-closed.js';
import { failingJudgement, isRecord, passingJudgement, refusedJudgement } from './fail-closed.js';
import { matchesGlob } from './glob.js';

/** Paths no candidate may change, regardless of the contract. */
export const BUILTIN_PROTECTED: readonly string[] = [
  '.git/**',
  '.evofence/**',
  '.evofence-task.md',
  'test/**',
  'tests/**',
  '**/test/**',
  '**/tests/**',
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/test_*.py',
  '**/*_test.py',
  '**/*_test.go',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock*',
  '.github/workflows/**',
];

/** The part of a contract this module needs. */
export type PathPolicyContract = Pick<EvoFenceContract, 'protected_paths'>;

/** `true` when the path matches a builtin or contract-declared protected pattern. */
export function isProtectedPath(filename: string, contract: PathPolicyContract): boolean {
  return [...BUILTIN_PROTECTED, ...contract.protected_paths].some((pattern) => matchesGlob(filename, pattern));
}

/** `true` when the path is inside `allowed_evolution_surface`; an empty list allows everything. */
export function isAllowedPath(filename: string, contract: Pick<EvoFenceContract, 'allowed_evolution_surface'>): boolean {
  if (!contract.allowed_evolution_surface.length) return true;
  return contract.allowed_evolution_surface.some((pattern) => matchesGlob(filename, pattern));
}

/** One violation per offending path; the two rules are mutually exclusive per path. */
export function checkChangedPaths(
  paths: readonly string[],
  contract: PathPolicyContract & Pick<EvoFenceContract, 'allowed_evolution_surface'>,
): PathViolation[] {
  const violations: PathViolation[] = [];
  for (const filename of paths) {
    if (isProtectedPath(filename, contract)) {
      violations.push({ path: filename, category: 'protected_path' });
    } else if (!isAllowedPath(filename, contract)) {
      violations.push({ path: filename, category: 'outside_evolution_surface' });
    }
  }
  return violations;
}

/** Input of the path-policy judgement entry point. */
export interface PolicyGateInput {
  contract: PathPolicyContract & Pick<EvoFenceContract, 'allowed_evolution_surface'>;
  changed_paths: readonly string[];
}

/** Path-policy judgement: every changed path is legal. */
export interface PolicyGateJudgement extends GateJudgementBase {
  allowed: boolean;
  violations: PathViolation[];
}

/**
 * Independent path-policy entry point.
 *
 * Fail-closed: a missing contract or a missing path list returns `passed: false` with the
 * offending fields named, instead of silently treating "no paths seen" as "no violations".
 */
export function evaluatePolicyGate(input: PolicyGateInput | null | undefined): PolicyGateJudgement {
  const empty = { allowed: false, violations: [] as PathViolation[] };
  if (!isRecord(input)) return failingJudgement(['input'], empty);
  const candidate = input as unknown as Record<string, unknown>;
  const missing: string[] = [];
  if (!isRecord(candidate.contract)) missing.push('contract');
  if (!Array.isArray(candidate.changed_paths)) missing.push('changed_paths');
  if (missing.length) return failingJudgement(missing, empty);

  const violations = checkChangedPaths(
    candidate.changed_paths as readonly string[],
    candidate.contract as PathPolicyContract & Pick<EvoFenceContract, 'allowed_evolution_surface'>,
  );
  if (violations.length) return refusedJudgement('POLICY_VIOLATION', { allowed: false, violations });
  return passingJudgement({ allowed: true, violations: [] as PathViolation[] });
}
