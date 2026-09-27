/**
 * Gate domain · budget gate (pure judgement).
 *
 * Boundary: this module owns the budget *decision* — the constants, the threshold semantics and
 * the pure thresholds — and nothing else. The accounting itself (ledger events, the adapter's
 * live token monitor, the process-tree interrupt) lives in the exec domain
 * (`src/lib/exec/budget.ts`, `src/lib/exec/runner-budgeted.ts`) and is deliberately NOT
 * duplicated here.
 *
 * WIRING STATUS (fix batch R2 · review F3) — read this before trusting a test against this file:
 *   - WIRED: the primitives below (`USD_MICROS`, `parseNumericBudget`, `usdToMicros`,
 *     `usdFromMicros`) ARE on the production path. `src/lib/exec/budget.ts` re-exports them and
 *     `runner-preflight.ts` / `runner-budgeted.ts` / `runner-run.ts` call them.
 *   - NOT WIRED: `evaluateBudgetGate` (and the other `evaluate*Gate` / verdict entry points) has
 *     no production caller today. Production decisions are taken by the accounting functions in
 *     `src/lib/exec/budget.ts` (`recordTokenUsage` / `recordCostUsage`) and the pre-invocation
 *     allowance check in `src/lib/exec/runner-budgeted.ts`.
 *   See the WIRING STATUS block in `./index.ts` for the whole domain and the tests that pin it.
 *
 * Ported verbatim from 0.3.0:
 *   - `parseNumericBudget` (`src/lib/runner.js:33-39`): `INVALID_BUDGET` / `BUDGET_ABOVE_POLICY`.
 *   - `usdToMicros` / `usdFromMicros` (`src/lib/runner.js:41-67`): BigInt decimal parsing so a
 *     USD figure is never a float; `floor` for accounting, `ceil` for the upper bound;
 *     `INVALID_BUDGET` when the amount exceeds the safe-integer range.
 *   - the exhaustion thresholds (`recordTokenUsage` `:194`, `recordCostUsage` `:263`,
 *     `runBudgetedAdapter` `:437-450`) and the host-capability pre-check (`:383-390`).
 *     Ref: `docs/refactor-inventory.md` §6.3.
 *
 * Imports: `src/types/**`, the shared base leaf `src/lib/errors.js`, sibling gate modules.
 */

import type { BudgetsConfig } from '../../types/config.js';
import type { BudgetGateInput, BudgetGateResult, BudgetMetric, GateJudgementBase } from '../../types/gate.js';
import type { UsdMicros } from '../../types/shared.js';
import { EvoFenceError, invariant } from '../errors.js';
import { failingJudgement, isFiniteNumber, isRecord, passingJudgement, refusedJudgement } from './fail-closed.js';

/** Micro-dollars per dollar; the accounting unit of every USD budget. */
export const USD_MICROS = 1_000_000;

/**
 * `undefined`/`null` keeps the contract ceiling; otherwise the CLI value must be a positive
 * integer no greater than that ceiling.
 */
export function parseNumericBudget(value: unknown, ceiling: number, name: string): number {
  if (value === undefined || value === null) return ceiling;
  const parsed = Number(value);
  invariant(Number.isInteger(parsed) && parsed > 0, 'INVALID_BUDGET', `${name} must be a positive integer.`);
  invariant(parsed <= ceiling, 'BUDGET_ABOVE_POLICY', `${name} cannot exceed the contract limit (${ceiling}).`);
  return parsed;
}

