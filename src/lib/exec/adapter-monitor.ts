/**
 * Exec domain · live token-budget monitor for adapter stdout.
 *
 * Extracted verbatim from `src/lib/adapter.js`. This is the "realtime" half of the token gate:
 * it consumes `runProcess` stdout chunks and returns a stop reason once the cumulative count
 * reaches the remaining budget (or once a usage field cannot be read). The runner's
 * `recordTokenUsage` is the accounting half.
 */
import { EvoFenceError } from './errors.js';
import { eventTokenCount } from './adapter-events.js';
import type { AdapterUsageSnapshot } from '../../types/index.js';
import type { StopReason } from '../../types/index.js';

const TOKEN_SOURCES: Record<string, string> = {
  codex: 'codex-cli-turn.completed',
  opencode: 'opencode-cli-step_finish',
  claude: 'claude-cli-result.modelUsage',
  pi: 'pi-cli-session-events',
};

/** Live monitor returned by {@link createAdapterUsageMonitor}. */
export interface AdapterUsageMonitor {
  /** Feed one stdout chunk; returns the stop reason once one has been requested. */
  push(chunk: string | Uint8Array): StopReason | null;
  /** Flush the pending (unterminated) line and return the final stop reason. */
  finish(): StopReason | null;
  snapshot(): AdapterUsageSnapshot;
}

export function createAdapterUsageMonitor(adapter: string, maxTokens: number): AdapterUsageMonitor {
  if (!['codex', 'opencode', 'claude', 'pi'].includes(adapter)) throw new EvoFenceError('UNKNOWN_ADAPTER', `Unsupported adapter: ${adapter}`);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new EvoFenceError('INVALID_BUDGET', 'The remaining token budget must be a positive safe integer.');

  let pending = '';
  let eventCount = 0;
  let total = 0;
  let complete = true;
  let stopReason: StopReason | null = null;
  let discardingOversizedLine = false;

  const requestStop = (reason: StopReason) => {
    if (!stopReason) stopReason = reason;
  };

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      complete = false;
      requestStop('TOKEN_USAGE_UNAVAILABLE');
      return;
    }
    const parsed = eventTokenCount(adapter, event);
    if (!parsed.relevant) return;
    eventCount += 1;
    if (parsed.tokens === null) {
      complete = false;
      requestStop('TOKEN_USAGE_UNAVAILABLE');
      return;
    }
    total += parsed.tokens;
    if (!Number.isSafeInteger(total)) {
      complete = false;
      requestStop('TOKEN_USAGE_UNAVAILABLE');
      return;
    }
    if (total >= maxTokens) requestStop('TOKEN_BUDGET_REACHED');
  };

  return {
    push(chunk: string | Uint8Array) {
      let input = pending + String(chunk);
      pending = '';
      if (discardingOversizedLine) {
        const lineEnd = input.indexOf('\n');
        if (lineEnd === -1) return stopReason;
        input = input.slice(lineEnd + 1);
        discardingOversizedLine = false;
      }
      const lines = input.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
      if (pending.length > 1_048_576) {
        complete = false;
        requestStop('TOKEN_USAGE_UNAVAILABLE');
        pending = '';
        discardingOversizedLine = true;
      }
      return stopReason;
    },
    finish() {
      if (pending) {
        if (discardingOversizedLine) complete = false;
        else consumeLine(pending);
        pending = '';
      }
      return stopReason;
    },
    snapshot() {
      const tokensComplete = eventCount > 0 && complete;
      return {
        tokens_total: tokensComplete ? total : null,
        tokens_complete: tokensComplete,
        token_source: eventCount ? TOKEN_SOURCES[adapter] ?? null : null,
      };
    },
  };
}
