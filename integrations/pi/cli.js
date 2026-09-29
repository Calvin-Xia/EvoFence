import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const LOCAL_CLI = path.resolve(import.meta.dirname, '../../dist/cli.js');
const LOCAL_PACKAGE_CLI = path.resolve(import.meta.dirname, '../../node_modules/evofence/dist/cli.js');

/**
 * Resolution order: explicit JS entry, this checkout or nearby local package, then PATH.
 */
function resolveCliInvocation(cwd) {
  const override = process.env.EVOFENCE_CLI_PATH;
  if (override) return { command: process.execPath, prefix: [path.resolve(override)] };

  const localCli = [
    LOCAL_CLI,
    LOCAL_PACKAGE_CLI,
    path.resolve(process.cwd(), 'dist', 'cli.js'),
    path.resolve(cwd, 'dist', 'cli.js'),
    path.resolve(cwd, 'node_modules', 'evofence', 'dist', 'cli.js'),
    path.resolve(cwd, '..', 'node_modules', 'evofence', 'dist', 'cli.js'),
  ].find((candidate) => existsSync(candidate));
  if (localCli) return { command: process.execPath, prefix: [localCli] };
  if (process.platform !== 'win32') return { command: 'evofence', prefix: [] };

  const lookup = spawnSync('where.exe', ['evofence'], { encoding: 'utf8', windowsHide: true });
  const paths = lookup.stdout?.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) ?? [];
  const commandPath = paths.find((value) => value.toLowerCase().endsWith('.exe'))
    ?? paths.find((value) => value.toLowerCase().endsWith('.cmd'))
    ?? paths[0];
  if (commandPath?.toLowerCase().endsWith('.cmd')) {
    const directory = path.dirname(commandPath);
    const cliPath = [
      path.resolve(directory, 'node_modules', 'evofence', 'dist', 'cli.js'),
      path.resolve(directory, '..', 'evofence', 'dist', 'cli.js'),
    ].find((candidate) => existsSync(candidate));
    if (cliPath) return { command: process.execPath, prefix: [cliPath] };
  }
  return { command: commandPath ?? 'evofence', prefix: [] };
}

export function parseCliFailure(stderr, fallbackMessage) {
  const text = typeof stderr === 'string' ? stderr.trim() : '';
  if (text.length > 0) {
    try {
      const payload = JSON.parse(text);
      const error = payload?.error;
      if (payload !== null && typeof payload === 'object' && error !== null && typeof error === 'object'
        && (typeof error.code === 'string' || error.code === null) && typeof error.message === 'string') {
        const projected = { code: error.code, message: error.message };
        if (error.details !== undefined) projected.details = error.details;
        return { error: projected };
      }
    } catch {
      // Fall through to the stable integration-level fallback below.
    }
  }
  return { error: fallbackMessage };
}

export function parseCliResult(result, messages) {
  if (result.error?.code === 'ENOENT') return { error: messages.missingMessage };
  if (result.error) return { error: messages.processErrorMessage };
  if (result.status !== 0) return parseCliFailure(result.stderr, messages.failureMessage);
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: messages.invalidMessage };
  }
}

export function runEvoFence(args, cwd, messages) {
  const cliArgs = args.includes('--json') ? args : [...args, '--json'];
  const invocation = resolveCliInvocation(cwd);
  const result = spawnSync(invocation.command, [...invocation.prefix, ...cliArgs], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1_000_000,
    timeout: 15_000,
    windowsHide: true,
  });
  return parseCliResult(result, messages);
}
