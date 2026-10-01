import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Ledger } from '../dist/lib/ledger.js';
import { exportLegacy, importLegacy, FORMATS } from '../dist/storage/legacy/index.js';
import { canonical } from '../dist/kernel/store/index.js';

const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
function fixture(t) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'l5-legacy-export-'));
  t.after(() => rmSync(tmp, { recursive: true }));
  const old = path.join(tmp, 'old'), copies = path.join(tmp, 'copies'), archive = path.join(tmp, 'archive');
  for (const dir of [old, copies, archive]) mkdirSync(dir);
  const original = path.join(old, 'ledger.sqlite'), copied = path.join(copies, 'ledger.sqlite');
  const ledger = new Ledger(original);
  let bundle;
  try {
    ledger.append('run.started', 'old-run', { adapter: 'pi', text: '历史来源' });
    ledger.recordGeneration({ generation_id: 'old-generation', run_id: 'old-run', sha: 'a'.repeat(40),
      parent_sha: 'b'.repeat(40), created_at: '2026-09-30T00:00:00.000Z' });
    bundle = ledger.export();
  } finally { ledger.close(); }
  copyFileSync(original, copied);
  return { tmp, old, copies, archive, original, copied, bundle };
}
test('DoD1 originals and copied sources keep exact digests across export and import', t => {
  const f = fixture(t), before = hash(readFileSync(f.original)), copyBefore = hash(readFileSync(f.copied));
  const exported = unwrap(exportLegacy(f.copied, 'ledger-sqlite-v2'));
  const imported = unwrap(importLegacy(exported, f.archive, 1_780_000_000_000));
  assert.equal(hash(readFileSync(f.original)), before, 'original digest changed');
  assert.equal(hash(readFileSync(f.copied)), copyBefore, 'copied source digest changed');
  assert.equal(exported.source.digest, copyBefore);
  assert.equal(hash(Buffer.from(exported.originalBase64, 'base64')), copyBefore);
  assert.deepEqual(readdirSync(f.copies), ['ledger.sqlite'], 'export/import wrote a source sidecar');
  assert.equal(imported.disposition, 'imported');
  t.diagnostic(JSON.stringify({ originalBefore: before, originalAfter: hash(readFileSync(f.original)),
    copiedBefore: copyBefore, copiedAfter: hash(readFileSync(f.copied)), eventCount: exported.records.filter(r => r.kind === 'ledger-event').length }));
});
test('cp1 SQLite and bundle exports are stable and preserve raw payloads and recorded hashes', t => {
  const f = fixture(t), first = unwrap(exportLegacy(f.copied, 'ledger-sqlite-v2'));
  assert.equal(canonical(unwrap(exportLegacy(f.copied, 'ledger-sqlite-v2'))), canonical(first));
  assert.deepEqual(first.records.filter(r => r.kind === 'ledger-event').map(r => r.value.event_hash), f.bundle.events.map(e => e.event_hash));
  const file = path.join(f.copies, 'bundle.json'); writeFileSync(file, JSON.stringify(f.bundle));
  const exported = unwrap(exportLegacy(file, 'ledger-bundle-v1'));
  assert.deepEqual(exported.records.filter(r => r.kind === 'ledger-event').map(r => r.value), f.bundle.events);
  assert.equal(exported.classification, 'historical-source'); assert.equal(exported.executable, false);
});
test('DoD1 unknown SQLite version is explicitly refused with no source writes', t => {
  const f = fixture(t), db = new Database(f.copied);
  db.prepare("UPDATE state SET value='999' WHERE key='schema_version'").run(); db.close();
  const before = hash(readFileSync(f.copied)), result = exportLegacy(f.copied, 'ledger-sqlite-v2');
  assert.equal(result.ok, false, 'unknown SQLite version was accepted');
  assert.equal(result.error.code, 'EFK_PROTOCOL_UNSUPPORTED');
  assert.equal(hash(readFileSync(f.copied)), before);
});
test('cp1 unmarked v1, foreign tables, extra columns and unreadable SQLite are refused', t => {
  const f = fixture(t), db = new Database(f.copied);
  db.prepare("DELETE FROM state WHERE key='schema_version'").run(); db.close();
  assert.equal(exportLegacy(f.copied, 'ledger-sqlite-v2').error.code, 'EFK_PROTOCOL_UNSUPPORTED');
  copyFileSync(f.original, f.copied);
  const extra = new Database(f.copied); extra.exec('ALTER TABLE events ADD COLUMN future TEXT'); extra.close();
  assert.equal(exportLegacy(f.copied, 'ledger-sqlite-v2').error.code, 'EFK_SCHEMA_INVALID');
  const foreign = path.join(f.copies, 'foreign.sqlite'), other = new Database(foreign);
  other.exec('CREATE TABLE events(seq INTEGER)'); other.close();
  assert.equal(exportLegacy(foreign, 'ledger-sqlite-v2').error.code, 'EFK_SCHEMA_INVALID');
  writeFileSync(foreign, 'corrupt');
  assert.equal(exportLegacy(foreign, 'ledger-sqlite-v2').error.code, 'EFK_SCHEMA_INVALID');
});
test('cp1 WAL/journal snapshots and unavailable files are refused rather than silently losing data', t => {
  const f = fixture(t);
  for (const suffix of ['-wal', '-journal']) {
    const file = `${f.copied}${suffix}`; writeFileSync(file, 'unsettled');
    assert.equal(exportLegacy(f.copied, 'ledger-sqlite-v2').error.code, 'EFK_SOURCE_PIN_DRIFT'); rmSync(file);
  }
  assert.equal(exportLegacy(path.join(f.copies, 'missing'), 'config-yaml-v1').error.code, 'EFK_ARTIFACT_UNAVAILABLE');
  assert.equal(exportLegacy(f.copied, 'future-format').error.code, 'EFK_PROTOCOL_UNSUPPORTED');
});
test('cp1 all four YAML document formats are explicit, strict and preserve omitted defaults', t => {
  const f = fixture(t), contract = readFileSync(new URL('../templates/contract.yaml', import.meta.url), 'utf8');
  const inputs = [ ['contract-yaml-v1', contract], ['config-yaml-v1', 'version: 1\n'],
    ['holdout-validator-v2', 'regressions: []\n'], ['experiment-validator-v2', 'goal_file: goal.md\n'] ];
  for (const [format, input] of inputs) {
    const file = path.join(f.copies, `${format}.yaml`); writeFileSync(file, input);
    const exported = unwrap(exportLegacy(file, format));
    assert.equal(Buffer.from(exported.originalBase64, 'base64').toString(), input);
    assert.equal(exported.records.length, 1);
    assert.equal(hash(readFileSync(file)), exported.source.digest);
  }
  assert.equal(FORMATS.length, 6);
  const file = path.join(f.copies, 'minimal.yaml'); writeFileSync(file, contract.replace(/^  (per_command_timeout_ms|max_output_bytes):.*\r?\n/gm, ''));
  const value = unwrap(exportLegacy(file, 'contract-yaml-v1')).records[0].value;
  assert.equal(Object.hasOwn(value.evidence, 'per_command_timeout_ms'), false);
  assert.equal(Object.hasOwn(value.evidence, 'max_output_bytes'), false);
});
test('cp1 unknown YAML/bundle versions, unknown keys, duplicates and malformed input reject', t => {
  const f = fixture(t), file = path.join(f.copies, 'config.yaml');
  for (const [input, code] of [ ['version: 2\n', 'EFK_PROTOCOL_UNSUPPORTED'], ['{}', 'EFK_PROTOCOL_UNSUPPORTED'],
    ['version: 1\ntypo: true\n', 'EFK_SCHEMA_INVALID'], ['version: 1\nversion: 1\n', 'EFK_SCHEMA_INVALID'],
    ['version: [\n', 'EFK_SCHEMA_INVALID'] ]) {
    writeFileSync(file, input); assert.equal(exportLegacy(file, 'config-yaml-v1').error.code, code);
  }
  const bundleFile = path.join(f.copies, 'bundle.json');
  for (const [mutate, code] of [ [b => b.schema_version = 9, 'EFK_PROTOCOL_UNSUPPORTED'],
    [b => b.events[0].payload = { forged: true }, 'EFK_SCHEMA_INVALID'],
    [b => b.events[0].previous_hash = 'f'.repeat(64), 'EFK_SCHEMA_INVALID'],
    [b => b.integrity.valid = false, 'EFK_SCHEMA_INVALID'] ]) {
    const b = structuredClone(f.bundle); mutate(b); writeFileSync(bundleFile, JSON.stringify(b));
    assert.equal(exportLegacy(bundleFile, 'ledger-bundle-v1').error.code, code);
  }
  writeFileSync(bundleFile, '{'); assert.equal(exportLegacy(bundleFile, 'ledger-bundle-v1').error.code, 'EFK_SCHEMA_INVALID');
});
test('cp1 non-JSON YAML, cyclic aliases and invalid UTF-8 refuse without source mutation', t => {
  const f = fixture(t), file = path.join(f.copies, 'untrusted.yaml');
  for (const input of ['goal_file: x\niterations: .inf\n', 'goal_file: x\niterations: &a [*a]\n',
    Buffer.from([0x67, 0x6f, 0x61, 0x6c, 0x5f, 0x66, 0x69, 0x6c, 0x65, 0x3a, 0x20, 0xff])]) {
    writeFileSync(file, input); const before = hash(readFileSync(file));
    assert.equal(exportLegacy(file, 'experiment-validator-v2').error.code, 'EFK_SCHEMA_INVALID');
    assert.equal(hash(readFileSync(file)), before);
  }
});
