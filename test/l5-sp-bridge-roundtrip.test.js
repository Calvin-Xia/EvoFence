import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('cp2 documented round trip runs verbatim with empty difference and zero ports', t => {
  const document = readFileSync(new URL('../docs/evofence-harness-kernel/L5-SP-BRIDGE-ROUNDTRIP.md', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const blocks = [...document.matchAll(/^```javascript\n([\s\S]*?)^```$/gm)];
  assert.equal(blocks.length, 1);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', blocks[0][1]], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(run.error, undefined); assert.equal(run.status, 0, run.stdout + run.stderr);
  const result = JSON.parse(run.stdout);
  assert.deepEqual(result.difference, []); assert.deepEqual(result.losses, []);
  assert.equal(result.portsParameter, 0, 'the documented example must prove the factory takes no ports');
  assert.deepEqual(result.edges, ['dependency']); assert.equal(result.executable, false);
  t.diagnostic(run.stdout.trim());
});
