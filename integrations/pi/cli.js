import { spawnSync } from 'node:child_process';

export function parseCliFailure(stderr, fallbackMessage) {
  const text = typeof stderr === 'string' ? stderr.trim() : '';
  if (text.length > 0) {
    try {
      const payload = JSON.parse(text);
      const error = payload?.error;
      if (payload !== null && typeof payload === 'object' && error !== null && typeof error === 'object'
        && (typeof error.code === 'string' || error.code === null) && typeof error.message === 'string') {
        return { error: { code: error.code, message: error.message } };
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
  const isWindows = process.platform === 'win32';
  const cliArgs = args.includes('--json') ? args : [...args, '--json'];
  const result = spawnSync(isWindows ? 'evofence.cmd' : 'evofence', cliArgs, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1_000_000,
    timeout: 15_000,
    windowsHide: true,
    ...(isWindows ? { shell: true } : {}),
  });
  return parseCliResult(result, messages);
}
