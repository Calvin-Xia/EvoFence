import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mutations } from './mutations.mjs';
import { digest } from './fixtures.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'verification/kernel/evidence/mutations');
mkdirSync(output, { recursive: true });
const records = [];
const loader = new URL('./mutation-loader.mjs', import.meta.url).href;
function run(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8' });
  const output = result.stdout + result.stderr;
  return { command: ['node', ...args].join(' '), exit: result.status,
    tests: Number(output.match(/ℹ tests (\d+)/)[1]), pass: Number(output.match(/ℹ pass (\d+)/)[1]),
    fail: Number(output.match(/ℹ fail (\d+)/)[1]), output };
}
for (const m of mutations) {
  const args = ['--test', '--test-reporter=spec', '--test-name-pattern', m.pattern, m.testFile];
  const before = digest.digest(readFileSync(path.join(root, m.file)));
  const green = run(args, process.env);
  assert.equal(green.exit, 0, `baseline is not green: ${m.id}`);
  const red = run(['--loader', loader, ...args], { ...process.env, EFK_VERIFICATION_MUTATION: m.id });
  assert.equal(red.exit, 1, `mutant survived: ${m.id}`);
  assert.ok(red.fail > 0);
  assert.ok(red.output.includes(`[mutation-applied:${m.id}]`));
  assert.ok(!red.output.includes('mutation drift:'), 'loader syntax/count failure is not assertion evidence');
  assert.match(red.output, /AssertionError|ERR_ASSERTION/);
  const restored = run(args, process.env);
  assert.equal(restored.exit, 0, `restored run is not green: ${m.id}`);
  const after = digest.digest(readFileSync(path.join(root, m.file)));
  assert.equal(before, after, 'the on-disk build must remain untouched');
  for (const [label, result] of [['green', green], ['red', red], ['restored', restored]]) {
    writeFileSync(path.join(output, `${m.id}.${label}.txt`), result.output);
  }
  records.push({ ...m, environment: { EFK_VERIFICATION_MUTATION: m.id }, diskDigestBefore: before, diskDigestAfter: after,
    green, red, restored, fileWasModified: false });
  process.stdout.write(`${m.id}: green=${green.exit}/${green.pass} red=${red.exit}/${red.fail} restored=${restored.exit}/${restored.pass}\n`);
}
writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(records, null, 2)}\n`);
