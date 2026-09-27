/**
 * Exec-domain contracts: process results, adapter invocations, token/USD accounting and the
 * worktree-isolation metadata snapshot.
 *
 * DERIVED FROM:
 *   - `runProcess`/`runTrustedCommand` result (`src/lib/process.js:200-215`, `:225-229`) and
 *     `runTrustedCommand`'s added `command` field. Ref: `docs/refactor-inventory.md` §6.3, §10.4.
 *   - `parseAdapterUsage`/`createAdapterUsageMonitor().snapshot()` (`src/lib/adapter.js:456-472`,
 *     `:296-306`, `:308-318` variant `incompleteUsage`). §6.3.
 *   - `runAgentAdapter` result (`src/lib/adapter.js:553-570`). §6.3.
 *   - `adapterEvent` payload for `adapter.finished` (`src/lib/runner.js:115-137`).
 *   - `runEvolution` outcome and per-iteration records (`src/lib/runner.js:423-428`, `:831-848`,
 *     `:531-570`). §7.2.
 *   - `worktreeMetadataSnapshot` (`src/lib/git.js:53-59`) and the isolation gate in §6.4.
 *   - `createWorktree`/`removeWorktree`/`changedPaths*` (`src/lib/git.js:45-95`).
 *
 * BOUNDARY REMINDER: worktree isolation is a filesystem boundary only. Nothing in this module
 * may be named or documented as an OS sandbox (§6.4 boundary statement, AGENTS.md).
 *
 * NO ESTIMATION RULE: every usage field is nullable on purpose. `tokens_total`,
 * `reported_cost` and `estimated_tokens` are `null` whenever the adapter did not report a
 * complete value; the runner treats that as `TOKEN_USAGE_UNAVAILABLE`/`USD_USAGE_UNAVAILABLE`
 * and stops. Never widen these to `number` and never let a consumer fill a null with a guess.
 */

import type {
  AdapterName,
  Hash256Hex,
  JsonValue,
  ProcessSignal,
  RepoRelativePath,
  RunOutcomeStatus,
  UsdMicros,
} from './shared.js';
import type { GenerationRecord } from './ledger.js';

/** Which phase of a run an adapter invocation belongs to. */
export type AdapterPhase = 'proposal' | 'implementation';

/** Which evidence pass ran; also the artifact filename prefix. */
export type EvidencePhase = 'baseline' | 'candidate';

/**
 * Why the process runner was stopped early, as seen in `stop_reason`.
 *
 * Three sources feed this string: the runner's own timer (`'TIMEOUT'`), a throwing output
 * callback (`'OUTPUT_CALLBACK_ERROR'`), and any string returned by an `onChunk` callback —
 * which is how the token monitor signals `'TOKEN_BUDGET_REACHED'` /
 * `'TOKEN_USAGE_UNAVAILABLE'` (`src/lib/process.js:158-161`, `:219`, `src/lib/adapter.js:264-266`).
 * The first observed reason wins; later ones are discarded.
 */
export type StopReason = string;

/** Result of `runProcess` (`src/lib/process.js:200-215`). */
export interface ProcessResult {
  command: string;
  args: readonly string[];
  /** Exit code, or `null` when the child died from a signal. */
  code: number | null;
  signal: ProcessSignal | null;
  timed_out: boolean;
  stop_reason: StopReason | null;
  /** `true` when a stopped process tree could not be confirmed dead — the candidate is never evaluated. */
  tree_termination_failed: boolean;
  /** Message of an exception thrown by an `onChunk` callback, if any. */
  output_error: string | null;
  /** `true` once either stream exceeded `maxOutputBytes`; the stored text is truncated. */
  output_limited: boolean;
  stdout: string;
  stderr: string;
  /** Total bytes seen on the stream, before truncation. */
  stdout_bytes: number;
  stderr_bytes: number;
}

/** `runTrustedCommand` result: a `ProcessResult` (it already carries `command`) run through a shell. */
export type TrustedCommandResult = ProcessResult;

/** `duration_ms` is added by the evidence collector, not by `runProcess`. */
export interface TimedProcessResult {
  duration_ms: number;
}

