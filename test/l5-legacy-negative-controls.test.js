import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const controls = [
  { id: 'unknown-version-accepted', dod: 'DoD1', module: 'sqlite', file: 'export',
    title: 'DoD1 unknown SQLite version is explicitly refused with no source writes',
    edits: [["if (version?.value !== '2')", 'if (false)']] },
  { id: 'source-writeback', dod: 'DoD1', module: 'exporter', file: 'export',
    title: 'DoD1 originals and copied sources keep exact digests across export and import',
    prepend: "import { writeFileSync as mutantWrite } from 'node:fs';\n",
    edits: [["return { protocol: EXPORT_PROTOCOL, classification: 'historical-source', executable: false,",
      "mutantWrite(source.file, Buffer.concat([source.bytes, Buffer.from('mutant-write')]));\nreturn { protocol: EXPORT_PROTOCOL, classification: 'historical-source', executable: false,"]] },
  { id: 'history-as-execution-evidence', dod: 'DoD2', module: 'importer', file: 'import',
    title: 'DoD2 old accepted ledger remains historical and cannot enter journal or asset qualification',
    edits: [["records: bundle.records.map(record => ({ ...record, executable: false,",
      "records: bundle.records.map(record => ({ ...record, executable: true,"]] },
  { id: 'breaking-command-omitted', dod: 'DoD2', module: 'breaking', file: 'checklist',
    title: 'DoD2 breaking checklist covers every legacy command and every config group',
    edits: [["['cli:doctor', 'old --fix only with the old CLI; no remediation or discovery in this lane'],", '']] },
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function run(control, loader) {
  const args = ['--test', '--test-reporter=tap', `--test-name-pattern=${control.title}`, `test/l5-legacy-${control.file}.test.js`];
  if (loader) args.unshift('--experimental-loader', pathToFileURL(loader).href);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return { exit: result.status, pass: Number(result.stdout.match(/^# pass (\d+)$/m)?.[1]),
    fail: Number(result.stdout.match(/^# fail (\d+)$/m)?.[1]), stdout: result.stdout, stderr: result.stderr };
}
for (const control of controls) {
  test(`real negative control ${control.id}: green -> red -> restored green`, t => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'l5-legacy-mutant-'));
    try {
      const target = path.join(root, `dist/storage/legacy/${control.module}.js`), before = hash(readFileSync(target));
      const loader = path.join(tmp, 'mutant.mjs');
      writeFileSync(loader, `export async function load(url, context, nextLoad) {
        const result = await nextLoad(url, context);
        if (!url.endsWith('/dist/storage/legacy/${control.module}.js')) return result;
        let source = String(result.source);
        for (const [from, to] of ${JSON.stringify(control.edits)}) {
          if (source.split(from).length !== 2) throw Error('mutation site missing or duplicated');
          source = source.replace(from, to);
        }
        return { ...result, source: ${JSON.stringify(control.prepend ?? '')} + source };
      }`);
      const green = run(control), red = run(control, loader), restored = run(control);
      assert.deepEqual([green.exit, green.pass, green.fail], [0, 1, 0]);
      assert.deepEqual([red.exit, red.pass, red.fail], [1, 0, 1]);
      assert.ok(red.stdout.includes(`not ok 1 - ${control.title}`), red.stdout + red.stderr);
      assert.ok(red.stdout.includes('AssertionError'), red.stdout + red.stderr);
      assert.deepEqual([restored.exit, restored.pass, restored.fail], [0, 1, 0]);
      assert.equal(hash(readFileSync(target)), before, 'negative control modified dist');
      t.diagnostic(JSON.stringify({ id: control.id, dod: control.dod, module: control.module,
        edits: control.edits, green: [green.exit, green.pass, green.fail], red: [red.exit, red.pass, red.fail],
        restored: [restored.exit, restored.pass, restored.fail], distUnchanged: true }));
      t.diagnostic(red.stdout);
    } finally { rmSync(tmp, { recursive: true }); }
  });
}
