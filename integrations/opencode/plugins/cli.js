import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const LOCAL_CLI = path.resolve(import.meta.dirname, '../../../dist/cli.js');
const LOCAL_PACKAGE_ROOT = path.resolve(import.meta.dirname, '../../../node_modules/evofence');

function packageCli(packageRoot) {
  const packageJson = path.join(packageRoot, 'package.json');
  if (!existsSync(packageJson)) return null;
  const metadata = JSON.parse(readFileSync(packageJson, 'utf8'));
  if (metadata.name !== 'evofence') return null;
  const cli = path.join(packageRoot, 'dist', 'cli.js');
  return existsSync(cli) ? cli : null;
}

/**
 * Resolution order: explicit `EVOFENCE_CLI_PATH`, this checkout's build, then PATH.
 *
 * Audit finding G13: the inspected repository's `node_modules/evofence` is deliberately **not**
 * consulted any more. Resolving a binary out of the repository under inspection meant that loading
 * this plugin executed code from that repository.
 */
function resolveCliInvocation() {
  const override = process.env.EVOFENCE_CLI_PATH;
  if (override) return { command: process.execPath, prefix: [path.resolve(override)] };

  const localCli = [
    existsSync(LOCAL_CLI) ? LOCAL_CLI : null,
    packageCli(LOCAL_PACKAGE_ROOT),
  ].find(Boolean);
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
      packageCli(path.resolve(directory, 'node_modules', 'evofence')),
      packageCli(path.resolve(directory, '..', 'evofence')),
    ].find(Boolean);
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

function parseBundleVerificationFailure(stdout) {
  try {
    const payload = JSON.parse(stdout);
    return payload?.valid === false ? payload : null;
  } catch {
    return null;
  }
}

export function parseCliResult(result, messages, expectsBundleVerification) {
  if (result.error?.code === 'ENOENT') return { error: messages.missingMessage };
  if (result.error) return { error: messages.processErrorMessage };
  if (result.status !== 0) {
    if (expectsBundleVerification) {
      const verification = parseBundleVerificationFailure(result.stdout);
      if (verification) return verification;
    }
    return parseCliFailure(result.stderr, messages.failureMessage);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: messages.invalidMessage };
  }
}

export function runEvoFence(args, cwd, messages) {
  const cliArgs = args.includes('--json') ? args : [...args, '--json'];
  const invocation = resolveCliInvocation();
  const result = spawnSync(invocation.command, [...invocation.prefix, ...cliArgs], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1_000_000,
    timeout: 15_000,
    windowsHide: true,
  });
  const expectsBundleVerification = args[0] === 'ledger'
    && args[1] === 'verify'
    && args.some((arg) => arg === '--bundle' || arg.startsWith('--bundle='));
  return parseCliResult(result, messages, expectsBundleVerification);
}
