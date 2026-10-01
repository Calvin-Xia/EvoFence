import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const lane = fileURLToPath(new URL('..', import.meta.url));
// Node's worker marker would make a child --test skip its files as a recursive runner.
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
const controls = [
  {
    id: 'token-gate', file: 'window.js',
    edits: [['if (full.value.tokenCount <= tokenLimit)', 'if (true)']],
    suite: 'test/l3-router-packet.test.js', name: 'token gate is inclusive',
  },
  {
    id: 'evidence-loss', file: 'window.js',
    edits: [['const candidate = measure(compact, true);', 'const candidate = measure({ ...compact, entries: [], audit: [] }, true);']],
    suite: 'test/l3-router-packet.test.js', name: 'long-task compaction preserves',
  },
  {
    id: 'private-leak', file: 'access.js',
    edits: [
      ["case 'fresh-verifier': return storeOk('author');", "case 'fresh-verifier': return storeOk('evaluator');"],
      ["case 'learner': return storeOk('asset-staging');", "case 'learner': return storeOk('evaluator');"],
    ],
    suite: 'test/l3-router-privacy.test.js', name: 'private and final refs never reach',
  },
];

for (const control of controls) {
  test(`negative control ${control.id}: real implementation mutation turns red; removing it restores green`, () => {
    // An ephemeral ESM loader mutates only this child process's learning/context code. No source,
    // dist file, core module or private payload is written, logged or persisted by the control.
    const loader = `export async function load(url, context, nextLoad) {
      const result = await nextLoad(url, context);
      if (url.endsWith('/dist/learning/context/${control.file}')) {
        let source = String(result.source);
        for (const [from, to] of ${JSON.stringify(control.edits)}) {
          if (source.split(from).length !== 2) throw new Error('mutation site drift');
          source = source.replace(from, to);
        }
        process.stderr.write('mutation-applied:${control.id}\\n');
        return { ...result, source };
      }
      return result;
    }`;
    const url = `data:text/javascript;base64,${Buffer.from(loader).toString('base64')}`;
    const preload = `import { register } from 'node:module'; register(${JSON.stringify(url)}, import.meta.url);`;
    const args = ['--test', '--test-reporter=tap', `--test-name-pattern=${control.name}`, control.suite];
    const mutated = spawnSync(process.execPath, [`--import=data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`, ...args], {
      cwd: lane, encoding: 'utf8', timeout: 30000, env: childEnv,
    });
    assert.equal(mutated.error, undefined);
    assert.equal(mutated.status, 1, mutated.stdout + mutated.stderr);
    assert.match(mutated.stdout + mutated.stderr, new RegExp(`mutation-applied:${control.id}`));
    assert.match(mutated.stdout, /# fail 1/);
    assert.match(mutated.stdout, /ERR_ASSERTION/, 'a behavior assertion, not an import failure, must turn red');
    const restored = spawnSync(process.execPath, args, { cwd: lane, encoding: 'utf8', timeout: 30000, env: childEnv });
    assert.equal(restored.error, undefined);
    assert.equal(restored.status, 0, restored.stdout + restored.stderr);
    assert.match(restored.stdout, /# pass 1/);
    assert.match(restored.stdout, /# fail 0/);
    console.log(`${control.id}: mutated exit=1/pass=0/fail=1; restored exit=0/pass=1/fail=0`);
  });
}
