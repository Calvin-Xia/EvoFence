import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Ledger, verifyBundle } from '../dist/lib/ledger.js';

async function withLedger(body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-ledger-bundle-'));
  const ledger = new Ledger(path.join(directory, 'ledger.sqlite'));
  try {
    ledger.append('run.started', 'run-bundle', { adapter: 'codex' });
    ledger.append('run.finished', 'run-bundle', { status: 'PLATEAU', iterations: 1 });
    return await body(ledger);
  } finally {
    ledger.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('offline bundle verification matches the online chain result', async () => {
  await withLedger((ledger) => {
    const online = ledger.verify();
    const bundle = ledger.export();
    assert.deepEqual(verifyBundle(bundle), online);
    assert.equal(bundle.integrity.valid, true);
    assert.equal(bundle.integrity.head, online.head);
    assert.equal(bundle.integrity.events, online.events);
  });
});

test('offline verification rejects an unsupported bundle schema version explicitly', async () => {
  await withLedger((ledger) => {
    const bundle = ledger.export();
    assert.throws(
      () => verifyBundle({ ...bundle, schema_version: 2 }),
      (error) => error?.code === 'LEDGER_BUNDLE_INCOMPATIBLE' && /schema_version 2/.test(error.message),
    );
  });
});
