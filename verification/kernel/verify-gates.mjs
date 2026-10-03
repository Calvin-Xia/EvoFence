import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { digest } from './fixtures.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, '.evofence/out/kernel-evidence/gates');
mkdirSync(output, { recursive: true });
function filesAt(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? filesAt(path.join(dir, e.name)) : [path.join(dir, e.name)]).sort();
}
const fingerprint = () => Object.fromEntries(filesAt(path.join(root, 'src')).map(p =>
  [path.relative(root, p).replaceAll('\\', '/'), digest.digest(readFileSync(p))]));
const before = fingerprint();
async function run(name, args) {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args,
    { cwd: root, shell: process.platform === 'win32', windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', error => { throw error; });
  const exit = await new Promise(resolve => child.on('close', resolve));
  writeFileSync(path.join(output, `${name}.stdout.txt`), stdout);
  writeFileSync(path.join(output, `${name}.stderr.txt`), stderr);
  const number = key => {
    const match = stdout.match(new RegExp(`(?:ℹ |# )${key} (\\d+)`));
    return match === null ? null : Number(match[1]);
  };
  const result = { command: `npm ${args.join(' ')}`, exit,
    tests: number('tests'), pass: number('pass'), fail: number('fail'), cancelled: number('cancelled'),
    stdout: `.evofence/out/kernel-evidence/gates/${name}.stdout.txt`, stderr: `.evofence/out/kernel-evidence/gates/${name}.stderr.txt` };
  process.stdout.write(`${result.command}: exit=${exit} tests=${result.tests} pass=${result.pass} fail=${result.fail}\n`);
  return result;
}
const results = [];
for (const gate of ['build', 'typecheck', 'src:policy', 'dep:check']) results.push(await run(gate.replace(':', '-'), ['run', gate]));
results.push(await run('test', ['test']));
const after = fingerprint();
const preservation = { sourceFiles: Object.keys(before).length, identical: JSON.stringify(before) === JSON.stringify(after), before, after };
writeFileSync(path.join(output, 'source-preservation.json'), `${JSON.stringify(preservation, null, 2)}\n`);
const newNames = readFileSync(path.join(output, 'test.stdout.txt'), 'utf8').split('\n')
  .filter(line => /kernel verify (cp[12]|boundary)/.test(line));
writeFileSync(path.join(output, 'results.json'), `${JSON.stringify({ results, addedTestNames: newNames,
  addedTests: 12, sourcePreserved: preservation.identical }, null, 2)}\n`);
process.exitCode = results.every(r => r.exit === 0) && preservation.identical ? 0 : 1;
