import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Ledger, verifyBundle } from '../dist/lib/ledger.js';
import { eventHash, verifyChain } from '../dist/lib/ledger/chain.js';
import { runProcess } from '../dist/lib/process.js';

const ZERO_HASH = '0'.repeat(64);

async function withLedger(body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-ledger-bundle-'));
  const ledger = new Ledger(path.join(directory, 'ledger.sqlite'));
  try {
    ledger.append('run.started', 'run-bundle', { adapter: 'codex' });
    ledger.append('candidate.accepted', 'run-bundle', { iteration: 1, generation_id: 'g1' });
    ledger.append('run.finished', 'run-bundle', { status: 'PLATEAU', iterations: 1 });
    return await body(ledger);
  } finally {
    ledger.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function copyBundle(bundle) {
  return {
    ...bundle,
    integrity: { ...bundle.integrity },
    events: bundle.events.map((event) => ({ ...event })),
  };
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

test('ledger verify --bundle reads only the bundle and preserves failure output', async () => {
  await withLedger(async (ledger) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'evofence-ledger-bundle-cli-'));
    try {
      const bundle = ledger.export();
      await writeFile(path.join(root, 'bundle.json'), `${JSON.stringify(bundle)}\n`);
      const cliPath = path.resolve(import.meta.dirname, '..', 'dist', 'cli.js');
      const healthy = await runProcess(
        process.execPath,
        [cliPath, 'ledger', 'verify', '--bundle', 'bundle.json', '--json'],
        { cwd: root, timeoutMs: 10000, maxOutputBytes: 100000 },
      );
      assert.equal(healthy.code, 0, healthy.stderr);
      assert.deepEqual(JSON.parse(healthy.stdout), bundle.integrity);
      assert.equal(healthy.stderr, '');

      const broken = copyBundle(bundle);
      broken.events[1].event_hash = 'b'.repeat(64);
      await writeFile(path.join(root, 'broken.json'), `${JSON.stringify(broken)}\n`);
      const invalid = await runProcess(
        process.execPath,
        [cliPath, 'ledger', 'verify', '--bundle=broken.json'],
        { cwd: root, timeoutMs: 10000, maxOutputBytes: 100000 },
      );
      assert.equal(invalid.code, 1);
      assert.deepEqual(JSON.parse(invalid.stdout), verifyChain(broken.events));
      assert.equal(invalid.stderr, '');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('offline verification localizes bundle tampering like the online verifier', async () => {
  await withLedger((ledger) => {
    const source = ledger.export();
    const cases = [
      {
        name: 'payload_json',
        sequence: 2,
        expected_previous_hash: source.events[0].event_hash,
        observed_hash: source.events[1].event_hash,
        mutate(bundle) {
          bundle.events[1].payload_json = '{"status":"FORGED"}';
        },
      },
      {
        name: 'event_hash',
        sequence: 2,
        expected_previous_hash: source.events[0].event_hash,
        observed_hash: 'b'.repeat(64),
        mutate(bundle) {
          bundle.events[1].event_hash = 'b'.repeat(64);
        },
      },
      {
        name: 'deleted middle event',
        sequence: 3,
        expected_previous_hash: source.events[0].event_hash,
        observed_hash: source.events[2].event_hash,
        mutate(bundle) {
          bundle.events.splice(1, 1);
        },
      },
      {
        name: 'reordered events',
        sequence: 3,
        expected_previous_hash: source.events[0].event_hash,
        observed_hash: source.events[2].event_hash,
        mutate(bundle) {
          [bundle.events[1], bundle.events[2]] = [bundle.events[2], bundle.events[1]];
        },
      },
      {
        name: 'non-zero genesis previous_hash',
        sequence: 1,
        expected_previous_hash: ZERO_HASH,
        mutate(bundle) {
          const first = bundle.events[0];
          first.previous_hash = 'a'.repeat(64);
          first.event_hash = eventHash(first);
          this.observed_hash = first.event_hash;
        },
      },
    ];

    for (const tamperCase of cases) {
      const tampered = copyBundle(source);
      tamperCase.mutate(tampered);
      const online = verifyChain(tampered.events);
      assert.deepEqual(online, {
        valid: false,
        sequence: tamperCase.sequence,
        expected_previous_hash: tamperCase.expected_previous_hash,
        observed_hash: tamperCase.observed_hash,
      }, `${tamperCase.name} online location`);
      assert.deepEqual(verifyBundle(tampered), online, `${tamperCase.name} offline location`);
    }
  });
});
