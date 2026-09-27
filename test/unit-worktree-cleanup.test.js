// Isolation regression oracles for candidate-worktree teardown and the per-repo temp parent.
//
// Why this file exists (node `l3_tests_unit`, DoD 4; review F1): `test/runner.test.js` asserts
// `git worktree list` is back to one tree, but that assertion sits at the very END of a single
// 20-iteration case. It cannot prove that each iteration's `removeCandidate()` ran, that the
// exception path cleans up, that repeated runs do not accumulate temp directories, or that a
// concurrently running sibling's temp directory survives. `src/lib/exec/worktree-temp.ts` is the
// observable point: `runEvolution`'s `finally` removes the per-run directory and then releases
// the shared `<TMPDIR>/evofence-worktrees/<repoId>` parent only when it is empty.
//
// The end-to-end case below therefore samples the live state from inside the adapter (proving the
// fixture really created a worktree and a run directory) and then asserts the post-run state.
// ADR-0004: imports point at the build output (`dist/`); `npm test` builds first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupEmptyWorktreeTempParent,
  repositoryId,
  runTempRoot,
  worktreeTempParent,
} from '../dist/lib/exec/worktree-temp.js';
import { removeCandidate } from '../dist/lib/exec/runner-candidate.js';
import { openTreeCount, repositoryRoot } from '../dist/lib/git.js';
import { initializeRepository } from '../dist/lib/init.js';
import { runProcess } from '../dist/lib/process.js';
import { runEvolution } from '../dist/lib/runner.js';

const SHARED_TEMP_ROOT = path.join(os.tmpdir(), 'evofence-worktrees');

/** Directories currently present under the machine-wide shared temp root (empty when absent). */
function sharedTempEntries() {
  return existsSync(SHARED_TEMP_ROOT) ? readdirSync(SHARED_TEMP_ROOT) : [];
}