/** Complete-or-null token/cost accounting for one adapter invocation (`parseAdapterUsage`). */
export interface AdapterUsage {
  /** `null` unless the count is complete and safe-integer-bounded. */
  tokens_total: number | null;
  tokens_complete: boolean;
  /** Which CLI field the count came from, e.g. `codex-cli-turn.completed`. */
  token_source: string | null;
  /** `null` unless the adapter reported a complete cost. */
  reported_cost: number | null;
  cost_complete: boolean;
  /** ISO currency of {@link AdapterUsage.reported_cost}, e.g. `'USD'`. */
  cost_currency: string | null;
  cost_source: string | null;
}

/** `createAdapterUsageMonitor(...).snapshot()` — live counters at the moment of the stop. */
export interface AdapterUsageSnapshot {
  tokens_total: number | null;
  tokens_complete: boolean;
  token_source: string | null;
}

/** Version of the pi tool-strategy telemetry schema (`PI_TOOL_STRATEGY_VERSION = 1`). */
export const PI_TOOL_STRATEGY_VERSION = 1;

/** Per-tool counters in a pi tool-strategy summary. */
export interface PiToolStrategyToolSummary {
  name: string;
  calls: number;
  results: number;
  errors: number;
}

/**
 * Telemetry sidecar summary for a pi adapter phase
 * (`summarizePiToolStrategyTelemetry`, `src/lib/pi-tool-strategy.js:175-256`), or its
 * all-zero `unavailablePiToolStrategy` fallback (`:259`).
 *
 * `status` is derived, never declared: `active` only when the strategy reported ready, was
 * never truncated, hit no controller error and saw `agent_end`; otherwise `degraded`, or
 * `unavailable` when it never became ready. The whole summary is fail-open telemetry — no
 * gate reads it.
 */
export interface PiToolStrategySummary {
  schema_version: typeof PI_TOOL_STRATEGY_VERSION;
  status: 'active' | 'degraded' | 'unavailable';
  phase: 'proposal' | 'implementation';
  /** Tool order observed at `ready`; `null` when the strategy never became ready. */
  initial_tool_order: string[] | null;
  final_tool_order: string[] | null;
  tool_order_updates: number;
  tool_calls: number;
  tool_results: number;
  tool_errors: number;
  repeated_call_blocks: number;
  controller_errors: number;
  /** `true` when the sidecar exceeded its byte cap or contained an unparseable/oversized line. */
  telemetry_truncated: boolean;
  agent_finished: boolean;
  /** Sorted by tool name. */
  tools: PiToolStrategyToolSummary[];
}

/** `runAgentAdapter` result (`src/lib/adapter.js:553-570`). */
export interface AdapterRunResult extends ProcessResult {
  adapter: AdapterName;
  /** Resolved from config; `null` when the adapter runs with its own default model. */
  model: string | null;
  budget_stop_reason: StopReason | null;
  /** Claude's native `--max-budget-usd` cap fired (`result` subtype `error_max_budget_usd`). */
  cost_budget_reached: boolean;
  /** Legacy field, kept for compatibility, never filled with a partial or estimated count. */
  estimated_tokens: number | null;
  reported_usage: AdapterUsage | AdapterUsageSnapshot;
  /** Present only for the pi adapter. */
  tool_strategy?: PiToolStrategySummary | null;
}

/**
 * `adapter.finished` event payload (`src/lib/runner.js:115-137`), minus `stdout`/`stderr`
 * bodies: the ledger stores only their digests.
 */
export interface AdapterEventPayload {
  adapter: AdapterName;
  model: string | null;
  phase: AdapterPhase;
  iteration: number;
  exit_code: number | null;
  signal: ProcessSignal | null;
  timed_out: boolean;
  tree_termination_failed: boolean;
  output_limited: boolean;
  duration_ms: number | null;
  estimated_tokens: number | null;
  /**
   * Numeric USD only when the adapter reported a complete USD cost; `null` otherwise.
   * (`cost_currency === 'USD' && cost_complete && 0 <= reported_cost`.)
   */
  estimated_cost_usd: number | null;
  reported_usage: AdapterUsage | AdapterUsageSnapshot | null;
  tool_strategy?: PiToolStrategySummary | null;
  stdout_sha256: Hash256Hex;
  stderr_sha256: Hash256Hex;
}

/**
 * Worktree `.git` pointer snapshot taken before and after each agent phase
 * (`worktreeMetadataSnapshot`, `src/lib/git.js:53-59`).
 *
 * The pointer must be a regular file: a directory or symlink is a candidate tamper
 * (`WORKTREE_METADATA_CHANGED`). Comparison is digest-only, so {@link WorktreeMetadataSnapshot.contents}
 * exists solely to restore the original pointer.
 */
