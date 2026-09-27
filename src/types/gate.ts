/**
 * Gate-domain contracts: the four gates' inputs, the risk assessment that colours the verdict,
 * and the verdict itself.
 *
 * DERIVED FROM:
 *   - Contract gate: `currentPolicyHashes` + the three drift comparisons
 *     (`src/lib/runner.js:140-149`, `:552`, `:638`, `:763`); `assessCapabilities`
 *     (`src/lib/policy.js:141-151`); `requireEvidenceConfigured` (`:155-161`).
 *     Ref: `docs/refactor-inventory.md` §6.1.
 *   - Evidence gate: `EvidenceGateInput`/`EvidenceGateResult` consume the bundle defined in
 *     `evidence.ts`, and mirror the final verdict mapping (`src/lib/runner.js:748-767`). §6.2.
 *   - Budget gate: `parseNumericBudget`/`recordTokenUsage`/`recordCostUsage`/`runBudgetedAdapter`
 *     (`src/lib/runner.js:33`, `:194`, `:263`, `:437-450`). §6.3.
 *   - Isolation gate: `worktreeMetadataSnapshot` (`src/lib/git.js:53-59`), `ensurePrivateIgnored`
 *     (`src/lib/runner.js:348-352`) and the flag checks at `:367`, `:380`, `:383`. §6.4.
 *   - Risk gate: `assessRisk` (`src/lib/policy.js:108-140`). §6.5.
 *
 * The four verdicts are exactly ACCEPT / REJECT / ESCALATE / QUARANTINE. `reason` is an open
 * string set because new refusal reasons are added at call sites, not in a table.
 *
 * BOUNDARY REMINDER: worktree isolation is a filesystem boundary, not an OS sandbox (§6.4).
 */

import type { BudgetsConfig } from './config.js';
import type { LedgerEvent, LedgerVerification } from './ledger.js';
import type { AdapterEventPayload, WorktreeMetadataSnapshot } from './exec.js';
import type { EvoFenceErrorCode, Hash256Hex, JsonValue, RepoRelativePath, UsdMicros } from './shared.js';

/** The four gate verdicts. There is no fifth. */
export const GATE_DECISIONS = ['ACCEPT', 'REJECT', 'ESCALATE', 'QUARANTINE'] as const;

export type GateDecision = (typeof GATE_DECISIONS)[number];

/**
 * Why a gate decided what it decided. Open set: 0.3.0 emits these as literals at each call
 * site, e.g. `PUBLIC_TEST_FAILURE`, `HIDDEN_REGRESSION`, `OBJECTIVE_SCORE_INVALID`,
 * `NO_PRACTICAL_IMPROVEMENT`, `HIGH_CHANGE_RISK`, `CRITICAL_CHANGE_RISK`,
 * `POLICY_CHANGED_DURING_{PROPOSAL,RUN,EVALUATION}`, `BASELINE_UNHEALTHY`,
 * `BASELINE_OBJECTIVE_INVALID`, `WORKTREE_METADATA_CHANGED`, `CAPABILITY_DENIED`,
 * `PRECOMMIT_VALIDATION_FAILED`, `COMMITTED_CANDIDATE_MISMATCH`,
 * `ALL_REQUIRED_EVIDENCE_PASSED`. Kept open so a new reason is never a type error.
 */
export type GateReason = string;

/* ------------------------------------------------------------------ *
 * Contract gate
 * ------------------------------------------------------------------ */

/**
 * The three policy documents whose digests are compared before and after each agent phase.
 * Any drift between the initial and current value is the contract gate's QUARANTINE trigger.
 */
export interface PolicyHashes {
  contract: Hash256Hex;
  holdout: Hash256Hex;
  config: Hash256Hex;
}

export interface ContractGateInput {
  /** Digests captured at run start (`initialHashes`). */
  initial: PolicyHashes;
  /** Digests re-read after the phase under test. */
  current: PolicyHashes;
}

