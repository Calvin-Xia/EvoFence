import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeRepository } from '../dist/lib/init.js';
import { prepareRun } from '../dist/lib/exec/runner-preflight.js';
import { cleanupEmptyWorktreeTempParent } from '../dist/lib/exec/worktree-temp.js';
import { canTerminateProcessTree, runProcess } from '../dist/lib/process.js';

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'evofence-usd-preflight-'));
  const root = path.join(parent, 'repo');
  await mkdir(root);
  for (const args of [
    ['init', '--quiet', '--initial-branch=main'],
    ['config', 'user.name', 'EvoFence fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
  ]) {
    const result = await runProcess('git', args, { cwd: root, timeoutMs: 10000 });
    assert.equal(result.code, 0, result.stderr);
  }
  await writeFile(path.join(root, 'score.txt'), '0\n');
  let result = await runProcess('git', ['add', '-A'], { cwd: root, timeoutMs: 10000 });
  assert.equal(result.code, 0, result.stderr);
  result = await runProcess('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root, timeoutMs: 10000 });
  assert.equal(result.code, 0, result.stderr);
  await initializeRepository(root);
  const contractFile = path.join(root, '.evofence', 'contract.yaml');
  const contract = await readFile(contractFile, 'utf8');
  const configuredContract = contract
    .replace('  command: ""', '  command: \'node -e "console.log(0)"\'')
    .replace('hard_invariants: []', 'hard_invariants:\n  - id: fixture\n    command: \'node -e "process.exit(0)"\'')
    .replace('max_usd: null', 'max_usd: 1');
  await writeFile(contractFile, configuredContract);
  return { parent, root };
}

async function closePrepared(context) {
  context.ledger.close();
  await rm(context.runTempRoot, { recursive: true, force: true });
  await cleanupEmptyWorktreeTempParent(context.tempParent);
}

test('Pi max_usd passes preflight while Codex and OpenCode remain rejected', async () => {
  const { parent, root } = await fixture();
  try {
    if (await canTerminateProcessTree()) {
      const context = await prepareRun({ cwd: root, goal: 'fixture', adapter: 'pi', allowUnisolatedAgent: true });
      try {
        assert.equal(context.costLimitMicros, 1_000_000);
      } finally {
        await closePrepared(context);
      }
    } else {
      await assert.rejects(prepareRun({ cwd: root, goal: 'fixture', adapter: 'pi', allowUnisolatedAgent: true }), { code: 'UNSUPPORTED_COST_BUDGET_PROCESS_CONTROL' });
    }

    await assert.rejects(prepareRun({ cwd: root, goal: 'fixture', adapter: 'codex' }), (error) => {
      assert.equal(error.code, 'UNSUPPORTED_COST_BUDGET');
      assert.match(error.message, /Codex/);
      assert.match(error.message, /max_usd/);
      return true;
    });
    await assert.rejects(prepareRun({ cwd: root, goal: 'fixture', adapter: 'opencode' }), (error) => {
      assert.equal(error.code, 'UNSUPPORTED_COST_BUDGET');
      assert.match(error.message, /OpenCode/);
      assert.match(error.message, /currency/);
      return true;
    });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
