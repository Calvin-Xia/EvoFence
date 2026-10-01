import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ledger } from '../dist/lib/ledger.js';
import { exportLegacy, importLegacy, readHistoricalImport, SOURCE_PROTOCOL, SOURCE_DIRECTORY, IMPORTER_VERSION } from '../dist/storage/legacy/index.js';
import { createMemoryEventStore, createMemoryArtifactStore } from '../dist/storage/index.js';
import { emptyRegistry, stageRevision } from '../dist/learning/assets/index.js';
import { decode } from '../dist/protocol/index.js';
import { canonical } from '../dist/kernel/store/index.js';

const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const unwrap = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
function fixture(t, ledger = false) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'l5-legacy-import-'));
  t.after(() => rmSync(tmp, { recursive: true }));
  const sourceDir = path.join(tmp, 'source'), archive = path.join(tmp, 'archive');
  mkdirSync(sourceDir); mkdirSync(archive);
  const file = path.join(sourceDir, ledger ? 'ledger.sqlite' : 'config.yaml');
  if (ledger) {
    const db = new Ledger(file);
    try { db.append('candidate.accepted', 'old-run', { accepted: true }); } finally { db.close(); }
  } else writeFileSync(file, 'version: 1\n');
  const bundle = unwrap(exportLegacy(file, ledger ? 'ledger-sqlite-v2' : 'config-yaml-v1'));
  return { tmp, sourceDir, archive, file, bundle };
}
test('cp2 import is idempotent with per-record source digest, time and importer version', t => {
  const f = fixture(t, true), before = hash(readFileSync(f.file));
  const first = unwrap(importLegacy(f.bundle, f.archive, 100)), repeated = unwrap(importLegacy(f.bundle, f.archive, 200));
  assert.deepEqual([first.disposition, repeated.disposition], ['imported', 'duplicate']);
  assert.deepEqual(repeated.archive, first.archive, 'retry changed first import provenance');
  assert.deepEqual(first.archive.protocol, SOURCE_PROTOCOL);
  for (const r of first.archive.records) assert.deepEqual(r.provenance, { sourceDigest: before,
    sourceFile: f.bundle.source.file, sourceFormat: 'ledger-sqlite-v2', importedAt: 100,
    importerVersion: IMPORTER_VERSION, classification: 'historical-source' });
  assert.deepEqual(unwrap(readHistoricalImport(first.file)), first.archive);
  assert.equal(hash(readFileSync(f.file)), before);
  assert.deepEqual(readdirSync(path.dirname(first.file)), [path.basename(first.file)]);
});
test('cp2 all six formats import independently and remain readable without the old source', t => {
  const f = fixture(t, true), exports = [f.bundle];
  const events = f.bundle.records.filter(r => r.kind === 'ledger-event').map(r => ({ ...r.value, payload: JSON.parse(r.value.payload_json) }));
  const bundle = { schema_version: 1, events, generations: [], active_generation: null,
    integrity: { valid: true, events: events.length, head: events.at(-1).event_hash } };
  const files = [ ['ledger-bundle-v1', JSON.stringify(bundle)],
    ['contract-yaml-v1', readFileSync(new URL('../templates/contract.yaml', import.meta.url), 'utf8')],
    ['config-yaml-v1', 'version: 1\n'], ['holdout-validator-v2', 'regressions: []\n'],
    ['experiment-validator-v2', 'goal_file: goal.md\n'] ];
  for (const [format, bytes] of files) {
    const file = path.join(f.sourceDir, format); writeFileSync(file, bytes);
    exports.push(unwrap(exportLegacy(file, format)));
  }
  const ids = new Set();
  for (const exported of exports) {
    const result = unwrap(importLegacy(exported, f.archive, 444)); ids.add(result.archive.importId);
    assert.equal(hash(readFileSync(exported.source.file)), exported.source.digest);
    rmSync(exported.source.file);
    assert.deepEqual(unwrap(readHistoricalImport(result.file)), result.archive);
    assert.equal(unwrap(importLegacy(exported, f.archive, 555)).disposition, 'duplicate');
    for (const record of result.archive.records) {
      assert.equal(record.executable, false); assert.equal(record.provenance.sourceFormat, exported.source.format);
    }
  }
  assert.equal(ids.size, 6);
});
test('DoD2 old accepted ledger remains historical and cannot enter journal or asset qualification', t => {
  const f = fixture(t, true), digest = { digest: hash }, store = createMemoryEventStore({ digest });
  const artifacts = createMemoryArtifactStore({ digest }), registry = emptyRegistry();
  const imported = unwrap(importLegacy(f.bundle, f.archive, 123));
  for (const record of imported.archive.records) {
    assert.equal(record.executable, false, 'old history was marked as execution evidence');
    assert.equal(record.provenance.classification, 'historical-source');
    for (const kind of ['Event', 'Receipt', 'TaskEvidenceReport', 'CapabilityAsset', 'ArtifactRef']) {
      assert.equal(decode(kind, record).ok, false, `${kind} accepted historical record`);
      assert.equal(decode(kind, record.value).ok, false, `${kind} accepted an old ledger row`);
    }
  }
  const oldEvent = imported.archive.records.find(r => r.kind === 'ledger-event');
  assert.equal(oldEvent.value.event_type, 'candidate.accepted');
  assert.equal(store.createSession({ protocol: imported.archive.protocol, sessionId: 'forged', epoch: 1 }).ok, false);
  assert.equal(stageRevision(registry, imported.archive, { digest, artifacts }).ok, false);
  assert.deepEqual(store.sessionIds(), []); assert.deepEqual(artifacts.ids(), []);
  assert.deepEqual(registry, emptyRegistry());
});
test('cp2 tampered export bytes, records, versions and execution flags reject before creating state', t => {
  const f = fixture(t);
  for (const [mutate, code] of [ [b => b.protocol.schemaVersion = '9.0.0', 'EFK_PROTOCOL_UNSUPPORTED'],
    [b => b.originalBase64 = Buffer.from('version: 2\n').toString('base64'), 'EFK_ARTIFACT_DIGEST_MISMATCH'],
    [b => b.records[0].value.version = 999, 'EFK_ARTIFACT_DIGEST_MISMATCH'],
    [b => b.executable = true, 'EFK_LEGACY_NOT_EXECUTABLE'],
    [b => b.newField = true, 'EFK_SCHEMA_INVALID'] ]) {
    const bundle = structuredClone(f.bundle); mutate(bundle);
    assert.equal(importLegacy(bundle, f.archive, 123).error.code, code);
    assert.deepEqual(readdirSync(f.archive), []);
  }
  assert.equal(importLegacy(f.bundle, f.archive, -1).error.code, 'EFK_SCHEMA_INVALID');
});
test('cp2 immutable conflicts and damaged archive retry fail without replacement', t => {
  const f = fixture(t), first = unwrap(importLegacy(f.bundle, f.archive, 123));
  const firstBytes = readFileSync(first.file);
  const alternate = path.join(f.sourceDir, 'same.yaml'); copyFileSync(f.file, alternate);
  const bundle = unwrap(exportLegacy(alternate, 'config-yaml-v1'));
  assert.equal(importLegacy(bundle, f.archive, 200).error.code, 'EFK_IDEMPOTENCY_COLLISION');
  assert.deepEqual(readFileSync(first.file), firstBytes);
  writeFileSync(first.file, '{incomplete'); const damaged = readFileSync(first.file);
  assert.equal(importLegacy(f.bundle, f.archive, 200).error.code, 'EFK_SCHEMA_INVALID');
  assert.deepEqual(readFileSync(first.file), damaged);
});
test('cp2 restart reuses a committed archive and ignores interrupted pending files', t => {
  const f = fixture(t), first = unwrap(importLegacy(f.bundle, f.archive, 123));
  const pending = `${first.file}.interrupted.pending`; writeFileSync(pending, '{half-written');
  const bytes = readFileSync(first.file); rmSync(first.file);
  const restarted = unwrap(importLegacy(JSON.parse(JSON.stringify(f.bundle)), f.archive, 124));
  assert.equal(restarted.disposition, 'imported');
  assert.equal(unwrap(readHistoricalImport(restarted.file)).records[0].provenance.importedAt, 124);
  assert.equal(readFileSync(pending, 'utf8'), '{half-written');
  writeFileSync(first.file, bytes);
  assert.equal(unwrap(importLegacy(f.bundle, f.archive, 300)).disposition, 'duplicate');
});
test('cp2 actual process termination before publication recovers through explicit retry', t => {
  const f = fixture(t), root = fileURLToPath(new URL('../', import.meta.url));
  const loader = path.join(f.tmp, 'interrupt.mjs'), input = path.join(f.tmp, 'input.json');
  const module = path.join(root, 'dist/storage/legacy/importer.js'), before = hash(readFileSync(module));
  writeFileSync(input, JSON.stringify(f.bundle));
  writeFileSync(loader, `export async function load(url, context, nextLoad) {
    const result = await nextLoad(url, context);
    if (!url.endsWith('/dist/storage/legacy/importer.js')) return result;
    const from = 'linkSync(staging, file);', source = String(result.source);
    if (source.split(from).length !== 2) throw Error('termination injection site absent');
    return { ...result, source: source.replace(from, 'process.exit(73);') };
  }`);
  const script = `import { readFileSync } from 'node:fs';
    import { importLegacy } from './dist/storage/legacy/importer.js';
    importLegacy(JSON.parse(readFileSync(process.argv[1], 'utf8')), process.argv[2], 111);`;
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const killed = spawnSync(process.execPath, ['--experimental-loader', pathToFileURL(loader).href,
    '--input-type=module', '-e', script, input, f.archive], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
  assert.equal(killed.error, undefined); assert.equal(killed.status, 73, killed.stdout + killed.stderr);
  const namespace = path.join(f.archive, SOURCE_DIRECTORY), interrupted = readdirSync(namespace);
  assert.equal(interrupted.length, 1); assert.ok(interrupted[0].endsWith('.pending'));
  const retry = unwrap(importLegacy(f.bundle, f.archive, 222));
  assert.equal(retry.disposition, 'imported');
  assert.equal(unwrap(readHistoricalImport(retry.file)).records[0].provenance.importedAt, 222);
  assert.equal(unwrap(importLegacy(f.bundle, f.archive, 333)).disposition, 'duplicate');
  assert.equal(hash(readFileSync(module)), before);
  assert.equal(hash(readFileSync(f.file)), f.bundle.source.digest);
  t.diagnostic(JSON.stringify({ phase: 'after-fsync-before-link', exit: killed.status, pendingCount: interrupted.length,
    retry: retry.disposition, moduleUnchanged: true, sourceUnchanged: true }));
});
test('cp3 source directory, namespace links and source hardlinks never become write targets', t => {
  const f = fixture(t), before = hash(readFileSync(f.file));
  assert.equal(importLegacy(f.bundle, f.sourceDir, 123).error.code, 'EFK_AUTHORITY_DENIED');
  assert.deepEqual(readdirSync(f.sourceDir), ['config.yaml']);
  const namespace = path.join(f.archive, SOURCE_DIRECTORY);
  symlinkSync(f.sourceDir, namespace, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(importLegacy(f.bundle, f.archive, 123).error.code, 'EFK_AUTHORITY_DENIED');
  if (process.platform === 'win32') rmdirSync(namespace); else unlinkSync(namespace);
  mkdirSync(namespace);
  const id = hash(`${f.bundle.source.format}\n${f.bundle.source.digest}`).slice(7), destination = path.join(namespace, `${id}.json`);
  linkSync(f.file, destination);
  assert.equal(importLegacy(f.bundle, f.archive, 123).error.code, 'EFK_SCHEMA_INVALID');
  assert.equal(hash(readFileSync(f.file)), before); assert.equal(hash(readFileSync(destination)), before);
});
test('cp3 altered per-record provenance and execution metadata are refused on archive read', t => {
  const f = fixture(t), first = unwrap(importLegacy(f.bundle, f.archive, 123));
  for (const mutate of [a => a.records[0].executable = true, a => a.records[0].provenance.sourceDigest = hash('forged'),
    a => a.records[0].provenance.importerVersion = 'future', a => a.records[0].kind = 'Event']) {
    const archive = structuredClone(first.archive); mutate(archive); writeFileSync(first.file, canonical(archive));
    assert.equal(readHistoricalImport(first.file).error.code, 'EFK_LEGACY_NOT_EXECUTABLE');
  }
  const future = structuredClone(first.archive); future.protocol.namespace = 'evofence.legacy-source/2';
  writeFileSync(first.file, JSON.stringify(future));
  assert.equal(readHistoricalImport(first.file).error.code, 'EFK_PROTOCOL_UNSUPPORTED');
});
