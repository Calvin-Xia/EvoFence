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

function nonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
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
      && nonNegativeInteger(tokens?.reasoning)
      && nonNegativeInteger(tokens?.cache?.read)
      && nonNegativeInteger(tokens?.cache?.write)
    ) {
      const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
      return { relevant: true, tokens: Number.isSafeInteger(total) ? total : null };
    }
    return { relevant: true, tokens: null };
  }
  return { relevant: false, tokens: null };
}

export function createAdapterUsageMonitor(adapter, maxTokens) {
  if (!['codex', 'opencode'].includes(adapter)) throw new EvoFenceError('UNKNOWN_ADAPTER', `Unsupported adapter: ${adapter}`);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new EvoFenceError('INVALID_BUDGET', 'The remaining token budget must be a positive safe integer.');

  let pending = '';
  let eventCount = 0;
  let total = 0;
  let complete = true;
  let stopReason = null;
  let discardingOversizedLine = false;

  const requestStop = (reason) => {
    if (!stopReason) stopReason = reason;
  };

  const consumeLine = (line) => {
    if (!line.trim()) return;
    let event;
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
    push(chunk) {
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
        token_source: eventCount ? (adapter === 'codex' ? 'codex-cli-turn.completed' : 'opencode-cli-step_finish') : null,
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

export function parseAdapterUsage(adapter, stdout, { outputLimited = false } = {}) {
  const parsed = parseJsonLines(stdout);
  let usage;
  if (adapter === 'codex') usage = codexUsage(parsed.events, outputLimited);
  else if (adapter === 'opencode') usage = openCodeUsage(parsed.events, outputLimited);
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

export async function runAgentAdapter({ name, command, model, agent, cwd, timeoutMs, maxOutputBytes, maxTokensRemaining = null, allowUnisolatedOpenCode = false }) {
  let args;
  let env = {};
  if (name === 'codex') {
    args = codexArgs({ cwd, model });
  } else if (name === 'opencode') {
    if (!allowUnisolatedOpenCode) {
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
  const monitorStopReason = usageMonitor?.finish() ?? null;
  const budgetStopReason = result.stop_reason ?? monitorStopReason;
  let usage = parseAdapterUsage(name, result.stdout, { outputLimited: result.output_limited });
  if (budgetStopReason === 'TOKEN_BUDGET_REACHED' || budgetStopReason === 'TOKEN_USAGE_UNAVAILABLE') {
    usage = { ...usage, ...usageMonitor.snapshot() };
  }
  if (budgetStopReason === 'TOKEN_USAGE_UNAVAILABLE' || result.output_limited) {
    usage.tokens_total = null;
    usage.tokens_complete = false;
  }
  return {
    ...result,
    adapter: name,
    model: model ?? null,
    budget_stop_reason: budgetStopReason,
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