export interface WorktreeMetadataSnapshot {
  /** Absolute path of `<worktree>/.git`. */
  path: string;
  /** Raw pointer file bytes. */
  contents: Uint8Array;
  sha256: Hash256Hex;
}

/** A single invocation's budget position, as `runBudgetedAdapter` computes it. */
export interface BudgetObservation {
  iteration: number;
  phase: AdapterPhase;
  /** Remaining token budget at the moment of the check; `null` when tokens are unlimited. */
  remaining_tokens: number | null;
  /** Remaining USD budget in micro-dollars; `null` when cost is unlimited or unknown. */
  remaining_usd_micros: UsdMicros | null;
}

/** `budget.exhausted` / `budget.usage_unavailable` / `budget.termination_failed` payload. */
export interface BudgetEventPayload {
  metric?: 'tokens' | 'estimated_usd' | 'wall_clock_ms';
  phase?: AdapterPhase;
  iteration?: number;
  /** Configured ceiling. */
  limit?: number;
  limit_usd?: number;
  observed_total?: number;
  observed_total_usd?: number;
  reason?: StopReason;
  cost_usage_unknown?: boolean;
  [key: string]: JsonValue | undefined;
}

/** One iteration of an evolution run, as pushed into `RunOutcome.iterations`. */
export interface RunIterationOutcome {
  iteration: number;
  /** The gate verdict, or a bare `REJECT` when the candidate never reached the gate. */
  decision: 'ACCEPT' | 'REJECT' | 'ESCALATE' | 'QUARANTINE';
  reason?: string;
  risk?: JsonValue;
  improvement?: number;
  requests?: JsonValue;
  failure?: JsonValue;
  generation_id?: string;
  sha?: string;
  parent_sha?: string;
  diff_sha256?: Hash256Hex;
  objective_score?: number;
  [key: string]: unknown;
}

/** Reason a run stopped without an accepted generation. */
export interface RunOutcomeFailure {
  code?: string;
  message?: string;
  reason?: string;
  [key: string]: unknown;
}

/**
 * `runEvolution` return value (`src/lib/runner.js:423-428`, `:831-848`).
 *
 * `token_usage_total` and `cost_estimate_total_usd` are `null` when the corresponding budget
 * is disabled — they are never an estimate of unbounded usage.
 */
export interface RunOutcome {
  run_id: string;
  status: RunOutcomeStatus;
  adapter: AdapterName;
  /** Commit the run started from (the active generation's sha, or `HEAD`). */
  base_sha: string;
  iterations: RunIterationOutcome[];
  active_generation: GenerationRecord | null;
  /** Cumulative tokens observed; `null` when `budgets.max_tokens` is `null`. */
  token_usage_total: number | null;
  /** Cumulative USD estimate; `null` when no USD budget was configured. */
  cost_estimate_total_usd: number | null;
  duration_ms?: number;
  decision?: 'ACCEPT' | 'REJECT' | 'ESCALATE' | 'QUARANTINE';
  failure?: RunOutcomeFailure;
  /** Markdown failure packet fed back into the next iteration's task file. */
  previous_failure_packet?: string;
  [key: string]: unknown;
}

/** `runEvolution` options (`src/lib/runner.js:361`). */
export interface RunEvolutionOptions {
  cwd: string;
  /** Goal file path, resolved by the caller. */
  goal: string;
  adapter?: AdapterName;
  iterations?: number;
  maxWallClockMs?: number;
  /** @deprecated kept for the 0.3.0 CLI flag; `allowUnisolatedAgent` is the live one. */
  allowUnisolatedOpenCode?: boolean;
  /** Explicitly accept that the adapter provides no OS-level sandbox. */
  allowUnisolatedAgent?: boolean;
  /** Required for a readable private holdout (`PRIVATE_ORACLE_READABLE` otherwise). */
  allowReadableHoldout?: boolean;
  onProgress?: (event: JsonValue) => void;
  adapterRunner?: unknown;
}

/** Path of the per-iteration task file handed to the agent, and the exclusion it implies. */
export const TASK_FILE_NAME = '.evofence-task.md';

/** Repository-relative path produced by `changedPaths`/`changedPathsBetween`. */
export type ChangedPath = RepoRelativePath;
