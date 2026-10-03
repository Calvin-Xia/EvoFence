// Explicit mutation command only; the regular suite never mutates source/build output.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--run')) {
  const evidence = [];
  const run = args => {
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000 });
    assert.ifError(r.error); return { exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const mutation of [
    { checkpoint: 'cp1', file: 'src/hosts/pi/delegation-records.ts',
      original: 'const derived = delegate(grant, plan.request, options.clock.now());',
      replacement: 'const derived = delegate({ ...grant, scope: plan.request.scope }, plan.request, options.clock.now());',
      test: 'cp1 refuses scope escalation before native child creation' },
    { checkpoint: 'cp3', file: 'src/hosts/pi/delegation.ts',
      original: 'if (recorded !== undefined) return recorded.receipt !== null',
      replacement: "if (recorded !== undefined && recorded.phase === 'prepared') return recorded.receipt !== null",
      test: 'cp3 dispatched record never creates another child or repeats a provider request' },
  ]) {
    const before = fs.readFileSync(mutation.file), text = before.toString('utf8');
    assert.equal(text.split(mutation.original).length, 2, 'exactly one owned mutation site');
    let red, redBuild;
    try {
      fs.writeFileSync(mutation.file, text.replace(mutation.original, mutation.replacement));
      redBuild = run(['node_modules/typescript/bin/tsc']); assert.equal(redBuild.exitCode, 0);
      red = run(['--test', `--test-name-pattern=${mutation.test}`, 'test/l3-pi-delegation-contract.test.js']);
      assert.notEqual(red.exitCode, 0, 'a compiling mutation must turn its contract test red');
    } finally { fs.writeFileSync(mutation.file, before); }
    const after = fs.readFileSync(mutation.file); assert(before.equals(after), 'byte-for-byte restoration');
    const greenBuild = run(['node_modules/typescript/bin/tsc']); assert.equal(greenBuild.exitCode, 0);
    const green = run(['--test', `--test-name-pattern=${mutation.test}`, 'test/l3-pi-delegation-contract.test.js']);
    assert.equal(green.exitCode, 0);
    evidence.push({ ...mutation, sha256Before: hash(before), sha256After: hash(after), byteExactRestored: true,
      redBuild, red, greenBuild, green });
  }
  const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
  if (output) fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence.map(e => ({ checkpoint: e.checkpoint, red: e.red.exitCode,
    green: e.green.exitCode, byteExactRestored: e.byteExactRestored })), null, 2) + '\n');
}
