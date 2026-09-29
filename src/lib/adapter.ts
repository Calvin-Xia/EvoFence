/**
 * Exec domain · adapter entry (0.3.0 path preserved).
 *
 * This file keeps two responsibilities that must stay at this path:
 *   - `runAgentAdapter`, because it resolves `./pi-tool-strategy-extension.js` relative to
 *     `import.meta.url` and hands that absolute path to the pi CLI subprocess;
 *   - the `adapterCommand` / `adapterModel` / `adapterAgent` config readers.
 *
 * The argv builders, usage parsers/monitor and pi telemetry sidecar now live in
 * `src/lib/exec/**` and are re-exported here so the domain boundary (and every existing
 * import of `./adapter.js`) is unchanged.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { runProcess } from './process.js';
import type { EnvironmentValues } from './process.js';
import { EvoFenceError } from './exec/errors.js';
import { claudeCodeArgs, codexArgs, openCodeArgs, piArgs } from './exec/adapter-args.js';
import { createAdapterUsageMonitor } from './exec/adapter-monitor.js';
import { parseAdapterUsage } from './exec/adapter-usage.js';
import { parseJsonLines } from './exec/adapter-events.js';
import { createPiToolStrategyLog, readPiToolStrategySummary } from './exec/adapter-pi.js';
import { checkAdapterIsolation, checkAdapterName } from './exec/preflight-policy.js';
import type { AdapterName, AdapterRunResult, AdapterUsage, StopReason } from '../types/index.js';

export { claudeCodeArgs, piArgs } from './exec/adapter-args.js';
export { createAdapterUsageMonitor } from './exec/adapter-monitor.js';
export type { AdapterUsageMonitor } from './exec/adapter-monitor.js';
export { parseAdapterUsage } from './exec/adapter-usage.js';

/** Options accepted by {@link runAgentAdapter} (0.3.0 shape, now typed). */
export interface RunAgentAdapterOptions {
  name: string;
  command: string;
  model?: string | null;
  agent?: string | null;
  cwd: string;
  phase?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxTokensRemaining?: number | null;
  maxUsdRemaining?: number | null;
  /** @deprecated kept for the 0.3.0 call sites; `allowUnisolatedAgent` is the live flag. */
  allowUnisolatedOpenCode?: boolean;
  allowUnisolatedAgent?: boolean;
}

