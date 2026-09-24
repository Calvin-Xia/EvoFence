import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Ledger } from '../src/lib/ledger.js';

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
