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

test('process runner terminates a process that exceeds its time budget', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 100 });
  assert.equal(result.timed_out, true);
  assert.notEqual(result.code, 0);
});

test('secret-like environment values are not passed to child processes', () => {
  const old = process.env.EVOFENCE_TEST_API_KEY;
  process.env.EVOFENCE_TEST_API_KEY = 'do-not-inherit';
  try {
    const env = sanitizedEnvironment({ EVOFENCE_SAFE: 'yes' });
    assert.equal(env.EVOFENCE_TEST_API_KEY, undefined);
    assert.equal(env.EVOFENCE_SAFE, 'yes');
  } finally {
    if (old === undefined) delete process.env.EVOFENCE_TEST_API_KEY;
    else process.env.EVOFENCE_TEST_API_KEY = old;
  }
});

test('objective parser reads only a finite final score', () => {
  assert.equal(finalNumericLine('starting benchmark\n0.823\n'), 0.823);
  assert.equal(finalNumericLine('no score'), null);
  assert.equal(finalNumericLine('Infinity'), null);
});