/** The only documents the drift comparison can attribute a change to. */
export type PolicyDocument = keyof PolicyHashes;

export interface ContractGateResult {
  /** `true` when any of the three digests differs. */
  drifted: boolean;
  /** Which document drifted, or `null` when nothing drifted. */
  changed: PolicyDocument | null;
}

/**
 * Capability names the contract template declares, plus the two capabilities hardcoded as
 * already-granted inside `checkTaskFile` (`src/lib/runner.js:186`).
 *
 * The contract's `capabilities` map is indexed dynamically by whatever a proposal requests, so
 * this list is a convenience for tooling — NOT a closed union. `external_api` is the one
 * template key with live gate behaviour; `authority_ceiling` and `shell` are validated or inert
 * (`docs/refactor-inventory.md` §5.2 "half-dead keys").
 */
export const KNOWN_CAPABILITY_KEYS = [
  'authority_ceiling',
  'network',
  'dependency_install',
  'credentials',
  'external_api',
  'shell',
] as const;

/** Capabilities the task file grants without needing a proposal entry. */
export const BUILTIN_GRANTED_CAPABILITIES = [
  'filesystem:scoped_write',
  'shell:evidence_commands_only',
] as const;

/** One row of `assessCapabilities().requests`. */
/**
 * A type alias (not an interface) on purpose: TypeScript only grants implicit
 * index signatures to object-literal type aliases, so this is what makes the
 * entry assignable to the ledger-facing `JsonValue` shape. Every field here is
 * JSON-serializable, so keeping it assignable is the intent.
 */
export type CapabilityReviewEntry = {
  capability: string;
  allowed: boolean;
  scope: string | null;
  reason: 'policy_allow' | 'not_allowed_by_contract';
};

/** `assessCapabilities()` result — `allowed` is the AND of every entry. */
export interface CapabilityReview {
  allowed: boolean;
  requests: CapabilityReviewEntry[];
}

/* ------------------------------------------------------------------ *
 * Risk gate (the fifth, non-decision-making gate)
 * ------------------------------------------------------------------ */

/** Risk bands, and the verdict each band maps to at the end of a run (§6.5). */
export const RISK_BANDS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type RiskBand = (typeof RISK_BANDS)[number];

/** `assessRisk()` result (`src/lib/policy.js:108-140`). */
export interface RiskAssessment {
  /** Clamped to `[0, 1]`, rounded to 2 decimals. */
  score: number;
  band: RiskBand;
  /** Machine-readable reason tags, e.g. `large_change_surface`, `test_surface_changed`. */
  reasons: string[];
}

/** A path that `checkChangedPaths` refuses. */
export interface PathViolation {
  path: RepoRelativePath;
  /** Which of the two path rules fired; they are mutually exclusive per path. */
  category: 'protected_path' | 'outside_evolution_surface';
}

/* ------------------------------------------------------------------ *
 * Evidence gate (bundles live in `evidence.ts`)
 * ------------------------------------------------------------------ */

export type { EvidenceBundle, EvidenceGateInput, EvidenceGateResult, ObjectiveComparison } from './evidence.js';

/* ------------------------------------------------------------------ *
 * Budget gate
 * ------------------------------------------------------------------ */

/** Running counters the budget gate compares against `BudgetsConfig`. */
export interface BudgetGateInput {
  limits: BudgetsConfig;
  /** Cumulative tokens observed so far; `null` when token budgeting is disabled. */
  observed_tokens: number | null;
  /** Cumulative USD estimate in micro-dollars; `null` when cost budgeting is disabled. */
  observed_usd_micros: UsdMicros | null;
  /** `true` when any invocation failed to report a complete USD cost. */
  cost_total_unknown: boolean;
  /** Wall-clock instant the run must finish by (`Date.now() + max_wall_clock_ms`). */
  deadline_at: number;
  failed_candidates: number;
  consecutive_no_improvement: number;
  /** Without process-tree termination the live token gate is refused up front (§6.3). */
  can_terminate_process_tree: boolean;
}

