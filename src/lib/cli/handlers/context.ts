/**
 * The handler contract: what a command implementation receives and what it returns.
 *
 * DOMAIN: CLI (node `l2_cli`). Handlers own the thin adapter logic (read the flags, call the
 * domain module, render the view); the dispatcher owns routing/parsing/exit codes (DoD 5).
 */
import type { Write } from '../output.js';

export interface CommandContext {
  /** Process working directory the command was invoked from. */
  readonly cwd: string;
  /** Parsed options, keyed by the manifest's `key` (snake_case). */
  readonly options: Readonly<Record<string, string | true>>;
  /** Parsed positional arguments, in manifest order. */
  readonly positionals: readonly string[];
  /** `true` when the machine-readable view is in effect (flag present, or an `always` command). */
  readonly json: boolean;
  readonly stdout: Write;
}

/** A handler returns the process exit code: `0` success, `1` any failure. */
export type CommandHandler = (context: CommandContext) => Promise<number>;

/** A value-flag option as a string, or `undefined` when absent. */
export function stringOption(context: CommandContext, key: string): string | undefined {
  const value = context.options[key];
  return typeof value === 'string' ? value : undefined;
}

/** A boolean-flag option. */
export function booleanOption(context: CommandContext, key: string): boolean {
  return context.options[key] === true;
}

/** An optional positional, or `undefined`. */
export function positional(context: CommandContext, index: number): string | undefined {
  return context.positionals[index];
}