/** Convert a finite, non-negative USD amount to micro-dollars without float arithmetic. */
export function usdToMicros(value: unknown, rounding: 'floor' | 'ceil' = 'floor'): UsdMicros {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new EvoFenceError('INVALID_BUDGET', 'USD amounts must be finite and non-negative.');
  }
  const match = value.toString().toLowerCase().match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
  if (!match) throw new EvoFenceError('INVALID_BUDGET', 'USD amount could not be represented as a decimal.');
  const fraction = match[2] ?? '';
  const digits = BigInt(`${match[1]}${fraction}`);
  if (digits === 0n) return 0;
  const shift = 6 - fraction.length + Number(match[3] ?? 0);
  let micros;
  if (shift >= 0) {
    micros = digits * (10n ** BigInt(shift));
  } else {
    const divisor = 10n ** BigInt(-shift);
    micros = digits / divisor;
    if (rounding === 'ceil' && digits % divisor !== 0n) micros += 1n;
  }
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new EvoFenceError('INVALID_BUDGET', 'USD amount exceeds EvoFence safe accounting range.');
  }
  return Number(micros);
}

/** Micro-dollars back to a display-only USD number. */
export function usdFromMicros(value: UsdMicros): number {
  return value / USD_MICROS;
}

/** Token budget left before the next invocation; `null` when tokens are unbounded. */
export function remainingTokenBudget(limit: number | null, observed: number): number | null {
  return limit === null ? null : limit - observed;
}

/** USD budget left in micro-dollars; `null` when cost is unbounded. */
export function remainingUsdBudgetMicros(limitMicros: UsdMicros | null, observedMicros: UsdMicros): UsdMicros | null {
  return limitMicros === null ? null : limitMicros - observedMicros;
}

/** Budget-gate judgement. */
export interface BudgetGateJudgement extends GateJudgementBase, BudgetGateResult {
  /** Configured limit of the exhausted dimension (tokens or dollars), when there is one. */
  limit: number | null;
  /** Observed total of the exhausted dimension. */
  observed: number | null;
}

const NO_EXHAUSTION: BudgetGateResult = { exhausted: false, metric: null, reason: null };

function invalidLimits(limits: Record<string, unknown>, missing: string[]): void {
  for (const key of ['max_iterations', 'max_wall_clock_ms', 'max_failed_candidates', 'max_consecutive_no_improvement']) {
    if (!Number.isInteger(limits[key]) || (limits[key] as number) < 1) missing.push(`limits.${key}`);
  }
  if (!(limits.max_tokens === null || (Number.isSafeInteger(limits.max_tokens) && (limits.max_tokens as number) > 0))) missing.push('limits.max_tokens');
  if (!(limits.max_usd === null || (isFiniteNumber(limits.max_usd) && limits.max_usd > 0))) missing.push('limits.max_usd');
}

/**
 * Independent budget-gate entry point: has any budget dimension been exhausted?
 *
 * WIRING STATUS (review F3): this function is a pure **reference implementation** — it is NOT
 * called anywhere on the production path (see the module header). Production takes the same
 * decisions in `src/lib/exec/runner-budgeted.ts` (pre-invocation allowance) and
 * `src/lib/exec/budget.ts` (post-invocation accounting); `test/fix-gate-wiring.test.js` pins
 * that the two agree on the exhaustion threshold and on the usage-unavailable cases.
 *
 * Fail-closed: an absent input, a malformed limit block, or a counter the gate needs but did not
 * receive (`observed_tokens` while `max_tokens` is set, `deadline_at`, …) returns
 * `passed: false` with `missing` naming every offending field — never "budget is fine".
 * `cost_total_unknown` while a USD limit is configured also refuses, because the run cannot
 * prove it is inside its cost ceiling.
 *
 * Check order (first exhausted dimension wins): tokens → estimated USD → wall clock →
 * failed candidates → consecutive no improvement.
 */
