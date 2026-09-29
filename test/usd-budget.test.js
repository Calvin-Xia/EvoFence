import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeRepository } from '../dist/lib/init.js';
import { Ledger, ledgerPath } from '../dist/lib/ledger.js';
import { prepareRun } from '../dist/lib/exec/runner-preflight.js';
import { runBudgetedAdapter } from '../dist/lib/exec/runner-budgeted.js';
import { cleanupEmptyWorktreeTempParent } from '../dist/lib/exec/worktree-temp.js';
import { canTerminateProcessTree, runProcess } from '../dist/lib/process.js';
import { runEvolution } from '../dist/lib/runner.js';

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

const budgetedOptions = {
  iteration: 1,
  phase: 'proposal',
  worktree: 'fixture',
  timeoutMs: 1000,
  contract: {},
  allowUnisolatedAgent: true,
};

function budgetedContext(result, observedCostMicros = 0) {
  const events = [];
  let launches = 0;
  return {
    events,
    launches: () => launches,
    ctx: {
      ledger: { append: (event_type, run_id, payload) => events.push({ event_type, run_id, payload }) },
      runId: 'pi-usd-fixture',
      adapter: 'pi',
      config: {},
      tokenLimit: null,
      costLimitMicros: 1_000_000,
      state: { observedTokens: 0, observedCostMicros, costTotalUnknown: false },
      outcome: {},
      adapterRunner: async () => {
        launches += 1;
        return result;
      },
    },
  };
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

test('Pi USD accounting records a post-invocation threshold and skips candidate evaluation', async () => {
  if (!(await canTerminateProcessTree())) return;
  const { parent, root } = await fixture();
  let launches = 0;
  try {
    await assert.rejects(runEvolution({
      cwd: root,
      goal: 'fixture',
      adapter: 'pi',
      allowUnisolatedAgent: true,
      iterations: 1,
      adapterRunner: async ({ phase, maxUsdRemaining }) => {
        assert.equal(phase, 'proposal');
        assert.equal(maxUsdRemaining, 1);
        launches += 1;
        return {
          code: 0,
          timed_out: false,
          tree_termination_failed: false,
          budget_stop_reason: null,
          cost_budget_reached: false,
          stdout: '',
          stderr: '',
          reported_usage: { cost_complete: true, cost_currency: 'USD', reported_cost: 1.01, cost_source: 'pi fixture' },
        };
      },
    }), (error) => {
      assert.equal(error.code, 'RESOURCE_EXHAUSTED');
      assert.match(error.message, /USD cost estimate/);
      assert.doesNotMatch(error.message, /Claude/);
      return true;
    });
    assert.equal(launches, 1);

    const ledger = new Ledger(ledgerPath(root));
    try {
      const events = ledger.events();
      const failed = events.findLast((event) => event.event_type === 'run.failed');
      assert.ok(failed);
      const runId = failed.run_id;
      const started = events.find((event) => event.run_id === runId && event.event_type === 'run.started');
      assert.equal(started.payload.cost_budget_source, 'pi-cli usage.cost.total model-price estimate; post-invocation run-wide threshold');
      const observed = events.find((event) => event.run_id === runId && event.event_type === 'budget.usd.observed');
      assert.deepEqual([observed.payload.limit_usd, observed.payload.observed_total_usd, observed.payload.native_cap_reached], [1, 1.01, false]);
      const exhausted = events.find((event) => event.run_id === runId && event.event_type === 'budget.exhausted');
      assert.deepEqual([exhausted.payload.limit_usd, exhausted.payload.observed_total_usd, exhausted.payload.over_limit_usd], [1, 1.01, 0.01]);
      assert.equal(failed.payload.cost_estimate_total_usd, 1.01);
      assert.equal(failed.payload.cost_estimate_complete, true);
      assert.equal(events.some((event) => event.run_id === runId && event.event_type === 'gate.decision'), false);
      assert.equal(events.some((event) => event.run_id === runId && event.event_type === 'candidate.accepted'), false);
      assert.equal(ledger.verify().valid, true);
    } finally {
      ledger.close();
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('Pi USD accounting fails closed for missing cost and unconfirmed process termination', async () => {
  const incomplete = budgetedContext({
    code: 0, timed_out: false, tree_termination_failed: false, budget_stop_reason: null,
    cost_budget_reached: false,
    reported_usage: { cost_complete: false, cost_currency: null, reported_cost: null },
  });
  await assert.rejects(runBudgetedAdapter(incomplete.ctx, budgetedOptions), { code: 'USD_USAGE_UNAVAILABLE' });
  assert.equal(incomplete.launches(), 1);
  assert.equal(incomplete.events.some((event) => event.event_type === 'budget.cost_usage_unavailable'), true);

  const termination = budgetedContext({
    code: 0, timed_out: false, tree_termination_failed: true, budget_stop_reason: null,
    cost_budget_reached: false,
    reported_usage: { cost_complete: true, cost_currency: 'USD', reported_cost: 0.1 },
  });
  await assert.rejects(runBudgetedAdapter(termination.ctx, budgetedOptions), (error) => {
    assert.equal(error.code, 'RESOURCE_EXHAUSTED');
    assert.match(error.message, /agent process tree/);
    assert.doesNotMatch(error.message, /Claude/);
    return true;
  });
  assert.equal(termination.events.some((event) => event.event_type === 'budget.termination_failed'), true);

  const atLimit = budgetedContext({ code: 0 }, 1_000_000);
  await assert.rejects(runBudgetedAdapter(atLimit.ctx, budgetedOptions), { code: 'RESOURCE_EXHAUSTED' });
  assert.equal(atLimit.launches(), 0);
  assert.equal(atLimit.events[0].payload.over_limit_usd, 0);
});
