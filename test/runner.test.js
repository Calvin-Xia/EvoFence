import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Ledger, ledgerPath } from '../src/lib/ledger.js';
import { initializeRepository } from '../src/lib/init.js';
import { checkFinalCandidate, runEvolution } from '../src/lib/runner.js';
import { canTerminateProcessTree, runProcess } from '../src/lib/process.js';
import { setActiveGenerationRef } from '../src/lib/git.js';
import { parseYamlText, validateContract } from '../src/lib/contract.js';

test('final candidate validation honors approved capabilities and detects evidence mutations', async () => {
  const template = await readFile(path.resolve(import.meta.dirname, '..', 'templates', 'contract.yaml'), 'utf8');
  const parsed = validateContract(parseYamlText(template, 'contract.yaml'));
  const contract = { ...parsed, capabilities: { ...parsed.capabilities, network: 'allow' } };
  const proposal = { changed_surface: ['src/**'], requested_capabilities: ['network'] };
  const claims = { files_changed: ['src/main.js'], capabilities_used: ['network'], missing_evidence: [] };

  assert.deepEqual(checkFinalCandidate(contract, ['src/main.js'], proposal, claims, 'before', 'before'), { accepted: true });
  assert.equal(checkFinalCandidate(contract, ['src/main.js'], { ...proposal, requested_capabilities: [] }, claims, 'before', 'before').code, 'CAPABILITY_VIOLATION');
  assert.equal(checkFinalCandidate(contract, ['src/main.js'], proposal, claims, 'before', 'after').code, 'EVIDENCE_MODIFIED_CANDIDATE');
  assert.equal(checkFinalCandidate(contract, ['tests/attack.test.js'], proposal, claims, 'before', 'before').code, 'POLICY_VIOLATION');
});

