import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeJson } from './l3-pi-native-support.test.js';

export function runGates() {
const gates = [];
function run(name, args) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const result = { name, command: [process.execPath, ...args], exit: r.status, stdout: r.stdout, stderr: r.stderr };
  gates.push(result); assert.equal(r.status, 0, `${name}\n${r.stdout}\n${r.stderr}`); return result;
}
const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
run('npm run build', ['node_modules/typescript/bin/tsc']);
run('npm run typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']);
for (const name of ['src:policy', 'dep:check']) {
  const command = scripts[name].split(' '); assert.equal(command[0], 'node');
  run(`npm run ${name}`, command.slice(1));
}
for (const name of ['test:first', 'test:second']) {
  const r = run(name, ['--test', '--test-reporter=tap', 'test/l3-pi-*.test.js']);
  r.tests = Number(r.stdout.match(/# tests (\d+)/)[1]); r.pass = Number(r.stdout.match(/# pass (\d+)/)[1]);
  r.fail = Number(r.stdout.match(/# fail (\d+)/)[1]);
}
const first = gates.find(g => g.name === 'test:first'), second = gates.find(g => g.name === 'test:second');
assert.equal(first.tests, second.tests); assert.equal(first.pass, second.pass); assert.equal(first.fail, 0);
const audit = run('static-audit', ['verification/kernel/static-audit.mjs']);
const parsed = JSON.parse(audit.stdout); assert.equal(parsed.violations.length, 0);
audit.violations = parsed.violations.length;
writeJson('src/hosts/pi/evidence/0992-static-audit.json', parsed);
const hashes = ['src/hosts/pi/binding.ts', 'src/hosts/pi/types.ts', 'src/hosts/pi/usage.ts', 'src/hosts/pi/entries.ts',
  'src/hosts/pi/capabilities.ts', 'src/hosts/pi/index.ts', 'test/l3-pi-native-session.test.js', 'test/l3-pi-native-support.test.js',
  'test/l3-pi-native.test.js', 'test/l3-pi-negative-controls.test.js', 'test/l3-pi-gates.test.js',
  'docs/evofence-harness-kernel/probes/pi/VERSION-PIN.json'].map(file => ({ file,
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
writeJson('src/hosts/pi/evidence/0992-gates.json', { recordedAt: new Date().toISOString(),
  invocationNote: 'Direct node argv execute exactly package.json npm script bodies, avoiding shell quoting; test follows this build',
  gates, sourceHashes: hashes });
console.log(JSON.stringify(gates.map(g => ({ name: g.name, exit: g.exit, tests: g.tests, pass: g.pass, fail: g.fail, violations: g.violations }))));
}
if (process.argv.includes('--gates')) runGates();
