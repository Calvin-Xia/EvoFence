/**
 * CLI command-surface specification types (node `l2_cli`, ADR-0003).
 *
 * The command surface used to be implicit: `src/cli.js` hand-parsed argv per command, `HELP` was
 * a hand-maintained string, and nothing recorded which flags a command accepted or which exit
 * codes it could produce. ADR-0003 makes one catalog the single source of truth, so the
 * dispatcher, the help text, the docs and the smoke test all read the same table.
 *
 * EXIT-CODE CONVENTION (ADR-0003, uniform across every command): this CLI only ever exits `0`
 * (success) or `1` (any failure — usage error, thrown domain error, or a negative domain verdict
 * such as a failed ledger verification). There is no third code; a consumer that needs to tell
 * failures apart reads `[CODE]` on stderr (text) or `error.code` (JSON).
 */
export const COMMAND_GROUPS = [
  'init',
  'run',
  'proposal',
  'evidence',
  'gate',
  'ledger',
  'diff',
  'rollback',
  'experiment',
  'report',
  'budget',
  'status',
  'doctor',
  'session',
] as const;

export type CommandGroup = (typeof COMMAND_GROUPS)[number];

/** One flag a command accepts. `name` is the CLI spelling, `key` the parsed-options key. */
export interface FlagSpec {
  readonly name: string;
  readonly key: string;
  readonly kind: 'value' | 'boolean';
  /** Value flags only: the flag must be present, else the command is a usage error. */
  readonly required?: boolean;
  readonly description: string;
}

/** One positional a command accepts, in order. */
export interface PositionalSpec {
  readonly name: string;
  readonly required: boolean;
  readonly description?: string;
}

/** One possible exit code, with the condition that produces it. */
export interface ExitSpec {
  readonly code: number;
  readonly when: string;
}

/**
 * `flag`   — text by default, the machine-readable view only with `--json`.
 * `always` — the machine-readable view is the only output; `--json` is accepted and idempotent.
 */
export type JsonMode = 'flag' | 'always';

/** Which smoke fixture a manifest-declared smoke invocation needs. */
export type SmokeFixture = 'ledger' | 'agentless';

/**
 * A deterministic smoke invocation plus the exit code the manifest promises for it.
 *
 * This is executable documentation: `test/cli-surface.test.js` drives every entry and fails when
 * the observed exit code differs from the declared one (DoD 1). The fixture names come from
 * `SMOKE` in `catalog.ts`, so the fixture and the manifest cannot drift apart.
 */
export interface SmokeSpec {
  readonly args: readonly string[];
  readonly code: number;
  readonly fixture: SmokeFixture;
  readonly note?: string;
}

/** The full specification of one subcommand. */
export interface CommandSpec {
  /** Present only for a native protocol surface; absent on the frozen legacy CLI. */
  readonly namespace?: 'evofence.runtime/1';
  /** Canonical spelling: `group` or `group action` (e.g. `ledger verify`). */
  readonly name: string;
  readonly group: CommandGroup;
  /** Present when the group has more than one subcommand. */
  readonly action?: string;
  readonly summary: string;
  /** Usage line WITHOUT the `evofence ` prefix; also the text after `Use: evofence `. */
  readonly usage: string;
  /**
   * Optional 0.4.x usage spelling retained in usage errors/help compatibility text while the
   * manifest's `usage` records an additive flag. This stays on the one manifest entry.
   */
  readonly legacyUsage?: string;
  readonly positionals: readonly PositionalSpec[];
  readonly flags: readonly FlagSpec[];
  readonly json: JsonMode;
  readonly exits: readonly ExitSpec[];
  /** Smoke invocation for DoD 1 (exit code must match `code`). */
  readonly smoke: SmokeSpec;
  /**
   * Smoke invocation WITH `--json`. A code of `0` requires `stdout` to parse as a JSON object;
   * a non-zero code requires `stderr` to parse as the documented error object.
   */
  readonly jsonSmoke: SmokeSpec;
}
