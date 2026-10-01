// Fresh-checkout entry: build once, run all production trajectories, compare two independent runs.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2);
const args = new Set(['--skip-build', '--scenario', '--output']);
for (let i = 0; i < argv.length; i++) {
  assert.ok(args.has(argv[i]), `unknown argument: ${argv[i]}`);
  if (argv[i] !== '--skip-build') { assert.ok(argv[i + 1], 'missing argument value'); i++; }
}
if (!argv.includes('--skip-build')) {
  const built = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'],
    { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  process.stderr.write(built.stdout + built.stderr);
  assert.equal(built.status, 0, 'build must pass before importing dist');
}
const { ordinary, repair, delegation } = await import('./normal.mjs');
const { concurrency, cancellation, budget } = await import('./faults.mjs');
const { crashBefore, crashAfter, crashIntended, epoch, staleLease, boundaryErrors } = await import('./recovery.mjs');
const { canonical } = await import('./harness.mjs');
const { digest } = await import('./fixtures.mjs');
const { audit } = await import('./static-audit.mjs');
const scenarios = { ordinary, repair, delegation, concurrency, cancellation, budget,
  'crash-before': crashBefore, 'crash-intended': crashIntended, 'crash-after': crashAfter,
  epoch, 'stale-lease': staleLease, 'boundary-errors': boundaryErrors };
const named = argv.includes('--scenario') ? argv[argv.indexOf('--scenario') + 1] : null;
assert.ok(named === null || Object.hasOwn(scenarios, named), `unknown scenario: ${named}`);
const selected = named === null ? Object.entries(scenarios) : [[named, scenarios[named]]];
const output = path.resolve(root, argv.includes('--output') ? argv[argv.indexOf('--output') + 1]
  : named === null ? 'verification/kernel/evidence' : `verification/kernel/evidence/reproduce/${named}`);
const allowedOutput = path.join(root, 'verification', 'kernel');
assert.ok(output === allowedOutput || output.startsWith(allowedOutput + path.sep), 'output must stay inside verification/kernel');
mkdirSync(output, { recursive: true });
const write = (name, data) => writeFileSync(path.join(output, name), `${JSON.stringify(data, null, 2)}\n`);
const traces = [], repeatability = [];
for (const [name, run] of selected) {
  const first = await run(), second = await run();
  const a = canonical(first), b = canonical(second);
  assert.equal(a, b, `non-deterministic trajectory: ${name}`);
  write(`${name}.run-1.json`, first);
  write(`${name}.run-2.json`, second);
  const result = { name, run1: digest.digest(a), run2: digest.digest(b), canonicalBytes: Buffer.byteLength(a), identical: true };
  repeatability.push(result);
  traces.push(first);
  process.stdout.write(`${name} ${result.run1} identical=true\n`);
}
const matrix = traces.flatMap(t => t.errors);
write('repeatability.json', repeatability);
write('error-matrix.json', matrix);
if (named === null) {
  const staticResult = audit();
  write('static-audit.json', staticResult);
  write('summary.json', { cp1: 'passed', cp2: 'passed', cp3: staticResult.status,
    trajectories: traces.length, deterministic: true, errorPaths: matrix.length,
    staticViolations: staticResult.violations.length, boundary: traces[0].boundary });
  process.stdout.write(`cp1=passed cp2=passed cp3=${staticResult.status} errors=${matrix.length} staticViolations=${staticResult.violations.length}\n`);
  process.exitCode = staticResult.status === 'passed' ? 0 : 1;
}