async function withScratchDirectory(prefix, body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function git(cwd, args, timeoutMs = 60000) {
  const result = await runProcess('git', args, { cwd, timeoutMs, maxOutputBytes: 100000 });
  assert.equal(result.code, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

test('worktreeTempParent is deterministic, per-checkout, and inside the OS temp directory', async () => {
  await withScratchDirectory('evofence-tempparent-', async (directory) => {
    const first = path.join(directory, 'checkout-a');
    const second = path.join(directory, 'checkout-b');
    const parent = worktreeTempParent(first);

    assert.equal(path.dirname(parent), SHARED_TEMP_ROOT);
    assert.match(path.basename(parent), /^[0-9a-f]{16}$/, 'the repo id must be a 16-hex digest');
    assert.equal(parent, worktreeTempParent(first), 'the same checkout must map to the same parent');
    assert.equal(worktreeTempParent(first.toUpperCase()), parent, 'path casing must not split the parent (Windows)');
    assert.notEqual(worktreeTempParent(second), parent, 'a sibling checkout must not share the parent');
    assert.equal(repositoryId(first), path.basename(parent));
  });
});

test('runTempRoot nests the per-run directory strictly inside the shared temp parent', () => {
  const parent = worktreeTempParent(path.join(os.tmpdir(), 'evofence-temproot-checkout'));
  const runRoot = runTempRoot(parent, 'run-20240101-abcdef12');
  assert.equal(path.dirname(runRoot), parent);
  assert.equal(path.relative(parent, runRoot), 'run-20240101-abcdef12');
  assert.equal(path.relative(parent, runRoot).startsWith('..'), false);
});

test('cleanupEmptyWorktreeTempParent removes only an empty parent and never disturbs a sibling', async () => {
  await withScratchDirectory('evofence-tempcleanup-', async (directory) => {
    const parent = path.join(directory, 'evofence-worktrees', 'repo-id');
    assert.equal(await cleanupEmptyWorktreeTempParent(parent), false, 'a missing parent is reported, not thrown');

    await mkdir(parent, { recursive: true });
    assert.equal(await cleanupEmptyWorktreeTempParent(parent), true);
    assert.equal(existsSync(parent), false);

    await mkdir(path.join(parent, 'run-a'), { recursive: true });
    await mkdir(path.join(parent, 'run-b'), { recursive: true });
    assert.equal(await cleanupEmptyWorktreeTempParent(parent), false, 'a parent with live runs must survive');
    assert.deepEqual((await readdir(parent)).sort(), ['run-a', 'run-b']);

    await rmdir(path.join(parent, 'run-a'));
    assert.equal(await cleanupEmptyWorktreeTempParent(parent), false);
    assert.deepEqual(await readdir(parent), ['run-b'], "the concurrent sibling's run directory must be untouched");

    await rmdir(path.join(parent, 'run-b'));
    assert.equal(await cleanupEmptyWorktreeTempParent(parent), true, 'the last leaver releases the parent');
    assert.equal(existsSync(parent), false);
  });
});

test('removeCandidate refuses a worktree that escapes the run temp root', async () => {
  await withScratchDirectory('evofence-removeescape-', async (directory) => {
    const root = path.join(directory, 'checkout');
    const parent = worktreeTempParent(root);
    const runRoot = runTempRoot(parent, 'run-a');

    await assert.rejects(
      removeCandidate(root, path.join(os.tmpdir(), 'evofence-outside'), runRoot),
      { code: 'PATH_ESCAPE' },
      'an absolute path outside the run temp root must be refused before git runs',
    );
    await assert.rejects(
      removeCandidate(root, path.join(parent, 'run-b', 'iteration-1'), runRoot),
      { code: 'PATH_ESCAPE' },
      "a concurrent sibling run's worktree must not be removable",
    );
    await assert.rejects(
      removeCandidate(root, parent, runRoot),
      { code: 'PATH_ESCAPE' },
      'the shared parent itself is not a candidate worktree',
    );
  });
});

test('removeCandidate deletes a registered candidate worktree and stays idempotent', async () => {
  await withScratchDirectory('evofence-removecandidate-', async (directory) => {
    const root = path.join(directory, 'project');
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'feature.txt'), '0\n');
    await git(root, ['init', '--quiet', '--initial-branch=main']);
    await git(root, ['config', 'user.name', 'Fixture']);
    await git(root, ['config', 'user.email', 'fixture@example.invalid']);
    await git(root, ['add', '-A']);
    await git(root, ['commit', '--quiet', '-m', 'baseline']);

    const runnerRoot = await repositoryRoot(root);
    const runRoot = runTempRoot(worktreeTempParent(runnerRoot), 'run-a');
    const worktree = path.join(runRoot, 'iteration-1');
    await mkdir(runRoot, { recursive: true });
    await git(root, ['worktree', 'add', '--detach', worktree, 'HEAD']);
    assert.equal(await openTreeCount(root), 2, 'the candidate worktree must be registered before teardown');

    await removeCandidate(root, worktree, runRoot);
    assert.equal(await openTreeCount(root), 1, 'removeCandidate must deregister the candidate worktree');
    assert.equal(existsSync(worktree), false, 'the candidate directory must be gone from disk');

    // 0.3.0 tolerated a second teardown; the exception path in `runEvolution` relies on it.
    await removeCandidate(root, worktree, runRoot);
    assert.equal(await openTreeCount(root), 1);
  });
});

// The same contract `test/runner.test.js` drives, kept small: two accepting iterations is enough
// to exercise per-iteration teardown, and the default (codex) adapter needs no isolation opt-in.
const CONTRACT = [
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

async function buildFixture(directory) {
  const root = path.join(directory, 'project');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'feature.txt'), '0\n');
  await writeFile(path.join(root, 'score.js'), "import { readFileSync } from 'node:fs'; process.stdout.write(`${Number(readFileSync('feature.txt', 'utf8'))}\\n`);\n");
  await writeFile(path.join(root, 'check.js'), "import { readFileSync } from 'node:fs'; if (!Number.isFinite(Number(readFileSync('feature.txt', 'utf8')))) process.exit(1);\n");
  await git(root, ['init', '--quiet', '--initial-branch=main']);
  await git(root, ['config', 'user.name', 'Fixture']);
  await git(root, ['config', 'user.email', 'fixture@example.invalid']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  await git(root, ['config', 'core.autocrlf', 'false']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '--quiet', '-m', 'fixture baseline']);
  await initializeRepository(root);
  await writeFile(path.join(root, '.evofence', 'contract.yaml'), CONTRACT);
  return { root, runnerRoot: await repositoryRoot(root) };
}

