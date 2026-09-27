/**
 * CLI command-surface API: the manifest re-export, argv routing and help rendering.
 *
 * DOMAIN: CLI (node `l2_cli`). This module holds NO command behaviour — only the surface.
 * `catalog.ts` owns the manifest data (DoD 1) and `handlers/` owns the behaviour, so the
 * dispatcher cannot grow business judgement (DoD 5).
 */
import { EvoFenceError } from '../errors.js';
import { COMMANDS } from './catalog.js';
import { COMMAND_GROUPS, type CommandGroup, type CommandSpec } from './spec.js';

export { COMMANDS, SMOKE } from './catalog.js';
export { COMMAND_GROUPS } from './spec.js';
export type {
  CommandGroup,
  CommandSpec,
  ExitSpec,
  FlagSpec,
  JsonMode,
  PositionalSpec,
  SmokeFixture,
  SmokeSpec,
} from './spec.js';

/** A routed command plus the argv it still has to parse (no global flags consumed). */
export interface Route {
  readonly spec: CommandSpec;
  readonly rest: readonly string[];
}

/** `evofence <usage>` — also the text every usage error reports after `Use: `. */
export function usageLine(spec: CommandSpec): string {
  return `evofence ${spec.usage}`;
}

function specsInGroup(group: CommandGroup): readonly CommandSpec[] {
  return COMMANDS.filter((spec) => spec.group === group);
}

function groupUsageLine(group: CommandGroup): string {
  const specs = specsInGroup(group);
  if (specs.length === 1) return usageLine(specs[0]);
  return `evofence ${group} <${specs.map((spec) => spec.action).join('|')}> [--json]`;
}

function isGroup(name: string): name is CommandGroup {
  return (COMMAND_GROUPS as readonly string[]).includes(name);
}

/**
 * Resolve `argv` to exactly one manifest entry. Pure routing: a bare group command consumes
 * `argv[0]`, an action group consumes `argv[0..1]`, and an unknown group/action is a `USAGE`
 * error before any handler runs.
 */
export function routeCommand(argv: readonly string[]): Route {
  const [group, ...tail] = argv;
  if (group === undefined) throw new EvoFenceError('USAGE', 'Missing command. Run evofence --help for usage.');
  if (!isGroup(group)) throw new EvoFenceError('USAGE', `Unknown command: ${group}\nRun evofence --help for usage.`);
  const specs = specsInGroup(group);
  const bare = specs.find((spec) => spec.action === undefined);
  if (bare) return { spec: bare, rest: tail };
  const action = tail[0];
  const spec = action === undefined ? undefined : specs.find((candidate) => candidate.action === action);
  if (!spec) throw new EvoFenceError('USAGE', `Use: ${groupUsageLine(group)}`);
  return { spec, rest: tail.slice(1) };
}

/** The `--help` text, generated from the manifest so it can never drift from the surface. */
export function renderHelp(version: string): string {
  const usage = COMMANDS.map((spec) => `  ${usageLine(spec)}`).join('\n');
  return `EvoFence ${version} — evidence-carrying evolution control plane

Usage:
${usage}

Options:
  --json                    Emit the machine-readable view instead of text (accepted by every command).
  --allow-unisolated-agent  Required for OpenCode, Claude Code and Pi; CLI controls are not an OS sandbox.
  --allow-readable-holdout  Required to run private checks when host read isolation is unavailable.
  --help, -h                Show this help.
  --version, -v             Print the version.

Exit codes:
  0  success
  1  any failure (usage error, thrown domain error, or a negative verdict such as a failed
     ledger verification). Text mode prints "[CODE] message" on stderr; --json mode prints one
     {"error":{"code","message","details"?}} object on stderr and keeps stdout empty.
`;
}
