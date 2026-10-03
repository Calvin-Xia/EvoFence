import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './l5-cli-fixture.test.js';
const ts = createRequire(import.meta.url)('typescript6');
const sourcePath = path.join(ROOT, 'src/lib/report/kernel-view.ts');
const original = readFileSync(sourcePath);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = pathToFileURL(path.join(ROOT, 'test/l5-cli-fixture.test.js')).href;
const invariants = pathToFileURL(path.join(ROOT, 'test/l5-cli-invariants.test.js')).href;

const mutations = [
  ['cp1 copied classification', null, null, 'assertCliOwnsNoClassification(sourceDirectory);'],
  ['cp2 omitted unknown effect', 'state.unknownEffectIds.map(id =>',
    "state.unknownEffectIds.filter(id => id !== 'effect:plan-1:n1').map(id =>", 'assertUnknown(view);'],
  ['cp3 unknown promoted to success', "status: 'unknown'", "status: 'succeeded'", 'assertUnknown(view);'],
  ['cp3 failed branch erased', 'branches: node.requiredBranches.map(id =>',
    "branches: node.requiredBranches.filter(id => id !== 'bad').map(id =>", 'assertBranches(view);'],
  ['cp3 redaction removed', 'storeOk(safeValue(view))', 'storeOk(view)',
    "for (const format of ['text', 'json', 'sarif', 'junit']) assertPrivacy(formatKernelView(view, format));"],
];
for (const [name, needle, replacement, check] of mutations) test(`${name}: real production mutation red, byte restore green`, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'evofence-l5-mutation-'));
  try {
    writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
    cpSync(path.join(ROOT, 'dist'), path.join(directory, 'dist'), { recursive: true });
    const sourceDirectory = path.join(directory, 'cli');
    cpSync(path.join(ROOT, 'src/lib/cli'), sourceDirectory, { recursive: true });
    const copiedSource = path.join(directory, 'kernel-view.ts');
    const emitted = path.join(directory, 'dist/lib/report/kernel-view.js');
    const cliSource = path.join(sourceDirectory, 'handlers/session.ts'), cliOriginal = readFileSync(cliSource);
    function compile(bytes) {
      writeFileSync(copiedSource, bytes);
      const js = ts.transpileModule(bytes.toString(), { compilerOptions: { target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext } }).outputText;
      writeFileSync(emitted, js);
    }
    function run() {
      const source = `import {makeReviewFixture} from ${JSON.stringify(fixture)};
        import {assertCliOwnsNoClassification,assertUnknown,assertBranches,assertPrivacy} from ${JSON.stringify(invariants)};
        import {readKernelView,formatKernelView} from ${JSON.stringify(pathToFileURL(emitted).href)};
        const f=await makeReviewFixture(); const result=readKernelView(f.source);
        if (!result.ok) throw new Error('fixture read rejected'); const view=result.value;
        const sourceDirectory=${JSON.stringify(sourceDirectory)}; ${check}`;
      return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        cwd: directory, encoding: 'utf8', timeout: 30000,
      });
    }
    compile(original);
    const before = run(); assert.equal(before.status, 0, before.stderr);
    if (needle === null) writeFileSync(cliSource, Buffer.concat([cliOriginal,
      Buffer.from("\nfunction copiedRule(value: string) { if (value === 'unknown') return 'failed'; return value; }\n")]));
    else {
      const text = original.toString(); assert.equal(text.split(needle).length, 2, 'exactly one production mutation site');
      compile(Buffer.from(text.replace(needle, replacement)));
    }
    const red = run(); assert.equal(red.status, 1); assert.match(red.stderr, /AssertionError/);
    writeFileSync(cliSource, cliOriginal); compile(original);
    assert.equal(hash(readFileSync(copiedSource)), hash(original));
    assert.equal(hash(readFileSync(cliSource)), hash(cliOriginal));
    const restored = run(); assert.equal(restored.status, 0, restored.stderr);
    console.log(`${name}: original=0 mutation=1 restored=0; source bytes restored`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
