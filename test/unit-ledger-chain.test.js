// Negative oracles for the ledger hash chain (`src/lib/ledger/chain.ts` → `verifyChain`).
//
// Why this file exists (node `l3_tests_unit`, DoD 3): the 0.3.0 oracles DO cover tampering, but
// only through one door each — `spec-f1`/`spec-f2`/`spec-f3` rewrite `payload_json`/`created_at`
// (or recompute a forged chain) and then assert `LEDGER_CORRUPT` at the CLI / `report.integrity`.
// None of them:
//   * rewrites `previous_hash` on its own and asserts the LINK-expected value;
//   * rewrites `event_hash` and asserts the observed digest;
//   * deletes a row to open a `seq` gap (the contiguity check);
//   * asserts the failure-location fields (`sequence`, `expected_previous_hash`,
//     `observed_hash`) with exact values instead of `typeof ... === 'string'`.
// These cases pin all three `verifyChain` checks and its machine-readable failure report, at
// both the library and the `ledger verify` CLI boundary.
//
// ADR-0004: imports point at the build output (`dist/`); `npm test` builds first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256, stableStringify } from '../dist/lib/fs.js';
import { Ledger, ledgerPath } from '../dist/lib/ledger.js';
import { runProcess } from '../dist/lib/process.js';

const ZERO_HASH = '0'.repeat(64);

/** Open a scratch ledger, append a fixed three-event history, and return its file path. */
async function seededLedger(directory) {
  const filename = path.join(directory, 'ledger.sqlite');
  const ledger = new Ledger(filename);
  try {
    ledger.append('run.started', 'run-a', { adapter: 'codex' });
    ledger.append('candidate.accepted', 'run-a', { iteration: 1, generation_id: 'g1' });
    ledger.append('run.finished', 'run-a', { status: 'ACCEPTED', iterations: 1 });
  } finally {
    ledger.close();
  }
  return filename;
}

/** Read the raw `events` rows (read-only; never triggers the append-only UPDATE trigger). */
function eventRows(filename) {
  const ledger = new Ledger(filename, { readOnly: true });
  try {
    return ledger.db.prepare('SELECT * FROM events ORDER BY seq').all();
  } finally {
    ledger.close();
  }
}

/**
 * Rewrite the ledger behind the append-only triggers, exactly like an out-of-band tamperer
 * would. `mutate` receives the raw sqlite handle.
 */
function tamper(filename, mutate) {
  const ledger = new Ledger(filename);
  try {
    ledger.db.exec('DROP TRIGGER IF EXISTS events_no_update');
    ledger.db.exec('DROP TRIGGER IF EXISTS events_no_delete');
    mutate(ledger.db);
  } finally {
    ledger.close();
  }
}

function verify(filename) {
  const ledger = new Ledger(filename);
  try {
    return ledger.verify();
  } finally {
    ledger.close();
  }
}

/**
 * Re-derive the frozen digest recipe (`docs/refactor-inventory.md` §4.4) for one row, taking the
 * row's CURRENT columns. A tamperer who recomputes the digest can make a row internally
 * consistent while its `previous_hash` still links to the wrong predecessor — that is the only
 * way to reach `verifyChain`'s second (link) check in isolation.
 */
function rehashRow(row, previousHash) {
  return sha256(stableStringify({
    seq: row.seq,
    created_at: row.created_at,
    event_type: row.event_type,
    run_id: row.run_id,
    payload_json: row.payload_json,
    previous_hash: previousHash,
  }));
}

async function withScratchDirectory(prefix, body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('verify() reports the contiguous chain head for an intact ledger', async () => {
  await withScratchDirectory('evofence-chain-intact-', async (directory) => {
    const filename = await seededLedger(directory);
    const rows = eventRows(filename);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.seq), [1, 2, 3]);
    assert.equal(rows[0].previous_hash, ZERO_HASH, 'the first event links to the zero hash');
    assert.equal(rows[1].previous_hash, rows[0].event_hash);
    assert.equal(rows[2].previous_hash, rows[1].event_hash);
    assert.deepEqual(verify(filename), { valid: true, events: 3, head: rows[2].event_hash });
  });
});

test('the append-only triggers refuse an event UPDATE and DELETE before any tampering', async () => {
  await withScratchDirectory('evofence-chain-triggers-', async (directory) => {
    const filename = await seededLedger(directory);
    const ledger = new Ledger(filename);
    try {
      // The UPDATE trigger is the one 0.3.0 pinned; the DELETE trigger opens the seq-gap case
      // below, so both are asserted here (every tamper case drops them explicitly).
      assert.throws(() => ledger.db.prepare("UPDATE events SET event_type = 'forged' WHERE seq = 2").run(), /append-only/);
      assert.throws(() => ledger.db.prepare('DELETE FROM events WHERE seq = 2').run(), /append-only/);
    } finally {
      ledger.close();
    }
    assert.equal(verify(filename).valid, true, 'a refused write must leave the chain intact');
    assert.equal(eventRows(filename).length, 3);
  });
});

