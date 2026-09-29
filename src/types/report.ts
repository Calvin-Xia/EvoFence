/**
 * Report/status-domain contracts: the JSON views behind `evofence report` and
 * `evofence status`, and the audit view behind `evofence diff`.
 *
 * DERIVED FROM:
 *   - `buildEvolutionReport` / `emptyReport` / `summarizeRuns` / `buildGenerations` /
 *     `buildObjective` / `summarizeObjectiveGroup` (`src/lib/report.js:86-145`, `:211-232`,
 *     `:237-279`, `:321-346`). Ref: `docs/refactor-inventory.md` §7.2.
 *   - `buildStatus` / `emptyStatus` / `aggregateRuns` (`src/lib/status.js:22-72`). §7.2.
 *   - `generationDiff` (`src/lib/audit.js:308-327`, 20 fields). §7.2 and §6.2.
 *
 * These are JSON views, not ledger rows: every field is already decoded, sanitized and — in
 * the report case — recomputed from the ledger. The `integrity` shape in particular is NOT
 * {@link import('./ledger.js').LedgerVerification}: it is a deliberately lossy projection
 * that also carries the two audit-only failure kinds (`parse_failed`, `generations_mismatch`).
 */

import type { GenerationRecord, RecentRunSummary } from './ledger.js';
import type { Hash256Hex, RepoRelativePath, RunSummaryStatus } from './shared.js';

/* ------------------------------------------------------------------ *
 * report
 * ------------------------------------------------------------------ */

/** One row of `report.runs`, built from `run.started` + terminal events. */
export interface ReportRunSummary {
  run_id: string;
  started_at: string;
  /** `'unknown'` when the `run.started` payload had no adapter string. */
  adapter: string;
  status: RunSummaryStatus;
  iterations: number;
  accepted_candidates: number;
  rejected_candidates: number;
  /** Only present for `run.failed`, from the failure payload's `code`. */
  failure_code?: string;
}

/** One row of `report.generations`. Scores are `null` when the accepted event is missing. */
export interface ReportGenerationSummary {
  generation_id: string;
  sha: string | null;
  parent_sha: string | null;
  objective_score: number | null;
  improvement: number | null;
  run_id: string | null;
}

/** Per-metric/direction aggregate over generations. */
export interface ReportObjectiveGroup {
  metric: string | null;
  direction: 'maximize' | 'minimize' | null;
  first_score: number | null;
  best_score: number | null;
  /** Signed in the group's own direction; `null` when the direction is unknown. */
  delta: number | null;
}

/**
 * `report.objective`. When generations span incompatible metrics/directions the aggregate
 * fields are all `null` and only {@link ReportObjectiveGroup} carries data — the report
 * refuses to combine incomparable objectives.
 */
export interface ReportObjective extends ReportObjectiveGroup {
  groups?: ReportObjectiveGroup[];
}

/** Boundary-of-report budget totals, recomputed from the event chain. */
export interface ReportBudgets {
  tokens_total: number | null;
  /** Float USD, not micro-dollars — this is a presentation value. */
  usd_total: number | null;
}

/**
 * Lossy integrity projection used by the report. Either the chain is valid, or one of the
 * three audit-detected failure kinds is set.
 */
export interface ReportIntegrity {
  valid: boolean;
  /** Chain index the verification failed at, when the chain itself is broken. */
  failed_at_seq?: number | null;
  expected_previous_hash?: Hash256Hex | null;
  observed_hash?: Hash256Hex | null;
  /** The hash chain matched but at least one `payload_json` was not valid JSON. */
  parse_failed?: boolean;
  /** The `generations` table disagrees with the `generation.accepted` events. */
  generations_mismatch?: boolean;
}

