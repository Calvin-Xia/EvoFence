import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { config, evidence, hash, record, writeJson } from './io.mjs';

const allowed = new Set(['src/lib/cli/catalog.ts', 'src/lib/cli/options.ts',
  'src/lib/cli/handlers/ledger.ts', 'src/lib/cli/handlers/context.ts',
  'test/ledger-limit-scenario.test.js', 'docs/cli-limit-scenario.md']);
export const taskState = { proposals: {}, plan: null, continuity: null, checks: [], mutation: null };
export const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: 'string' };
export function resolveSource(file) {
  assert(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), 'repo-relative read only');
  assert(/^(src\/lib\/|test\/|docs\/|package\.json$|tsconfig\.json$)/.test(file), 'read outside task scope');
  return path.join(config.scratch, file);
}
const result = text => ({ content: [{ type: 'text', text }], details: {} });
export async function command(label, args) {
  const started = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: config.scratch, windowsHide: true, env: process.env });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`${label} timeout`)); }, 180000);
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject);
    child.on('exit', code => {
      clearTimeout(timeout);
      const row = { label, argv: [process.execPath, ...args], code, elapsedMs: Date.now() - started, stdout, stderr };
      writeJson(path.join(evidence, `check-${taskState.checks.length + 1}.json`), row);
      taskState.checks.push(row); record('check', { label, code, elapsedMs: row.elapsedMs }); resolve(row);
    });
  });
}
export async function checks(label, rounds = 1, gates = false) {
  const rows = [await command(`${label}:build`, ['node_modules/typescript/bin/tsc'])];
  for (let n = 1; n <= rounds; n++) rows.push(await command(`${label}:focused:${n}`, ['--test', 'test/ledger-limit-scenario.test.js']));
  if (gates) {
    rows.push(await command(`${label}:typecheck`, ['node_modules/typescript/bin/tsc', '--noEmit']));
    rows.push(await command(`${label}:src:policy`, ['scripts/check-src-policy.mjs']));
    rows.push(await command(`${label}:dep:check`, ['scripts/check-deps.mjs']));
  }
  return rows;
}
export function toolsFor(role, pause) {
  const tool = (name, description, parameters, fn) => ({ name, label: name, description, parameters,
    async execute(_id, args, signal) { return result(await fn(args, signal)); } });
  const tools = [tool('source_read', 'Read a real task source file with numbered lines. Paths are repo-relative.',
    schema({ path: str }), ({ path: file }) => fs.readFileSync(resolveSource(file), 'utf8').split('\n').map((s, n) => `${n + 1}: ${s}`).join('\n'))];
  if (role === 'parent') tools.push(
    tool('publish_plan', 'Publish inspection anchors and two disjoint worker units. Do not write source.',
      schema({ anchors: { type: 'array', items: str }, logic: str, tests: str }), args => {
        assert(args.anchors.length >= 3); taskState.plan = args;
        writeJson(path.join(evidence, 'inspection-plan.json'), args); record('plan-published', args); return 'Plan saved.';
      }),
    tool('continuity_ack', 'Acknowledge the nonce remembered from the earlier parent turn; do not invent a new nonce.',
      schema({ nonce: str }), ({ nonce }) => { taskState.continuity = nonce; record('continuity-ack', { nonce }); return 'Recorded.'; }),
    tool('checkpoint_pause', 'Wait at a recoverable checkpoint until the host invokes native abort.', schema({}), async (_a, signal) => {
      pause.started(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      record('pause-tool-aborted'); return 'Native abort acknowledged at checkpoint.';
    }),
    tool('integrate_proposals', 'Apply both completed worker bundles once, using base byte hashes. Reject conflicts explicitly.', schema({}), () => {
      const rows = Object.values(taskState.proposals).flat(); assert(rows.length >= 3);
      const files = new Set();
      for (const row of rows) {
        assert(!files.has(row.path), `overlapping proposal: ${row.path}`); files.add(row.path);
        const file = path.join(config.scratch, row.path);
        const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
        assert.equal(before === null ? null : hash(before), row.baseHash, `integration conflict: ${row.path}`);
      }
      for (const row of rows) {
        fs.writeFileSync(path.join(config.scratch, row.path), row.content);
        record('integration-write', { path: row.path, baseHash: row.baseHash, afterHash: hash(Buffer.from(row.content)) });
      }
      return `Applied ${rows.length} files with explicit base CAS.`;
    }),
    tool('repair_restore', 'Restore the injected fault to the exact original bytes. Explain diagnosis before calling.', schema({ diagnosis: str }), ({ diagnosis }) => {
      const m = taskState.mutation; assert(m !== null); const file = path.join(config.scratch, m.path);
      assert.equal(hash(fs.readFileSync(file)), m.mutatedHash, 'mutation changed unexpectedly');
      fs.writeFileSync(file, Buffer.from(m.originalBase64, 'base64'));
      assert.equal(hash(fs.readFileSync(file)), m.originalHash);
      record('repair-restored', { path: m.path, diagnosis, restoredHash: m.originalHash }); return 'Restored original bytes.';
    }));
  if (role === 'logic' || role === 'tests') tools.push(tool('propose_file',
    'Submit full replacement file content to your own bundle. No shared source write. Read original source first; do not include line numbers.',
    schema({ path: str, content: str }), ({ path: file, content }) => {
      assert(allowed.has(file), 'file outside bounded task');
      assert(role === 'logic' ? file.startsWith('src/lib/cli/') : file.startsWith('test/') || file.startsWith('docs/'), 'worker ownership conflict');
      const original = path.join(config.scratch, file), baseHash = fs.existsSync(original) ? hash(fs.readFileSync(original)) : null;
      const rows = taskState.proposals[role] ?? []; taskState.proposals[role] = [...rows.filter(r => r.path !== file), { path: file, baseHash, content }];
      const own = path.join(evidence, 'proposals', role); fs.mkdirSync(own, { recursive: true });
      writeJson(path.join(own, 'bundle.json'), taskState.proposals[role]);
      record('worker-proposal', { role, path: file, baseHash, outputHash: hash(Buffer.from(content)) }); return 'Proposal recorded; integration writer will apply it.';
    }));
  if (role === 'quality') tools.push(tool('revise_validation',
    'Single integration writer: replace only handlers/context.ts to remove redundant integer guards. Read current source first; all unrelated content must be preserved.',
    schema({ content: str }), ({ content }) => {
      const file = 'src/lib/cli/handlers/context.ts', previous = fs.readFileSync(path.join(config.scratch, file));
      fs.writeFileSync(path.join(config.scratch, file), content);
      record('quality-source-write', { path: file, beforeHash: hash(previous), afterHash: hash(Buffer.from(content)) });
      return 'Validation revised. End turn; independent verifier owns final checks.';
    }));
  if (role === 'quality-verifier') tools.push(tool('run_checks',
    'Run build, two focused CLI test rounds and all four gates on current quality-repaired source, read-only to source.',
    schema({ final: { type: 'boolean' } }), async ({ final }) => {
      assert.equal(final, true); return JSON.stringify(await checks('quality-final', 2, true));
    }));
  if (role === 'verifier') tools.push(tool('run_checks',
    'Run current build and focused CLI tests. final=true runs focused tests twice plus build/typecheck/src:policy/dep:check. Cannot write source.',
    schema({ final: { type: 'boolean' } }), async ({ final }) => JSON.stringify(await checks(final ? 'finish' : 'fresh-verify', final ? 2 : 1, final))));
  return tools;
}