test('verify() localizes a payload_json rewrite without parsing the payload', async () => {
  await withScratchDirectory('evofence-chain-payload-', async (directory) => {
    const filename = await seededLedger(directory);
    const before = eventRows(filename);
    tamper(filename, (db) => {
      db.prepare('UPDATE events SET payload_json = ? WHERE seq = 2').run('{"iteration": not-json');
    });

    const report = verify(filename);
    assert.equal(report.valid, false);
    assert.equal(report.sequence, 2, 'the first rewritten row must be the reported location');
    assert.equal(report.expected_previous_hash, before[0].event_hash, 'the link still points at the real predecessor');
    assert.equal(report.observed_hash, before[1].event_hash, 'the row event_hash itself was not rewritten');
    assert.equal(report.events, undefined, 'an invalid report carries no chain head');

    // Malformed JSON must not make verify() throw: it hashes the raw column, it never parses.
    assert.equal(eventRows(filename)[1].payload_json, '{"iteration": not-json');
  });
});

test('verify() rejects a naive previous_hash rewrite whose stored digest no longer matches', async () => {
  await withScratchDirectory('evofence-chain-naive-link-', async (directory) => {
    const filename = await seededLedger(directory);
    const before = eventRows(filename);
    tamper(filename, (db) => {
      db.prepare('UPDATE events SET previous_hash = ? WHERE seq = 2').run('f'.repeat(64));
    });

    // Editing previous_hash without rehashing the row breaks the DIGEST check, which is the
    // first check that fires. The location is still reported against the edited row.
    const report = verify(filename);
    assert.equal(report.valid, false);
    assert.equal(report.sequence, 2);
    assert.equal(report.expected_previous_hash, before[0].event_hash);
    assert.equal(report.observed_hash, before[1].event_hash, 'the stored digest is untouched, so it is echoed as-is');
    const after = eventRows(filename);
    assert.equal(after[1].previous_hash, 'f'.repeat(64));
    assert.equal(after[0].event_hash, before[0].event_hash, 'the visible predecessor is untouched');
  });
});

test('verify() rejects a rehashed row that links to the wrong predecessor', async () => {
  await withScratchDirectory('evofence-chain-forged-link-', async (directory) => {
    const filename = await seededLedger(directory);
    const before = eventRows(filename);
    const forgedLink = 'f'.repeat(64);
    assert.notEqual(before[0].event_hash, forgedLink);

    // Rewrite the link AND recompute the row digest, so the row is internally consistent and the
    // DIGEST check passes. Only the LINK check can catch this.
    tamper(filename, (db) => {
      const row = db.prepare('SELECT * FROM events WHERE seq = 2').get();
      db.prepare('UPDATE events SET previous_hash = ?, event_hash = ? WHERE seq = 2')
        .run(forgedLink, rehashRow({ ...row, previous_hash: forgedLink }, forgedLink));
    });

    const report = verify(filename);
    assert.equal(report.valid, false);
    assert.equal(report.sequence, 2, 'the digest is self-consistent, so only the link can be wrong');
    assert.equal(report.expected_previous_hash, before[0].event_hash, 'the chain expected the real predecessor digest');
    assert.notEqual(report.observed_hash, before[1].event_hash, 'the rehashed digest is echoed');

    // Proof the row digest itself now verifies against the forged link: check 3 passes in isolation.
    const after = eventRows(filename)[1];
    assert.equal(after.previous_hash, forgedLink);
    assert.equal(rehashRow(after, forgedLink), after.event_hash);
  });
});

test('verify() requires the first event to link to the zero hash even when it is rehashed', async () => {
  await withScratchDirectory('evofence-chain-genesis-', async (directory) => {
    const filename = await seededLedger(directory);
    const before = eventRows(filename);
    const forgedLink = 'a'.repeat(64);
    tamper(filename, (db) => {
      const row = db.prepare('SELECT * FROM events WHERE seq = 1').get();
      db.prepare('UPDATE events SET previous_hash = ?, event_hash = ? WHERE seq = 1')
        .run(forgedLink, rehashRow({ ...row, previous_hash: forgedLink }, forgedLink));
    });

    const report = verify(filename);
    assert.equal(report.valid, false);
    assert.equal(report.sequence, 1);
    assert.equal(report.expected_previous_hash, ZERO_HASH, 'the genesis row must link to the zero hash');
    assert.notEqual(report.observed_hash, before[0].event_hash);
  });
});

test('verify() rejects a rewritten event_hash and echoes the observed digest', async () => {
  await withScratchDirectory('evofence-chain-digest-', async (directory) => {
    const filename = await seededLedger(directory);
    const before = eventRows(filename);
    const forgedDigest = 'b'.repeat(64);
    tamper(filename, (db) => {
      db.prepare('UPDATE events SET event_hash = ? WHERE seq = 2').run(forgedDigest);
    });

    const report = verify(filename);
    assert.equal(report.valid, false);
    assert.equal(report.sequence, 2);
    assert.equal(report.expected_previous_hash, before[0].event_hash);
    assert.equal(report.observed_hash, forgedDigest);
  });
});

