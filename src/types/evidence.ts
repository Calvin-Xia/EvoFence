/**
 * Evidence-gate inputs: the per-command results `collectEvidence` produces, the bundle it
 * persists, and the objective comparison the gate draws from it.
 *
 * DERIVED FROM: `summary()` / `collectEvidence()` in `src/lib/evidence.js:6-99`, the artifact
 * contract (`writeFile(..., { flag: 'wx', mode: 0o600 })` + `artifact_sha256`), and
 * `docs/refactor-inventory.md` §6.2. The bundle is stored verbatim as the `evidence.baseline`
 * and `evidence.candidate` payloads.
 *
 * PRIVACY RULE: a private holdout case is reduced to five fields — no command line, no stdout,
 * no stderr. Never widen {@link PrivateEvidenceCase} to reuse {@link EvidenceCaseSummary};
 * that would put hidden-oracle output into the ledger.
 */

import type { ObjectiveDirection } from './config.js';
import type { ArtifactPath } from './ledger.js';
import type { EvidencePhase } from './exec.js';
import type { Hash256Hex } from './shared.js';

/** One command's outcome, as summarized by `evidence.js`'s `summary()`. */
export interface EvidenceCaseSummary {
  command_sha256: Hash256Hex;
  /** `exit_code === 0 && !timed_out && !output_limited`. */
  passed: boolean;
  result: 'PASS' | 'FAIL' | 'TIMEOUT' | 'OUTPUT_LIMIT';
  exit_code: number | null;
  duration_ms: number;
  stdout_sha256: Hash256Hex;
  stderr_sha256: Hash256Hex;
  /** Bytes seen before truncation. */
  stdout_bytes: number;
  stderr_bytes: number;
  /** `true` only for private holdout regressions. */
  hidden: boolean;
  /** Present for the objective command only; `null` when the score was unreadable. */
  score?: number | null;
}

/** A public or hard-invariant check entry — it carries its own id, kind and command line. */
export interface EvidenceCheckSummary extends EvidenceCaseSummary {
  id: string;
  kind: 'hard_invariant' | 'public_check';
  command: string;
}

/** A private holdout case, deliberately reduced to five fields. */
export interface PrivateEvidenceCase {
  /** 1-based index within the holdout list. */
  case: number;
  result: 'PASS' | 'FAIL' | 'TIMEOUT' | 'OUTPUT_LIMIT';
  exit_code: number | null;
  passed: boolean;
  duration_ms: number;
}

export interface PrivateEvidenceSummary {
  total: number;
  passed: number;
  failed: number;
  cases: PrivateEvidenceCase[];
}

/** `contract.objective.command`'s result when one is configured; `null` otherwise. */
export interface ObjectiveEvidence extends EvidenceCaseSummary {
  configured: true;
  /** `true` only when the last stdout line parsed as a finite number. */
  valid_score: boolean;
}

/**
 * `collectEvidence()` return value.
 *
 * The two top-level booleans are the evidence gate's summary judgement; the raw per-command
 * fields exist so an auditor can recompute them from the ledger alone.
 */
export interface EvidenceBundle {
  schema_version: 1;
  run_id: string;
  /** `0` for the baseline pass, the iteration number for a candidate pass. */
  iteration: number;
  phase: EvidencePhase;
  /** Filled in by the runner afterwards for candidate bundles. */
  candidate_sha: string | null;
  started_at: string;
  duration_ms: number;
  public: EvidenceCheckSummary[];
  private: PrivateEvidenceSummary;
  objective: ObjectiveEvidence | null;
  all_public_passed: boolean;
  all_private_within_tolerance: boolean;
  /** Path relative to the repository root; absent until the artifact write succeeded. */
  artifact?: ArtifactPath;
  /** Digest of the exact artifact bytes written. */
  artifact_sha256?: Hash256Hex;
}

/** Baseline-vs-candidate judgement performed at the end of each iteration. */
export interface ObjectiveComparison {
  baseline_score: number;
  candidate_score: number;
  /** Signed in the objective's own direction: `maximize` -> candidate - baseline. */
  improvement: number;
  min_delta: number;
  /** `improvement >= min_delta`. */
  meets_min_delta: boolean;
}

export interface EvidenceGateInput {
  baseline: EvidenceBundle;
  candidate: EvidenceBundle;
  /** `acceptance.hidden_regression_tolerance`. */
  tolerance: number;
  direction: ObjectiveDirection;
  /** `objective.min_delta`. */
  min_delta: number;
}

/** The `evidence_ok` flag stored on the final `gate.decision`: every condition must hold. */
export interface EvidenceGateResult {
  all_public_passed: boolean;
  all_private_within_tolerance: boolean;
  objective_valid: boolean;
  comparison: ObjectiveComparison | null;
  evidence_ok: boolean;
}
