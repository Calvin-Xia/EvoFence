import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Ledger, ledgerPath } from '../src/lib/ledger.js';
import { runProcess } from '../src/lib/process.js';

test('SQLite ledger appends hash-chained events and keeps generation history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-ledger-'));
  const filename = path.join(directory, 'ledger.sqlite');
  const ledger = new Ledger(filename);
  try {
    ledger.append('run.started', 'run-a', { adapter: 'codex' });
    ledger.recordGeneration({ generation_id: 'g0', run_id: 'run-a', sha: 'a'.repeat(40), parent_sha: 'a'.repeat(40) });
    ledger.recordGeneration({ generation_id: 'g1', run_id: 'run-a', sha: 'b'.repeat(40), parent_sha: 'a'.repeat(40) });
    assert.equal(ledger.verify().valid, true);
    assert.equal(ledger.activeGeneration().generation_id, 'g1');
    assert.equal(ledger.events('run-a').length, 3);
    assert.throws(() => ledger.db.prepare("UPDATE events SET event_type = 'forged' WHERE seq = 1").run(), /append-only/);
    ledger.rollback('g0');
    assert.equal(ledger.activeGeneration().generation_id, 'g0');
    assert.equal(ledger.verify().valid, true);
  } finally {
    ledger.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('ledger CLI recent returns sanitized run summaries and read-only commands do not create a ledger', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-ledger-cli-'));
  const root = path.join(directory, 'repo');
  const policyDirectory = path.join(root, '.evofence');
  const cliPath = path.resolve(import.meta.dirname, '../src/cli.js');
  await mkdir(policyDirectory, { recursive: true });
  try {
    const initialized = await runProcess('git', ['init', '--quiet'], { cwd: root, timeoutMs: 10000, maxOutputBytes: 10000 });
    assert.equal(initialized.code, 0, initialized.stderr);
    const missingVerify = await runProcess(process.execPath, [cliPath, 'ledger', 'verify'], { cwd: root, timeoutMs: 10000, maxOutputBytes: 10000 });
    assert.notEqual(missingVerify.code, 0);
    await assert.rejects(readFile(ledgerPath(root)), { code: 'ENOENT' });
    const missingRecent = await runProcess(process.execPath, [cliPath, 'ledger', 'recent'], { cwd: root, timeoutMs: 10000, maxOutputBytes: 10000 });
    assert.notEqual(missingRecent.code, 0);
    await assert.rejects(readFile(ledgerPath(root)), { code: 'ENOENT' });

    const ledger = new Ledger(ledgerPath(root));
    try {
      ledger.append('run.started', 'run-a', { adapter: 'claude', secret_note: 'must-not-appear-in-summary' });
      ledger.append('run.finished', 'run-a', { status: 'ACCEPTED', iterations: 1, duration_ms: 125 });
    } finally { ledger.close(); }

    const recent = await runProcess(process.execPath, [cliPath, 'ledger', 'recent', '10'], { cwd: root, timeoutMs: 10000, maxOutputBytes: 10000 });
    assert.equal(recent.code, 0, recent.stderr);
    const summaries = JSON.parse(recent.stdout);
    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0], {
      run_id: 'run-a', started_at: summaries[0].started_at, adapter: 'claude', status: 'ACCEPTED',
      accepted_candidates: 0, rejected_candidates: 0, iterations: 1, duration_ms: 125,
    });
    assert.equal(recent.stdout.includes('must-not-appear-in-summary'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
