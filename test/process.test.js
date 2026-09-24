import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { finalNumericLine, runProcess, sanitizedEnvironment } from '../src/lib/process.js';

test('process runner captures bounded output and exit status', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("hello\\n")'], { timeoutMs: 5000 });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'hello\n');
  assert.equal(result.timed_out, false);
});

test('process runner marks a final chunk that crosses the output limit as truncated', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(2048))'], { timeoutMs: 5000, maxOutputBytes: 1024 });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'x'.repeat(1024));
  assert.equal(result.stdout_bytes, 2048);
  assert.equal(result.output_limited, true);
});

test('process runner terminates a process that exceeds its time budget', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 100 });
  assert.equal(result.timed_out, true);
  assert.notEqual(result.code, 0);
});

test('process runner stops when a streamed output callback reports a budget trigger', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("budget-hit\\n"); setTimeout(() => {}, 5000)'], {
    timeoutMs: 5000,
    stopGraceMs: 0,
    onChunk: (_stream, chunk) => chunk.includes('budget-hit') ? 'TOKEN_BUDGET_REACHED' : undefined,
  });
  assert.equal(result.stop_reason, 'TOKEN_BUDGET_REACHED');
  assert.equal(result.timed_out, false);
  assert.notEqual(result.code, 0);
});

test('secret-like environment values are not passed to child processes', () => {
  const names = ['EVOFENCE_TEST_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'CI_JOB_TOKEN', 'AWS_SESSION_TOKEN', 'GIT_ASKPASS', 'SSH_AUTH_SOCK'];
  const old = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) process.env[name] = 'do-not-inherit';
  try {
    const env = sanitizedEnvironment({ EVOFENCE_SAFE: 'yes', CI_JOB_TOKEN: 'override' });
    for (const name of names) assert.equal(env[name], undefined, name);
    assert.equal(env.EVOFENCE_SAFE, 'yes');
  } finally {
    for (const [name, value] of old) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('objective parser reads only a finite final score', () => {
  assert.equal(finalNumericLine('starting benchmark\n0.823\n'), 0.823);
  assert.equal(finalNumericLine('no score'), null);
  assert.equal(finalNumericLine('Infinity'), null);
});
