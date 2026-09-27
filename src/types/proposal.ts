/**
 * The two structured documents an agent must produce, and the checks the gate runs against
 * them.
 *
 * DERIVED FROM: `checkProposal` (`src/lib/policy.js:76-93`, 15 assertions) and `checkClaims`
 * (`src/lib/policy.js:95-106`, 9 assertions) for the document shapes; `checkTaskFile` and
 * `checkFinalCandidate` (`src/lib/runner.js:175-191`, `:339-345`) for the refusal codes.
 * Ref: `docs/refactor-inventory.md` §6.1, §6.2.
 *
 * Both documents are authored by the agent under test, so every field here is something the
 * validator actually inspects. The index signatures preserve the source's real behaviour:
 * neither `checkProposal` nor `checkClaims` rejects unknown keys.
 */

import type { Hash256Hex, JsonValue, RepoRelativePath } from './shared.js';

/** One capability the proposal asks for, either as a bare name or a request object. */
export interface CapabilityRequest {
  capability?: string;
  scope?: string;
  exact_scope?: string;
  [key: string]: unknown;
}

/**
 * `proposal.json`, validated by `checkProposal`.
 *
 * Required-field strictness matters: `problem_evidence` and `falsification_plan` must be
 * non-empty, `base_sha` must be a full commit SHA, and `expected_effect.primary_metric` must
 * match `contract.objective.name` or the run is rejected with `PROPOSAL_OBJECTIVE_MISMATCH`.
 */
export interface Proposal {
  /** Positive integer. */
  iteration: number;
  /** Full 40-64 hex git commit SHA. */
  base_sha: string;
  hypothesis: string;
  proposed_change: string;
  /** Non-empty list of observed-evidence strings. */
  problem_evidence: string[];
  /** Glob patterns; `checkTaskFile` matches the actual diff paths against these. */
  changed_surface: string[];
  possible_regressions: string[];
  requested_capabilities: (string | CapabilityRequest)[];
  /** Non-empty list of falsification checks. */
  falsification_plan: string[];
  rollback_plan: string;
  expected_effect: {
    /** Must equal `objective.name`, else `PROPOSAL_OBJECTIVE_MISMATCH`. */
    primary_metric: string;
    direction: 'increase' | 'decrease';
    minimum_practical_effect: string;
  };
  [key: string]: unknown;
}

/** `claims.json`, validated by `checkClaims`. */
export interface Claims {
  status: 'CANDIDATE_READY' | 'NO_CHANGE' | 'BLOCKED';
  claims: JsonValue[];
  tests_executed: JsonValue[];
  known_failures: JsonValue[];
  /** Any entry here forces `INSUFFICIENT_EVIDENCE` and a REJECT. */
  missing_evidence: JsonValue[];
  /** Must match the observed diff exactly, else `CLAIMS_DIFF_MISMATCH`. */
  files_changed: string[];
  /**
   * Entries outside the two hardcoded built-in capabilities
   * (`filesystem:scoped_write`, `shell:evidence_commands_only`) must be approved by the
   * proposal, else `CAPABILITY_VIOLATION` and an ESCALATE.
   */
  capabilities_used: JsonValue[];
  suggested_gate_checks: JsonValue[];
  [key: string]: unknown;
}

/**
 * Refusal codes `checkFinalCandidate` / `checkTaskFile` can return. Note the split:
 * `EVIDENCE_MODIFIED_CANDIDATE` comes only from the post-evidence re-check and is the one code
 * that maps to QUARANTINE; the rest map to REJECT.
 */
export type CandidateCheckCode =
  | 'POLICY_VIOLATION'
  | 'NO_CHANGE'
  | 'UNDECLARED_CHANGE'
  | 'CLAIMS_DIFF_MISMATCH'
  | 'CAPABILITY_VIOLATION'
  | 'INSUFFICIENT_EVIDENCE'
  | 'EVIDENCE_MODIFIED_CANDIDATE';

/** The candidate passed every structural, path and capability check. */
export interface CandidateCheckAccepted {
  accepted: true;
}

/** The candidate was refused. Extra fields depend on which code fired. */
export interface CandidateCheckRefused {
  accepted: false;
  code: CandidateCheckCode;
  /** `POLICY_VIOLATION` only: one entry per offending path. */
  violations?: { path: RepoRelativePath; category: 'protected_path' | 'outside_evolution_surface' }[];
  /** `NO_CHANGE` only. */
  message?: string;
  /** `UNDECLARED_CHANGE` only. */
  paths?: RepoRelativePath[];
  /** `CLAIMS_DIFF_MISMATCH` only: `expected` is the observed diff, `declared` is the claim. */
  expected?: RepoRelativePath[];
  declared?: RepoRelativePath[];
  /** `CAPABILITY_VIOLATION` only. */
  capabilities_used?: JsonValue[];
  /** `INSUFFICIENT_EVIDENCE` only. */
  missing_evidence?: JsonValue[];
  /** `EVIDENCE_MODIFIED_CANDIDATE` only: the evidence artifact changed between checks. */
  before_evidence_sha256?: Hash256Hex;
  after_evidence_sha256?: Hash256Hex;
}

export type CandidateCheckResult = CandidateCheckAccepted | CandidateCheckRefused;