export async function runAgentAdapter({ name, command, model, agent, cwd, phase = 'implementation', timeoutMs, maxOutputBytes, maxTokensRemaining = null, maxUsdRemaining = null, allowUnisolatedOpenCode = false, allowUnisolatedAgent = allowUnisolatedOpenCode }: RunAgentAdapterOptions): Promise<AdapterRunResult> {
  const adapterRefusal = checkAdapterName(name);
  if (adapterRefusal) throw new EvoFenceError(adapterRefusal.code, adapterRefusal.message);
  const adapterName = name as AdapterName;
  let args: string[];
  let env: EnvironmentValues = {};
  let piToolStrategyLog: string | null = null;
  if (adapterName === 'codex') {
    if (maxUsdRemaining !== null) throw new EvoFenceError('UNSUPPORTED_COST_BUDGET', 'Codex does not provide complete, verifiable USD telemetry. Set budgets.max_usd to null or use the Claude Code or Pi adapter.');
    args = codexArgs({ cwd, model });
  } else if (adapterName === 'opencode') {
    if (maxUsdRemaining !== null) throw new EvoFenceError('UNSUPPORTED_COST_BUDGET', 'OpenCode reports cost without a verified currency; EvoFence cannot infer USD. Set budgets.max_usd to null or use the Claude Code or Pi adapter.');
    const isolationRefusal = checkAdapterIsolation(adapterName, allowUnisolatedAgent, 'dispatch');
    if (isolationRefusal) throw new EvoFenceError(isolationRefusal.code, isolationRefusal.message);
    args = openCodeArgs({ model, agent });
    env = {
      OPENCODE_PURE: '1',
      OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
      OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        '$schema': 'https://opencode.ai/config.json',
        permission: {
          edit: 'allow',
          bash: 'allow',
          question: 'deny',
          webfetch: 'deny',
          websearch: 'deny',
          external_directory: 'deny',
        },
      }),
    };
  } else if (adapterName === 'claude') {
    const isolationRefusal = checkAdapterIsolation(adapterName, allowUnisolatedAgent, 'dispatch');
    if (isolationRefusal) throw new EvoFenceError(isolationRefusal.code, isolationRefusal.message);
    args = claudeCodeArgs({ model, agent, maxBudgetUsd: maxUsdRemaining });
  } else {
    const isolationRefusal = checkAdapterIsolation(adapterName, allowUnisolatedAgent, 'dispatch');
    if (isolationRefusal) throw new EvoFenceError(isolationRefusal.code, isolationRefusal.message);
    if (agent) {
      throw new EvoFenceError('UNSUPPORTED_ADAPTER_OPTION', 'Pi does not expose a built-in --agent selector. Remove adapters.pi.agent from .evofence/config.yaml.');
    }
    const strategy = await createPiToolStrategyLog(cwd, phase);
    piToolStrategyLog = strategy.logPath;
    if (piToolStrategyLog) {
      const extensionPath = fileURLToPath(new URL('./pi-tool-strategy-extension.js', import.meta.url));
      args = piArgs({ model, extensionPath });
      env = {
        EVOFENCE_PI_TOOL_STRATEGY_LOG: piToolStrategyLog,
        EVOFENCE_PI_TOOL_STRATEGY_PHASE: strategy.stage,
      };
    } else {
      args = piArgs({ model });
    }
  }

  const usageMonitor = maxTokensRemaining === null ? null : createAdapterUsageMonitor(adapterName, maxTokensRemaining);
  const result = await runProcess(command, args, {
    cwd,
    timeoutMs,
    maxOutputBytes,
    env,
    shell: platform() === 'win32',
    ...(usageMonitor ? {
      onChunk: (stream: 'stdout' | 'stderr', chunk: string) => stream === 'stdout' ? (usageMonitor.push(chunk) ?? undefined) : undefined,
      stopGraceMs: 0,
    } : {}),
  });
  const monitorStopReason = usageMonitor?.finish() ?? null;
  const budgetStopReason: StopReason | null = result.stop_reason ?? monitorStopReason;
  let usage: AdapterUsage = parseAdapterUsage(adapterName, result.stdout, { outputLimited: result.output_limited });
  const claudeBudgetReached = adapterName === 'claude'
    && parseJsonLines(result.stdout).events.some((event) => event?.type === 'result' && event.subtype === 'error_max_budget_usd');
  const toolStrategy = adapterName === 'pi'
    ? await readPiToolStrategySummary(piToolStrategyLog, phase === 'proposal' ? 'proposal' : 'implementation')
    : null;
  if (budgetStopReason === 'TOKEN_BUDGET_REACHED' || budgetStopReason === 'TOKEN_USAGE_UNAVAILABLE') {
    usage = { ...usage, ...usageMonitor?.snapshot() };
  }
  if (budgetStopReason === 'TOKEN_USAGE_UNAVAILABLE' || result.output_limited) {
    usage.tokens_total = null;
    usage.tokens_complete = false;
  }
  return {
    ...result,
    adapter: adapterName,
    model: model ?? null,
    budget_stop_reason: budgetStopReason,
    cost_budget_reached: claudeBudgetReached,
    // Keep the legacy field, but never fill it with a partial or estimated count.
    estimated_tokens: usage.tokens_complete ? usage.tokens_total : null,
    reported_usage: usage,
    ...(adapterName === 'pi' ? { tool_strategy: toolStrategy } : {}),
  };
}

export function adapterCommand(config: any, name: string): string {
  const value = config.adapters?.[name]?.command;
  return typeof value === 'string' && value.trim() ? value : name;
}

export function adapterModel(config: any, name: string): string | null {
  return config.adapters?.[name]?.model ?? null;
}

export function adapterAgent(config: any, name: string): string | null {
  return config.adapters?.[name]?.agent ?? null;
}
