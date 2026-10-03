import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { digest } from './fixtures.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = path.join(root, '.evofence/out/kernel-evidence');
const run = () => spawnSync(process.execPath, ['verification/kernel/run.mjs'], { cwd: root, encoding: 'utf8' });
const first = run();
assert.equal(first.status, 0, 'S05 requires all three checkpoints to pass');
writeFileSync(path.join(dir, 'run-command-1.stdout.txt'), first.stdout);
writeFileSync(path.join(dir, 'run-command-1.stderr.txt'), first.stderr);
const hashesBefore = JSON.parse(readFileSync(path.join(dir, 'repeatability.json'), 'utf8'));
const second = run();
assert.equal(second.status, 0);
writeFileSync(path.join(dir, 'run-command-2.stdout.txt'), second.stdout);
writeFileSync(path.join(dir, 'run-command-2.stderr.txt'), second.stderr);
const hashesAfter = JSON.parse(readFileSync(path.join(dir, 'repeatability.json'), 'utf8'));
// Compare original tracked bytes, before checkout line-ending conversion on Windows.
const archived = spawnSync('git', ['show', 'HEAD:verification/kernel/evidence/pre-fix/repeatability.json'], { cwd: root });
assert.equal(archived.status, 0, archived.stderr.toString());
const baseline = archived.stdout;
const current = readFileSync(path.join(dir, 'repeatability.json'));
assert.equal(baseline.compare(current), 0, 'STOP: trajectory summaries differ from the pre-fix baseline');
assert.equal(first.stdout, second.stdout, 'independent command summaries must match');
assert.deepEqual(hashesBefore, hashesAfter);
const tracePairs = readdirSync(dir).filter(n => n.endsWith('.run-1.json')).map(file => {
  const other = file.replace('.run-1.json', '.run-2.json');
  const a = readFileSync(path.join(dir, file)), b = readFileSync(path.join(dir, other));
  assert.equal(a.compare(b), 0);
  return { file, other, byteIdentical: true, diskDigest1: digest.digest(a), diskDigest2: digest.digest(b) };
});
const result = { command: 'node verification/kernel/run.mjs', run1Exit: first.status, run2Exit: second.status,
  explanation: 'S05 relocation resolved cp3; all checkpoints and trajectories pass.',
  preFixSummaryByteIdentical: true, preFixSummaryDigest: digest.digest(baseline), currentSummaryDigest: digest.digest(current),
  summaryByteIdentical: true, summaryDigest1: digest.digest(first.stdout), summaryDigest2: digest.digest(second.stdout), tracePairs };
writeFileSync(path.join(dir, 'command-repeatability.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(JSON.stringify({ run1Exit: first.status, run2Exit: second.status,
  identical: true, pairs: tracePairs.length, summaryDigest: result.summaryDigest1 }) + '\n');
