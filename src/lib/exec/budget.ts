/**
 * Exec domain · budget accounting (money conversion + token/USD ledger gates).
 *
 * Split out of the 0.3.0 `src/lib/runner.js` unchanged in behavior. The gate domain owns the
 * *pure* verdicts; the wiring — counting observed usage, appending `budget.*` events and
 * throwing `RESOURCE_EXHAUSTED` / `*_USAGE_UNAVAILABLE` — is the exec domain's job and lives
 * here (see `docs/refactor-inventory.md` §6.3).
 */
import { EvoFenceError, invariant } from './errors.js';
import type { Ledger } from '../ledger.js';
import type { AdapterResultLike, AdapterUsageLike } from './types.js';

export const USD_MICROS = 1_000_000;

export function parseNumericBudget(value: unknown, ceiling: number, name: string): number {
  if (value === undefined || value === null) return ceiling;
  const parsed = Number(value);
  invariant(Number.isInteger(parsed) && parsed > 0, 'INVALID_BUDGET', `${name} must be a positive integer.`);
  invariant(parsed <= ceiling, 'BUDGET_ABOVE_POLICY', `${name} cannot exceed the contract limit (${ceiling}).`);
  return parsed;
}

export function usdToMicros(value: number, rounding: 'floor' | 'ceil' = 'floor'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new EvoFenceError('INVALID_BUDGET', 'USD amounts must be finite and non-negative.');
  }
  const match = value.toString().toLowerCase().match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
  if (!match) throw new EvoFenceError('INVALID_BUDGET', 'USD amount could not be represented as a decimal.');
  const fraction = match[2] ?? '';
  const digits = BigInt(`${match[1]}${fraction}`);
  if (digits === 0n) return 0;
  const shift = 6 - fraction.length + Number(match[3] ?? 0);
  let micros: bigint;
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

export function usdFromMicros(value: number): number {
  return value / USD_MICROS;
}

/** Shared ledger coordinates for one adapter invocation. */
export interface BudgetContext {
  ledger: Ledger;
  runId: string;
  phase: string;
  iteration: number;
}

export function recordTokenUsage(result: AdapterResultLike, { maxTokens, totalTokens, ledger, runId, phase, iteration }: BudgetContext & { maxTokens: number | null; totalTokens: number }): number {
  if (result.tree_termination_failed) {
    const usage: AdapterUsageLike | null | undefined = result.reported_usage;
    const invocationTokens: number | null = usage?.tokens_complete === true && Number.isSafeInteger(usage.tokens_total)
      ? usage.tokens_total as number
      : null;
    const observedTotal = maxTokens !== null && invocationTokens !== null
      ? totalTokens + invocationTokens
      : null;
    const failure = {
      metric: maxTokens === null ? 'process_tree' : 'tokens', phase, iteration, limit: maxTokens,
      previous_observed_total: maxTokens === null ? null : totalTokens,
      invocation_tokens: invocationTokens,
      observed_total: Number.isSafeInteger(observedTotal) ? observedTotal : null,
      reason: 'process_tree_termination_failed',
    };
    ledger.append(maxTokens === null ? 'process.tree_termination_failed' : 'budget.termination_failed', runId, failure);
    throw new EvoFenceError('RESOURCE_EXHAUSTED', 'EvoFence could not confirm that the agent process tree stopped. The candidate will not be evaluated or accepted.', failure);
  }
  if (maxTokens === null) return totalTokens;
  if (result.timed_out) {
    const usage: AdapterUsageLike | null | undefined = result.reported_usage;
    const invocationTokens: number | null = usage?.tokens_complete === true && Number.isSafeInteger(usage.tokens_total)
      ? usage.tokens_total as number
      : null;
    const observedTotal = invocationTokens !== null ? totalTokens + invocationTokens : null;
    const failure = {
      metric: 'wall_clock', phase, iteration, reason: 'agent_timeout',
      previous_observed_total: totalTokens,
      invocation_tokens: invocationTokens,
      observed_total: Number.isSafeInteger(observedTotal) ? observedTotal : null,
    };
    ledger.append('budget.exhausted', runId, failure);
    throw new EvoFenceError('RESOURCE_EXHAUSTED', 'The wall-clock budget stopped the agent. The in-flight candidate will not be evaluated or accepted.', failure);
  }
  const usage: AdapterUsageLike | null | undefined = result.reported_usage;
  if (!usage || usage.tokens_complete !== true || !Number.isSafeInteger(usage.tokens_total) || (usage.tokens_total as number) < 0) {
    const failure = { metric: 'tokens', phase, iteration, limit: maxTokens, reason: result.budget_stop_reason ?? 'usage_incomplete' };
    ledger.append('budget.usage_unavailable', runId, failure);
    throw new EvoFenceError('TOKEN_USAGE_UNAVAILABLE', 'The adapter did not provide complete token usage. EvoFence stopped before continuing or evaluating the candidate.', failure);
  }

  const observedTotal = totalTokens + (usage.tokens_total as number);
  if (!Number.isSafeInteger(observedTotal)) {
    const failure = { metric: 'tokens', phase, iteration, limit: maxTokens, reason: 'usage_total_out_of_range' };
    ledger.append('budget.usage_unavailable', runId, failure);
    throw new EvoFenceError('TOKEN_USAGE_UNAVAILABLE', 'The cumulative token count exceeded the safe integer range.', failure);
  }
  const event = {
    metric: 'tokens', phase, iteration,
    invocation_tokens: usage.tokens_total,
    observed_total: observedTotal,
    limit: maxTokens,
    stop_reason: result.budget_stop_reason ?? null,
  };
  ledger.append('budget.tokens.observed', runId, event);

  if (result.budget_stop_reason === 'TOKEN_BUDGET_REACHED' || observedTotal >= maxTokens) {
    ledger.append('budget.exhausted', runId, { ...event, over_limit_tokens: Math.max(0, observedTotal - maxTokens) });
    throw new EvoFenceError('RESOURCE_EXHAUSTED', `The token usage threshold was reached (${observedTotal}/${maxTokens}). The candidate will not continue to evaluation or acceptance.`, event);
  }
  if (result.budget_stop_reason) {
    const failure = { ...event, reason: result.budget_stop_reason };
    ledger.append('budget.usage_unavailable', runId, failure);
    throw new EvoFenceError('TOKEN_USAGE_UNAVAILABLE', 'The adapter stopped before it could provide complete token usage.', failure);
  }
  return observedTotal;
}

