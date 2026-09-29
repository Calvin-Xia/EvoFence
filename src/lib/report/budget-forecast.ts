/** Read-only, deterministic budget forecast derived from one ledger snapshot. */
import type {
  BudgetForecastMetric,
  BudgetForecastRun,
  BudgetForecastView,
  JsonValue,
  LedgerEvent,
  LedgerSnapshot,
} from '../../types/index.js';
import { payloadObject } from './ledger-view.js';

const FORECAST_EXPLANATION = 'Estimates use the historical mean usage per completed run/round; they are not a prediction commitment. Unknown token/USD telemetry remains null.';

interface MutableRun extends BudgetForecastRun {
  max_iteration_observed: number;
  terminal: boolean;
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function integerValue(value: JsonValue | undefined): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function positiveInteger(value: JsonValue | undefined): number | null {
  const number = integerValue(value);
  return number !== null && number > 0 ? number : null;
}

function snapshotBudgets(payload: Record<string, JsonValue>): Record<string, JsonValue> {
  const snapshot = payloadObject(payload.contract_snapshot) ?? {};
  return payloadObject(snapshot.budgets) ?? {};
}

function iterationLimit(payload: Record<string, JsonValue>): number | null {
  return positiveInteger(payload.requested_iterations) ?? positiveInteger(snapshotBudgets(payload).max_iterations);
}

function tokenLimit(payload: Record<string, JsonValue>): number | null {
  return integerValue(snapshotBudgets(payload).max_tokens) ?? integerValue(payload.token_budget);
}

function usdLimit(payload: Record<string, JsonValue>): number | null {
  return numberValue(snapshotBudgets(payload).max_usd) ?? numberValue(payload.limit_usd);
}

function tokenUsage(payload: Record<string, JsonValue>): number | null {
  return integerValue(payload.token_usage_total) ?? integerValue(payload.observed_total);
}

function usdUsage(payload: Record<string, JsonValue>): number | null {
  return numberValue(payload.cost_estimate_total_usd) ?? numberValue(payload.observed_total_usd);
}

function runFor(runs: Map<string, MutableRun>, event: LedgerEvent): MutableRun | null {
  if (event.run_id === null) return null;
  const existing = runs.get(event.run_id);
  if (existing) return existing;
  const created: MutableRun = {
    run_id: event.run_id,
    started_at: event.created_at,
    status: 'INCOMPLETE',
    iterations: 0,
    iteration_limit: null,
    tokens_used: null,
    tokens_limit: null,
    usd_used: null,
    usd_limit: null,
    max_iteration_observed: 0,
    terminal: false,
  };
  runs.set(event.run_id, created);
  return created;
}

function updateIteration(run: MutableRun, payload: Record<string, JsonValue>): void {
  const iteration = positiveInteger(payload.iteration);
  if (iteration !== null) run.max_iteration_observed = Math.max(run.max_iteration_observed, iteration);
}

function applyEvent(runs: Map<string, MutableRun>, event: LedgerEvent): void {
  const run = runFor(runs, event);
  if (!run) return;
  const payload = payloadObject(event.payload) ?? {};
  updateIteration(run, payload);

  if (event.event_type === 'run.started') {
    run.started_at = event.created_at;
    run.iteration_limit = iterationLimit(payload);
    run.tokens_limit = tokenLimit(payload);
    run.usd_limit = usdLimit(payload);
    return;
  }

  const tokenBudgetEvent = event.event_type === 'budget.tokens.observed'
    || event.event_type === 'budget.usage_unavailable'
    || ((event.event_type === 'budget.exhausted' || event.event_type === 'budget.termination_failed') && payload.metric !== 'estimated_usd');
  if (tokenBudgetEvent) {
    if (run.tokens_limit === null) run.tokens_limit = integerValue(payload.limit);
    if (!run.terminal) run.tokens_used = tokenUsage(payload) ?? run.tokens_used;
    return;
  }
  const usdBudgetEvent = event.event_type === 'budget.usd.observed'
    || event.event_type === 'budget.cost_usage_unavailable'
    || ((event.event_type === 'budget.exhausted' || event.event_type === 'budget.termination_failed') && payload.metric === 'estimated_usd');
  if (usdBudgetEvent) {
    if (run.usd_limit === null) run.usd_limit = usdLimit(payload);
    if (!run.terminal) run.usd_used = usdUsage(payload) ?? run.usd_used;
    return;
  }

  if (event.event_type !== 'run.finished' && event.event_type !== 'run.failed') return;
  run.terminal = true;
  run.status = event.event_type === 'run.failed'
    ? 'FAILED'
    : typeof payload.status === 'string' ? payload.status : 'FINISHED';
  run.iterations = integerValue(payload.iterations) ?? run.max_iteration_observed;
  if (run.iteration_limit === null) run.iteration_limit = iterationLimit(payload);
  if (run.tokens_limit === null) run.tokens_limit = tokenLimit(payload);
  if (run.usd_limit === null) run.usd_limit = usdLimit(payload);
  run.tokens_used = tokenUsage(payload);
  run.usd_used = usdUsage(payload);
}

function ratio(used: number | null, limit: number | null): number | null {
  return used !== null && limit !== null && limit > 0 ? used / limit : null;
}

function estimate(used: number | null, limit: number | null, historicalMean: number | null): number | null {
  if (used === null || limit === null || historicalMean === null || historicalMean <= 0) return null;
  return Math.max(0, limit - used) / historicalMean;
}

function metric(runs: readonly BudgetForecastRun[], usageKey: 'tokens_used' | 'usd_used', limitKey: 'tokens_limit' | 'usd_limit'): BudgetForecastMetric {
  const measured = runs.filter((run) => run[usageKey] !== null);
  const used = measured.length ? measured.reduce((total, run) => total + (run[usageKey] as number), 0) : null;
  const limit = runs.length > 0 && runs.every((run) => run[limitKey] !== null)
    ? runs.reduce((total, run) => total + (run[limitKey] as number), 0)
    : null;
  const measuredRounds = measured.reduce((total, run) => total + run.iterations, 0);
  const historicalMean = used !== null && measuredRounds > 0 ? used / measuredRounds : null;
  return {
    used,
    limit,
    used_ratio: ratio(used, limit),
    historical_mean_per_round: historicalMean,
    remaining_rounds_estimate: estimate(used, limit, historicalMean),
  };
}

function display(value: number | null): string {
  return value === null ? 'n/a' : String(value);
}

function displayRatio(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

/** Build a stable forecast. Ledger events are reduced first, then all output rows are sorted. */
export function buildBudgetForecast(snapshot: LedgerSnapshot): BudgetForecastView {
  const runsById = new Map<string, MutableRun>();
  for (const event of snapshot.events) applyEvent(runsById, event);
  const runs = [...runsById.values()]
    .map(({ max_iteration_observed, terminal, ...run }) => ({
      ...run,
      iterations: terminal ? run.iterations : max_iteration_observed,
    }))
    .sort((left, right) => left.run_id < right.run_id ? -1 : left.run_id > right.run_id ? 1 : 0);
  const completed = runs.filter((run) => run.status !== 'INCOMPLETE');
  const roundsUsed = runs.reduce((total, run) => total + run.iterations, 0);
  const roundsLimit = runs.length > 0 && runs.every((run) => run.iteration_limit !== null)
    ? runs.reduce((total, run) => total + (run.iteration_limit as number), 0)
    : null;
  const historicalMeanRounds = completed.length
    ? completed.reduce((total, run) => total + run.iterations, 0) / completed.length
    : null;
  return {
    schema_version: 1,
    basis: 'historical_mean',
    explanation: FORECAST_EXPLANATION,
    run_count: runs.length,
    rounds_used: roundsUsed,
    rounds_limit: roundsLimit,
    used_ratio: ratio(roundsUsed, roundsLimit),
    historical_mean_rounds_per_run: historicalMeanRounds,
    remaining_rounds_estimate: estimate(roundsUsed, roundsLimit, historicalMeanRounds),
    tokens: metric(runs, 'tokens_used', 'tokens_limit'),
    usd: metric(runs, 'usd_used', 'usd_limit'),
    runs,
  };
}

/** Deterministic human-readable view of the forecast. */
export function formatBudgetForecast(view: BudgetForecastView): string {
  const lines = [
    'EvoFence Budget Forecast',
    `- Basis: ${view.basis} (historical mean; not a prediction commitment)`,
    `- Runs: ${view.run_count}`,
    `- Rounds: used=${view.rounds_used} limit=${display(view.rounds_limit)} ratio=${displayRatio(view.used_ratio)}`,
    `- Historical mean rounds per run: ${display(view.historical_mean_rounds_per_run)}`,
    `- Remaining rounds estimate: ${display(view.remaining_rounds_estimate)}`,
    `- Tokens: used=${display(view.tokens.used)} limit=${display(view.tokens.limit)} ratio=${displayRatio(view.tokens.used_ratio)} remaining_rounds_estimate=${display(view.tokens.remaining_rounds_estimate)}`,
    `- USD: used=${display(view.usd.used)} limit=${display(view.usd.limit)} ratio=${displayRatio(view.usd.used_ratio)} remaining_rounds_estimate=${display(view.usd.remaining_rounds_estimate)}`,
    '',
    'Runs:',
  ];
  for (const run of view.runs) {
    lines.push(`  ${run.run_id}  ${run.status}  iterations=${run.iterations}/${display(run.iteration_limit)}  tokens=${display(run.tokens_used)}/${display(run.tokens_limit)}  usd=${display(run.usd_used)}/${display(run.usd_limit)}`);
  }
  return `${lines.join('\n')}\n`;
}
