import { usdToMicros } from './budget.js';
import { ADAPTER_NAMES } from '../../types/index.js';

export interface PreflightRefusal {
  readonly code: string;
  readonly message: string;
}

export interface CostBudgetPolicy {
  readonly costLimitMicros: number | null;
  readonly refusal: PreflightRefusal | null;
}

export function checkAdapterName(adapter: string): PreflightRefusal | null {
  if (!ADAPTER_NAMES.includes(adapter as (typeof ADAPTER_NAMES)[number])) {
    return refusal('UNKNOWN_ADAPTER', `Unsupported adapter: ${adapter}`);
  }
  return null;
}

function refusal(code: string, message: string): PreflightRefusal {
  return { code, message };
}

export function checkHoldoutExposure(
  holdoutCount: number,
  allowReadableHoldout: boolean,
): PreflightRefusal | null {
  if (holdoutCount > 0 && !allowReadableHoldout) {
    return refusal(
      'PRIVATE_ORACLE_READABLE',
      'The built-in Codex, OpenCode, Claude Code, and Pi adapters cannot guarantee read isolation from files elsewhere on this host. Re-run with --allow-readable-holdout only if you accept possible oracle exposure, or run EvoFence from a container/VM that mounts only the candidate and gate data.',
    );
  }
  return null;
}

export function checkCostBudget(maxUsd: number | null, adapter: string): CostBudgetPolicy {
  if (maxUsd === null) {
    return { costLimitMicros: null, refusal: null };
  }

  if (adapter !== 'claude' && adapter !== 'pi') {
    const message = adapter === 'codex'
      ? 'Codex does not provide complete, verifiable USD telemetry. Set budgets.max_usd to null or use the Claude Code or Pi adapter.'
      : 'OpenCode reports cost without a verified currency; EvoFence cannot infer USD. Set budgets.max_usd to null or use the Claude Code or Pi adapter.';
    return { costLimitMicros: null, refusal: refusal('UNSUPPORTED_COST_BUDGET', message) };
  }

  const costLimitMicros = usdToMicros(maxUsd);
  if (costLimitMicros < 1) {
    return {
      costLimitMicros,
      refusal: refusal(
        'INVALID_BUDGET',
        'budgets.max_usd must be at least $0.000001 for USD budget enforcement.',
      ),
    };
  }
  return { costLimitMicros, refusal: null };
}

export function checkAdapterIsolation(
  adapter: string,
  allowUnisolatedAgent: boolean,
  stage: 'preflight' | 'dispatch',
): PreflightRefusal | null {
  if (stage === 'dispatch' && adapter === 'opencode' && !allowUnisolatedAgent) {
    return refusal(
      'OPEN_CODE_SANDBOX_REQUIRED',
      'OpenCode does not provide an OS security sandbox. Re-run with --allow-unisolated-agent only if you accept that boundary, or launch OpenCode in a Docker/VM sandbox.',
    );
  }
  if (adapter === 'claude' && !allowUnisolatedAgent) {
    return refusal(
      'CLAUDE_SANDBOX_REQUIRED',
      'EvoFence does not place the Claude Code CLI inside an OS sandbox. Re-run with --allow-unisolated-agent only if you accept that boundary, or run EvoFence in a Docker/VM with restricted mounts.',
    );
  }
  if (adapter === 'pi' && !allowUnisolatedAgent) {
    return refusal(
      'PI_SANDBOX_REQUIRED',
      'EvoFence does not place the Pi CLI inside an OS sandbox. Re-run with --allow-unisolated-agent only if you accept that boundary, or run EvoFence in a Docker/VM with restricted mounts.',
    );
  }
  return null;
}

export function checkClaudeTokenBudget(
  adapter: string,
  maxTokens: number | null,
): PreflightRefusal | null {
  if (adapter === 'claude' && maxTokens !== null) {
    return refusal(
      'UNSUPPORTED_CLAUDE_TOKEN_BUDGET',
      'Claude Code reports complete whole-tree token usage only in its final result event. EvoFence cannot safely interrupt the run at the token threshold; set max_tokens to null or use Codex, OpenCode, or Pi for token-budgeted runs.',
    );
  }
  return null;
}

export function checkProcessTree(
  maxTokens: number | null,
  costLimitMicros: number | null,
  adapter: string,
  canTerminate: boolean,
): PreflightRefusal | null {
  if (maxTokens !== null && !canTerminate) {
    return refusal(
      'UNSUPPORTED_TOKEN_BUDGET_PROCESS_CONTROL',
      'This host cannot terminate an agent process tree. EvoFence refused to start a token-budgeted run.',
    );
  }
  if (costLimitMicros !== null && !canTerminate) {
    return refusal(
      'UNSUPPORTED_COST_BUDGET_PROCESS_CONTROL',
      `This host cannot terminate the ${adapter} process tree. EvoFence refused to start a USD-budgeted run.`,
    );
  }
  return null;
}