export function evaluateBudgetGate(
  input: BudgetGateInput | null | undefined,
  now: number = Date.now(),
): BudgetGateJudgement {
  const empty = { ...NO_EXHAUSTION, limit: null, observed: null };
  if (!isRecord(input)) return failingJudgement(['input'], empty);
  const missing: string[] = [];
  if (!isRecord(input.limits)) missing.push('limits');
  else invalidLimits(input.limits as Record<string, unknown>, missing);
  if (!Number.isSafeInteger(input.observed_tokens) && input.observed_tokens !== null) missing.push('observed_tokens');
  if (!Number.isSafeInteger(input.observed_usd_micros) && input.observed_usd_micros !== null) missing.push('observed_usd_micros');
  if (typeof input.cost_total_unknown !== 'boolean') missing.push('cost_total_unknown');
  if (!isFiniteNumber(input.deadline_at)) missing.push('deadline_at');
  if (!Number.isSafeInteger(input.failed_candidates)) missing.push('failed_candidates');
  if (!Number.isSafeInteger(input.consecutive_no_improvement)) missing.push('consecutive_no_improvement');
  if (typeof input.can_terminate_process_tree !== 'boolean') missing.push('can_terminate_process_tree');
  if (missing.length) return failingJudgement(missing, empty);

  const limits = input.limits as unknown as BudgetsConfig;
  const observedTokens = input.observed_tokens as number | null;
  const observedUsdMicros = input.observed_usd_micros as UsdMicros | null;
  const deadlineAt = input.deadline_at as number;
  const failedCandidates = input.failed_candidates as number;
  const noImprovement = input.consecutive_no_improvement as number;

  if (limits.max_tokens !== null && observedTokens === null) return failingJudgement(['observed_tokens'], empty);
  if (limits.max_usd !== null && observedUsdMicros === null) return failingJudgement(['observed_usd_micros'], empty);

  if (limits.max_tokens !== null && !input.can_terminate_process_tree) {
    return refusedJudgement('UNSUPPORTED_TOKEN_BUDGET_PROCESS_CONTROL', { ...NO_EXHAUSTION, metric: 'tokens' as BudgetMetric, limit: limits.max_tokens, observed: observedTokens });
  }
  if (limits.max_usd !== null && !input.can_terminate_process_tree) {
    return refusedJudgement('UNSUPPORTED_COST_BUDGET_PROCESS_CONTROL', { ...NO_EXHAUSTION, metric: 'estimated_usd' as BudgetMetric, limit: usdToMicros(limits.max_usd), observed: observedUsdMicros });
  }
  if (limits.max_usd !== null && input.cost_total_unknown) {
    return refusedJudgement('USD_USAGE_UNAVAILABLE', { ...NO_EXHAUSTION, metric: 'estimated_usd' as BudgetMetric, limit: usdToMicros(limits.max_usd), observed: observedUsdMicros });
  }

  if (limits.max_tokens !== null && observedTokens !== null && observedTokens >= limits.max_tokens) {
    return refusedJudgement('TOKEN_BUDGET_REACHED', { exhausted: true, metric: 'tokens' as BudgetMetric, limit: limits.max_tokens, observed: observedTokens });
  }
  const usdLimitMicros = limits.max_usd === null ? null : usdToMicros(limits.max_usd);
  if (usdLimitMicros !== null && observedUsdMicros !== null && observedUsdMicros >= usdLimitMicros) {
    return refusedJudgement('USD_LIMIT_REACHED', { exhausted: true, metric: 'estimated_usd' as BudgetMetric, limit: usdLimitMicros, observed: observedUsdMicros });
  }
  if (now >= deadlineAt) {
    return refusedJudgement('WALL_CLOCK_EXHAUSTED', { exhausted: true, metric: 'wall_clock_ms' as BudgetMetric, limit: null, observed: null });
  }
  if (failedCandidates >= limits.max_failed_candidates) {
    return refusedJudgement('MAX_FAILED_CANDIDATES', { exhausted: true, metric: null, limit: limits.max_failed_candidates, observed: failedCandidates });
  }
  if (noImprovement >= limits.max_consecutive_no_improvement) {
    return refusedJudgement('MAX_CONSECUTIVE_NO_IMPROVEMENT', { exhausted: true, metric: null, limit: limits.max_consecutive_no_improvement, observed: noImprovement });
  }
  return passingJudgement({ ...NO_EXHAUSTION, limit: null, observed: null });
}
