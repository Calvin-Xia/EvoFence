import { runProcess } from './process.js';
import { EvoFenceError } from './errors.js';
import { platform } from 'node:os';

const TASK_POINTER = 'Read and follow .evofence-task.md. Complete the requested EvoFence phase and stop.';

function codexArgs({ cwd, model }) {
  const args = ['--ask-for-approval', 'never', 'exec', '--sandbox', 'workspace-write', '--json', '--cd', '.', TASK_POINTER];
  if (model) args.splice(args.length - 1, 0, '--model', model);
  return args;
}

function openCodeArgs({ model, agent }) {
  const args = ['run', '--dir', '.', '--format', 'json'];
  if (model) args.push('--model', model);
  if (agent) args.push('--agent', agent);
  args.push(TASK_POINTER);
  return args;
}

export function claudeCodeArgs({ model, agent }) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'auto',
    '--permission-prompts', 'none',
  ];
  if (model) args.push('--model', model);
  if (agent) args.push('--agent', agent);
  args.push(TASK_POINTER);
  return args;
}

function nonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function claudeModelTokenCount(modelUsage) {
  if (!modelUsage || typeof modelUsage !== 'object' || Array.isArray(modelUsage)) return null;
  const models = Object.values(modelUsage);
  if (!models.length) return null;
  let total = 0;
  for (const usage of models) {
    const fields = [usage?.inputTokens, usage?.outputTokens, usage?.cacheReadInputTokens, usage?.cacheCreationInputTokens];
    if (!fields.every(nonNegativeInteger)) return null;
    total += fields.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function parseJsonLines(stdout) {
  const events = [];
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

function eventTokenCount(adapter, event) {
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
      && nonNegativeInteger(tokens?.cache?.read)
      && nonNegativeInteger(tokens?.cache?.write)
    ) {
      const total = tokens.input + tokens.output + tokens.cache.read + tokens.cache.write;
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

export function createAdapterUsageMonitor(adapter, maxTokens) {
  if (!['codex', 'opencode', 'claude'].includes(adapter)) throw new EvoFenceError('UNKNOWN_ADAPTER', `Unsupported adapter: ${adapter}`);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new EvoFenceError('INVALID_BUDGET', 'The remaining token budget must be a positive safe integer.');

  let pending = '';
  let eventCount = 0;
  let total = 0;
  let complete = true;
  let stopReason = null;

  const consumeLine = (line) => {
    if (!line.trim()) return null;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      complete = false;
      return 'TOKEN_USAGE_UNAVAILABLE';
    }
    const parsed = eventTokenCount(adapter, event);
    if (!parsed.relevant) return null;
    eventCount += 1;
    if (parsed.tokens === null) {
      complete = false;
      return 'TOKEN_USAGE_UNAVAILABLE';
    }
    total += parsed.tokens;
    if (!Number.isSafeInteger(total)) {
      complete = false;
      return 'TOKEN_USAGE_UNAVAILABLE';
    }
    return total >= maxTokens ? 'TOKEN_BUDGET_REACHED' : null;
  };

  return {
    push(chunk) {
      if (stopReason) return stopReason;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        stopReason = consumeLine(line);
        if (stopReason) return stopReason;
      }
      if (pending.length > 1_048_576) {
        complete = false;
        stopReason = 'TOKEN_USAGE_UNAVAILABLE';
      }
      return stopReason;
    },
    snapshot() {
      const tokensComplete = eventCount > 0 && complete;
      return {
        tokens_total: tokensComplete ? total : null,
        tokens_complete: tokensComplete,
        token_source: eventCount
          ? ({ codex: 'codex-cli-turn.completed', opencode: 'opencode-cli-step_finish', claude: 'claude-cli-result.modelUsage' })[adapter]
          : null,
      };
    },
  };
}

function incompleteUsage(tokenSource = null, costSource = null) {
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

function codexUsage(events, outputLimited) {
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

function openCodeUsage(events, outputLimited) {
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

function claudeUsage(events, outputLimited) {
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

export function parseAdapterUsage(adapter, stdout, { outputLimited = false } = {}) {
  const parsed = parseJsonLines(stdout);
  let usage;
  if (adapter === 'codex') usage = codexUsage(parsed.events, outputLimited);
  else if (adapter === 'opencode') usage = openCodeUsage(parsed.events, outputLimited);
  else if (adapter === 'claude') usage = claudeUsage(parsed.events, outputLimited);
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

export async function runAgentAdapter({ name, command, model, agent, cwd, timeoutMs, maxOutputBytes, maxTokensRemaining = null, allowUnisolatedOpenCode = false, allowUnisolatedAgent = allowUnisolatedOpenCode }) {
  let args;
  let env = {};
  if (name === 'codex') {
    args = codexArgs({ cwd, model });
  } else if (name === 'opencode') {
    if (!allowUnisolatedAgent) {
      throw new EvoFenceError('OPEN_CODE_SANDBOX_REQUIRED', 'OpenCode does not provide an OS security sandbox. Re-run with --allow-unisolated-agent only if you accept that boundary, or launch OpenCode in a Docker/VM sandbox.');
    }
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
  } else if (name === 'claude') {
    if (!allowUnisolatedAgent) {
      throw new EvoFenceError('CLAUDE_SANDBOX_REQUIRED', 'EvoFence does not place the Claude Code CLI inside an OS sandbox. Re-run with --allow-unisolated-agent only if you accept that boundary, or run EvoFence in a Docker/VM with restricted mounts.');
    }
    args = claudeCodeArgs({ model, agent });
  } else {
    throw new EvoFenceError('UNKNOWN_ADAPTER', `Unsupported adapter: ${name}`);
  }

  const usageMonitor = maxTokensRemaining === null ? null : createAdapterUsageMonitor(name, maxTokensRemaining);
  const result = await runProcess(command, args, {
    cwd,
    timeoutMs,
    maxOutputBytes,
    env,
    shell: platform() === 'win32',
    ...(usageMonitor ? {
      onChunk: (stream, chunk) => stream === 'stdout' ? usageMonitor.push(chunk) : undefined,
      stopGraceMs: 0,
    } : {}),
  });
  let usage = parseAdapterUsage(name, result.stdout, { outputLimited: result.output_limited });
  if (result.stop_reason === 'TOKEN_BUDGET_REACHED' || result.stop_reason === 'TOKEN_USAGE_UNAVAILABLE') {
    usage = { ...usage, ...usageMonitor.snapshot() };
    if (result.stop_reason === 'TOKEN_USAGE_UNAVAILABLE') usage.tokens_complete = false;
  }
  return {
    ...result,
    adapter: name,
    model: model ?? null,
    budget_stop_reason: result.stop_reason,
    // Keep the legacy field, but never fill it with a partial or estimated count.
    estimated_tokens: usage.tokens_complete ? usage.tokens_total : null,
    reported_usage: usage,
  };
}

export function adapterCommand(config, name) {
  const value = config.adapters?.[name]?.command;
  return typeof value === 'string' && value.trim() ? value : name;
}

export function adapterModel(config, name) {
  return config.adapters?.[name]?.model ?? null;
}

export function adapterAgent(config, name) {
  return config.adapters?.[name]?.agent ?? null;
}
