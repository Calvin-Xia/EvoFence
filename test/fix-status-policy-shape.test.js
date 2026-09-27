// Fix batch R2 · review F8a — `status --json` emits a sixth top-level key (`policy`) that
// `src/types/report.ts::StatusView` did not declare, so TypeScript consumers could not see it and
// nothing failed when it was added.
//
// The declaration is fixed in `src/types/report.ts` (`StatusView.policy:
// StatusPolicySnapshot | null`). This file is the machine check that keeps the declaration and
// the emitted JSON together: `src/lib/status.ts` declares its own `StatusView extends
// StatusViewContract` and can add a key without any compile error, so only a runtime key-set
// assertion catches the next drift. `npm run typecheck` catches the other direction (a lib field
// that stops being assignable to the declared shape).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeRepository } from '../dist/lib/init.js';
import { emptyStatus } from '../dist/lib/status.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

// Kept in sync by hand with `src/types/report.ts`; an added or renamed field must fail here.
const STATUS_VIEW_KEYS = ['active_generation', 'integrity', 'policy', 'recent_runs', 'root', 'totals'];
const POLICY_KEYS = ['adapters', 'contract', 'files'];
const POLICY_FILES_KEYS = ['config', 'contract'];
const CONTRACT_SUMMARY_KEYS = ['budgets', 'evidence', 'hard_invariants', 'objective', 'protected_paths'];
const ADAPTER_SUMMARY_KEYS = ['agent', 'command', 'model', 'name'];

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout || result.error}`);
}

test('status --json emits exactly the keys StatusView declares, policy included', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-fix-status-'));
  const root = path.join(directory, 'repo');
  try {
    await mkdir(root, { recursive: true });
    runGit(root, ['init', '--quiet', '--initial-branch=main']);
    runGit(root, ['config', 'user.name', 'EvoFence Fixture']);
    runGit(root, ['config', 'user.email', 'fixture@example.invalid']);
    runGit(root, ['config', 'commit.gpgsign', 'false']);
    await writeFile(path.join(root, 'README.md'), '# fixture repository\n');
    runGit(root, ['add', '-A']);
    runGit(root, ['commit', '--quiet', '-m', 'fixture']);
    await initializeRepository(root);

    const result = spawnSync(process.execPath, [CLI, 'status', '--json'], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const view = JSON.parse(result.stdout);

    assert.deepEqual(Object.keys(view).sort(), STATUS_VIEW_KEYS);
    assert.notEqual(view.policy, null, 'a repository with .evofence/contract.yaml must echo the policy snapshot');
    assert.deepEqual(Object.keys(view.policy).sort(), POLICY_KEYS);
    assert.deepEqual(Object.keys(view.policy.files).sort(), POLICY_FILES_KEYS);
    assert.equal(view.policy.files.contract, '.evofence/contract.yaml');
    assert.equal(view.policy.files.config, '.evofence/config.yaml');
    assert.deepEqual(Object.keys(view.policy.contract).sort(), CONTRACT_SUMMARY_KEYS);
    assert.ok(view.policy.adapters.length > 0, 'the snapshot lists the known adapters');
    for (const adapter of view.policy.adapters) {
      assert.deepEqual(Object.keys(adapter).sort(), ADAPTER_SUMMARY_KEYS);
    }

    // The in-process view must agree with the CLI shape (same contract, same key set).
    const direct = emptyStatus(root);
    assert.deepEqual(Object.keys(direct).sort(), STATUS_VIEW_KEYS);
    assert.deepEqual(Object.keys(direct.policy).sort(), POLICY_KEYS);
    assert.deepEqual(Object.keys(direct.policy.contract).sort(), CONTRACT_SUMMARY_KEYS);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
