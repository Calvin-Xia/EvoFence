/** Real source mutations, fresh builds, red/restore/green; no mutation survives this script. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const results = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined);
  return { command: ['node', ...args].join(' '), exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}
function build() {
  const result = run(['node_modules/typescript/bin/tsc']);
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
}
const mutations = [
  { dod: 'DoD1', file: 'src/hosts/dsh/binding.ts', test: 'DoD1: same native session continues and resumes',
    before: "source === 'resume' ? runtime.open(request) : runtime.create(request)",
    after: "source === 'resume' ? runtime.open({ ...request, sessionId: 'mutated-resume' }) : runtime.create(request)" },
  { dod: 'DoD2', file: 'src/hosts/dsh/health.ts', test: 'DoD2: observation hook failure durably pauses',
    before: "if (state.value.dispatchMode !== 'active') return;",
    after: "if (state.value.dispatchMode === 'active') return;" },
];
for (const mutation of mutations) {
  const filename = path.join(root, mutation.file), original = fs.readFileSync(filename, 'utf8');
  assert.equal(original.split(mutation.before).length, 2, 'mutation point must be unique');
  const command = ['--test', `--test-name-pattern=${mutation.test}`, 'test/l3-dsh-session.test.js'];
  build();
  const baseline = run(command); assert.equal(baseline.exitCode, 0);
  let red;
  try {
    fs.writeFileSync(filename, original.replace(mutation.before, mutation.after));
    build(); red = run(command);
    assert.equal(red.exitCode, 1, 'mutation must turn the behavioural test red');
    assert.match(red.stdout, /fail 1/);
  } finally { fs.writeFileSync(filename, original); build(); }
  const green = run(command); assert.equal(green.exitCode, 0); assert.match(green.stdout, /fail 0/);
  const restoredSha256 = hash(fs.readFileSync(filename)); assert.equal(restoredSha256, hash(original));
  results.push({ ...mutation, originalSha256: hash(original), restoredSha256, baseline, red, green });
}
const report = { evidenceLevel: 'fault-injection-on-native-fixture', version: '0.2.0-rc.2', results };
fs.writeFileSync(path.join(root, 'integrations/deepseek-harness/evidence/negative-controls.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(results.map(r => ({ dod: r.dod, baseline: r.baseline.exitCode, mutated: r.red.exitCode, restored: r.green.exitCode, sourceRestored: r.originalSha256 === r.restoredSha256 }))));
