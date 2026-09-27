/**
 * Manifest-driven argv parsing for one routed command.
 *
 * DOMAIN: CLI (node `l2_cli`). Uniform rules for the whole surface:
 *   - `--name value` and `--name=value` are both accepted;
 *   - an unknown flag is a usage error for EVERY command (0.3.0 silently ignored unknown value
 *     flags on `run` and swallowed stray arguments on `init`);
 *   - a missing value, a missing required flag, or too many/few positionals is a usage error;
 *   - a plain usage error (arity/required) reports exactly `Use: <usage>` — that exact text is
 *     pinned by the acceptance oracles (`spec-f1` diff, `spec-f2` report, `spec-f3` status).
 */
import { EvoFenceError } from '../errors.js';
import { usageLine } from './commands.js';
import type { CommandSpec } from './spec.js';

/** Parsed option value: `true` for boolean flags, the string for value flags. */
export type OptionValue = string | true;

export interface ParsedCommandArgs {
  readonly options: Readonly<Record<string, OptionValue>>;
  readonly positionals: readonly string[];
}

function usageError(spec: CommandSpec, message?: string): never {
  throw new EvoFenceError('USAGE', message === undefined ? `Use: ${usageLine(spec)}` : `${message} Use: ${usageLine(spec)}`);
}

export function parseCommandArgs(spec: CommandSpec, rest: readonly string[]): ParsedCommandArgs {
  const options: Record<string, OptionValue> = {};
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] as string;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const inlineValue = equals === -1 ? null : arg.slice(equals + 1);
    const flag = spec.flags.find((candidate) => candidate.name === name);
    if (!flag) usageError(spec, `Unknown option --${name}.`);

    if (flag.kind === 'boolean') {
      if (inlineValue !== null) usageError(spec, `Option --${name} does not take a value.`);
      options[flag.key] = true;
      continue;
    }

    const value = inlineValue ?? rest[index + 1];
    if (value === undefined || (inlineValue === null && value.startsWith('--'))) {
      usageError(spec, `Option --${name} requires a value.`);
    }
    options[flag.key] = value;
    if (inlineValue === null) index += 1;
  }

  for (const flag of spec.flags) {
    if (flag.kind === 'value' && flag.required === true && options[flag.key] === undefined) {
      usageError(spec, `Missing required option --${flag.name}.`);
    }
  }

  if (positionals.length > spec.positionals.length) usageError(spec);
  for (const [index, positional] of spec.positionals.entries()) {
    if (positional.required && positionals[index] === undefined) usageError(spec);
  }

  return { options, positionals };
}
