import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { testLoaderArgs, namedTapFailure } from '../scripts/probes/loader-support.mjs';
import { digest } from './l4-experience-fixtures.test.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const controls = [
  { id: 'train-partition-bypass', module: 'trace', file: 'trace',
    title: 'cp1 train-only inputs refuse dev/not-evaluation and missing visibility or scope',
    from: "if (selection.ref.partition !== 'train')", to: 'if (false)' },
  { id: 'fabricated-counterexample', module: 'candidate', file: 'candidate',
    title: 'cp3 refuses fabricated source lines, cross-pattern support and success disguised as a counterexample',
    from: '!pattern.failures.some(actual => canonical(actual) === canonical(counter.event))', to: 'false' },
  { id: 'single-success-generalization', module: 'candidate', file: 'trace',
    title: 'cp1 separates host/model/task scopes and never turns a single success into a candidate',
    from: 'p.successes.length > 0 && p.failures.length > 0', to: 'p.successes.length > 0' },
  { id: 'actual-cost-bound-bypass', module: 'generation', file: 'candidate',
    title: 'cp3 actual overspend and token overflow stay metered but prevent staging',
    from: 'settlement.micros > experience.limits.maxGenerationMicros', to: 'false' },
];

function run(control, loader) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [...testLoaderArgs(loader), '--test', '--test-reporter=tap',
    `--test-name-pattern=${control.title}`, `test/l4-experience-${control.file}.test.js`],
  { cwd: root, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return { exit: result.status, pass: Number(result.stdout.match(/^# pass (\d+)$/m)?.[1]),
    fail: Number(result.stdout.match(/^# fail (\d+)$/m)?.[1]), stdout: result.stdout, stderr: result.stderr };
}

for (const control of controls) test(`real implementation mutation ${control.id}: green -> red -> byte-restored green`, t => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'l4-experience-mutation-'));
  try {
    const originalPath = path.join(root, `dist/learning/proposals/${control.module}.js`);
    const original = readFileSync(originalPath), source = original.toString('utf8');
    assert.equal(source.split(control.from).length, 2, 'one exact implementation mutation site');
    const copy = path.join(temp, 'implementation.js'), loader = path.join(temp, 'loader.mjs');
    // Override one built module with a physical byte copy; every dependency and test remains real.
    writeFileSync(loader, `import { readFile } from 'node:fs/promises';
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  return url.endsWith('/dist/learning/proposals/${control.module}.js')
    ? { ...result, source: await readFile(${JSON.stringify(copy)}) } : result;
}
`);
    writeFileSync(copy, original);
    const green = run(control, loader);
    writeFileSync(copy, source.replace(control.from, control.to));
    const mutantDigest = digest.digest(readFileSync(copy, 'utf8'));
    const red = run(control, loader);
    writeFileSync(copy, original); // Actual byte restoration of the loaded implementation, not a test flag.
    assert.deepEqual(readFileSync(copy), original);
    const restored = run(control, loader);
    assert.deepEqual([green.exit, green.pass, green.fail], [0, 1, 0], green.stdout + green.stderr);
    assert.deepEqual([red.exit, red.pass, red.fail], [1, 0, 1], red.stdout + red.stderr);
    assert.ok(namedTapFailure(red.stdout, control.title), red.stdout + red.stderr);
    assert.ok(red.stdout.includes('AssertionError'), red.stdout + red.stderr);
    assert.deepEqual([restored.exit, restored.pass, restored.fail], [0, 1, 0], restored.stdout + restored.stderr);
    assert.deepEqual(readFileSync(originalPath), original);
    t.diagnostic(JSON.stringify({ id: control.id, file: `dist/learning/proposals/${control.module}.js`,
      mutation: [control.from, control.to], test: control.title, mutantDigest,
      restoredDigest: digest.digest(readFileSync(copy, 'utf8')), originalDigest: digest.digest(source),
      green: [green.exit, green.pass, green.fail], red: [red.exit, red.pass, red.fail],
      restored: [restored.exit, restored.pass, restored.fail], restoredByteIdentical: true, originalDistUnchanged: true }));
  } finally {
    const resolved = realpathSync(temp), base = realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), base); assert.ok(path.basename(resolved).startsWith('l4-experience-mutation-'));
    rmSync(resolved, { recursive: true, force: true });
  }
});
