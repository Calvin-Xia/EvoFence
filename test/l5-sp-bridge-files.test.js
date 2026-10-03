import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, linkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { fixture, witnesses, value } from './l5-sp-bridge-fixture.test.js';

function temporary(action) {
  const root = mkdtempSync(path.join(tmpdir(), 'efk-sp-files-'));
  try { return action(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
test('cp3 graph truth paths are denied before any source read', () => temporary(root => {
  const { bridge, calls } = witnesses(), { bindings } = fixture();
  for (const file of [path.join(root, '.graph', 'nodes', 'n1.yaml'), path.join(root, '.GRAPH', 'x.yaml'),
    root + path.sep + '.graph' + path.sep + '..' + path.sep + 'copy.yaml']) {
    const result = bridge.importFile(file, { root }, bindings);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'EFK_AUTHORITY_DENIED');
  }
  assert.deepEqual(calls, { hostPort: 0, journal: 0, decisions: 0, grants: 0, claims: 0 });
}));
test('cp3 ignored input output and rerooted scopes are denied with source bytes preserved', () => temporary(root => {
  const { delivery, bindings } = fixture(), { bridge } = witnesses();
  const old = path.join(root, 'old-sp'); mkdirSync(old);
  const file = path.join(old, 'snapshot.yaml'); writeFileSync(file, stringify(delivery));
  const before = readFileSync(file);
  writeFileSync(path.join(root, '.gitignore'), '/old-sp/\r\n!old-sp/snapshot.yaml\r\n');
  for (const scope of [{ root }, { root: old }]) {
    assert.equal(bridge.importFile(file, scope, bindings).error.code, 'EFK_AUTHORITY_DENIED');
    const packet = value(bridge.importData(delivery, bindings));
    assert.equal(bridge.exportFile(packet, path.join(old, 'new.yaml'), scope).error.code, 'EFK_AUTHORITY_DENIED');
  }
  assert.deepEqual(readFileSync(file), before);
}));
test('cp2 YAML file round trip is read only and import export ports remain unused', () => temporary(root => {
  const { delivery, bindings } = fixture(), { bridge, calls } = witnesses();
  const source = path.join(root, 'snapshot.yaml'), output = path.join(root, 'export.yaml');
  writeFileSync(source, stringify(delivery).replace(/\n/g, '\r\n')); const original = readFileSync(source);
  const packet = value(bridge.importFile(source, { root }, bindings));
  value(bridge.exportFile(packet, output, { root }));
  assert.deepEqual(value(bridge.importFile(output, { root }, bindings)), packet);
  assert.deepEqual(readFileSync(source), original);
  assert.deepEqual(calls, { hostPort: 0, journal: 0, decisions: 0, grants: 0, claims: 0 });
}));
test('cp3 ignore wildcards and zero-directory double-star patterns cannot bypass refusal', () => temporary(root => {
  const { delivery, bindings } = fixture(), { bridge } = witnesses();
  const directory = path.join(root, 'old-x'); mkdirSync(directory);
  const file = path.join(directory, 'copy.yaml'); writeFileSync(file, stringify(delivery));
  for (const pattern of ['/old-?/', '**/old-?/', 'old-*/', '[old]/']) {
    writeFileSync(path.join(root, '.gitignore'), pattern + '\n');
    assert.equal(bridge.importFile(file, { root }, bindings).error.code, 'EFK_AUTHORITY_DENIED', pattern);
  }
}));
test('cp3 export never rewrites source existing output or hardlink alias', () => temporary(root => {
  const { delivery, bindings } = fixture(), { bridge } = witnesses();
  const source = path.join(root, 'source.yaml'), alias = path.join(root, 'alias.yaml');
  writeFileSync(source, stringify(delivery)); linkSync(source, alias);
  const packet = value(bridge.importFile(source, { root }, bindings)), before = readFileSync(source);
  for (const file of [source, alias]) assert.equal(bridge.exportFile(packet, file, { root }).ok, false);
  assert.deepEqual(readFileSync(source), before); assert.deepEqual(readFileSync(alias), before);
  assert.equal(bridge.exportFile(packet, path.join(root, '.graph', 'x.yaml'), { root }).error.code, 'EFK_AUTHORITY_DENIED');
}));
test('cp3 path escapes relative paths directories and directory links are denied', () => temporary(root => {
  const { delivery, bindings } = fixture(), { bridge } = witnesses();
  const source = path.join(root, 'source.yaml'); writeFileSync(source, stringify(delivery));
  const scope = path.join(root, 'scope'); mkdirSync(scope);
  assert.equal(bridge.importFile(source, { root: scope }, bindings).error.code, 'EFK_AUTHORITY_DENIED');
  assert.equal(bridge.importFile('source.yaml', { root }, bindings).error.code, 'EFK_AUTHORITY_DENIED');
  assert.equal(bridge.importFile(scope, { root }, bindings).error.code, 'EFK_AUTHORITY_DENIED');
  const alias = path.join(root, 'directory-alias'); symlinkSync(scope, alias, 'junction');
  assert.equal(bridge.importFile(path.join(alias, 'source.yaml'), { root }, bindings).error.code, 'EFK_AUTHORITY_DENIED');
}));
test('cp1 malformed YAML duplicate keys invalid UTF8 and aliases fail explicitly', () => temporary(root => {
  const { bindings } = fixture(), { bridge } = witnesses(), file = path.join(root, 'bad.yaml');
  for (const data of ['format: [', 'format: a\nformat: b\n', 'x: &a [*a]\n', Buffer.from([0xff, 0xfe])]) {
    writeFileSync(file, data); const before = readFileSync(file), result = bridge.importFile(file, { root }, bindings);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'EFK_SCHEMA_INVALID'); assert.deepEqual(readFileSync(file), before);
  }
}));
