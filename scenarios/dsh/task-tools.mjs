import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { config, evidence, hash, record, writeJson } from './io.mjs';

export const sharedPath = 'docs/cli-limit-scenario.md';
const logicPaths = ['src/lib/cli/catalog.ts', 'src/lib/cli/handlers/context.ts', 'src/lib/cli/handlers/ledger.ts'];
const testPath = 'test/ledger-limit-scenario.test.js';
const readPaths = new Set([...logicPaths, testPath, sharedPath, 'src/lib/cli/options.ts', 'test/ledger.test.js',
  'src/lib/ledger.ts', 'src/lib/ledger/queries.ts', 'src/lib/cli/output.ts', 'src/lib/cli/dispatch.ts',
  'src/lib/cli/spec.ts', 'src/lib/cli/index.ts', 'src/lib/cli/handlers/index.ts', 'src/lib/errors.ts',
  'src/lib/ledger/schema.ts', 'package.json', 'tsconfig.json']);
export const taskState = { proposals: {}, plan: null, continuity: null, checks: [], mutation: null, conflict: null, integrated: false };
export function resolveSource(file) {
  assert(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), 'Repo-relative task path required');
  assert(readPaths.has(file), 'Read outside explicitly bounded CLI/ledger/test data scope');
  return path.join(config.scratch, file);
}
export async function command(label, args) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: config.scratch, windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${label} timeout`)); }, 180000);
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      const row = { label, argv: [process.execPath, ...args], code, elapsedMs: Date.now() - started, stdout, stderr };
      writeJson(path.join(evidence, `check-${taskState.checks.length + 1}.json`), row);
      taskState.checks.push(row); record('check', { label, code, elapsedMs: row.elapsedMs }); resolve(row);
    });
  });
}
export async function checks(label, rounds, gates) {
  const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const rows = [await command(`${label}:build`, [npm, 'run', 'build'])];
  for (let n = 1; n <= rounds; n++) rows.push(await command(`${label}:focused:${n}`, ['--test', testPath]));
  if (gates) for (const gate of ['typecheck', 'src:policy', 'dep:check']) rows.push(await command(`${label}:${gate}`, [npm, 'run', gate]));
  return rows;
}
export function toolDefinitions(role, pause) {
  const str = { type: 'string', required: true };
  const t = (name, description, parameters, execute) => ({ name, description, parameters,
    output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] }, execute });
  const tools = [t('source_read', 'Read a real bounded task file with numbered lines.', { path: str }, ({ path: file }) => {
    record('source-read', { role, path: file });
    return fs.readFileSync(resolveSource(file), 'utf8').split('\n').map((s, n) => `${n + 1}: ${s}`).join('\n');
  })];
  if (role === 'parent') tools.push(
    t('publish_plan', 'Save real file:line anchors and two disjoint units: logic src/lib/cli; tests test plus docs. Shared doc proposals are the explicit conflict exception.',
      { anchors: { type: 'array', items: { type: 'string' }, required: true }, logic: str, tests: str }, args => {
        assert(args.anchors.length >= 3); taskState.plan = args;
        writeJson(path.join(evidence, 'inspection-plan.json'), args); record('plan-published', args); return 'Plan saved.';
      }),
    t('continuity_ack', 'Recall the exact nonce from the earlier turn after native cancellation and resume.', { nonce: str }, ({ nonce }) => {
      taskState.continuity = nonce; record('continuity-ack', { nonce }); return 'Continuity recorded.';
    }),
    t('checkpoint_pause', 'Wait for the driver to cancel this native turn; preserve this same session.', {}, async (_args, execution) => {
      pause.started(); await new Promise(resolve => execution.signal.addEventListener('abort', resolve, { once: true }));
      record('pause-tool-aborted'); return 'Native abort signal observed.';
    }),
    t('proposal_read', 'Read both completed native worker proposal bundles, including the shared file conflict.', {}, () => JSON.stringify(taskState.proposals)),
    t('resolve_shared_conflict', 'Unique integration writer: explicitly merge the two differing proposals for the shared documentation file. Explain which behaviors and test examples were retained.',
      { content: str, rationale: str }, ({ content, rationale }) => {
        const variants = ['logic', 'tests'].map(role => taskState.proposals[role].find(r => r.path === sharedPath));
        assert.notEqual(variants[0].content, variants[1].content, 'Conflict must be real');
        taskState.conflict = { path: sharedPath, baseHash: variants[0].baseHash, variants, content, rationale,
          resolvedHash: hash(Buffer.from(content)), writer: 'parent' };
        writeJson(path.join(evidence, 'shared-file-conflict.json'), taskState.conflict);
        record('conflict-resolved', { path: sharedPath, proposalHashes: variants.map(r => hash(Buffer.from(r.content))),
          resolvedHash: taskState.conflict.resolvedHash, rationale }); return 'Explicit shared-file resolution saved.';
      }),
    t('integrate_proposals', 'Only scratch source writer. Apply both worker bundles after all original byte hashes match; use only the explicitly resolved shared doc.', {}, () => {
      assert(taskState.conflict !== null);
      const rows = Object.values(taskState.proposals).flat().filter(r => r.path !== sharedPath);
      rows.push({ path: sharedPath, baseHash: taskState.conflict.baseHash, content: taskState.conflict.content });
      assert.equal(new Set(rows.map(r => r.path)).size, rows.length, 'Unresolved overlapping file');
      for (const row of rows) {
        const file = resolveSource(row.path), before = fs.existsSync(file) ? fs.readFileSync(file) : null;
        assert.equal(before === null ? null : hash(before), row.baseHash, `Base conflict: ${row.path}`);
      }
      for (const row of rows) {
        fs.writeFileSync(resolveSource(row.path), row.content);
        record('integration-write', { path: row.path, baseHash: row.baseHash, afterHash: hash(Buffer.from(row.content)) });
      }
      taskState.integrated = true; return `Applied ${rows.length} files; conflict resolution recorded.`;
    }),
    t('repair_restore', 'Restore only the deliberately mutated ledger handler to byte-identical original bytes after diagnosing red tests. Do not change tests.', {}, () => {
      const m = taskState.mutation; fs.writeFileSync(resolveSource(m.path), m.original);
      assert.equal(hash(fs.readFileSync(resolveSource(m.path))), m.originalHash);
      record('repair-restored', { path: m.path, hash: m.originalHash }); return 'Original bytes restored.';
    }),
    t('repair_test', 'Unique integration writer: repair a genuine assertion syntax bug in the focused test without weakening any behavioral assertion. Preserve the negative matrix and all CLI checks.',
      { content: str, rationale: str }, ({ content, rationale }) => {
        const original = fs.readFileSync(resolveSource(testPath));
        fs.writeFileSync(resolveSource(testPath), content);
        record('test-assertion-repaired', { path: testPath, beforeHash: hash(original), afterHash: hash(Buffer.from(content)), rationale });
        writeJson(path.join(evidence, 'test-quality-repair.json'), { path: testPath, beforeHash: hash(original),
          afterHash: hash(Buffer.from(content)), rationale, writer: 'parent' });
        return 'Test assertion repaired; independent verifier must run all cases again.';
    })
  );
  if (role === 'logic' || role === 'tests') tools.push(t('propose_file', 'Submit full replacement content for an owned file; never write scratch directly. Both workers also submit differing documentation proposals for the explicit conflict case.',
    { path: str, content: str }, ({ path: file, content }, execution) => {
      assert((role === 'logic' ? [...logicPaths, sharedPath] : [testPath, sharedPath]).includes(file), 'Worker scope violation');
      const original = fs.existsSync(resolveSource(file)) ? fs.readFileSync(resolveSource(file)) : null;
      const row = { path: file, content, baseHash: original === null ? null : hash(original), role, sessionId: execution.agent.id };
      taskState.proposals[role] ??= [];
      const i = taskState.proposals[role].findIndex(r => r.path === file);
      if (i < 0) taskState.proposals[role].push(row); else taskState.proposals[role][i] = row;
      writeJson(path.join(evidence, `proposals-${role}.json`), taskState.proposals[role]);
      record('worker-proposal', { role, sessionId: execution.agent.id, path: file, baseHash: row.baseHash, afterHash: hash(Buffer.from(content)) });
      return 'Proposal saved; only parent can integrate.';
    }));
  if (role === 'verifier') tools.push(t('run_checks', 'Independently run real build and CLI subprocess tests. final=true runs tests twice plus four npm gates. Cannot modify task source.',
    { final: { type: 'boolean', required: true } }, async ({ final }) => JSON.stringify(await checks(final ? 'finish' : 'fresh-verify', final ? 2 : 1, final))));
  return tools;
}
