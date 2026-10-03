import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readPackInventory, verifyPackedFiles } from '../scripts/verify-release-metadata.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const inventory = readPackInventory(root);

test('cp1: actual npm dry-run packs every typed export and bin, with zero private paths', () => {
  assert.equal(inventory.name, pkg.name);
  assert.equal(inventory.version, pkg.version);
  const result = verifyPackedFiles({ pkg, files: inventory.files });
  assert.equal(result.exports, Object.keys(pkg.exports).length);
  assert.equal(result.privateEntries, 0);
  assert.equal(result.entries, inventory.entryCount);
  assert.equal(existsSync(path.join(root, inventory.filename)), false, 'dry-run must not write a tarball');
  console.log(`cp1 pack: ${result.entries} entries / ${result.exports} exports / 0 private`);
});

test('cp1 negative: adding execution or scenarios to files is refused even when the directory is empty', () => {
  for (const forbidden of ['docs/evofence-harness-kernel/execution/', 'scenarios/']) {
    assert.throws(() => verifyPackedFiles({ pkg: { ...pkg, files: [...pkg.files, forbidden] }, files: inventory.files }),
      /frozen publish allowlist/);
  }
});

test('cp1 negative: every forbidden path and uncompiled TypeScript source is refused', () => {
  for (const forbidden of [
    '.evofence/private/key', 'docs/evofence-harness-kernel/execution/log.md',
    'scenarios/pi/run.mjs', 'experiments/capability/run.mjs', 'dist/hosts/pi/evidence/usage.js',
    'dist/private/credentials.js', '.graph/events.jsonl', 'dist/runtime/source.ts',
    'dist/ledger.sqlite', 'node_modules/yaml/index.js', 'dist/../secret.js', '/dist/index.js',
  ]) {
    assert.throws(() => verifyPackedFiles({ pkg, files: [...inventory.files, { path: forbidden }] }),
      /private\/generated|built artifacts only|non-canonical|unexpected/, forbidden);
  }
});

test('cp1 negative: deleting any export target or required document fails closed', () => {
  const required = new Set(['dist/cli.js', 'README.md', 'README.en.md', 'LICENSE', 'CHANGELOG.md',
    ...Object.values(pkg.exports).flatMap(entry => Object.values(entry).map(p => p.replace(/^\.\//, '')))]);
  for (const target of required) {
    assert.throws(() => verifyPackedFiles({ pkg, files: inventory.files.filter(entry => entry.path !== target) }),
      /missing/, target);
  }
});

test('cp1: package, lock and installed dependency metadata agree without installing', () => {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  const require = createRequire(import.meta.url);
  for (const name of ['better-sqlite3', 'yaml']) {
    const metadata = require(`${name}/package.json`);
    assert.equal(metadata.version, lock.packages[`node_modules/${name}`].version);
    assert.ok(require(name), `existing installed dependency loads: ${name}`);
  }
  assert.throws(() => verifyPackedFiles({ pkg: { ...pkg, dependencies: { ...pkg.dependencies, extra: '1' } },
    files: inventory.files }), /runtime dependencies/);
});