/** A minimal accepting adapter: proposal, then a one-line implementation. */
async function acceptingAdapter({ worktree, phase }) {
  const output = path.join(worktree, '.evofence-out');
  const task = await readFile(path.join(worktree, '.evofence-task.md'), 'utf8');
  const iteration = Number(task.match(/^Iteration: (\d+)$/m)?.[1]);
  if (phase === 'proposal') {
    const baseSha = task.match(/^Base generation: ([0-9a-f]{40,64})$/m)?.[1];
    await writeFile(path.join(output, 'proposal.json'), JSON.stringify({
      iteration, base_sha: baseSha, hypothesis: 'A higher score value helps.',
      problem_evidence: ['The baseline score is zero.'], proposed_change: 'Set the score to the iteration.',
      changed_surface: ['feature.txt'],
      expected_effect: { primary_metric: 'score', direction: 'increase', minimum_practical_effect: '0.1' },
      possible_regressions: ['The parser may reject the value.'], requested_capabilities: [],
      falsification_plan: ['Run the invariant and score command.'], rollback_plan: 'Restore the parent generation.',
    }));
  } else {
    await writeFile(path.join(worktree, 'feature.txt'), `${iteration}\n`);
    await writeFile(path.join(output, 'claims.json'), JSON.stringify({
      status: 'CANDIDATE_READY', claims: [], tests_executed: [], known_failures: [], missing_evidence: [],
      files_changed: ['feature.txt'], capabilities_used: [], suggested_gate_checks: [],
    }));
  }
  return {
    code: 0, timed_out: false, stdout: '', stderr: '', estimated_tokens: 42,
    reported_usage: { tokens_total: 42, tokens_complete: true, token_source: 'fixture', reported_cost: null, cost_complete: false, cost_currency: null, cost_source: null },
  };
}

test('a finished evolution leaves no candidate worktree, no run directory, and no shared temp parent', async () => {
  await withScratchDirectory('evofence-worktree-e2e-', async (directory) => {
    const { root, runnerRoot } = await buildFixture(directory);
    const tempParent = worktreeTempParent(runnerRoot);
    assert.equal(existsSync(tempParent), false, 'the fixture must start with no shared temp parent');
    assert.equal(await openTreeCount(root), 1);

    // Sample the live state from inside the adapter: this is the proof that the post-run
    // assertions below are not vacuous (the run really did create a worktree + a run directory).
    let live = null;
    const result = await runEvolution({
      cwd: root,
      goal: 'Increase the score by changing feature.txt.',
      iterations: 2,
      onProgress: () => {},
      adapterRunner: async (options) => {
        if (live === null) {
          live = {
            worktreeInsideParent: path.resolve(options.worktree).startsWith(`${path.resolve(tempParent)}${path.sep}`),
            parentExists: existsSync(tempParent),
            runDirectories: existsSync(tempParent) ? readdirSync(tempParent) : [],
            treeCount: await openTreeCount(root),
          };
        }
        return acceptingAdapter(options);
      },
    });
    assert.equal(result.status, 'ACCEPTED');
    assert.equal(result.iterations.length, 2);

    assert.ok(live, 'the adapter must have been invoked');
    assert.equal(live.parentExists, true, 'the shared temp parent must exist while the run is live');
    assert.equal(live.runDirectories.length, 1, "exactly this run's directory must live under the shared parent");
    assert.equal(live.worktreeInsideParent, true, 'the candidate worktree must live under the shared temp parent');
    assert.equal(live.treeCount, 2, 'the candidate worktree must be registered while the run is live');

    assert.equal(await openTreeCount(root), 1, 'no candidate worktree may survive the run');
    assert.equal(existsSync(tempParent), false, 'the empty shared temp parent must be released after the run');
    assert.equal(sharedTempEntries().includes(repositoryId(runnerRoot)), false, 'no per-repo directory may be left behind');

    // The exception path: an adapter that throws must still tear the candidate worktree and the
    // run directory down (this is the case the end-of-case assertion in runner.test.js misses).
    let liveOnFailure = null;
    await assert.rejects(
      runEvolution({
        cwd: root,
        goal: 'no-op',
        adapterRunner: async (options) => {
          liveOnFailure = {
            parentExists: existsSync(tempParent),
            treeCount: await openTreeCount(root),
            worktreeInsideParent: path.resolve(options.worktree).startsWith(`${path.resolve(tempParent)}${path.sep}`),
          };
          throw new Error('adapter exploded');
        },
      }),
      /adapter exploded/,
    );
    assert.equal(liveOnFailure.parentExists, true, 'the failing run must have created its run directory');
    assert.equal(liveOnFailure.treeCount, 2, 'the failing run must have created its candidate worktree');
    assert.equal(liveOnFailure.worktreeInsideParent, true);

    assert.equal(await openTreeCount(root), 1, 'the exception path must deregister the candidate worktree');
    assert.equal(existsSync(tempParent), false, 'the exception path must release the shared temp parent');
    assert.equal(sharedTempEntries().includes(repositoryId(runnerRoot)), false, 'repeated runs must not accumulate per-repo directories');
  });
});
