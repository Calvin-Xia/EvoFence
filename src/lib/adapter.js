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
    const usage = event.usage;
    if (!nonNegativeNumber(usage?.input_tokens) || !nonNegativeNumber(usage?.output_tokens)) {
      complete = false;
      continue;
    }
    // cached_input_tokens and reasoning_output_tokens are breakdowns of input/output.
    total += usage.input_tokens + usage.output_tokens;
  }

  const tokensComplete = turnCount > 0 && complete && !outputLimited;
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
    const tokens = part?.tokens ?? event.tokens;
    let stepTokens = null;
    if (nonNegativeNumber(tokens?.total)) {
      stepTokens = tokens.total;
    } else if (
      nonNegativeNumber(tokens?.input)
      && nonNegativeNumber(tokens?.output)
      && nonNegativeNumber(tokens?.cache?.read)
      && nonNegativeNumber(tokens?.cache?.write)
    ) {
      // reasoning is a breakdown of output; cache read/write are separate token buckets.
      stepTokens = tokens.input + tokens.output + tokens.cache.read + tokens.cache.write;
    }
    if (stepTokens === null) tokensComplete = false;
    else tokenTotal += stepTokens;

    const cost = part?.cost ?? event.cost;
    if (nonNegativeNumber(cost)) {
      costTotal += cost;
      costCount += 1;
    } else {
      costComplete = false;
    }
  }

  const completeTokens = stepCount > 0 && tokensComplete && !outputLimited;
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

export async function runAgentAdapter({ name, command, model, agent, cwd, timeoutMs, maxOutputBytes, allowUnisolatedOpenCode = false }) {
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

  const result = await runProcess(command, args, { cwd, timeoutMs, maxOutputBytes, env, shell: platform() === 'win32' });
  const usage = parseAdapterUsage(name, result.stdout, { outputLimited: result.output_limited });
  return {
    ...result,
    adapter: name,
    model: model ?? null,
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
