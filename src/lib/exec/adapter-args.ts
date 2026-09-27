/**
 * Exec domain · adapter argv construction.
 *
 * Extracted verbatim from the 0.3.0 `src/lib/adapter.js` (argv builders, the shared task
 * pointer, and Claude's USD-budget formatter). The public entry `src/lib/adapter.ts`
 * re-exports `claudeCodeArgs` / `piArgs` so the domain boundary is unchanged.
 */
import { EvoFenceError } from './errors.js';

export const TASK_POINTER = 'Read and follow .evofence-task.md. Complete the requested EvoFence phase and stop.';

export function codexArgs({ cwd: _cwd, model }: { cwd?: string; model?: string | null }): string[] {
  const args = ['--ask-for-approval', 'never', 'exec', '--sandbox', 'workspace-write', '--json', '--cd', '.', TASK_POINTER];
  if (model) args.splice(args.length - 1, 0, '--model', model);
  return args;
}

export function openCodeArgs({ model, agent }: { model?: string | null; agent?: string | null }): string[] {
  const args = ['run', '--dir', '.', '--format', 'json'];
  if (model) args.push('--model', model);
  if (agent) args.push('--agent', agent);
  args.push(TASK_POINTER);
  return args;
}

/**
 * Local copy of the USD → micro-dollar conversion. Kept separate from the runner's copy on
 * purpose: the two throw the same code with different messages, and that text is part of the
 * observed contract (`Claude USD budget ...`).
 */
export function usdToMicros(value: number, rounding: 'floor' | 'ceil' = 'floor'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new EvoFenceError('INVALID_BUDGET', 'Claude USD budget must be a finite, non-negative number.');
  }
  const match = value.toString().toLowerCase().match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
  if (!match) throw new EvoFenceError('INVALID_BUDGET', 'Claude USD budget could not be represented as a decimal amount.');
  const fraction = match[2] ?? '';
  const digits = BigInt(`${match[1]}${fraction}`);
  if (digits === 0n) return 0;
  const shift = 6 - fraction.length + Number(match[3] ?? 0);
  let micros: bigint;
  if (shift >= 0) {
    micros = digits * (10n ** BigInt(shift));
  } else {
    const divisor = 10n ** BigInt(-shift);
    micros = digits / divisor;
    if (rounding === 'ceil' && digits % divisor !== 0n) micros += 1n;
  }
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new EvoFenceError('INVALID_BUDGET', 'Claude USD amount exceeds EvoFence safe accounting range.');
  }
  return Number(micros);
}

export function formatUsdBudget(value: number): string {
  const micros = usdToMicros(value);
  if (micros < 1) {
    throw new EvoFenceError('INVALID_BUDGET', 'Claude USD budget must be at least $0.000001.');
  }
  const whole = Math.floor(micros / 1_000_000);
  const fraction = String(micros % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function claudeCodeArgs({ model, agent, maxBudgetUsd = null }: { model?: string | null; agent?: string | null; maxBudgetUsd?: number | null }): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'auto',
    '--permission-prompts', 'none',
  ];
  if (model) args.push('--model', model);
  if (agent) args.push('--agent', agent);
  if (maxBudgetUsd !== null) args.push('--max-budget-usd', formatUsdBudget(maxBudgetUsd));
  args.push(TASK_POINTER);
  return args;
}

export function piArgs({ model, extensionPath = null }: { model?: string | null; extensionPath?: string | null }): string[] {
  const args = [
    '--mode', 'json',
    '--no-session',
    '--no-approve',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-context-files',
  ];
  if (extensionPath) args.push('--extension', extensionPath);
  if (model) args.push('--model', model);
  args.push(TASK_POINTER);
  return args;
}
