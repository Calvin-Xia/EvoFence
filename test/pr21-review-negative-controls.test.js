import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { testLoaderArgs, namedTapFailure } from '../scripts/probes/loader-support.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const ts = createRequire(import.meta.url)('typescript6');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const controls = [
  ['A order', 'lib/cli/handlers/session', 'checked(validateRegistryHistory(registry, { artifacts }));', 'void registry;',
    'PR21 A: forged registry transition order cannot render an eligible or usable asset'],
  ['A evidence', 'lib/cli/handlers/session', 'checked(validateRegistryHistory(registry, { artifacts }));', 'void registry;',
    'PR21 A: null required decision evidence cannot render an eligible or usable asset'],
  ['C effect IDs', 'storage/store-recovery', 'const effectIds = uniqueEffects(exported.effects); if (!effectIds.ok) return effectIds;', 'void exported.effects;',
    'PR21 C: duplicate effect IDs are rejected before map reconstruction'],
  ['C idempotency keys', 'storage/store-recovery', 'const effectIds = uniqueEffects(exported.effects); if (!effectIds.ok) return effectIds;', 'void exported.effects;',
    'PR21 C: duplicate effect idempotency keys are rejected before map reconstruction'],
  ['D request index', 'storage/store-recovery', 'for (const [requestId, entry] of indexed.requestIndex) record.requestIndex.set(requestId, entry);', 'void indexed.requestIndex;',
    'PR21 D: export restore and retry preserves the original duplicate outcome'],
];
for (const [id, module, needle, replacement, title] of controls) test(`PR21 negative ${id}: green red byte-restored green`, t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'evofence-pr21-mutation-'));
  const sourcePath = path.join(root, `src/${module}.ts`), distPath = path.join(root, `dist/${module}.js`);
  const original = readFileSync(sourcePath), distOriginal = readFileSync(distPath);
  const copy = path.join(directory, 'production.ts'), emitted = path.join(directory, 'production.js'), loader = path.join(directory, 'loader.mjs');
  function compile(bytes) {
    writeFileSync(copy, bytes);
    writeFileSync(emitted, ts.transpileModule(bytes.toString(), { compilerOptions: {
      target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText);
  }
  function run() {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} ${testLoaderArgs(loader).join(' ')}`.trim();
    const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=^${title}$`,
      'test/pr21-review-regressions.test.js'], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null);
    return { exit: child.status, pass: Number(child.stdout.match(/^# pass (\d+)$/m)?.[1]),
      fail: Number(child.stdout.match(/^# fail (\d+)$/m)?.[1]), stdout: child.stdout, stderr: child.stderr };
  }
  try {
    writeFileSync(loader, `import {readFileSync} from 'node:fs';
      export async function load(url,context,nextLoad) {
        const result=await nextLoad(url,context);
        return url.endsWith(${JSON.stringify(`/dist/${module}.js`)})
          ? {...result,source:readFileSync(${JSON.stringify(emitted)})} : result;
      }`);
    compile(original);
    const green = run(); assert.deepEqual([green.exit, green.pass, green.fail], [0, 1, 0], green.stdout + green.stderr);
    const normalized = original.toString().replace(/\r\n/g, '\n');
    assert.equal(normalized.split(needle).length, 2, 'exactly one real production mutation site');
    compile(Buffer.from(normalized.replace(needle, replacement)));
    const red = run(); assert.deepEqual([red.exit, red.pass, red.fail], [1, 0, 1], red.stdout + red.stderr);
    assert.ok(namedTapFailure(red.stdout, title), red.stdout + red.stderr);
    assert.match(red.stdout, /AssertionError/);
    compile(original);
    assert.deepEqual(readFileSync(copy), original, 'mutated source copy restored byte for byte');
    const restored = run(); assert.deepEqual([restored.exit, restored.pass, restored.fail], [0, 1, 0], restored.stdout + restored.stderr);
    assert.equal(sha(readFileSync(sourcePath)), sha(original), 'lane source bytes unchanged by control');
    assert.equal(sha(readFileSync(distPath)), sha(distOriginal), 'lane dist bytes unchanged by control');
    t.diagnostic(JSON.stringify({ id, module, green: [green.exit, green.pass, green.fail],
      red: [red.exit, red.pass, red.fail], restored: [restored.exit, restored.pass, restored.fail], byteRestored: true }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
