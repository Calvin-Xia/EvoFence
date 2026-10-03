import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BREAKING_CHANGES } from '../dist/storage/legacy/index.js';
import { COMMANDS } from '../dist/lib/cli/catalog.js';
import { documentSchema } from '../dist/lib/config/schema.js';

test('DoD2 breaking checklist covers every legacy command and every config group', () => {
  const keys = BREAKING_CHANGES.map(([key]) => key);
  assert.equal(new Set(keys).size, keys.length);
  const legacyCommands = COMMANDS.filter(command => command.namespace === undefined);
  for (const command of legacyCommands) assert.ok(keys.includes(`cli:${command.name}`), `missing breaking command: ${command.name}`);
  assert.deepEqual(keys.filter(key => key.startsWith('cli:') && key !== 'cli:flags').sort(),
    legacyCommands.map(command => `cli:${command.name}`).sort(), 'frozen legacy checklist must match exactly; native runtime surfaces are not legacy commands');
  for (const kind of ['contract', 'config', 'holdout', 'experiment']) {
    for (const field of Object.keys(documentSchema(kind).fields)) {
      assert.ok(keys.includes(`${kind}:${field}`), `missing breaking field group: ${kind}.${field}`);
    }
  }
  for (const group of ['schema_version', 'events', 'generations', 'state', 'chain', 'integrity']) {
    assert.ok(keys.includes(`ledger:${group}`), `missing ledger boundary: ${group}`);
  }
  assert.ok(keys.includes('cli:flags'));
});
test('cp3 README contains every breaking mapping, both upgrade choices and explicit recovery boundaries', () => {
  const readme = readFileSync(new URL('../src/storage/legacy/README.md', import.meta.url), 'utf8');
  for (const [key, replacement] of BREAKING_CHANGES) {
    assert.ok(readme.includes(`| \`${key}\` | ${replacement} |`), `missing or stale README mapping: ${key}`);
  }
  for (const phrase of ['继续使用旧版', '显式导入', '不重算', 'historical-source', '不进入 asset registry',
    '不冒充 journal', 'EFK_PROTOCOL_UNSUPPORTED', '.pending', 'fsync', '未证明']) assert.ok(readme.includes(phrase), phrase);
  assert.match(readme, /没有新增 CLI 命令/);
});