test('one evolution is evaluated, committed, pinned, and can be rolled back', async () => {
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), 'evofence-runner-'));
  const root = path.join(temporaryParent, 'project');
  await mkdir(root, { recursive: true });
  try {
    await writeFile(path.join(root, 'feature.txt'), '0\n');
    await writeFile(path.join(root, 'score.js'), "import { readFileSync } from 'node:fs'; process.stdout.write(`${Number(readFileSync('feature.txt', 'utf8'))}\\n`);\n");
    await writeFile(path.join(root, 'check.js'), "import { readFileSync } from 'node:fs'; if (!Number.isFinite(Number(readFileSync('feature.txt', 'utf8')))) process.exit(1);\n");
    let result = await runProcess('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root, timeoutMs: 10000 });
    assert.equal(result.code, 0, result.stderr);
    for (const [key, value] of [['user.name', 'Fixture'], ['user.email', 'fixture@example.invalid']]) {
      result = await runProcess('git', ['config', key, value], { cwd: root, timeoutMs: 10000 });
      assert.equal(result.code, 0, result.stderr);
    }
    assert.equal((await runProcess('git', ['add', '-A'], { cwd: root })).code, 0);
    assert.equal((await runProcess('git', ['commit', '--quiet', '-m', 'fixture baseline'], { cwd: root })).code, 0);
    await initializeRepository(root);
    assert.equal((await initializeRepository(root)).existing, true);
    const adapterConfig = await readFile(path.join(root, '.evofence', 'config.yaml'), 'utf8');
    assert.match(adapterConfig, /claude:\s+command: claude/);
    const contract = [
      'contract_version: 1', 'objective:', '  name: score', '  command: "node score.js"', '  direction: maximize', '  min_delta: 0.1',
      'hard_invariants:', '  - id: score-file-valid', '    command: "node check.js"', 'allowed_evolution_surface:', '  - "**/*"',
      'protected_paths:', '  - ".evofence/**"', '  - "tests/**"', '  - "**/*.test.*"', '  - "package.json"', 'capabilities:',
      '  authority_ceiling: A2', '  network: deny', '  dependency_install: deny', '  credentials: deny', '  external_api: deny',
      '  shell:', '    mode: evidence_commands_only', 'evidence:', '  public_commands: []', '  per_command_timeout_ms: 5000',
      '  max_output_bytes: 8192', 'acceptance:', '  require_proposal: true', '  require_claims: true',
      '  require_objective_improvement: true', '  require_rollback_point: true', '  hidden_regression_tolerance: 0', 'budgets:',
      '  max_iterations: 20', '  max_wall_clock_ms: 120000', '  max_failed_candidates: 5', '  max_consecutive_no_improvement: 3',
      '  max_tokens: null', '  max_usd: null', '',
    ].join('\n');
    await writeFile(path.join(root, '.evofence', 'contract.yaml'), contract);

    const resultRun = await runEvolution({
      cwd: root,
      goal: 'Increase the score by changing feature.txt.',
      adapter: 'pi',
      iterations: 20,
      allowUnisolatedAgent: true,
      onProgress: () => {},
      adapterRunner: async ({ worktree, phase }) => {
        const output = path.join(worktree, '.evofence-out');
        if (phase === 'proposal') {
          const task = await readFile(path.join(worktree, '.evofence-task.md'), 'utf8');
          const iteration = Number(task.match(/^Iteration: (\d+)$/m)?.[1]);
          const baseSha = task.match(/^Base generation: ([0-9a-f]{40,64})$/m)?.[1];
          await writeFile(path.join(output, 'proposal.json'), JSON.stringify({
            iteration, base_sha: baseSha, hypothesis: 'A higher score value helps.',
            problem_evidence: ['The baseline score is zero.'], proposed_change: 'Set the score to one.',
            changed_surface: ['feature.txt'],
            expected_effect: { primary_metric: 'score', direction: 'increase', minimum_practical_effect: '0.1' },
            possible_regressions: ['The parser may reject the value.'], requested_capabilities: [],
            falsification_plan: ['Run the invariant and score command.'], rollback_plan: 'Restore the parent generation.',
          }));
        } else {
          const task = await readFile(path.join(worktree, '.evofence-task.md'), 'utf8');
          const iteration = Number(task.match(/^Iteration: (\d+)$/m)?.[1]);
          await writeFile(path.join(worktree, 'feature.txt'), `${iteration}\n`);
          await writeFile(path.join(output, 'claims.json'), JSON.stringify({
            status: 'CANDIDATE_READY', claims: [], tests_executed: [], known_failures: [], missing_evidence: [],
            files_changed: ['feature.txt'], capabilities_used: [], suggested_gate_checks: [],
          }));
        }
        return {
          code: 0, timed_out: false, stdout: '', stderr: '', estimated_tokens: 42,
          tool_strategy: {
            schema_version: 1, status: 'active', phase, initial_tool_order: ['read'], final_tool_order: ['read'],
            tool_order_updates: 0, tool_calls: 1, tool_results: 1, tool_errors: 0,
            repeated_call_blocks: 0, controller_errors: 0, telemetry_truncated: false, agent_finished: true,
            tools: [{ name: 'read', calls: 1, results: 1, errors: 0 }],
          },
          reported_usage: { tokens_total: 42, tokens_complete: true, token_source: 'fixture', reported_cost: null, cost_complete: false, cost_currency: null, cost_source: null },
        };
      },
    });
    assert.equal(resultRun.status, 'ACCEPTED');
    assert.equal(resultRun.iterations.length, 20);
    assert.ok(resultRun.iterations.every((item) => item.decision === 'ACCEPT'));
    assert.equal(resultRun.active_generation.sha, resultRun.iterations.at(-1).sha);
    assert.equal(resultRun.iterations[0].improvement, 1);

    const ledger = new Ledger(ledgerPath(root));
    try {
      assert.equal(ledger.verify().valid, true);
      assert.equal(ledger.generations().length, 21);
      const firstAdapterEvent = ledger.events().find((item) => item.event_type === 'adapter.finished');
      assert.equal(firstAdapterEvent.payload.reported_usage.tokens_total, 42);
      assert.equal(firstAdapterEvent.payload.tool_strategy.status, 'active');
      assert.deepEqual(firstAdapterEvent.payload.tool_strategy.initial_tool_order, ['read']);
      const baseline = ledger.generations()[0];
      ledger.rollback(baseline.generation_id);
      await setActiveGenerationRef(root, baseline.sha);
      assert.equal(ledger.activeGeneration().generation_id, baseline.generation_id);
      assert.equal(ledger.verify().valid, true);
    } finally { ledger.close(); }

    const protectedChange = await runEvolution({
      cwd: root,
      goal: 'Weaken the tests to improve the score.',
      adapter: 'codex',
      iterations: 1,
      onProgress: () => {},
      adapterRunner: async ({ worktree, phase }) => {
        const output = path.join(worktree, '.evofence-out');
        if (phase === 'proposal') {
          const task = await readFile(path.join(worktree, '.evofence-task.md'), 'utf8');
          const iteration = Number(task.match(/^Iteration: (\d+)$/m)?.[1]);
          const baseSha = task.match(/^Base generation: ([0-9a-f]{40,64})$/m)?.[1];
          await writeFile(path.join(output, 'proposal.json'), JSON.stringify({
            iteration, base_sha: baseSha, hypothesis: 'Skipping a regression test raises the score.',
            problem_evidence: ['The test takes time.'], proposed_change: 'Change a protected test.', changed_surface: ['tests/test_score.js'],
            expected_effect: { primary_metric: 'score', direction: 'increase', minimum_practical_effect: '0.1' },
            possible_regressions: ['The test could stop checking behavior.'], requested_capabilities: [],
            falsification_plan: ['Inspect the modified test.'], rollback_plan: 'Restore the parent generation.',
          }));
        } else {
          await mkdir(path.join(worktree, 'tests'), { recursive: true });
          await writeFile(path.join(worktree, 'tests', 'test_score.js'), 'process.exit(0);\n');
          await writeFile(path.join(output, 'claims.json'), JSON.stringify({
            status: 'CANDIDATE_READY', claims: [], tests_executed: [], known_failures: [], missing_evidence: [],
            files_changed: ['tests/test_score.js'], capabilities_used: [], suggested_gate_checks: [],
          }));
        }
        return { code: 0, timed_out: false, stdout: '', stderr: '', estimated_tokens: null };
      },
    });
    assert.equal(protectedChange.status, 'QUARANTINE');
    assert.equal(protectedChange.iterations[0].decision, 'QUARANTINE');
    const finalLedger = new Ledger(ledgerPath(root));
    try {
      assert.equal(finalLedger.activeGeneration().generation_id, 'g0-'.concat(resultRun.base_sha.slice(0, 12)));
      assert.equal(finalLedger.verify().valid, true);
    } finally { finalLedger.close(); }

    const contractFile = path.join(root, '.evofence', 'contract.yaml');
    const savedContract = await readFile(contractFile, 'utf8');
    await writeFile(contractFile, savedContract.replace('max_tokens: null', 'max_tokens: 100'));
    let claudeBudgetCalls = 0;
    await assert.rejects(runEvolution({
      cwd: root,
      goal: 'no-op',
      adapter: 'claude',
      allowUnisolatedAgent: true,
      adapterRunner: async () => {
        claudeBudgetCalls += 1;
        throw new Error('Claude must not launch with an unsupported token budget.');
      },
    }), { code: 'UNSUPPORTED_CLAUDE_TOKEN_BUDGET' });
    assert.equal(claudeBudgetCalls, 0);

    if (await canTerminateProcessTree()) {
      let budgetedCalls = 0;
      await assert.rejects(runEvolution({
        cwd: root,
        goal: 'no-op',
        adapterRunner: async ({ phase }) => {
          budgetedCalls += 1;
          assert.equal(phase, 'proposal');
          return { code: 0, timed_out: false, stdout: '', stderr: '', reported_usage: { tokens_total: 115, tokens_complete: true } };
        },
      }), { code: 'RESOURCE_EXHAUSTED' });
      assert.equal(budgetedCalls, 1);

      await assert.rejects(runEvolution({
        cwd: root,
        goal: 'no-op',
        adapterRunner: async () => ({ code: 0, timed_out: false, stdout: '', stderr: '', reported_usage: { tokens_total: null, tokens_complete: false } }),
      }), { code: 'TOKEN_USAGE_UNAVAILABLE' });
      const budgetLedger = new Ledger(ledgerPath(root));
      try {
        const events = budgetLedger.events();
        const exhausted = events.findLast((item) => item.event_type === 'budget.exhausted');
        const exhaustedRun = events.find((item) => item.event_type === 'run.failed' && item.run_id === exhausted.run_id);
        const unavailable = events.findLast((item) => item.event_type === 'budget.usage_unavailable');
        assert.equal(exhausted.payload.observed_total, 115);
        assert.equal(exhaustedRun.payload.token_usage_total, 115);
        assert.equal(unavailable.payload.reason, 'usage_incomplete');
        assert.equal(budgetLedger.verify().valid, true);
      } finally { budgetLedger.close(); }
    } else {
      let budgetedCalls = 0;
      await assert.rejects(runEvolution({
        cwd: root,
        goal: 'no-op',
        adapterRunner: async () => {
          budgetedCalls += 1;
          throw new Error('should not launch');
        },
      }), { code: 'UNSUPPORTED_TOKEN_BUDGET_PROCESS_CONTROL' });
      assert.equal(budgetedCalls, 0);
    }
    await writeFile(contractFile, savedContract);

    let unisolatedClaudeCalls = 0;
    await assert.rejects(runEvolution({
      cwd: root,
      goal: 'no-op',
      adapter: 'claude',
      adapterRunner: async () => {
        unisolatedClaudeCalls += 1;
        throw new Error('Claude must not launch without explicit isolation acceptance.');
      },
    }), { code: 'CLAUDE_SANDBOX_REQUIRED' });
    assert.equal(unisolatedClaudeCalls, 0);

    await writeFile(contractFile, savedContract.replace('max_usd: null', 'max_usd: 1'));
    await assert.rejects(runEvolution({ cwd: root, goal: 'no-op', adapterRunner: async () => { throw new Error('should not launch'); } }), { code: 'UNSUPPORTED_COST_BUDGET' });

    if (await canTerminateProcessTree()) {
      const claudeUsdCaps = [];
      await assert.rejects(runEvolution({
        cwd: root,
        goal: 'no-op',
        adapter: 'claude',
        allowUnisolatedAgent: true,
        iterations: 1,
        adapterRunner: async ({ worktree, phase, maxUsdRemaining }) => {
          claudeUsdCaps.push({ phase, maxUsdRemaining });
          if (phase === 'proposal') {
            const task = await readFile(path.join(worktree, '.evofence-task.md'), 'utf8');
            const iteration = Number(task.match(/^Iteration: (\d+)$/m)?.[1]);
            const baseSha = task.match(/^Base generation: ([0-9a-f]{40,64})$/m)?.[1];
            await writeFile(path.join(worktree, '.evofence-out', 'proposal.json'), JSON.stringify({
              iteration, base_sha: baseSha, hypothesis: 'Improve the objective with a focused change.',
              problem_evidence: ['The current value can improve.'], proposed_change: 'Update the feature value.',
              changed_surface: ['feature.txt'],
              expected_effect: { primary_metric: 'score', direction: 'increase', minimum_practical_effect: '0.1' },
              possible_regressions: ['The parser could reject the value.'], requested_capabilities: [],
              falsification_plan: ['Run the configured invariant.'], rollback_plan: 'Restore the parent generation.',
            }));
          }
          return {
            code: 0, timed_out: false, stdout: '', stderr: '',
            cost_budget_reached: phase === 'implementation',
            reported_usage: {
              tokens_total: null, tokens_complete: false,
              reported_cost: phase === 'proposal' ? 0.6 : 0.41,
              cost_complete: true, cost_currency: 'USD', cost_source: 'fixture',
            },
          };
        },
      }), { code: 'RESOURCE_EXHAUSTED' });
      assert.deepEqual(claudeUsdCaps, [
        { phase: 'proposal', maxUsdRemaining: 1 },
        { phase: 'implementation', maxUsdRemaining: 0.4 },
      ]);

      let usdFailureRunId;
      const costLedger = new Ledger(ledgerPath(root));
      try {
        const events = costLedger.events();
        const failed = events.findLast((item) => item.event_type === 'run.failed' && item.payload.cost_budget_usd === 1);
        assert.ok(failed);
        usdFailureRunId = failed.run_id;
        assert.equal(failed.payload.code, 'RESOURCE_EXHAUSTED');
        assert.equal(failed.payload.cost_estimate_total_usd, 1.01);
        assert.equal(failed.payload.cost_estimate_complete, true);
        assert.equal(events.some((item) => item.run_id === usdFailureRunId && item.event_type === 'candidate.accepted'), false);
        assert.equal(events.some((item) => item.run_id === usdFailureRunId && item.event_type === 'gate.decision'), false);
        const exhausted = events.find((item) => item.run_id === usdFailureRunId && item.event_type === 'budget.exhausted');
        assert.equal(exhausted.payload.observed_total_usd, 1.01);
        assert.equal(costLedger.verify().valid, true);
      } finally { costLedger.close(); }

      await assert.rejects(runEvolution({
        cwd: root,
        goal: 'no-op',
        adapter: 'claude',
        allowUnisolatedAgent: true,
        adapterRunner: async () => ({ code: 0, timed_out: false, stdout: '', stderr: '' }),
      }), { code: 'USD_USAGE_UNAVAILABLE' });
      const unavailableCostLedger = new Ledger(ledgerPath(root));
      try {
        const events = unavailableCostLedger.events();
        const failed = events.findLast((item) => item.event_type === 'run.failed' && item.payload.code === 'USD_USAGE_UNAVAILABLE');
        assert.ok(failed);
        assert.equal(failed.payload.cost_estimate_total_usd, null);
        assert.equal(failed.payload.cost_estimate_complete, false);
        assert.equal(events.some((item) => item.run_id === failed.run_id && item.event_type === 'budget.cost_usage_unavailable'), true);
        assert.equal(events.some((item) => item.run_id === failed.run_id && item.event_type === 'gate.decision'), false);
        assert.equal(unavailableCostLedger.verify().valid, true);
      } finally { unavailableCostLedger.close(); }
    } else {
      let costBudgetCalls = 0;
      await assert.rejects(runEvolution({
        cwd: root,
        goal: 'no-op',
        adapter: 'claude',
        allowUnisolatedAgent: true,
        adapterRunner: async () => {
          costBudgetCalls += 1;
          throw new Error('Claude must not launch when process-tree termination is unavailable.');
        },
      }), { code: 'UNSUPPORTED_COST_BUDGET_PROCESS_CONTROL' });
      assert.equal(costBudgetCalls, 0);
    }
    await writeFile(contractFile, savedContract);

    let terminationFailureCalls = 0;
    await assert.rejects(runEvolution({
      cwd: root,
      goal: 'no-op',
      iterations: 1,
      adapterRunner: async () => {
        terminationFailureCalls += 1;
        return { code: 0, timed_out: false, tree_termination_failed: true, stdout: '', stderr: '' };
      },
    }), { code: 'RESOURCE_EXHAUSTED' });
    assert.equal(terminationFailureCalls, 1);
    const terminationLedger = new Ledger(ledgerPath(root));
    try {
      const events = terminationLedger.events();
      const failure = events.findLast((item) => item.event_type === 'process.tree_termination_failed');
      assert.ok(failure);
      assert.equal(events.some((item) => item.run_id === failure.run_id && item.event_type === 'gate.decision'), false);
      assert.equal(terminationLedger.verify().valid, true);
    } finally { terminationLedger.close(); }

    const holdoutFile = path.join(root, '.evofence', 'private', 'holdout.yaml');
    const savedHoldout = await readFile(holdoutFile, 'utf8');
    await writeFile(holdoutFile, "regressions:\n  - id: hidden-1\n    command: \"node -e 'process.exit(0)'\"\n");
    await assert.rejects(runEvolution({ cwd: root, goal: 'no-op', adapterRunner: async () => { throw new Error('should not launch'); } }), { code: 'PRIVATE_ORACLE_READABLE' });
    await writeFile(holdoutFile, savedHoldout);

    const trees = await runProcess('git', ['worktree', 'list', '--porcelain'], { cwd: root });
    assert.equal(trees.stdout.split(/\r?\n/).filter((line) => line.startsWith('worktree ')).length, 1);
  } finally {
    const resolvedTemp = path.resolve(temporaryParent);
    assert.ok(resolvedTemp.startsWith(path.resolve(os.tmpdir())));
    await rm(resolvedTemp, { recursive: true, force: true });
  }
});
