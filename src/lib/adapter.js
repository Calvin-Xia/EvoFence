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

function estimatedTokens(adapter, stdout) {
  let total = 0;
  let observed = false;
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      const candidates = [
        event?.info?.total_token_usage?.total_tokens,
        event?.payload?.info?.total_token_usage?.total_tokens,
        event?.total_token_usage?.total_tokens,
        event?.part?.tokens?.total,
        event?.tokens?.total,
      ].filter((value) => Number.isFinite(value) && value >= 0);
      if (candidates.length) {
        observed = true;
        const current = Math.max(...candidates);
        total = adapter === 'codex' ? Math.max(total, current) : total + current;
      }
      const ioTokens = [event?.part?.tokens, event?.tokens, event?.metadata?.tokens]
        .filter((value) => value && typeof value === 'object')
        .map((tokens) => Number(tokens.input ?? 0) + Number(tokens.output ?? 0) + Number(tokens.reasoning ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0);
      if (ioTokens.length) {
        observed = true;
        total += ioTokens[0];
      }
    } catch {
      // Informational non-JSON output is intentionally ignored.
    }
  }
  return observed ? Math.round(total) : null;
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
  const tokens = estimatedTokens(name, result.stdout);
  return { ...result, adapter: name, model: model ?? null, estimated_tokens: tokens };
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