/** Which budget dimension stopped the run. */
export type BudgetMetric = 'tokens' | 'estimated_usd' | 'wall_clock_ms';

export interface BudgetGateResult {
  exhausted: boolean;
  metric: BudgetMetric | null;
  reason: GateReason | null;
}

/* ------------------------------------------------------------------ *
 * Isolation gate
 * ------------------------------------------------------------------ */

/**
 * All four isolation checks in one input:
 *   - `expected_metadata` / `observed_metadata` — the `.git` pointer digest before vs after a
 *     phase (`WORKTREE_METADATA_CHANGED`);
 *   - `holdout_ignored` — `git check-ignore` accepts the private holdout (`HOLDOUT_NOT_IGNORED`);
 *   - `unisolated_agent_accepted` / `readable_holdout_accepted` — the two explicit CLI opt-ins
 *     (`*_SANDBOX_REQUIRED`, `PRIVATE_ORACLE_READABLE`).
 *
 * This is a filesystem/worktree boundary, not an OS sandbox.
 */
export interface IsolationGateInput {
  /** Snapshot taken before the phase, or `null` when no worktree exists yet. */
  expected_metadata: WorktreeMetadataSnapshot | null;
  /** Snapshot taken after the phase; `null` when the pointer could not be read. */
  observed_metadata: WorktreeMetadataSnapshot | null;
  /** `undefined` when no holdout file exists, which is not a failure. */
  holdout_ignored: boolean | undefined;
  unisolated_agent_accepted: boolean;
  readable_holdout_accepted: boolean;
  /** `true` when the selected adapter/phase needs an OS sandbox it does not provide. */
  adapter_requires_sandbox: boolean;
}

export interface IsolationGateResult {
  isolated: boolean;
  reason: GateReason | null;
  /** `true` when the original `.git` pointer had to be restored from the snapshot. */
  metadata_restored: boolean;
}

/* ------------------------------------------------------------------ *
 * Verdicts
 * ------------------------------------------------------------------ */

/** A bare decision plus why, before iteration/evidence context is attached. */
export interface GateVerdict {
  decision: GateDecision;
  reason: GateReason;
}

/**
 * The full payload appended as a `gate.decision` event.
 *
 * `evidence_ok` is set on an iteration's FINAL decision only; the earlier decisions in the same
 * iteration (worktree metadata, policy drift, capability denial, pre-commit validation) carry
 * `failure` or `reason` instead. Extra keys are preserved because the audit view
 * (`src/lib/audit.js`) recomputes verdicts from these payloads.
 */
export interface GateDecisionPayload extends GateVerdict {
  iteration?: number;
  /** Commit the candidate was built from. */
  base_sha?: string;
  evidence_ok?: boolean;
  risk?: RiskAssessment;
  improvement?: number;
  details?: JsonValue;
  failure?: JsonValue;
  requests?: JsonValue;
  private_regressions?: boolean | number;
  min_delta?: number;
  [key: string]: unknown;
}

/** A `gate.decision` ledger event narrowed to its payload. */
export type GateDecisionEvent = Omit<LedgerEvent, 'event_type' | 'payload'> & {
  event_type: 'gate.decision';
  payload: GateDecisionPayload;
};

/** Everything an audit of one gate decision needs, all ledger-derived. */
export interface GateAuditView {
  decision: GateDecisionPayload;
  /** Chain state at the time the audit view was built. */
  integrity: LedgerVerification;
  /** `adapter.finished` payloads for the same run, used to recompute budget claims. */
  adapter_events: AdapterEventPayload[];
  /** Any error code the audit recomputation raised, e.g. `LEDGER_CORRUPT`. */
  error_code?: EvoFenceErrorCode;
}
