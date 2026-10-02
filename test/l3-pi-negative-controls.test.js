import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeJson } from './l3-pi-native-support.test.js';

export function runNegativeControls() {
const source = 'src/hosts/pi/binding.ts', original = fs.readFileSync(source);
const hash = b => createHash('sha256').update(b).digest('hex');
function run(args) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return { command: [process.execPath, ...args], exit: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
}
const build = () => run(['node_modules/typescript/bin/tsc']);
const controls = [];
for (const c of [
  { dod: 'DoD1', name: 'remove native disk-backed session gate', from: 'manager.getSessionFile() === undefined', to: 'false', args: ['--memory-control'] },
  { dod: 'DoD2', name: 'publish completed native receipt inside agent_end before continuation/settlement',
    from: 'active.ended = true;', to: "active.ended = true; record('receipt', active.authorized, makeReceipt(active, 'completed', null));", args: [] },
]) {
  assert(original.toString().includes(c.from));
  const mutated = Buffer.from(original.toString().replace(c.from, c.to));
  const result = { ...c, evidenceGrade: 'native-fixture: actual Pi 0.99.2 SDK process, not hand-emitted hook events',
    originalSha256: hash(original), mutatedSha256: hash(mutated) };
  try {
    fs.writeFileSync(source, mutated);
    result.build = build(); assert.equal(result.build.exit, 0);
    result.red = run(['test/l3-pi-native-session.test.js', '--probe', ...c.args,
      `--output=src/hosts/pi/evidence/0992-${c.dod.toLowerCase()}-red.json`]);
    assert.equal(result.red.exit, 1, 'actual native process must fail the mutated contract');
  } finally { fs.writeFileSync(source, original); }
  result.restoredSha256 = hash(fs.readFileSync(source)); assert.equal(result.restoredSha256, result.originalSha256);
  result.rebuild = build(); assert.equal(result.rebuild.exit, 0);
  result.green = run(['test/l3-pi-native-session.test.js', '--probe', ...c.args,
    `--output=src/hosts/pi/evidence/0992-${c.dod.toLowerCase()}-green.json`]);
  assert.equal(result.green.exit, 0, 'restored native process must pass');
  controls.push(result);
  writeJson('src/hosts/pi/evidence/0992-negative-controls.json', { recordedAt: new Date().toISOString(), controls, paidRequests: 0 });
}
console.log(JSON.stringify(controls.map(c => ({ dod: c.dod, red: c.red.exit, green: c.green.exit, restored: c.originalSha256 === c.restoredSha256 }))));
}
if (process.argv.includes('--mutate')) runNegativeControls();
