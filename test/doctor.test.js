import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function spawnDoctor(args) {
  return spawnSync(process.execPath, [CLI, 'doctor', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120000,
  });
}

test('doctor JSON output exposes the per-check skeleton', () => {
  const result = spawnDoctor(['--json']);
  assert.equal(result.status, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.ok(Array.isArray(document.checks));
  assert.ok(document.checks.length > 0);
  for (const check of document.checks) {
    assert.deepEqual(Object.keys(check).sort(), ['code', 'id', 'label', 'remediation', 'status']);
    assert.equal(typeof check.id, 'string');
    assert.equal(typeof check.label, 'string');
    assert.ok(['ok', 'refused'].includes(check.status));
    assert.equal(check.code, null);
    assert.equal(typeof check.remediation, 'string');
  }
});

test('doctor text output is one readable line per check', () => {
  const result = spawnDoctor([]);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trimEnd().split('\n');
  assert.ok(lines.length > 0);
  for (const line of lines) assert.match(line, /^(OK|REFUSED) [^:]+: .+/);
});

test('doctor accepts the shared adapter flag', () => {
  const result = spawnDoctor(['--adapter=codex', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
});
