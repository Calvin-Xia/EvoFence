/**
 * Exec domain · per-invocation adapter usage parsing.
 *
 * Extracted verbatim from `src/lib/adapter.js`: one parser per CLI, plus the shared
 * complete-or-null policy. `parseAdapterUsage` never estimates — a missing or unparseable
 * field sets `*_complete: false` and the corresponding total to `null`.
 */
/* Adapter payloads are external JSON; each field is validated before use. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { claudeModelTokenCount, eventTokenCount, nonNegativeInteger, nonNegativeNumber, parseJsonLines, piEventUsage } from './adapter-events.js';
import type { AdapterUsage } from '../../types/index.js';

function incompleteUsage(tokenSource: string | null = null, costSource: string | null = null): AdapterUsage {
  return {
    tokens_total: null,
    tokens_complete: false,
    token_source: tokenSource,
    reported_cost: null,
    cost_complete: false,
    cost_currency: null,
    cost_source: costSource,
  };
}

function codexUsage(events: any[], outputLimited: boolean): AdapterUsage {
  let turnCount = 0;
  let total = 0;
  let complete = true;

  for (const event of events) {
    if (event?.type !== 'turn.completed') continue;
    turnCount += 1;
    const parsed = eventTokenCount('codex', event);
    if (parsed.tokens === null) {
      complete = false;
      continue;
    }
    // cached_input_tokens and reasoning_output_tokens are breakdowns of input/output.
    total += parsed.tokens;
  }

  const tokensComplete = turnCount > 0 && complete && Number.isSafeInteger(total) && !outputLimited;
  return {
    tokens_total: tokensComplete ? total : null,
    tokens_complete: tokensComplete,
    token_source: turnCount ? 'codex-cli-turn.completed' : null,
    reported_cost: null,
    cost_complete: false,
    cost_currency: null,
    cost_source: null,
  };
}

function openCodeUsage(events: any[], outputLimited: boolean): AdapterUsage {
  let stepCount = 0;
  let tokenTotal = 0;
  let tokensComplete = true;
  let costTotal = 0;
  let costCount = 0;
  let costComplete = true;

  for (const event of events) {
    if (event?.type !== 'step_finish') continue;
    stepCount += 1;
    const part = event.part;
    const parsed = eventTokenCount('opencode', event);
    const stepTokens = parsed.tokens;
    if (stepTokens === null) tokensComplete = false;
    else tokenTotal += stepTokens;
    if (!Number.isSafeInteger(tokenTotal)) tokensComplete = false;

    const cost = part?.cost ?? event.cost;
    if (nonNegativeNumber(cost)) {
      costTotal += cost;
      costCount += 1;
    } else {
      costComplete = false;
    }
  }

  const completeTokens = stepCount > 0 && tokensComplete && Number.isSafeInteger(tokenTotal) && !outputLimited;
  const completeCost = stepCount > 0 && costComplete && costCount === stepCount && !outputLimited;
  return {
    tokens_total: completeTokens ? tokenTotal : null,
    tokens_complete: completeTokens,
    token_source: stepCount ? 'opencode-cli-step_finish' : null,
    reported_cost: completeCost ? costTotal : null,
    cost_complete: completeCost,
    cost_currency: null,
    cost_source: costCount ? 'opencode-cli-step_finish' : null,
  };
}

function claudeUsage(events: any[], outputLimited: boolean): AdapterUsage {
  const results = events.filter((event) => event?.type === 'result');
  if (results.length !== 1) {
    return incompleteUsage(results.length ? 'claude-cli-result.modelUsage' : null, results.length ? 'claude-cli-result.total_cost_usd' : null);
  }

  const result = results[0];
  const modelTokenCount = claudeModelTokenCount(result.modelUsage);
  const failedAfterCrash = result.subtype === 'error_during_execution';
  const tokensComplete = modelTokenCount !== null && !outputLimited && !failedAfterCrash;
  const costComplete = nonNegativeNumber(result.total_cost_usd) && !outputLimited && !failedAfterCrash;
  return {
    tokens_total: tokensComplete ? modelTokenCount : null,
    tokens_complete: tokensComplete,
    token_source: 'claude-cli-result.modelUsage',
    reported_cost: costComplete ? result.total_cost_usd : null,
    cost_complete: costComplete,
    cost_currency: costComplete ? 'USD' : null,
    cost_source: 'claude-cli-result.total_cost_usd',
  };
}

function piUsage(events: any[], outputLimited: boolean): AdapterUsage {
  let assistantCount = 0;
  let agentEndCount = 0;
  let usageCount = 0;
  let tokenTotal = 0;
  let tokensComplete = true;
  let costTotal = 0;
  let costCount = 0;
  let costComplete = true;

  for (const event of events) {
    // Pi's JSON CLI stream completes an invocation with agent_end; agent_settled is an RPC lifecycle event.
    if (event?.type === 'agent_end' && event.willRetry !== true) agentEndCount += 1;
    if (event?.type === 'message_end' && event.message?.role === 'assistant') assistantCount += 1;
    const parsed = piEventUsage(event);
    if (!parsed.relevant) continue;
    usageCount += 1;
    if (parsed.tokens === null) tokensComplete = false;
    else {
      tokenTotal += parsed.tokens;
      if (!Number.isSafeInteger(tokenTotal)) tokensComplete = false;
    }
    if (parsed.cost === null || parsed.cost === undefined) costComplete = false;
    else {
      costTotal += parsed.cost;
      costCount += 1;
      if (!Number.isFinite(costTotal)) costComplete = false;
    }
  }

  const completeTokens = assistantCount > 0 && agentEndCount === 1 && usageCount > 0
    && tokensComplete && Number.isSafeInteger(tokenTotal) && !outputLimited;
  const completeCost = completeTokens && costComplete && costCount === usageCount && !outputLimited;
  return {
    tokens_total: completeTokens ? tokenTotal : null,
    tokens_complete: completeTokens,
    token_source: assistantCount ? 'pi-cli-session-events.usage.totalTokens' : null,
    reported_cost: completeCost ? costTotal : null,
    cost_complete: completeCost,
    cost_currency: completeCost ? 'USD' : null,
    cost_source: costCount ? 'pi-cli-session-events.usage.cost.total (model-price estimate)' : null,
  };
}

export function parseAdapterUsage(adapter: string, stdout: string, { outputLimited = false }: { outputLimited?: boolean } = {}): AdapterUsage {
  const parsed = parseJsonLines(stdout);
  let usage: AdapterUsage;
  if (adapter === 'codex') usage = codexUsage(parsed.events, outputLimited);
  else if (adapter === 'opencode') usage = openCodeUsage(parsed.events, outputLimited);
  else if (adapter === 'claude') usage = claudeUsage(parsed.events, outputLimited);
  else if (adapter === 'pi') usage = piUsage(parsed.events, outputLimited);
  else return incompleteUsage();
  if (parsed.complete) return usage;
  return {
    ...usage,
    tokens_total: null,
    tokens_complete: false,
    reported_cost: null,
    cost_complete: false,
  };
}
