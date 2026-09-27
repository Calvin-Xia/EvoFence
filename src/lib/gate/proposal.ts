/**
 * Gate domain · contract gate, document half.
 *
 * `checkProposal` (15 assertions) and `checkClaims` (9 assertions) validate the two documents
 * the agent authors. Ported verbatim from `src/lib/policy.js:76-106` (0.3.0): same error codes,
 * same messages, same return value (the input object itself, so callers keep object identity
 * and can hash it afterwards).
 *
 * Imports: the shared base leaf `src/lib/errors.js` (never an exec/ledger domain module).
 */

import type { Claims, Proposal } from '../../types/proposal.js';
import { invariant } from '../errors.js';

/** An unvalidated parsed document: any key, any shape. */
type RawDocument = Record<string, any>;

/**
 * Validate `proposal.json`. Throws `INVALID_PROPOSAL` on the first failing rule and returns the
 * input unchanged otherwise.
 */
export function checkProposal(proposal: unknown): Proposal {
  invariant(proposal && typeof proposal === 'object' && !Array.isArray(proposal), 'INVALID_PROPOSAL', 'proposal.json must contain an object.');
  const document = proposal as RawDocument;
  invariant(Number.isInteger(document.iteration) && document.iteration >= 1, 'INVALID_PROPOSAL', 'proposal.iteration must be a positive integer.');
  invariant(typeof document.base_sha === 'string' && /^[0-9a-f]{40,64}$/i.test(document.base_sha), 'INVALID_PROPOSAL', 'proposal.base_sha must be a full git commit SHA.');
  invariant(typeof document.hypothesis === 'string' && document.hypothesis.trim(), 'INVALID_PROPOSAL', 'proposal.hypothesis is required.');
  invariant(typeof document.proposed_change === 'string' && document.proposed_change.trim(), 'INVALID_PROPOSAL', 'proposal.proposed_change is required.');
  invariant(Array.isArray(document.problem_evidence) && document.problem_evidence.length > 0 && document.problem_evidence.every((item: unknown) => typeof item === 'string'), 'INVALID_PROPOSAL', 'proposal.problem_evidence must contain observed evidence strings.');
  invariant(Array.isArray(document.changed_surface) && document.changed_surface.every((item: unknown) => typeof item === 'string'), 'INVALID_PROPOSAL', 'proposal.changed_surface must be an array of path strings.');
  invariant(Array.isArray(document.possible_regressions) && document.possible_regressions.every((item: unknown) => typeof item === 'string'), 'INVALID_PROPOSAL', 'proposal.possible_regressions must be an array of strings.');
  invariant(Array.isArray(document.requested_capabilities) && document.requested_capabilities.every((item: unknown) => typeof item === 'string' || (item && typeof item === 'object')), 'INVALID_PROPOSAL', 'proposal.requested_capabilities must contain capability names or request objects.');
  invariant(Array.isArray(document.falsification_plan) && document.falsification_plan.length > 0 && document.falsification_plan.every((item: unknown) => typeof item === 'string'), 'INVALID_PROPOSAL', 'proposal.falsification_plan must contain at least one string check.');
  invariant(typeof document.rollback_plan === 'string' && document.rollback_plan.trim(), 'INVALID_PROPOSAL', 'proposal.rollback_plan is required.');
  invariant(document.expected_effect && typeof document.expected_effect === 'object', 'INVALID_PROPOSAL', 'proposal.expected_effect is required.');
  invariant(typeof document.expected_effect.primary_metric === 'string' && document.expected_effect.primary_metric.trim(), 'INVALID_PROPOSAL', 'expected_effect.primary_metric is required.');
  invariant(['increase', 'decrease'].includes(document.expected_effect.direction), 'INVALID_PROPOSAL', 'expected_effect.direction must be increase or decrease.');
  invariant(typeof document.expected_effect.minimum_practical_effect === 'string' && document.expected_effect.minimum_practical_effect.trim(), 'INVALID_PROPOSAL', 'expected_effect.minimum_practical_effect is required.');
  return document as Proposal;
}

/**
 * Validate `claims.json`. Throws `INVALID_CLAIMS` on the first failing rule and returns the
 * input unchanged otherwise.
 */
export function checkClaims(claims: unknown): Claims {
  invariant(claims && typeof claims === 'object' && !Array.isArray(claims), 'INVALID_CLAIMS', 'claims.json must contain an object.');
  const document = claims as RawDocument;
  invariant(['CANDIDATE_READY', 'NO_CHANGE', 'BLOCKED'].includes(document.status), 'INVALID_CLAIMS', 'claims.status must be CANDIDATE_READY, NO_CHANGE, or BLOCKED.');
  invariant(Array.isArray(document.claims), 'INVALID_CLAIMS', 'claims.claims must be an array.');
  invariant(Array.isArray(document.tests_executed), 'INVALID_CLAIMS', 'claims.tests_executed must be an array.');
  invariant(Array.isArray(document.known_failures), 'INVALID_CLAIMS', 'claims.known_failures must be an array.');
  invariant(Array.isArray(document.missing_evidence), 'INVALID_CLAIMS', 'claims.missing_evidence must be an array.');
  invariant(Array.isArray(document.files_changed) && document.files_changed.every((item: unknown) => typeof item === 'string'), 'INVALID_CLAIMS', 'claims.files_changed must be an array of paths.');
  invariant(Array.isArray(document.capabilities_used), 'INVALID_CLAIMS', 'claims.capabilities_used must be an array.');
  invariant(Array.isArray(document.suggested_gate_checks), 'INVALID_CLAIMS', 'claims.suggested_gate_checks must be an array.');
  return document as Claims;
}