test('verify() detects a deleted row as a sequence gap before it checks the chain', async () => {
  await withScratchDirectory('evofence-chain-delete-', async (directory) => {
    const filename = await seededLedger(directory);
    const before = eventRows(filename);
    tamper(filename, (db) => {
      db.prepare('DELETE FROM events WHERE seq = 2').run();
    });

    const after = eventRows(filename);
    assert.deepEqual(after.map((row) => row.seq), [1, 3], 'seq is no longer contiguous');
    const report = verify(filename);
    assert.equal(report.valid, false);
    assert.equal(report.sequence, 3, 'the gap is reported at the row that follows it');
    assert.equal(report.expected_previous_hash, before[0].event_hash);
    assert.equal(report.observed_hash, before[2].event_hash);
  });
});

test('verify() detects a non-contiguous seq even when the row is rehashed and its link is intact', async () => {
  await withScratchDirectory('evofence-chain-seqgap-', async (directory) => {
    const filename = await seededLedger(directory);
    const before = eventRows(filename);

    // Move the last row to seq 5, keep its link to the real predecessor (rows[1]) and recompute its
    // digest. Link and digest both verify, so ONLY the contiguity check can catch this.
    tamper(filename, (db) => {
      const row = db.prepare('SELECT * FROM events WHERE seq = 3').get();
      const moved = { ...row, seq: 5, previous_hash: before[1].event_hash };
      db.prepare('UPDATE events SET seq = 5, previous_hash = ?, event_hash = ? WHERE seq = 3')
        .run(moved.previous_hash, rehashRow(moved, moved.previous_hash));
    });

    const report = verify(filename);
    assert.equal(report.valid, false);
    assert.equal(report.sequence, 5, 'the gap is reported at the out-of-order row');
    assert.equal(report.expected_previous_hash, before[1].event_hash, 'the link was left intact');
    assert.notEqual(report.observed_hash, before[2].event_hash);

    // Proof the moved row is internally consistent: its digest verifies against its own link.
    const after = eventRows(filename)[2];
    assert.equal(after.seq, 5);
    assert.equal(rehashRow(after, before[1].event_hash), after.event_hash);
  });
});

test('CLI ledger verify prints the chain head and exits 0 for an intact ledger', async () => {
  await withScratchDirectory('evofence-chain-cli-ok-', async (directory) => {
    const root = path.join(directory, 'repo');
    await mkdir(path.join(root, '.evofence'), { recursive: true });
    assert.equal((await runProcess('git', ['init', '--quiet'], { cwd: root, timeoutMs: 30000, maxOutputBytes: 10000 })).code, 0);

    const ledger = new Ledger(ledgerPath(root));
    try {
      ledger.append('run.started', 'run-a', { adapter: 'codex' });
      ledger.append('run.finished', 'run-a', { status: 'PLATEAU', iterations: 1 });
    } finally {
      ledger.close();
    }
    const rows = eventRows(ledgerPath(root));
    const cliPath = path.resolve(import.meta.dirname, '..', 'dist', 'cli.js');
    const result = await runProcess(process.execPath, [cliPath, 'ledger', 'verify'], { cwd: root, timeoutMs: 60000, maxOutputBytes: 100000 });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { valid: true, events: 2, head: rows[1].event_hash });
    assert.equal(result.stderr, '');
  });
});

test('CLI ledger verify exits 1 and prints the failing sequence for a rewritten previous_hash', async () => {
  await withScratchDirectory('evofence-chain-cli-broken-', async (directory) => {
    const root = path.join(directory, 'repo');
    await mkdir(path.join(root, '.evofence'), { recursive: true });
    assert.equal((await runProcess('git', ['init', '--quiet'], { cwd: root, timeoutMs: 30000, maxOutputBytes: 10000 })).code, 0);

    const ledger = new Ledger(ledgerPath(root));
    try {
      ledger.append('run.started', 'run-a', { adapter: 'codex' });
      ledger.append('candidate.accepted', 'run-a', { iteration: 1, generation_id: 'g1' });
      ledger.append('run.finished', 'run-a', { status: 'ACCEPTED', iterations: 1 });
    } finally {
      ledger.close();
    }
    const before = eventRows(ledgerPath(root));
    tamper(ledgerPath(root), (db) => {
      db.prepare('UPDATE events SET previous_hash = ? WHERE seq = 2').run('f'.repeat(64));
    });

    const cliPath = path.resolve(import.meta.dirname, '..', 'dist', 'cli.js');
    const result = await runProcess(process.execPath, [cliPath, 'ledger', 'verify'], { cwd: root, timeoutMs: 60000, maxOutputBytes: 100000 });
    assert.equal(result.code, 1, 'a broken chain must exit non-zero');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      sequence: 2,
      expected_previous_hash: before[0].event_hash,
      observed_hash: before[1].event_hash,
    });
    assert.equal(result.stderr, '');
  });
});
