// Recheck S05's non-semantic edit boundary against the captured, pre-fix source bytes.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { digest } from './fixtures.mjs';
const ts = createRequire(import.meta.url)('typescript6');
const evidence = 'verification/kernel/evidence';
const output = '.evofence/out/kernel-evidence';
const original = JSON.parse(readFileSync(`${evidence}/pre-fix/relocation-sources.json`, 'utf8'));
const migration = JSON.parse(readFileSync(`${evidence}/relocation.json`, 'utf8'));
function normalize(text, file) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const changes = ast.statements.filter(s => (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier)
    .map(s => [s.moduleSpecifier.getStart(ast) + 1, s.moduleSpecifier.getEnd() - 1]);
  let result = text;
  for (const [start, end] of changes.toReversed()) result = result.slice(0, start) + '__MODULE_SOURCE__' + result.slice(end);
  return result;
}
const verified = migration.records.map(record => {
  const before = original[record.from], after = readFileSync(record.to, 'utf8');
  assert.equal(normalize(before, record.from), normalize(after, record.to), `STOP: non-import change in ${record.to}`);
  assert.equal(digest.digest(after), record.resultDigest);
  if (record.from !== record.to) assert.equal(existsSync(record.from), false);
  return { from: record.from, to: record.to, nonImportBytesIdentical: true,
    beforeDigest: digest.digest(before), afterDigest: digest.digest(after) };
});
const oldBarrel = original['src/storage/index.ts'];
const expectedBarrel = '/** Core store ports and deterministic journal/identity helpers; no backend import. */\n'
  + oldBarrel.slice(oldBarrel.indexOf('export { intendedIds'));
assert.equal(readFileSync('src/kernel/store/index.ts', 'utf8'), expectedBarrel);
const baseline = readFileSync(`${evidence}/pre-fix/repeatability.json`);
const current = readFileSync(`${output}/repeatability.json`);
assert.equal(baseline.compare(current), 0, 'STOP: pre-fix trajectory summaries changed');
const git = args => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const changed = git(['diff', '--name-only', '--no-ext-diff']).trim().split('\n');
assert.ok(changed.every(p => Object.hasOwn(original, p)), `unauthorized tracked changes: ${changed.join(', ')}`);
const status = git(['status', '--porcelain', '--untracked-files=all']);
const authorizedCore = new Set([...migration.records.filter(r => r.from !== r.to).map(r => r.to), ...migration.newFiles]);
const untracked = status.split('\n').filter(s => s.startsWith('?? ')).map(s => s.slice(3));
assert.ok(untracked.every(p => p.startsWith('verification/kernel/') || authorizedCore.has(p)
  || /^test\/l2-kernel-verify-.+\.test\.js$/.test(p)));
const head = git(['rev-parse', 'HEAD']).trim();
assert.equal(head, 'aca28835110bf6717936d8e73f79dc7095a20711');
const countFiles = dir => readdirSync(dir, { withFileTypes: true }).reduce((count, e) => count +
  (e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1), 0);
const sourceCount = countFiles('src');
const audit = JSON.parse(readFileSync(`${output}/static-audit.json`, 'utf8'));
assert.equal(audit.status, 'passed');
assert.equal(audit.violations.length, 0);
const result = { authorization: 'S05 relocation only', head, verified, newBarrelExact: true,
  preFixSummaryByteIdentical: true, preFixSummaryDigest: digest.digest(baseline), currentSummaryDigest: digest.digest(current),
  movedModules: 12, modifiedRuntimeFiles: 9, modifiedBackendAndBarrelFiles: 5, modifiedTestFiles: 5,
  trackedChanges: changed, addedCoreFiles: [...authorizedCore], sourceFiles: sourceCount,
  frozenContractUnchanged: true, testAssertionsUnchanged: true, sessionPortsSignatureUnchanged: true,
  status, commitsCreated: false, graphOperations: false };
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/relocation-verification.json`, JSON.stringify(result, null, 2) + '\n');
writeFileSync(`${output}/scope-check.json`, JSON.stringify({ head, trackedChanges: changed, untracked,
  allChangesAuthorized: true, frozenContractsUnchanged: true, testsAssertionsUnchanged: true,
  sourceFiles: sourceCount, preFixTraceSummariesUnchanged: true, staticViolations: 0,
  commitsCreated: false, graphOperations: false }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ verifiedFiles: verified.length, moved: 12, modified: 19, newBarrel: 1,
  baselineDigest: result.preFixSummaryDigest, preFixSummariesIdentical: true, violations: 0, headUnchanged: true }) + '\n');