export function recordCostUsage(result: AdapterResultLike, { maxUsdMicros, totalCostMicros, ledger, runId, phase, iteration }: BudgetContext & { maxUsdMicros: number; totalCostMicros: number }): number {
  const usage: AdapterUsageLike | null | undefined = result.reported_usage;
  const reportedUsageComplete = usage?.cost_complete === true
    && usage.cost_currency === 'USD'
    && typeof usage.reported_cost === 'number'
    && Number.isFinite(usage.reported_cost)
    && usage.reported_cost >= 0;
  let invocationCostMicros: number | null = null;
  let usageComplete = reportedUsageComplete;
  if (reportedUsageComplete) {
    try {
      invocationCostMicros = usdToMicros(usage!.reported_cost as number, 'ceil');
    } catch {
      usageComplete = false;
    }
  }
  const observedTotalMicros = invocationCostMicros === null ? null : totalCostMicros + invocationCostMicros;
  const observedTotalSafe = Number.isSafeInteger(observedTotalMicros);
  const estimatedTotal = observedTotalSafe ? usdFromMicros(observedTotalMicros as number) : null;
  const details = {
    metric: 'estimated_usd', phase, iteration,
    limit_usd: usdFromMicros(maxUsdMicros),
    previous_observed_usd: usdFromMicros(totalCostMicros),
    invocation_estimate_usd: invocationCostMicros === null ? null : usdFromMicros(invocationCostMicros),
    observed_total_usd: estimatedTotal,
    observed_total_usd_micros: observedTotalSafe ? observedTotalMicros : null,
    cost_source: usage?.cost_source ?? null,
  };

  if (result.tree_termination_failed) {
    const failure = { ...details, cost_usage_unknown: true, reason: 'process_tree_termination_failed' };
    ledger.append('budget.termination_failed', runId, failure);
    throw new EvoFenceError('RESOURCE_EXHAUSTED', 'EvoFence could not confirm that the Claude process tree stopped. The candidate will not be evaluated or accepted.', failure);
  }

  if (result.timed_out) {
    const failure = { ...details, cost_usage_unknown: !observedTotalSafe, reason: 'agent_timeout' };
    ledger.append('budget.exhausted', runId, failure);
    throw new EvoFenceError('RESOURCE_EXHAUSTED', 'The wall-clock budget stopped Claude. The in-flight candidate will not be evaluated or accepted.', failure);
  }

  if (!usageComplete || !observedTotalSafe) {
    const failure = {
      ...details,
      cost_usage_unknown: true,
      reason: result.cost_budget_reached ? 'native_usd_cap_reached_usage_unavailable' : result.budget_stop_reason ?? 'usage_incomplete',
    };
    if (result.cost_budget_reached) {
      ledger.append('budget.exhausted', runId, failure);
      throw new EvoFenceError('RESOURCE_EXHAUSTED', 'Claude reached its native USD cap, but EvoFence could not verify the final cost estimate. The run stopped before candidate evaluation.', failure);
    }
    ledger.append('budget.cost_usage_unavailable', runId, failure);
    throw new EvoFenceError('USD_USAGE_UNAVAILABLE', 'Claude did not provide a complete USD cost estimate. EvoFence stopped before continuing or evaluating the candidate.', failure);
  }

  const event = {
    ...details,
    invocation_estimate_usd: usdFromMicros(invocationCostMicros as number),
    observed_total_usd: estimatedTotal,
    limit_usd: usdFromMicros(maxUsdMicros),
    native_cap_reached: result.cost_budget_reached === true,
  };
  ledger.append('budget.usd.observed', runId, event);

  if (result.cost_budget_reached || (observedTotalMicros as number) >= maxUsdMicros) {
    const failure = {
      ...event,
      reason: result.cost_budget_reached ? 'claude_native_usd_cap_reached' : 'run_usd_estimate_limit_reached',
      over_limit_usd: usdFromMicros(Math.max(0, (observedTotalMicros as number) - maxUsdMicros)),
    };
    ledger.append('budget.exhausted', runId, failure);
    throw new EvoFenceError('RESOURCE_EXHAUSTED', `The Claude USD cost estimate reached the run limit ($${estimatedTotal} / $${usdFromMicros(maxUsdMicros)}). The candidate will not continue to evaluation or acceptance.`, failure);
  }
  return observedTotalMicros as number;
}
