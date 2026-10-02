/** Capture the exact lane gates, without editing core or running paid model calls. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const evidence = path.join(root, '.evofence/out/dsh-evidence');
fs.mkdirSync(evidence, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const outputs = [];
function run(executable, args, command) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  const entry = { command, exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  outputs.push(entry);
  assert.equal(result.status, 0, `${command}\n${result.stdout}\n${result.stderr}`);
  return entry;
}
for (const gate of ['build', 'typecheck', 'src:policy', 'dep:check']) {
  run(process.execPath, [npm, 'run', gate], `npm run ${gate}`);
}
const tests = [];
for (let iteration = 1; iteration <= 2; iteration++) {
  const entry = run(process.execPath, ['--test', 'test/l3-dsh-*.test.js'], 'node --test test/l3-dsh-*.test.js');
  const count = key => Number(entry.stdout.match(new RegExp(`${key} ([0-9]+)`))[1]);
  const result = { iteration, tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped') };
  assert.equal(result.fail, 0); assert.equal(result.skipped, 0); assert.equal(result.pass, result.tests);
  tests.push(result);
}
assert.deepEqual({ ...tests[0], iteration: 0 }, { ...tests[1], iteration: 0 });
const audit = run(process.execPath, ['verification/kernel/static-audit.mjs'], 'node verification/kernel/static-audit.mjs');
const auditResult = JSON.parse(audit.stdout);
assert.equal(auditResult.status, 'passed'); assert.equal(auditResult.violations.length, 0);
// Preserve the full audit separately; gate summaries avoid duplicating its large closure inventory.
fs.writeFileSync(path.join(evidence, 'static-audit.json'), audit.stdout);
audit.stdout = JSON.stringify({ status: auditResult.status, violations: auditResult.violations,
  fullResult: 'static-audit.json', sha256: hash(fs.readFileSync(path.join(evidence, 'static-audit.json'))) });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'integrations/deepseek-harness/package.json'), 'utf8'));
assert.equal(manifest.engines.dsh, '0.2.0-rc.2');
assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-tools'], '0.2.0-rc.2');
const pin = JSON.parse(fs.readFileSync(path.join(evidence, 'native-revalidation/VERSION-PIN.json'), 'utf8'));
assert.equal(pin.observedVersion, '0.2.0-rc.2');
const declaration = { decision: 'A', declaredDsh: manifest.engines.dsh,
  declaredToolsPeer: manifest.peerDependencies['@deepseek-ai/dsh-tools'], observedDsh: pin.observedVersion,
  compatibleWithDeclaredExactVersions: true, profileInstallCompatibility: 'unknown',
  manifestSha256: hash(fs.readFileSync(path.join(root, 'integrations/deepseek-harness/package.json'))),
  historicalProbeCaveat: 'The unchanged support script hardcodes integrationGap.compatibleWithDeclaredExactVersions=false; this fresh equality check supersedes that static field only.' };
fs.writeFileSync(path.join(evidence, 'version-decision.json'), JSON.stringify(declaration, null, 2) + '\n');
const scope = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], 'git status --porcelain=v1 --untracked-files=all');
const files = scope.stdout.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).replaceAll('\\', '/'));
assert(files.every(file => /^(src\/hosts\/dsh\/|test\/l3-dsh-[^/]+\.test\.js$|integrations\/deepseek-harness\/)/.test(file)), 'change outside lane ownership');
run('git', ['diff', '--check'], 'git diff --check');
const sourceFiles = files.filter(file => /^src\/hosts\/dsh\//.test(file) || /^test\//.test(file)
  || /^integrations\/deepseek-harness\/(index\.js|package\.json)$/.test(file));
const sourceSha256 = Object.fromEntries(sourceFiles.map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
const negatives = JSON.parse(fs.readFileSync(path.join(evidence, 'negative-controls.json'), 'utf8'));
assert.equal(negatives.results.length, 2);
for (const control of negatives.results) {
  assert.equal(control.baseline.exitCode, 0); assert.equal(control.red.exitCode, 1); assert.equal(control.green.exitCode, 0);
  assert.equal(control.originalSha256, sourceSha256[control.file]);
  assert.equal(control.restoredSha256, control.originalSha256);
}
const report = { lane: 'l3-dsh', status: 'passed', evidenceLevel: 'native-fixture-and-fault-injection',
  nodeVersion: process.version, tests, staticAudit: { status: auditResult.status, violations: 0 },
  versionDecision: declaration, negativeControls: negatives.results.map(row => ({ dod: row.dod,
    baseline: row.baseline.exitCode, mutated: row.red.exitCode, restored: row.green.exitCode, sourceRestored: true })),
  scope: files, sourceSha256, gates: outputs };
fs.writeFileSync(path.join(evidence, 'gates.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, tests, staticAudit: report.staticAudit,
  version: declaration.observedDsh, negativeControls: report.negativeControls, changedFiles: files.length }));
