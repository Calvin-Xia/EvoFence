/**
 * `report.budgets`: boundary-of-report token/USD totals, recomputed from the event chain.
 *
 * DOMAIN: report views (L2 node `l2_report`). Ported 1:1 from `src/lib/report.js` (the
 * `runTotals` / `tokenTotal` / `usdTotalMicros` / `invocation*Total*` cluster); the arithmetic is
 * unchanged, only annotated.
 *
 * Per-run totals combine two sources: cumulative observations (which include every preceding
 * invocation, complete or not) and complete per-invocation telemetry. The reported value is the
 * best lower bound — the maximum of the complete-invocation sum and, over every cumulative
 * anchor, of (anchor total + complete invocations recorded after that anchor). The invocation sum
 * floors stale terminal anchors that undercount earlier invocations; anchored estimates recover
 * usage from incomplete invocations; trailing invocation sums recover telemetry that never
 * reached an anchor. Nothing is ever double counted because each candidate estimate counts every
 * invocation at most once.
 */
import type { JsonValue, LedgerEvent } from '../../types/index.js';
import { payloadObject } from './ledger-view.js';

const MICROS_PER_USD = 1_000_000;

/** Events whose payload may carry a cumulative token total. */
export const TOKEN_TOTAL_EVENTS = ['budget.tokens.observed', 'budget.exhausted', 'budget.termination_failed', 'run.failed', 'run.finished'];
/** Events whose payload may carry a cumulative USD total. */
export const USD_TOTAL_EVENTS = ['budget.usd.observed', 'budget.exhausted', 'budget.termination_failed', 'run.failed', 'run.finished'];

type Payload = Record<string, JsonValue>;
type TotalReader = (payload: Payload) => number | null;

function runTotals(events: LedgerEvent[], eventTypes: readonly string[], cumulative: TotalReader, invocation: TotalReader): Map<string, number> {
  const anchorsByRun = new Map<string, Array<{ seq: number; value: number }>>();
  const invocationsByRun = new Map<string, Array<{ seq: number; value: number }>>();
  for (const event of events) {
    const runId = event.run_id ?? '';
    const payload = payloadObject(event.payload) ?? {};
    if (eventTypes.includes(event.event_type)) {
      const value = cumulative(payload);
      if (value !== null) {
        const anchors = anchorsByRun.get(runId) ?? [];
        anchors.push({ seq: event.seq, value });
        anchorsByRun.set(runId, anchors);
      }
      continue;
    }
    if (event.event_type === 'adapter.finished') {
      const value = invocation(payloadObject(payload.reported_usage) ?? {});
      if (value === null) continue;
      const invocations = invocationsByRun.get(runId) ?? [];
      invocations.push({ seq: event.seq, value });
      invocationsByRun.set(runId, invocations);
    }
  }

  const totals = new Map<string, number>();
  for (const runId of new Set([...anchorsByRun.keys(), ...invocationsByRun.keys()])) {
    const anchors = anchorsByRun.get(runId) ?? [];
    const invocations = invocationsByRun.get(runId) ?? [];
    let total = invocations.length ? invocations.reduce((sum, item) => sum + item.value, 0) : null;
    for (const anchor of anchors) {
      const estimate = anchor.value + invocations
        .filter((item) => item.seq > anchor.seq)
        .reduce((sum, item) => sum + item.value, 0);
      if (total === null || estimate > total) total = estimate;
    }
    if (total !== null) totals.set(runId, total);
  }
  return totals;
}

function tokenTotal(payload: Payload): number | null {
  for (const value of [payload.observed_total, payload.token_usage_total]) {
    if (Number.isSafeInteger(value) && (value as number) >= 0) return value as number;
  }
  return null;
}

function usdTotalMicros(payload: Payload): number | null {
  if (Number.isSafeInteger(payload.observed_total_usd_micros) && (payload.observed_total_usd_micros as number) >= 0) {
    return payload.observed_total_usd_micros as number;
  }
  for (const value of [payload.observed_total_usd, payload.cost_estimate_total_usd]) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value * MICROS_PER_USD);
  }
  return null;
}

function invocationTokenTotal(usage: Payload): number | null {
  return usage.tokens_complete === true && Number.isSafeInteger(usage.tokens_total) && (usage.tokens_total as number) >= 0
    ? (usage.tokens_total as number)
    : null;
}

function invocationUsdTotalMicros(usage: Payload): number | null {
  return usage.cost_complete === true && usage.cost_currency === 'USD'
    && typeof usage.reported_cost === 'number' && Number.isFinite(usage.reported_cost) && usage.reported_cost >= 0
    ? Math.round(usage.reported_cost * MICROS_PER_USD)
    : null;
}

/** `report.budgets`. Both totals are `null` when no complete telemetry exists. */
export function buildBudgets(events: LedgerEvent[]): { tokens_total: number | null; usd_total: number | null } {
  const tokenTotals = runTotals(events, TOKEN_TOTAL_EVENTS, tokenTotal, invocationTokenTotal);
  const usdTotals = runTotals(events, USD_TOTAL_EVENTS, usdTotalMicros, invocationUsdTotalMicros);
  return {
    tokens_total: tokenTotals.size ? [...tokenTotals.values()].reduce((total, value) => total + value, 0) : null,
    usd_total: usdTotals.size ? [...usdTotals.values()].reduce((total, value) => total + value, 0) / MICROS_PER_USD : null,
  };
}
