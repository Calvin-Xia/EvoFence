// Build first, then run mutations and newline conversion only in an owned snapshot.
// Example: node scripts/verify-ci-environment.mjs --node <node.exe> --snapshot-root <D: temp>
//   --temp-root <C: short-name temp> --line-endings crlf --output .evofence/out/ci-probe
//
// Audit G09/G23: this script used to be referenced by nothing while being the only skip-sensitive
// check in the repository. `--skips` is the mode CI runs (through `npm run check:skips`): it asserts
// the test-skip baseline still matches, so a newly hidden skip fails the gate instead of passing
// silently as "skipped".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSkipGate } from './test-skips.mjs';

if (process.argv.includes('--skips')) {
  process.exit(runSkipGate({ update: process.argv.includes('--update') }));
}

const root = fileURLToPath(new URL('../', import.meta.url));
const options = { node: process.execPath, 'snapshot-root': os.tmpdir(), 'temp-root': os.tmpdir(),
  'line-endings': 'lf', output: path.join(root, '.evofence/out/ci-environment') };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, ''), value = process.argv[i + 1];
  if (!Object.hasOwn(options, key) || value === undefined) throw new Error('Unknown or missing option: ' + process.argv[i]);
  options[key] = value;
}
if (!['lf', 'crlf'].includes(options['line-endings'])) throw new Error('--line-endings must be lf or crlf');
for (const key of ['snapshot-root', 'temp-root']) {
  if (!path.isAbsolute(options[key]) || !fs.statSync(options[key]).isDirectory()) throw new Error(key + ' must be an existing absolute directory');
}
const output = path.resolve(options.output), outputRelative = path.relative(path.join(root, '.evofence/out'), output);
if (path.isAbsolute(outputRelative) || outputRelative === '..' || outputRelative.startsWith('..' + path.sep)) {
  throw new Error('--output must be inside the checkout .evofence/out');
}
fs.mkdirSync(output, { recursive: true });
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const env = { ...process.env, TEMP: options['temp-root'], TMP: options['temp-root'], TMPDIR: options['temp-root'] };
delete env.NODE_TEST_CONTEXT;
const build = spawnSync(options.node, [path.join(root, 'node_modules/typescript/bin/tsc')],
  { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
fs.writeFileSync(path.join(output, 'build.log'), (build.stdout ?? '') + (build.stderr ?? ''));
if (build.error || build.status !== 0) throw new Error('Fresh build failed: ' + build.error + ' ' + build.stderr);

const snapshot = fs.mkdtempSync(path.join(options['snapshot-root'], 'evofence-ci-environment-'));
for (const directory of ['dist', 'test', 'templates']) {
  fs.cpSync(path.join(root, directory), path.join(snapshot, directory), { recursive: true,
    filter: source => !path.relative(root, source).split(path.sep).includes('.work') });
}
fs.copyFileSync(path.join(root, 'package.json'), path.join(snapshot, 'package.json'));
fs.mkdirSync(path.join(snapshot, 'src/storage/legacy'), { recursive: true });
fs.copyFileSync(path.join(root, 'src/storage/legacy/README.md'), path.join(snapshot, 'src/storage/legacy/README.md'));
fs.mkdirSync(path.join(snapshot, 'scripts/probes'), { recursive: true });
fs.copyFileSync(path.join(root, 'scripts/probes/loader-support.mjs'), path.join(snapshot, 'scripts/probes/loader-support.mjs'));
fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules')), path.join(snapshot, 'node_modules'),
  process.platform === 'win32' ? 'junction' : 'dir');
const distFiles = [];
function rewrite(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) rewrite(target);
    else if (/\.(?:js|mjs)$/.test(entry.name)) {
      const lf = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
      fs.writeFileSync(target, options['line-endings'] === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf);
      if (path.relative(snapshot, target).startsWith('dist' + path.sep)) distFiles.push(target);
    }
  }
}
rewrite(path.join(snapshot, 'dist')); rewrite(path.join(snapshot, 'test'));
const before = Object.fromEntries(distFiles.map(file => [path.relative(snapshot, file), sha(file)]));
const files = ['l4-assets-registry', 'l4-assets-writer', 'l4-assets-negative-controls',
  'l4-retrieval-context', 'l4-retrieval-rejection', 'l4-retrieval-selection', 'l4-retrieval-negative-controls',
  'l5-legacy-checklist', 'l5-legacy-export', 'l5-legacy-import', 'l5-legacy-negative-controls']
  .map(name => `test/${name}.test.js`);
const result = spawnSync(options.node, ['--test', '--test-reporter=tap', ...files],
  { cwd: snapshot, env, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
fs.writeFileSync(path.join(output, 'tests.tap'), (result.stdout ?? '') + (result.stderr ?? ''));
const counts = {};
for (const key of ['tests', 'pass', 'fail', 'skipped', 'cancelled']) {
  const value = result.stdout?.match(new RegExp('^# ' + key + ' (\\d+)\\r?$', 'm'))?.[1];
  if (value !== undefined) counts[key] = Number(value);
}
const changedDist = distFiles.filter(file => before[path.relative(snapshot, file)] !== sha(file)).map(file => path.relative(snapshot, file));
const relativeTemp = path.relative(snapshot, options['temp-root']);
const nativeVersion = spawnSync(options.node, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
const record = { node: nativeVersion, snapshot, fixtureTemp: options['temp-root'],
  fixtureTempRealpath: fs.realpathSync.native(options['temp-root']), relativeTemp, crossDrive: path.isAbsolute(relativeTemp),
  usesAlias: options['temp-root'].toLowerCase() !== fs.realpathSync.native(options['temp-root']).toLowerCase(),
  lineEndings: options['line-endings'], buildExit: build.status, exit: result.status, counts,
  emittedModules: distFiles.length, changedDist, runtimeError: result.error?.message ?? null,
  cleanup: 'Owned snapshots are retained for review; tests remove only their own fixture subdirectories.' };
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record));
process.exitCode = result.error || result.status !== 0 || counts.tests === undefined || counts.fail !== 0
  || counts.skipped !== 0 || changedDist.length !== 0 ? 1 : 0;
