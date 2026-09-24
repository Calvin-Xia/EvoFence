import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { EvoFenceError } from './errors.js';

const DEFAULT_MAX_OUTPUT = 1_048_576;

export function sanitizedEnvironment(extra = {}) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) continue;
    env[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined || value === null) delete env[name];
    else env[name] = String(value);
  }
  return env;
}

async function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', resolve);
      killer.once('close', resolve);
    });
  } else {
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
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimited = false;
    let settled = false;
    const append = (target, chunk, stream) => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') {
        stdoutBytes += chunk.length;
        if (Buffer.byteLength(stdout) < maxOutputBytes) {
          const room = maxOutputBytes - Buffer.byteLength(stdout);
          stdout += Buffer.from(chunk).subarray(0, room).toString('utf8');
        } else outputLimited = true;
        onChunk?.(stream, text);
      } else {
        stderrBytes += chunk.length;
        if (Buffer.byteLength(stderr) < maxOutputBytes) {
          const room = maxOutputBytes - Buffer.byteLength(stderr);
          stderr += Buffer.from(chunk).subarray(0, room).toString('utf8');
        } else outputLimited = true;
      }
    };
    child.stdout?.on('data', (chunk) => append(stdout, chunk, 'stdout'));
    child.stderr?.on('data', (chunk) => append(stderr, chunk, 'stderr'));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new EvoFenceError('PROCESS_START_FAILED', `Could not start ${command}: ${error.message}`, { command, code: error.code }));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ command, args, code, signal, timed_out: timedOut, output_limited: outputLimited, stdout, stderr, stdout_bytes: stdoutBytes, stderr_bytes: stderrBytes });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => void killTree(child), 1500).unref();
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
