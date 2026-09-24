import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { EvoFenceError } from './errors.js';

const DEFAULT_MAX_OUTPUT = 1_048_576;
const SENSITIVE_ENV_NAME = /(?:^|[_-])(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|BEARER|COOKIE|SESSION)(?:$|[_-])|(?:^|[_-])(?:API|ACCESS|PRIVATE|CLIENT|SIGNING|ENCRYPTION)[_-]?KEY(?:$|[_-])|(?:ASKPASS|AUTH_SOCK|KUBECONFIG|DOCKER_CONFIG)$/i;

function isSensitiveEnvironmentName(name) {
  return SENSITIVE_ENV_NAME.test(name);
}

export function sanitizedEnvironment(extra = {}) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (isSensitiveEnvironmentName(name)) continue;
    env[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (isSensitiveEnvironmentName(name)) {
      delete env[name];
      continue;
    }
    if (value === undefined || value === null) delete env[name];
    else env[name] = String(value);
  }
  return env;
}

async function killTree(child, { force = false } = {}) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    if (child.exitCode !== null && !force) return;
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', resolve);
      killer.once('close', resolve);
    });
  } else {
    if (child.exitCode !== null && !force) return;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

export function runProcess(command, args, options = {}) {
  const {
    cwd,
    timeoutMs = 120000,
    maxOutputBytes = DEFAULT_MAX_OUTPUT,
    env = {},
    input,
    shell = false,
    onChunk,
    stopGraceMs = 250,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: sanitizedEnvironment(env),
      shell: shell || (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)),
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutStoredBytes = 0;
    let stderrStoredBytes = 0;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimited = false;
    let stopReason = null;
    let callbackError = null;
    let forceKillTimer = null;
    let settled = false;
    const requestStop = (reason, graceMs = stopGraceMs) => {
      if (stopReason) return;
      stopReason = reason;
      child.kill('SIGTERM');
      if (graceMs === 0) {
        void killTree(child, { force: true });
        return;
      }
      forceKillTimer = setTimeout(() => void killTree(child), Math.max(0, graceMs));
      forceKillTimer.unref?.();
    };
    const append = (chunk, stream) => {
      if (stream === 'stdout') {
        stdoutBytes += chunk.length;
        const room = Math.max(0, maxOutputBytes - stdoutStoredBytes);
        if (room > 0) {
          const kept = chunk.subarray(0, room);
          stdoutChunks.push(Buffer.from(kept));
          stdoutStoredBytes += kept.length;
        }
        if (chunk.length > room) outputLimited = true;
        try {
          const requestedStop = onChunk?.(stream, chunk.toString('utf8'));
          if (typeof requestedStop === 'string' && requestedStop) requestStop(requestedStop);
        } catch (error) {
          callbackError = error;
          requestStop('OUTPUT_CALLBACK_ERROR');
        }
      } else {
        stderrBytes += chunk.length;
        const room = Math.max(0, maxOutputBytes - stderrStoredBytes);
        if (room > 0) {
          const kept = chunk.subarray(0, room);
          stderrChunks.push(Buffer.from(kept));
          stderrStoredBytes += kept.length;
        }
        if (chunk.length > room) outputLimited = true;
      }
    };
    child.stdout?.on('data', (chunk) => append(chunk, 'stdout'));
    child.stderr?.on('data', (chunk) => append(chunk, 'stderr'));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(new EvoFenceError('PROCESS_START_FAILED', `Could not start ${command}: ${error.message}`, { command, code: error.code }));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer && !stopReason) clearTimeout(forceKillTimer);
      resolve({
        command,
        args,
        code,
        signal,
        timed_out: timedOut,
        stop_reason: stopReason,
        output_error: callbackError?.message ?? null,
        output_limited: outputLimited,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
      });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      requestStop('TIMEOUT', 1500);
    }, Math.max(1, timeoutMs));
    timer.unref?.();
    if (input !== undefined) child.stdin.end(input);
  });
}

export async function runTrustedCommand(command, { cwd, timeoutMs = 120000, maxOutputBytes = DEFAULT_MAX_OUTPUT, env = {} } = {}) {
  const result = await runProcess(command, [], { cwd, timeoutMs, maxOutputBytes, env, shell: true });
  return { ...result, command };
}

export function finalNumericLine(output) {
  const lines = output.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const value = Number(lines.at(-1));
  return Number.isFinite(value) ? value : null;
}

export async function waitForClose(child) {
  const [code, signal] = await once(child, 'close');
  return { code, signal };
}
