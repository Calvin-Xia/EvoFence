import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testLoaderArgs, namedTapFailure } from '../scripts/probes/loader-support.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const controls = [
  { id: 'mapping-row-omitted', module: 'mapping', testFile: 'semantics', title: 'cp1 mapping inventory covers every known SP enum and field',
    edit: ['"IMPOSSIBLE"', ''], filter: 'edge.type.depends_on' },
  // Audit G20 removed the never-read `ports` parameter, so the two controls that used to inject
  // `ports.journal.append(...)` / `ports.grants.issue(...)` inside the bridge can no longer be
  // expressed that way (they would raise a ReferenceError instead of the required AssertionError).
  // They now attack the structural guard that replaced the witness: the factory's arity and the
  // fail-closed execution stubs.
  { id: 'ports-parameter-returns', module: 'index', testFile: 'semantics',
    title: 'cp1 bridge factory takes no ports and its execution surface is fail-closed G20',
    edit: ['export function createSPBridge() {', 'export function createSPBridge(ports) {'] },
  { id: 'sp-cli-dependency', module: 'index', testFile: 'boundary', title: 'cp3 bridge module graph contains no process CLI or new bare dependencies',
    prepend: 'import { spawnSync } from "node:child_process";\n', copy: true },
  { id: 'graph-path-allowed', module: 'types', testFile: 'files', title: 'cp3 graph truth paths are denied before any source read',
    edit: ["if (file.replace(/\\\\/g, '/').split('/').some(part => part.toLowerCase() === '.graph'))", 'if (false)'] },
  { id: 'execute-stub-opens', module: 'index', testFile: 'semantics',
    title: 'cp1 bridge factory takes no ports and its execution surface is fail-closed G20',
    edit: ['const denied = () => ({ ok: false, error: fail(', 'const denied = () => ({ ok: true, error: fail('] },
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function run(control, loader, auditCopy) {
  const args = ['--test', '--test-reporter=tap', '--test-name-pattern=' + control.title, `test/l5-sp-bridge-${control.testFile}.test.js`];
  if (loader) args.unshift(...testLoaderArgs(loader));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; delete env.EFK_SP_AUDIT_COPY;
  if (auditCopy) env.EFK_SP_AUDIT_COPY = auditCopy;
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return { exit: result.status, pass: Number(result.stdout.match(/^# pass (\d+)$/m)?.[1]), fail: Number(result.stdout.match(/^# fail (\d+)$/m)?.[1]), stdout: result.stdout, stderr: result.stderr };
}
for (const control of controls) test(`real bridge negative control ${control.id}: green -> red -> restored`, t => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'efk-sp-mutant-'));
  try {
    const target = path.join(root, `dist/bridges/super-plumber/${control.module}.js`), original = readFileSync(target), before = hash(original);
    let loader, auditCopy;
    if (control.copy) {
      auditCopy = path.join(tmp, 'bridge-copy'); cpSync(path.join(root, 'dist/bridges/super-plumber'), auditCopy, { recursive: true });
      writeFileSync(path.join(auditCopy, 'index.js'), control.prepend + original.toString());
    } else {
      loader = path.join(tmp, 'mutant.mjs');
      const mutate = control.filter ? `source = source.replace('export const MAPPINGS = [', 'const ALL_MAPPINGS = [');
        source += '\\nexport const MAPPINGS = ALL_MAPPINGS.filter(row => row.source !== ${JSON.stringify(control.filter)});';` :
        `const [from,to] = ${JSON.stringify(control.edit)}; if (source.split(from).length !== 2) throw Error('mutation site missing or duplicated'); source=source.replace(from,to);`;
      writeFileSync(loader, `export async function load(url, context, nextLoad) {
        const result = await nextLoad(url, context);
        if (!url.endsWith('/dist/bridges/super-plumber/${control.module}.js')) return result;
        let source = String(result.source).replace(/\\r\\n?/g, '\\n'); ${mutate}
        return { ...result, source };
      }`);
    }
    const green = run(control), red = run(control, loader, auditCopy), restored = run(control);
    assert.deepEqual([green.exit, green.pass, green.fail], [0, 1, 0], green.stdout + green.stderr);
    assert.deepEqual([red.exit, red.pass, red.fail], [1, 0, 1], red.stdout + red.stderr);
    assert.ok(namedTapFailure(red.stdout, control.title)); assert.ok(red.stdout.includes('AssertionError'), red.stdout + red.stderr);
    assert.deepEqual([restored.exit, restored.pass, restored.fail], [0, 1, 0]);
    assert.equal(hash(readFileSync(target)), before);
    t.diagnostic(JSON.stringify({ id: control.id, green: [0, 1, 0], red: [1, 0, 1], restored: [0, 1, 0], distUnchanged: true }));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
