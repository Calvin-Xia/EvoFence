/**
 * Exec domain · adapter stream event parsing helpers.
 *
 * Extracted verbatim from `src/lib/adapter.js`. Adapter stdout is line-delimited JSON whose
 * shape is owned by each external CLI, so these helpers work on loosely-typed event records.
 * Nothing here estimates usage: an unreadable or missing field yields `null`, which the
 * caller turns into `TOKEN_USAGE_UNAVAILABLE`.
 */
/* The event payloads come from external CLIs and are validated field by field below. */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Token (and optional cost) extraction result for one parsed event. */
export interface EventTokenCount {
  relevant: boolean;
  tokens: number | null;
  cost?: number | null;
}

export function nonNegativeNumber(value: any): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function nonNegativeInteger(value: any): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function claudeModelTokenCount(modelUsage: any): number | null {
  if (!modelUsage || typeof modelUsage !== 'object' || Array.isArray(modelUsage)) return null;
  const models = Object.values(modelUsage);
  if (!models.length) return null;
  let total = 0;
  for (const usage of models as any[]) {
    const fields = [usage?.inputTokens, usage?.outputTokens, usage?.cacheReadInputTokens, usage?.cacheCreationInputTokens];
    if (!fields.every(nonNegativeInteger)) return null;
    total += fields.reduce((sum: number, value: number) => sum + value, 0);
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function piUsageMetrics(usage: any): { tokens: number; cost: number | null } | null {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const tokenFields = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens];
  if (!tokenFields.every(nonNegativeInteger)) return null;
  const cost = usage.cost;
  const costFields = [cost?.input, cost?.output, cost?.cacheRead, cost?.cacheWrite, cost?.total];
  return {
    tokens: usage.totalTokens,
    cost: costFields.every(nonNegativeNumber) ? cost.total : null,
  };
}

export function piEventUsage(event: any): EventTokenCount {
  if (event?.type === 'message_end') {
    const message = event.message;
    if (message?.role === 'assistant') {
      const metrics = piUsageMetrics(message.usage);
      return { relevant: true, tokens: metrics?.tokens ?? null, cost: metrics?.cost ?? null };
    }
    if (message?.role === 'toolResult' && message.usage !== undefined) {
      const metrics = piUsageMetrics(message.usage);
      return { relevant: true, tokens: metrics?.tokens ?? null, cost: metrics?.cost ?? null };
    }
  }
  if (event?.type === 'compaction_end') {
    const metrics = piUsageMetrics(event.result?.usage);
    return { relevant: true, tokens: metrics?.tokens ?? null, cost: metrics?.cost ?? null };
  }
  if (event?.type === 'auto_retry_start' || event?.type === 'summarization_retry_scheduled') {
    // Pi does not attach usage to failed attempts, so a hard budget cannot account for them.
    return { relevant: true, tokens: null, cost: null };
  }
  if (event?.type === 'agent_end' && event.willRetry === true) {
    return { relevant: true, tokens: null, cost: null };
  }
  if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'error') {
    return { relevant: true, tokens: null, cost: null };
  }
  return { relevant: false, tokens: null, cost: null };
}

export function parseJsonLines(stdout: string): { events: any[]; complete: boolean } {
  const events: any[] = [];
  let complete = true;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      complete = false;
    }
  }
  return { events, complete };
}

export function eventTokenCount(adapter: string, event: any): EventTokenCount {
  if (adapter === 'pi') return piEventUsage(event);
  if (adapter === 'codex' && event?.type === 'turn.completed') {
    const usage = event.usage;
    if (!nonNegativeInteger(usage?.input_tokens) || !nonNegativeInteger(usage?.output_tokens)) return { relevant: true, tokens: null };
    const tokens = usage.input_tokens + usage.output_tokens;
    return { relevant: true, tokens: Number.isSafeInteger(tokens) ? tokens : null };
  }
  if (adapter === 'opencode' && event?.type === 'step_finish') {
    const tokens = event.part?.tokens ?? event.tokens;
    if (nonNegativeInteger(tokens?.total)) return { relevant: true, tokens: tokens.total };
    if (
      nonNegativeInteger(tokens?.input)
      && nonNegativeInteger(tokens?.output)
      && nonNegativeInteger(tokens?.reasoning)
      && nonNegativeInteger(tokens?.cache?.read)
      && nonNegativeInteger(tokens?.cache?.write)
    ) {
      const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
      return { relevant: true, tokens: Number.isSafeInteger(total) ? total : null };
    }
    return { relevant: true, tokens: null };
  }
  if (adapter === 'claude' && event?.type === 'result') {
    if (event.subtype === 'error_during_execution') return { relevant: true, tokens: null };
    return { relevant: true, tokens: claudeModelTokenCount(event.modelUsage) };
  }
  return { relevant: false, tokens: null };
}
