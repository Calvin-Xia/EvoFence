import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { EvoFenceError } from './exec/errors.js';
import type { ProcessResult, StopReason, TrustedCommandResult } from '../types/index.js';

const DEFAULT_MAX_OUTPUT = 1_048_576;
const SENSITIVE_ENV_NAME = /(?:^|[_-])(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|BEARER|COOKIE|SESSION)(?:$|[_-])|(?:^|[_-])(?:API|ACCESS|PRIVATE|CLIENT|SIGNING|ENCRYPTION)[_-]?KEY(?:$|[_-])|(?:ASKPASS|AUTH_SOCK|KUBECONFIG|DOCKER_CONFIG)$/i;

/** Environment overlay accepted by `runProcess`; `null`/`undefined` removes the variable. */
export type EnvironmentValues = Record<string, string | null | undefined>;

/** Options accepted by {@link runProcess}. */
export interface RunProcessOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: EnvironmentValues;
  input?: string | Uint8Array;
  shell?: boolean;
  /** Called per stdout chunk; a returned string requests an early stop with that reason. */
  onChunk?: (stream: 'stdout' | 'stderr', chunk: string) => StopReason | void;
  stopGraceMs?: number;
}

function isSensitiveEnvironmentName(name: string): boolean {
  return SENSITIVE_ENV_NAME.test(name);
}

export function sanitizedEnvironment(extra: EnvironmentValues = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
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

async function taskkillProcessTree(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      resolve(success);
    };
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.once('error', () => finish(false));
    killer.once('close', (code) => finish(code === 0));
  });
}

async function killTree(child: ChildProcess, { force = false }: { force?: boolean } = {}): Promise<boolean> {
  const pid = child.pid;
  if (!pid) return true;
  if (process.platform === 'win32') {
    if (child.exitCode !== null && !force) return true;
    const killed = await taskkillProcessTree(pid);
    if (!killed && child.exitCode === null) child.kill('SIGKILL');
    return killed;
  }
  if (child.exitCode !== null && !force) return true;
  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    child.kill('SIGKILL');
    return false;
  }
}

async function closesWithin(closePromise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    closePromise.then(() => true),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); timer.unref?.(); }),
  ]);
  if (timer) clearTimeout(timer);
  return result;
}

export async function canTerminateProcessTree(): Promise<boolean> {
  if (process.platform !== 'win32') return true;
  const probe = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore', windowsHide: true });
  const started = await new Promise<boolean>((resolve) => {
    probe.once('spawn', () => resolve(true));
    probe.once('error', () => resolve(false));
  });
  if (!started) return false;
  const probePid = probe.pid;
  if (probePid === undefined) return false;
  const closePromise = new Promise((resolve) => probe.once('close', resolve));
  const killed = await taskkillProcessTree(probePid);
  if (killed && await closesWithin(closePromise, 1000)) return true;
  probe.kill('SIGKILL');
  await closesWithin(closePromise, 1000);
  return false;
}

export function runProcess(command: string, args: readonly string[], options: RunProcessOptions = {}): Promise<ProcessResult> {
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
    // DEP0190: under `shell: true` Node concatenates (never escapes) argv into the command line
    // and warns when argv is non-empty. Fold argv into the command line ourselves and hand spawn
    // an empty argv: the spawned command line is byte-identical to Node's own assembly, and the
    // deprecation warning can never leak onto stderr where the --json error contract lives.
    const useShell = shell || (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command));
    const foldArgs = useShell && args.length > 0;
    const child = spawn(foldArgs ? [command, ...args].join(' ') : command, foldArgs ? [] : args, {
      cwd,
      env: sanitizedEnvironment(env),
      shell: useShell,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutStoredBytes = 0;
    let stderrStoredBytes = 0;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimited = false;
    let stopReason: StopReason | null = null;
    let callbackError: Error | null = null;
    let treeTerminationFailed = false;
    let treeKillPromise: Promise<unknown> | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const requestStop = (reason: StopReason, graceMs = stopGraceMs) => {
      if (stopReason) return;
      stopReason = reason;
      if (graceMs === 0 && process.platform === 'win32') {
        treeKillPromise = killTree(child, { force: true }).then((success) => {
          treeTerminationFailed = !success;
        });
        return;
      }
      child.kill('SIGTERM');
      if (graceMs === 0) {
        treeKillPromise = killTree(child, { force: true }).then((success) => {
          treeTerminationFailed = !success;
        });
        return;
      }
      forceKillTimer = setTimeout(() => {
        treeKillPromise = killTree(child).then((success) => {
          treeTerminationFailed = !success;
        });
      }, Math.max(0, graceMs));
      forceKillTimer.unref?.();
    };
    const append = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
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
          callbackError = error as Error;
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
    child.stdout?.on('data', (chunk: Buffer) => append(chunk, 'stdout'));
    child.stderr?.on('data', (chunk: Buffer) => append(chunk, 'stderr'));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(new EvoFenceError('PROCESS_START_FAILED', `Could not start ${command}: ${error.message}`, { command, code: (error as NodeJS.ErrnoException).code }));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer && stopReason) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
        if (!treeKillPromise) {
          treeKillPromise = killTree(child, { force: true }).then((success) => {
            treeTerminationFailed = !success;
          });
        }
      } else if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      void (async () => {
        if (treeKillPromise) await treeKillPromise;
        resolve({
          command,
          args,
          code,
          signal,
          timed_out: timedOut,
          stop_reason: stopReason,
          tree_termination_failed: treeTerminationFailed,
          output_error: callbackError?.message ?? null,
          output_limited: outputLimited,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          stdout_bytes: stdoutBytes,
          stderr_bytes: stderrBytes,
        });
      })();
    });
    timer = setTimeout(() => {
      timedOut = true;
      requestStop('TIMEOUT', 1500);
    }, Math.max(1, timeoutMs));
    timer.unref?.();
    if (input !== undefined) child.stdin?.end(input);
  });
}

export async function runTrustedCommand(command: string, { cwd, timeoutMs = 120000, maxOutputBytes = DEFAULT_MAX_OUTPUT, env = {} }: Omit<RunProcessOptions, 'input' | 'shell' | 'onChunk' | 'stopGraceMs'> = {}): Promise<TrustedCommandResult> {
  const result = await runProcess(command, [], { cwd, timeoutMs, maxOutputBytes, env, shell: true });
  return { ...result, command };
}

export function finalNumericLine(output: string): number | null {
  const lines = output.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const value = Number(lines.at(-1));
  return Number.isFinite(value) ? value : null;
}

export async function waitForClose(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const [code, signal] = await once(child, 'close');
  return { code: code as number | null, signal: signal as NodeJS.Signals | null };
}
