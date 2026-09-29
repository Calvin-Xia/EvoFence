#!/usr/bin/env node
/**
 * EvoFence CLI entry (node `l2_cli`, ADR-0003).
 *
 * Converted from `src/cli.js` (R1 keeps `dist/cli.js`, which `package.json#bin` points at) and
 * reduced to the three jobs an entry module should have:
 *
 *   1. global flags (`--help`, `-h`, `--version`, `-v`) before any routing;
 *   2. routing + argv parsing through the manifest (`lib/cli/commands.ts`, `lib/cli/options.ts`);
 *   3. the single failure contract — text `[CODE] message` or, with `--json`/`--format json`, one
 *      `{"error":{"code","message","details"?}}` object on stderr with stdout kept empty.
 *
 * Everything else (what a command does) lives in `lib/cli/handlers/**`, so this file stays well
 * under the 350-line gate and contains no business judgement (DoD 5).
 */
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { renderHelp, routeCommand } from './lib/cli/commands.js';
import { HANDLERS } from './lib/cli/handlers/index.js';
import { errorPayload, errorText, jsonDocument, type Write } from './lib/cli/output.js';
import { parseCommandArgs } from './lib/cli/options.js';
import { EvoFenceError } from './lib/errors.js';
import type { CommandSpec } from './lib/cli/spec.js';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const stdout: Write = (text) => { process.stdout.write(text); };
const stderr: Write = (text) => { process.stderr.write(text); };

function requestsJsonFormat(spec: CommandSpec, rest: readonly string[]): boolean {
  if (!spec.flags.some((flag) => flag.name === 'format')) return false;
  return rest.some((arg, index) => arg === '--format=json' || (arg === '--format' && rest[index + 1] === 'json'));
}

let jsonFailureMode = false;

async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv.includes('--help')) {
    stdout(renderHelp(packageJson.version));
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    stdout(`${packageJson.version}\n`);
    return 0;
  }

  const { spec, rest } = routeCommand(argv);
  jsonFailureMode = requestsJsonFormat(spec, rest);
  const parsed = parseCommandArgs(spec, rest);
  const handler = HANDLERS[spec.name];
  if (!handler) throw new EvoFenceError('USAGE', `No handler registered for "${spec.name}".`);

  return handler({
    cwd: process.cwd(),
    options: parsed.options,
    positionals: parsed.positionals,
    json: spec.json === 'always' || parsed.options.json === true,
    stdout,
  });
}

const argv = process.argv.slice(2);
try {
  process.exitCode = await main(argv);
} catch (error) {
  // `--json` or a manifest-declared `--format json` switches the failure output: ONE JSON object
  // on stderr, stdout byte-empty. Without either flag the 0.3.0 text line is unchanged.
  if (argv.includes('--json') || jsonFailureMode) stderr(jsonDocument(errorPayload(error)));
  else stderr(errorText(error));
  process.exitCode = 1;
}