/** `buildEvolutionReport()` return value; also the shape `formatEvolutionReport` renders. */
export interface EvolutionReport {
  schema_version: 1;
  generated_at: string;
  run_count: number;
  generation_count: number;
  runs: ReportRunSummary[];
  generations: ReportGenerationSummary[];
  objective: ReportObjective | null;
  budgets: ReportBudgets;
  integrity: ReportIntegrity;
}

/* ------------------------------------------------------------------ *
 * budget forecast
 * ------------------------------------------------------------------ */

/** One sanitized run row used by the read-only budget forecast. */
export interface BudgetForecastRun {
  run_id: string;
  started_at: string;
  status: string;
  iterations: number;
  iteration_limit: number | null;
  tokens_used: number | null;
  tokens_limit: number | null;
  usd_used: number | null;
  usd_limit: number | null;
}

/** Aggregate usage/threshold facts and a historical-mean round estimate. */
export interface BudgetForecastMetric {
  used: number | null;
  limit: number | null;
  used_ratio: number | null;
  historical_mean_per_round: number | null;
  remaining_rounds_estimate: number | null;
}

/** JSON/text view behind `evofence budget`. */
export interface BudgetForecastView {
  schema_version: 1;
  basis: 'historical_mean';
  explanation: string;
  run_count: number;
  rounds_used: number;
  rounds_limit: number | null;
  used_ratio: number | null;
  historical_mean_rounds_per_run: number | null;
  remaining_rounds_estimate: number | null;
  tokens: BudgetForecastMetric;
  usd: BudgetForecastMetric;
  runs: BudgetForecastRun[];
}

/* ------------------------------------------------------------------ *
 * status
 * ------------------------------------------------------------------ */

/** `status.totals`: ledger-wide counters. `generations` counts `generation.accepted` events. */
export interface StatusTotals {
  runs: number;
  generations: number;
  accepted_candidates: number;
  rejected_candidates: number;
}

/** `status.integrity`: just the chain verdict. */
export interface StatusIntegrity {
  valid: boolean;
}

/**
 * `status.policy.contract` — the objective/budget/evidence facts `status` echoes so its printed
 * output can be checked against `.evofence/contract.yaml` (counts where the document has arrays).
 */
export interface StatusPolicyContractSummary {
  objective: { name: string; direction: string; min_delta: number };
  budgets: {
    max_iterations: number;
    max_wall_clock_ms: number;
    max_failed_candidates: number;
    max_consecutive_no_improvement: number;
  };
  evidence: { public_commands: string[]; per_command_timeout_ms: number; max_output_bytes: number };
  hard_invariants: number;
  protected_paths: number;
}

/** One effective adapter in `status.policy.adapters`; `command` falls back to the adapter name. */
export interface StatusPolicyAdapterSummary {
  name: string;
  command: string;
  model: string | null;
  agent: string | null;
}

/**
 * `status.policy` — the validated policy state, or `null` when the repository has neither
 * `.evofence/contract.yaml` nor `.evofence/config.yaml` (an absent policy is not an error).
 *
 * PAIRED DECLARATION: the runtime producer is `PolicySnapshot` in `src/lib/config/load.ts`
 * (review F8a — `StatusView` used to omit this key even though `status --json` emits it). The
 * shape is declared here rather than imported because ADR-0005 and `src/types/README.md` forbid
 * `src/types/**` from importing `src/lib/**`. Two checks keep the pair honest:
 *   - `src/lib/status.ts` declares `interface StatusView extends StatusViewContract { policy:
 *     PolicySnapshot | null }`, so `tsc` fails as soon as the lib shape stops being assignable
 *     to this one (a dropped or retyped field);
 *   - `test/fix-status-policy-shape.test.js` pins the emitted key set of `status --json` and of
 *     `emptyStatus()` against these fields, which also catches a field the lib adds and this
 *     declaration misses.
 * The clean end state is to move `PolicySnapshot` into `src/types/config.ts` and have
 * `src/lib/config/load.ts` re-export it; that edit is outside this batch's file boundary.
 */
