// S05-authorized one-time relocation. Every existing file may change module sources only.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { digest } from './fixtures.mjs';
const ts = createRequire(import.meta.url)('typescript6');
const evidence = 'verification/kernel/evidence';
const beforeDir = '.evofence/out/kernel-evidence/pre-fix';
assert.ok(!existsSync(`${evidence}/pre-fix/relocation-sources.json`), 'relocation has already been recorded; do not rerun');
mkdirSync(beforeDir, { recursive: true });
for (const file of ['repeatability.json', 'static-audit.json', 'summary.json', 'command-repeatability.json']) {
  writeFileSync(`${beforeDir}/${file}`, readFileSync(`${evidence}/${file}`));
}
const moves = ['contracts', 'identity', 'projection', 'outbox'].map(n =>
  ({ from: `src/storage/${n}.ts`, to: `src/kernel/store/${n}.ts` }));
for (const name of readdirSync('src/storage/artifacts').sort()) {
  assert.ok(name.endsWith('.ts'));
  moves.push({ from: `src/storage/artifacts/${name}`, to: `src/kernel/artifacts/${name}` });
}
assert.equal(moves.length, 12);
const backend = ['memory-event-store', 'memory-snapshot-store', 'memory-artifact-store', 'store-session', 'index']
  .map(n => `src/storage/${n}.ts`);
const runtime = readdirSync('src/runtime/session').filter(n => n.endsWith('.ts')).map(n => `src/runtime/session/${n}`)
  .filter(p => readFileSync(p, 'utf8').includes('../../storage/'));
assert.equal(runtime.length, 9);
const tests = readdirSync('test').filter(n => n.startsWith('l2-artifact-') && n.endsWith('.test.js'))
  .map(n => `test/${n}`).filter(p => readFileSync(p, 'utf8').includes('../dist/storage/artifacts/index.js'));
assert.equal(tests.length, 5);
const oldContents = Object.fromEntries([...moves.map(m => m.from), ...backend, ...runtime, ...tests]
  .map(p => [p, readFileSync(p, 'utf8')]));
writeFileSync(`${beforeDir}/relocation-sources.json`, JSON.stringify(oldContents, null, 2) + '\n');
function replaceSources(text, file, choose) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  for (const s of ast.statements) {
    if ((ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier) {
      const specifier = s.moduleSpecifier.text, replacement = choose(specifier);
      if (specifier !== replacement) edits.push({ start: s.moduleSpecifier.getStart(ast) + 1,
        end: s.moduleSpecifier.getEnd() - 1, specifier, replacement });
    }
  }
  let result = text;
  for (const e of edits.toReversed()) result = result.slice(0, e.start) + e.replacement + result.slice(e.end);
  return { result, edits };
}
const records = [];
for (const m of moves) {
  assert.ok(!existsSync(m.to), `target already exists: ${m.to}`);
  mkdirSync(path.dirname(m.to), { recursive: true });
  const chosen = s => m.to.startsWith('src/kernel/store/') && s === '../protocol/index.js' ? '../../protocol/index.js'
    : m.to.startsWith('src/kernel/artifacts/') && s === '../index.js' ? '../store/contracts.js' : s;
  const updated = replaceSources(oldContents[m.from], m.from, chosen);
  renameSync(m.from, m.to);
  writeFileSync(m.to, updated.result);
  records.push({ ...m, importEdits: updated.edits });
}
for (const file of [...backend, ...runtime, ...tests]) {
  const choose = s => backend.includes(file) && /^\.\/(contracts|identity|projection|outbox)\.js$/.test(s)
    ? s.replace('./', '../kernel/store/')
    : runtime.includes(file) && s === '../../storage/index.js' ? '../../kernel/store/index.js'
    : runtime.includes(file) && s === '../../storage/artifacts/index.js' ? '../../kernel/artifacts/index.js'
    : tests.includes(file) && s === '../dist/storage/artifacts/index.js' ? '../dist/kernel/artifacts/index.js' : s;
  const updated = replaceSources(oldContents[file], file, choose);
  assert.ok(updated.edits.length > 0, `no sanctioned imports to rewrite: ${file}`);
  writeFileSync(file, updated.result);
  records.push({ from: file, to: file, importEdits: updated.edits });
}
// Core barrel contains contracts and pure helpers; concrete memory constructors stay in storage.
const originalBarrel = oldContents['src/storage/index.ts'];
const pureExports = originalBarrel.slice(originalBarrel.indexOf('export { intendedIds'));
const newFile = 'src/kernel/store/index.ts';
writeFileSync(newFile, '/** Core store ports and deterministic journal/identity helpers; no backend import. */\n' + pureExports);
const normalize = (s, p) => replaceSources(s, p, () => '__MODULE_SOURCE__').result;
for (const r of records) {
  const before = oldContents[r.from], after = readFileSync(r.to, 'utf8');
  assert.equal(normalize(before, r.from), normalize(after, r.to), `non-import change: ${r.to}`);
  r.originalDigest = digest.digest(before);
  r.resultDigest = digest.digest(after);
  r.nonImportBytesIdentical = true;
}
writeFileSync('.evofence/out/kernel-evidence/relocation.json', JSON.stringify({ authorization: 'orchestrator S05',
  boundaryUnchanged: true, movedFiles: moves.length, modifiedFiles: backend.length + runtime.length + tests.length,
  newFiles: [newFile], records }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ moved: moves.length, rewritten: backend.length + runtime.length + tests.length,
  added: newFile, nonImportBytesIdentical: true }) + '\n');
