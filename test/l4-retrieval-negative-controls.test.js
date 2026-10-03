import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { testLoaderArgs, namedTapFailure } from '../scripts/probes/loader-support.mjs';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const controls = [
  { id: 'qualification-bypass', dod: 'DoD1', file: 'selection',
    title: 'DoD1 qualification rejects unverified and metadata-mismatched experience before material reads',
    from: 'if (!q.ok || !q.value.eligible)', to: 'if (!q.ok)' },
  { id: 'revocation-bypass', dod: 'DoD1', file: 'rejection',
    title: 'cp3 revocation propagation removes transitive dependents on the next retrieval without stale injection',
    from: 'if (!q.ok || !q.value.eligible)', to: 'if (!q.ok)' },
  { id: 'empty-injection', dod: 'DoD2', file: 'context',
    title: 'DoD2 empty registry returns exact base execution with reproducible non-free overhead',
    from: "mode: assets.length === 0 ? 'base' : 'candidate'", to: "mode: 'candidate'" },
  { id: 'unaccounted-overhead', dod: 'DoD2', file: 'context',
    title: 'DoD2 empty registry returns exact base execution with reproducible non-free overhead',
    from: 'materialReads, materialCodeUnits, tokenizerCalls, tokensCounted, modelRequests:',
    to: 'materialReads, materialCodeUnits, tokenizerCalls: 0, tokensCounted: 0, modelRequests:' },
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function run(control, loader) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const args = ['--test', '--test-reporter=tap', `--test-name-pattern=${control.title}`,
    `test/l4-retrieval-${control.file}.test.js`];
  if (loader) args.unshift(...testLoaderArgs(loader));
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return { exit: result.status, tests: Number(result.stdout.match(/^# tests (\d+)$/m)?.[1]),
    pass: Number(result.stdout.match(/^# pass (\d+)$/m)?.[1]), fail: Number(result.stdout.match(/^# fail (\d+)$/m)?.[1]),
    stdout: result.stdout, stderr: result.stderr };
}
for (const control of controls) {
  test(`real mutation ${control.id}: green -> red -> restored green`, t => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'l4-retrieval-mutant-'));
    try {
      const file = path.join(root, 'dist/learning/retrieval/retrieve.js'), original = readFileSync(file);
      const loader = path.join(tmp, 'mutant.mjs');
      writeFileSync(loader, `export async function load(url, context, nextLoad) {
        const result = await nextLoad(url, context);
        if (!url.endsWith('/dist/learning/retrieval/retrieve.js')) return result;
        // Normalize only the in-memory injection source; raw dist bytes stay pinned.
        const source = String(result.source).replace(/\\r\\n/g, '\\n'), from = ${JSON.stringify(control.from)};
        if (source.split(from).length !== 2) throw Error('mutation site missing or duplicated');
        return { ...result, source: source.replace(from, ${JSON.stringify(control.to)}) };
      }`, 'utf8');
      const green = run(control), red = run(control, loader), restored = run(control);
      assert.deepEqual([green.exit, green.pass, green.fail], [0, 1, 0]);
      assert.deepEqual([red.exit, red.pass, red.fail], [1, 0, 1], red.stdout + red.stderr);
      assert.ok(red.stdout.includes('AssertionError'), red.stdout + red.stderr);
      assert.ok(namedTapFailure(red.stdout, control.title), red.stdout + red.stderr);
      assert.deepEqual([restored.exit, restored.pass, restored.fail], [0, 1, 0]);
      assert.equal(green.tests, red.tests); assert.equal(green.tests, restored.tests);
      assert.equal(sha(readFileSync(file)), sha(original));
      t.diagnostic(JSON.stringify({ id: control.id, dod: control.dod, module: 'retrieval/retrieve',
        mutation: [control.from, control.to], test: control.title,
        green: [green.exit, green.tests, green.pass, green.fail], red: [red.exit, red.tests, red.pass, red.fail],
        restored: [restored.exit, restored.tests, restored.pass, restored.fail], distUnchanged: true }));
      t.diagnostic(red.stdout);
    } finally {
      // Remove only the test-owned directory, after checking its resolved containment in tmp.
      const resolved = realpathSync(tmp), base = realpathSync(os.tmpdir());
      assert.equal(path.dirname(resolved), base);
      assert.ok(path.basename(resolved).startsWith('l4-retrieval-mutant-'));
      rmSync(resolved, { recursive: true, force: true });
    }
  });
}