export interface StatusPolicySnapshot {
  contract: StatusPolicyContractSummary | null;
  adapters: StatusPolicyAdapterSummary[];
  files: { contract: string | null; config: string | null };
}

/**
 * `buildStatus()` return value.
 *
 * `active_generation` and `recent_runs` stay empty when the ledger is missing or unreadable;
 * a failed verification is reported through {@link StatusIntegrity} while the counters keep
 * their best-effort values. `policy` is `null` when no policy document exists.
 */
export interface StatusView {
  /** Absolute root path, normalised to `/` separators. */
  root: string;
  active_generation: GenerationRecord | null;
  integrity: StatusIntegrity;
  /** At most five entries (`recentRuns(5)`), each already sanitized. */
  recent_runs: RecentRunSummary[];
  totals: StatusTotals;
  /** Validated `.evofence` policy state; `null` without either policy file. */
  policy: StatusPolicySnapshot | null;
}

/* ------------------------------------------------------------------ *
 * diff / audit
 * ------------------------------------------------------------------ */

/**
 * Objective facts the audit recovered for an accepted generation, or `null` when there is no
 * `candidate.accepted` event. `metric` falls back to the proposal's `expected_effect.primary_metric`
 * before giving up; `direction` does not fall back — it stays `null` when the run snapshot lacks it.
 */
export interface AuditObjective {
  metric: string | null;
  direction: string | null;
  score: number | null;
  improvement: number | null;
}

/** One public/hard-invariant check as summarized for the audit view (three fields only). */
export interface AuditEvidenceCheck {
  id: string | null;
  kind: string | null;
  result: string | null;
}

/**
 * Evidence summary the audit view exposes. Private cases are deliberately absent: the audit
 * view never mirrors the hidden oracle.
 */
export interface AuditEvidence {
  all_public_passed: boolean;
  all_private_within_tolerance: boolean;
  checks: AuditEvidenceCheck[];
}

/**
 * `generationDiff()` return value — the F1 acceptance oracle's JSON surface
 * (`src/lib/audit.js:264-320`).
 *
 * This method FAILS CLOSED: every integrity problem it detects (broken chain, missing
 * generation, metadata/gate/evidence/improvement disagreement, Git < 2.42) throws
 * `EvoFenceError` (`LEDGER_CORRUPT`, `GENERATION_NOT_FOUND`, `GIT_VERSION_UNSUPPORTED`)
 * instead of returning a degraded object. So there is no `integrity`/`error_code` field here:
 * a returned `GenerationDiff` is a verified one.
 *
 * `diff_sha256_matches` is the one soft signal: `null` when the ledger recorded no digest
 * (legacy acceptance), otherwise `boolean`, and `false` is reported inline rather than thrown.
 */
export interface GenerationDiff {
  generation_id: string;
  run_id: string | null;
  sha: string;
  parent_sha: string;
  /** `false` means the generation exists in `generations` but has no `candidate.accepted` event. */
  accepted: boolean;
  /** Digest recomputed live from git with `GIT_ATTR_SOURCE` pinned to the generation's tree. */
  diff_sha256: Hash256Hex;
  /** Digest as recorded on the `candidate.accepted` event; `null` for legacy acceptances. */
  diff_sha256_recorded: Hash256Hex | null;
  diff_sha256_matches: boolean | null;
  /** Sorted, `/`-separated paths between `parent_sha` and `sha`. */
  changed_paths: RepoRelativePath[];
  /** Unified diff, capped at 200 KiB (`DIFF_CAP_BYTES`). */
  diff: string;
  /** `true` once {@link GenerationDiff.diff} has been truncated. */
  diff_truncated: boolean;
  objective: AuditObjective | null;
  evidence: AuditEvidence | null;
  /** `proposal_id` recorded on the `proposal.created` event bound to this acceptance. */
  proposal_id: string | null;
  /** `generations.created_at` for this generation. */
  accepted_at: string | null;
}
