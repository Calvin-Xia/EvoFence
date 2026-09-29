/**
 * Exec domain · per-invocation budget wrapper and the shared cost-field projection.
 *
 * Extracted verbatim from `runEvolution`'s closure. `runBudgetedAdapter` checks the remaining
 * allowance, dispatches the adapter, appends `adapter.finished`, then applies the token and USD
 * accounting gates (which may throw `RESOURCE_EXHAUSTED` / `*_USAGE_UNAVAILABLE`).
 */
import { EvoFenceError } from './errors.js';
import { adapterEvent } from './runner-events.js';
import { invokeAdapter } from './runner-adapter.js';
import { recordCostUsage, recordTokenUsage, usdFromMicros } from './budget.js';
import type { RunContext } from './runner-context.js';
import type { AdapterResultLike } from './types.js';

/** Options for one budgeted adapter invocation. */
export interface BudgetedAdapterOptions {
  iteration: number;
  phase: string;
  worktree: string;
  timeoutMs: number;
  contract: unknown;
  allowUnisolatedAgent: boolean;
}

export async function runBudgetedAdapter(ctx: RunContext, { iteration, phase, ...options }: BudgetedAdapterOptions): Promise<AdapterResultLike> {
  const { ledger, runId, adapter, config } = ctx;
  const remainingTokens = ctx.tokenLimit === null ? null : ctx.tokenLimit - ctx.state.observedTokens;
  if (remainingTokens !== null && remainingTokens < 1) {
    const failure = { metric: 'tokens', phase, iteration, limit: ctx.tokenLimit, observed_total: ctx.state.observedTokens };
    ledger.append('budget.exhausted', runId, failure);
    throw new EvoFenceError('RESOURCE_EXHAUSTED', `The token usage threshold was reached (${ctx.state.observedTokens}/${ctx.tokenLimit}).`, failure);
  }
  const remainingUsdMicros = ctx.costLimitMicros === null ? null : ctx.costLimitMicros - ctx.state.observedCostMicros;
  if (remainingUsdMicros !== null && remainingUsdMicros < 1) {
    const failure = {
      metric: 'estimated_usd', phase, iteration,
      limit_usd: usdFromMicros(ctx.costLimitMicros as number),
      observed_total_usd: usdFromMicros(ctx.state.observedCostMicros),
      over_limit_usd: usdFromMicros(Math.max(0, ctx.state.observedCostMicros - (ctx.costLimitMicros as number))),
    };
    ledger.append('budget.exhausted', runId, failure);
    throw new EvoFenceError('RESOURCE_EXHAUSTED', 'The USD cost estimate limit was reached before another adapter invocation.', failure);
  }
  const result = await invokeAdapter({
    ...options, adapter, config, phase, iteration,
    maxTokensRemaining: remainingTokens,
    maxUsdRemaining: remainingUsdMicros === null ? null : usdFromMicros(remainingUsdMicros),
  }, ctx.adapterRunner);
  ledger.append('adapter.finished', runId, adapterEvent(result, adapter, phase, iteration));
  if (ctx.costLimitMicros !== null) {
    ctx.state.observedCostMicros = recordCostUsage(result, { maxUsdMicros: ctx.costLimitMicros, totalCostMicros: ctx.state.observedCostMicros, ledger, runId, phase, iteration });
    ctx.outcome.cost_estimate_total_usd = usdFromMicros(ctx.state.observedCostMicros);
  }
  ctx.state.observedTokens = recordTokenUsage(result, { maxTokens: ctx.tokenLimit, totalTokens: ctx.state.observedTokens, ledger, runId, phase, iteration });
  ctx.outcome.token_usage_total = ctx.tokenLimit === null ? null : ctx.state.observedTokens;
  return result;
}

/** Cost fields attached to `run.finished` / `run.failed` (unchanged from 0.3.0). */
export function runCostFields(ctx: RunContext): Record<string, unknown> {
  return {
    cost_budget_usd: ctx.contract.budgets.max_usd,
    cost_estimate_total_usd: ctx.costLimitMicros === null || ctx.state.costTotalUnknown ? null : usdFromMicros(ctx.state.observedCostMicros),
    cost_estimate_complete: ctx.costLimitMicros === null ? null : !ctx.state.costTotalUnknown,
    ...(ctx.state.costTotalUnknown ? { cost_estimate_observed_before_failure_usd: usdFromMicros(ctx.state.observedCostMicros) } : {}),
  };
}
