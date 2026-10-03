import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeJson } from './l3-pi-native-support.test.js';

export function runNegativeControls() {
const output = '.evofence/out/pi-evidence';
fs.mkdirSync(output, { recursive: true });
const source = 'src/hosts/pi/binding.ts', original = fs.readFileSync(source);
const hash = b => createHash('sha256').update(b).digest('hex');
function run(args) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return { command: [process.execPath, ...args], exit: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
}
const build = () => run(['node_modules/typescript/bin/tsc']);
const controls = [];
for (const c of [
  { dod: 'DoD1', id: 'dod1', name: 'remove native disk-backed session gate',
    from: 'manager.getSessionFile() === undefined', to: 'false', args: ['--memory-control'],
    check: 'nativeMemorySessionRefused', assertion: 'DoD1 rejects real native in-memory session' },
  { dod: 'DoD2', id: 'dod2', name: 'publish completed native receipt inside agent_end before continuation/settlement',
    from: 'active.ended = true;', to: "active.ended = true; record('receipt', active.authorized, makeReceipt(active, 'completed', null));", args: [],
    check: 'noEarlySettlement', assertion: 'DoD2 no receipt before native continuation/settlement' },
  { dod: 'DoD2', id: 'dod2-reentry', name: 'remove execute busy guard during awaited native settlement',
    from: "if (!isIdle()) return err(fail('EFK_HOST_REVISION_CONFLICT', 'Pi session is busy; dispatch only at an external safe point'));",
    to: '', args: [], check: 'settledReentryRefused', assertion: 'settledReentryRefused' },
  { dod: 'DoD2', id: 'dod2-context', name: 'invalidate node context packet at agent_end before native boundary continuation',
    from: 'active.ended = true;', to: 'active.ended = true; packet = [];', args: [],
    check: 'contextAndResources', assertion: 'contextAndResources' },
]) {
  assert.equal(original.toString().split(c.from).length, 2, 'mutation must have exactly one source location');
  const mutated = Buffer.from(original.toString().replace(c.from, c.to));
  const result = { ...c, evidenceGrade: 'native-fixture: actual Pi 0.99.2 SDK process, not hand-emitted hook events',
    originalSha256: hash(original), mutatedSha256: hash(mutated),
    redTrace: path.join(output, `0992-${c.id}-red.json`),
    greenTrace: path.join(output, `0992-${c.id}-green.json`) };
  try {
    fs.writeFileSync(source, mutated);
    result.build = build(); assert.equal(result.build.exit, 0);
    result.red = run(['test/l3-pi-native-session.test.js', '--probe', ...c.args,
      `--output=${result.redTrace}`]);
    assert.equal(result.red.exit, 1, 'actual native process must fail the mutated contract');
    assert(result.red.stderr.includes(c.assertion), 'red must fail the specific contract assertion');
    const red = JSON.parse(fs.readFileSync(result.redTrace, 'utf8'));
    assert.equal(red.checks[c.check], false); assert.equal(red.paidRequests, 0);
    assert.equal(red.sourceHashes.find(h => h.file === source).sha256, result.mutatedSha256);
  } finally {
    fs.writeFileSync(source, original);
    result.restoredSha256 = hash(fs.readFileSync(source)); assert.equal(result.restoredSha256, result.originalSha256);
    result.rebuild = build(); assert.equal(result.rebuild.exit, 0);
  }
  result.green = run(['test/l3-pi-native-session.test.js', '--probe', ...c.args,
    `--output=${result.greenTrace}`]);
  assert.equal(result.green.exit, 0, 'restored native process must pass');
  const green = JSON.parse(fs.readFileSync(result.greenTrace, 'utf8'));
  assert.equal(green.checks[c.check], true); assert.equal(green.paidRequests, 0);
  assert.equal(green.sourceHashes.find(h => h.file === source).sha256, result.restoredSha256);
  controls.push(result);
  const sourceHashes = ['test/l3-pi-negative-controls.test.js', 'test/l3-pi-native-session.test.js',
    'test/l3-pi-native-support.test.js', source].map(file => ({ file, sha256: hash(fs.readFileSync(file)) }));
  writeJson(path.join(output, '0992-negative-controls.json'), { recordedAt: new Date().toISOString(), controls, paidRequests: 0, sourceHashes });
}
console.log(JSON.stringify(controls.map(c => ({ dod: c.dod, id: c.id, check: c.check, red: c.red.exit, green: c.green.exit, restored: c.originalSha256 === c.restoredSha256 }))));
}
if (process.argv.includes('--mutate')) runNegativeControls();
