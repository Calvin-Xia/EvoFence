import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const controls = [
  { id: 'compatibility-bypass', dod: 'DoD1', module: 'compatibility', file: 'registry',
    title: 'DoD1 compatibility rejects host/model/repository/task/scope drift deterministically',
    edits: [['const allowed = revision.compatibility;', 'return true; const allowed = revision.compatibility;']] },
  { id: 'validated-autoactivation', dod: 'DoD2', module: 'qualification', file: 'registry',
    title: 'DoD2 validated never automatically activates; explicit promotion and scoped receipt are required',
    edits: [['const active = eligible &&', "const active = state === 'validated' || eligible &&"]] },
  { id: 'revocation-no-propagation', dod: 'DoD2', module: 'qualification', file: 'registry',
    title: 'DoD2 revocation propagates transitively and preserves every revision and prior event',
    edits: [['for (const dep of asset.dependencies)', 'for (const dep of [])'],
      ['const deps = revision.candidate.dependencies.map(', 'const deps = [].map(']] },
  { id: 'outside-write', dod: 'DoD2', module: 'writer', file: 'writer',
    title: 'DoD2 out-of-project writes reject traversal, absolute paths and sibling prefix tricks',
    edits: [["if (!inside(project, staging) || !inside(staging, parent) ||\n            readOnly.some(root => inside(root, staging) || inside(root, parent))) {", 'if (false) {']] },
  { id: 'history-erasure', dod: 'DoD2', module: 'registry', file: 'registry',
    title: 'DoD2 history survives revocation and revision replacement without erasing earlier observations',
    edits: [['history: [...snapshot.history, { ...event, sequence: snapshot.history.length }]',
      'history: [{ ...event, sequence: snapshot.history.length }]']] },
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function run(control, loader) {
  const args = ['--test', '--test-reporter=tap', `--test-name-pattern=${control.title}`, `test/l4-assets-${control.file}.test.js`];
  if (loader) args.unshift('--experimental-loader', pathToFileURL(loader).href);
  // A nested runner must not inherit the parent runner's binary IPC reporter context.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return { exit: result.status, tests: Number(result.stdout.match(/^# tests (\d+)$/m)?.[1]),
    pass: Number(result.stdout.match(/^# pass (\d+)$/m)?.[1]), fail: Number(result.stdout.match(/^# fail (\d+)$/m)?.[1]),
    stdout: result.stdout, stderr: result.stderr };
}
for (const control of controls) {
  test(`real mutation ${control.id}: green -> red -> restored green`, t => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'l4-assets-mutant-'));
    try {
      const file = path.join(root, `dist/learning/assets/${control.module}.js`), original = readFileSync(file);
      const loader = path.join(tmp, 'mutant.mjs');
      writeFileSync(loader, `export async function load(url, context, nextLoad) {
        const result = await nextLoad(url, context);
        if (!url.endsWith('/dist/learning/assets/${control.module}.js')) return result;
        let source = String(result.source);
        for (const [from, to] of ${JSON.stringify(control.edits)}) {
          if (source.split(from).length !== 2) throw Error('mutation site missing or duplicated');
          source = source.replace(from, to);
        }
        return { ...result, source };
      }`, 'utf8');
      const green = run(control), red = run(control, loader), restored = run(control);
      // Older supported Node runners include pattern-skipped cases in `tests`.
      assert.deepEqual([green.exit, green.pass, green.fail], [0, 1, 0]);
      assert.deepEqual([red.exit, red.pass, red.fail], [1, 0, 1]);
      assert.ok(red.stdout.includes(`not ok 1 - ${control.title}`), red.stdout + red.stderr);
      assert.ok(red.stdout.includes('AssertionError'), red.stdout + red.stderr);
      assert.deepEqual([restored.exit, restored.pass, restored.fail], [0, 1, 0]);
      assert.equal(green.tests, red.tests); assert.equal(green.tests, restored.tests);
      assert.equal(sha(readFileSync(file)), sha(original), 'dist file was changed by mutation execution');
      t.diagnostic(JSON.stringify({ id: control.id, dod: control.dod, module: control.module, edits: control.edits,
        test: control.title, green: [green.exit, green.tests, green.pass, green.fail],
        red: [red.exit, red.tests, red.pass, red.fail], restored: [restored.exit, restored.tests, restored.pass, restored.fail],
        distUnchanged: true }));
      t.diagnostic(red.stdout);
    } finally {
      // This directory is created by this test beneath tmp; no user files are cleaned.
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}
