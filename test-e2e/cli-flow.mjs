// End-to-end CLI smoke: real processes, real Git repositories, real ledgers (node `l3_tests_e2e`).
//
// WHY THIS FILE EXISTS
// --------------------
// `test/cli-surface.test.js` drives every subcommand through the manifest (`src/lib/cli/catalog.ts`)
// and pins the recorded exit codes, but it does so against *seeded* fixtures: the ledger events and
// the accepted generation are appended by hand. This suite is the other half of DoD 2 — it drives the
// real flow end to end inside a throwaway Git repository:
//
//   init  ->  run (through a stub adapter the runner dispatches like any other agent)  ->  every
//   downstream command against the ledger that run actually produced.
//
// It also owns the two failure paths the DoD calls out (DoD 3):
//   1. an invalid `.evofence/config.yaml` (unknown field and a missing required field) exits non-zero;
//   2. a tampered ledger hash chain makes `ledger verify` exit non-zero.
//
// ISOLATION: every fixture is created under `os.tmpdir()`, so a smoke run writes nothing inside the
// checkout and `git status --short` is unchanged (DoD 4). The stub adapter never lives in the repo:
// it is emitted into a sibling `tools/` directory of the temp fixture.
//
// WHY IT LIVES IN `test-e2e/` AND NOT `test/`
// ------------------------------------------
// `node --test` with no explicit path discovers EVERY `.js`/`.mjs`/`.cjs` file under a `test/`
// directory, not just `*.test.*`. Because the runner runs test files in parallel, this suite's many
// CLI subprocesses (each a fresh Node + SQLite + Git) starve the wall-clock budgets in the
// timing-sensitive `test/runner.test.js`, which then fails with RESOURCE_EXHAUSTED. Keeping the
// smoke out of the discovered tree preserves the `npm test` baseline exactly (204 cases) and runs
// this suite on demand via `npm run test:e2e`.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger, ledgerPath } from '../dist/lib/ledger.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const IS_WINDOWS = process.platform === 'win32';
const BASELINE_SCORE = '0.5';
const STEP = 0.25;
const MIN_DELTA = 0.2;

/* ------------------------------------------------------------------ *
 * Fixture helpers
 * ------------------------------------------------------------------ */

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

/** Spawn the built CLI the way a user would; never throws, always returns `{status, stdout, stderr}`. */
function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
}

async function makeRepo(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `evofence-e2e-${prefix}-`));
  const root = path.join(directory, 'repo');
  await mkdir(root, { recursive: true });
  runGit(root, ['init', '--quiet', '--initial-branch=main']);
  runGit(root, ['config', 'user.name', 'EvoFence E2E']);
  runGit(root, ['config', 'user.email', 'e2e@example.invalid']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  runGit(root, ['config', 'core.autocrlf', 'false']);
  return { directory, root };
}

/**
 * The stub adapter the runner dispatches for `run` / `experiment run`.
 *
 * The real `runAgentAdapter` builds a Codex-style argv, exports `EVOFENCE_*` for the evidence
 * commands only, and spawns the command named by `adapters.codex.command` with the candidate
 * worktree as cwd. The stub therefore reads the controller task file to learn its phase and, for
 * phase two, the base generation it must declare in the proposal.
 */
const STUB_ADAPTER_SOURCE = `
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cwd = process.cwd();
const task = await readFile(path.join(cwd, '.evofence-task.md'), 'utf8');
const phase = (/^Phase:\\s*(\\S+)/m.exec(task) || [])[1] || '';
const iteration = Number((/^Iteration:\\s*(\\d+)/m.exec(task) || [])[1] || '1');
const baseSha = (/^Base generation:\\s*(\\S+)/m.exec(task) || [])[1] || '';

if (phase === 'proposal') {
  const proposal = {
    iteration,
    base_sha: baseSha,
    hypothesis: 'rewriting the recorded score raises the objective metric',
    proposed_change: 'write the improved score into score.txt',
    problem_evidence: ['objective.mjs reads the recorded score from score.txt'],
    changed_surface: ['score.txt'],
    possible_regressions: ['a hard-coded score can be gamed by a future candidate'],
    requested_capabilities: [],
    falsification_plan: ['run objective.mjs and check the printed value'],
    rollback_plan: 'git checkout the base generation -- score.txt',
    expected_effect: {
      primary_metric: 'quality_score',
      direction: 'increase',
      minimum_practical_effect: 'at least +${MIN_DELTA}',
    },
  };
  await writeFile(path.join(cwd, '.evofence-out', 'proposal.json'), JSON.stringify(proposal, null, 2) + '\\n');
} else if (phase === 'implementation') {
  const current = Number((await readFile(path.join(cwd, 'score.txt'), 'utf8')).trim());
  const next = Math.round((current + ${STEP}) * 100) / 100;
  await writeFile(path.join(cwd, 'score.txt'), String(next) + '\\n');
  const claims = {
    status: 'CANDIDATE_READY',
    claims: ['score.txt now reports the improved value'],
    tests_executed: ['node objective.mjs'],
    known_failures: [],
    missing_evidence: [],
    files_changed: ['score.txt'],
    capabilities_used: [],
    suggested_gate_checks: [],
  };
  await writeFile(path.join(cwd, '.evofence-out', 'claims.json'), JSON.stringify(claims, null, 2) + '\\n');
}

process.stdout.write(JSON.stringify({ type: 'stub-adapter', phase: phase }) + '\\n');
`;

function posixWrapper(script) {
  const quote = (value) => value.replace(/(["\\$`])/g, '\\$1');
  return `#!/bin/sh\nexec "${quote(process.execPath)}" "${quote(script)}" "$@"\n`;
}

function windowsWrapper(script) {
  return `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`;
}

/** Emit the executable stub into `<fixture>/tools/` (outside the repository) and return its path. */
async function installStub(directory) {
  const tools = path.join(directory, 'tools');
  await mkdir(tools, { recursive: true });
  const script = path.join(tools, 'stub-adapter.mjs');
  await writeFile(script, STUB_ADAPTER_SOURCE, 'utf8');
  const wrapper = path.join(tools, IS_WINDOWS ? 'stub-adapter.cmd' : 'stub-adapter.sh');
  await writeFile(wrapper, IS_WINDOWS ? windowsWrapper(script) : posixWrapper(script), 'utf8');
  if (!IS_WINDOWS) await chmod(wrapper, 0o755);
  return wrapper;
}

/** The `adapters.codex.command` value: quoted on Windows so a path with spaces survives `cmd /c`. */
function stubCommand(wrapper) {
  return IS_WINDOWS ? `"${wrapper}"` : wrapper;
}

function yamlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function configYaml(command) {
  return `version: 1
adapters:
  codex:
    command: ${yamlString(command)}
    model: null
  opencode:
    command: opencode
    model: null
    agent: null
  claude:
    command: claude
    model: null
    agent: null
  pi:
    command: pi
    model: null
`;
}

/** The deterministic objective every evidence command reads: the last stdout line is the score. */
const OBJECTIVE_SOURCE = `import { readFileSync } from 'node:fs';
process.stdout.write(readFileSync(new URL('./score.txt', import.meta.url), 'utf8').trim() + '\\n');
`;

function contractYaml({ publicCommand = 'node objective.mjs' } = {}) {
  return `contract_version: 1
objective:
  name: quality_score
  command: "node objective.mjs"
  direction: maximize
  min_delta: ${MIN_DELTA}
hard_invariants:
  - id: node_runs
    command: "node --version"
allowed_evolution_surface:
  - "**/*"
protected_paths:
  - ".evofence/**"
evidence:
  public_commands:
    - ${yamlString(publicCommand)}
  per_command_timeout_ms: 60000
  max_output_bytes: 1048576
acceptance:
  require_rollback_point: true
  hidden_regression_tolerance: 0
capabilities:
  authority_ceiling: A1
budgets:
  max_iterations: 3
  max_wall_clock_ms: 600000
  max_failed_candidates: 2
  max_consecutive_no_improvement: 2
  max_tokens: null
  max_usd: null
`;
}

/** A committed baseline the stub can improve: score.txt + the objective command it reads. */
async function seedBaseline(root) {
  await writeFile(path.join(root, 'objective.mjs'), OBJECTIVE_SOURCE, 'utf8');
  await writeFile(path.join(root, 'score.txt'), `${BASELINE_SCORE}\n`, 'utf8');
  await writeFile(path.join(root, 'README.md'), '# e2e fixture\n', 'utf8');
  await writeFile(path.join(root, 'goal.md'), 'Raise the quality score without weakening the checks.\n', 'utf8');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'baseline']);
}

/** Copy the healthy ledger of one fixture into another repository (for the tamper case). */
async function copyLedger(fromRoot, toRoot) {
  const target = ledgerPath(toRoot);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(ledgerPath(fromRoot), target);
}

/* ------------------------------------------------------------------ *
 * The healthy fixture: init -> run through the stub adapter
 * ------------------------------------------------------------------ */

let fixture = null;

before(async () => {
  const { directory, root } = await makeRepo('flow');
  const wrapper = await installStub(directory);
  await seedBaseline(root);

  const init = runCli(['init'], root);
  assert.equal(init.status, 0, `init must succeed: ${init.stderr}`);
  await writeFile(path.join(root, '.evofence', 'config.yaml'), configYaml(stubCommand(wrapper)), 'utf8');
  await writeFile(path.join(root, '.evofence', 'contract.yaml'), contractYaml(), 'utf8');

  // The real run: baseline evidence -> stub proposal -> stub implementation -> evidence -> accept.
  const run = runCli(['run', '--goal', 'goal.md', '--adapter', 'codex', '--iterations', '1', '--json'], root);
  assert.equal(run.status, 0, `run must reach ACCEPTED: ${run.stderr}\n${run.stdout}`);
  const outcome = JSON.parse(run.stdout);
  assert.equal(outcome.status, 'ACCEPTED', 'the stub candidate must be accepted');

  fixture = { directory, root, init, run, outcome };
});

after(async () => {
  if (fixture) await rm(fixture.directory, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * DoD 2 — every command group, success path with an exit-code assertion
 * ------------------------------------------------------------------ */

test('init: scaffolds the control plane and exits 0 (real repo)', async () => {
  // The fixture's own `init` ran in `before`; this asserts its output shape.
  assert.equal(fixture.init.status, 0);
  assert.match(fixture.init.stdout, /Initialized EvoFence in /);
  assert.match(fixture.init.stdout, /\.evofence[\\/]contract\.yaml/);
  assert.match(fixture.init.stdout, /Review \.evofence\/contract\.yaml/);
  for (const file of ['contract.yaml', 'config.yaml', 'schemas/proposal.schema.json', 'ledger.sqlite']) {
    assert.ok(existsSync(path.join(fixture.root, '.evofence', file)), `.evofence/${file} must exist`);
  }

  // A second init is idempotent and reports the existing skeleton, still exit 0.
  const again = runCli(['init'], fixture.root);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already initialized/);

  // ADR-0003: every command accepts --json, including init.
  const json = runCli(['init', '--json'], fixture.root);
  assert.equal(json.status, 0, json.stderr);
  const view = JSON.parse(json.stdout);
  assert.equal(view.existing, true);
  assert.deepEqual(view.created, []);
  assert.equal(typeof view.root, 'string');
});

test('init: outside a Git repository exits 1 with a GIT_COMMAND_FAILED code', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-e2e-nogit-'));
  try {
    const result = runCli(['init'], directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^\[GIT_COMMAND_FAILED\]/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('run: drives the full loop through a stub adapter and exits 0 with ACCEPTED', async () => {
  assert.equal(fixture.run.status, 0);
  const outcome = fixture.outcome;
  assert.equal(outcome.status, 'ACCEPTED');
  assert.match(outcome.run_id, /^[A-Za-z0-9._-]+$/);
  assert.equal(outcome.iterations.length, 1);
  assert.equal(outcome.iterations[0].decision, 'ACCEPT');
  assert.ok(outcome.active_generation && typeof outcome.active_generation.generation_id === 'string');
  // Node 24 warns (DEP0190) about the adapter's `shell: true` dispatch on Windows; the CLI itself
  // must not print an error code or leak a stack on a successful run.
  assert.doesNotMatch(fixture.run.stderr, /^\[[A-Z_]+\]/m, 'a successful run must not print an error code');
  assert.doesNotMatch(fixture.run.stderr, /\n\s+at /, 'stderr must not leak a stack');

  // The text view is the other half of the same command.
  const text = runCli(['run', '--goal', 'goal.md', '--iterations', '1'], fixture.root);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /finished: ACCEPTED\./);
  assert.match(text.stdout, /Active generation: /);
});

test('run: an unknown adapter exits 1 with UNKNOWN_ADAPTER', () => {
  const result = runCli(['run', '--goal', 'goal.md', '--adapter', 'not-an-adapter'], fixture.root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[UNKNOWN_ADAPTER\]/);
});

test('run: a baseline that cannot pass exits 1 with BASELINE_UNHEALTHY', async () => {
  const { directory, root } = await makeRepo('unhealthy');
  try {
    await seedBaseline(root);
    const init = runCli(['init'], root);
    assert.equal(init.status, 0, init.stderr);
    await writeFile(path.join(root, '.evofence', 'contract.yaml'), contractYaml({ publicCommand: 'node -e "process.exit(1)"' }), 'utf8');

    const result = runCli(['run', '--goal', 'goal.md', '--json'], root);
    assert.equal(result.status, 1, 'a non-ACCEPTED/PLATEAU run must exit 1');
    const outcome = JSON.parse(result.stdout);
    assert.equal(outcome.status, 'BASELINE_UNHEALTHY');
    assert.equal(outcome.iterations.length, 0, 'no iteration runs without a healthy baseline');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('proposal inspect: prints the recorded proposal and exits 0', () => {
  const proposalId = `${fixture.outcome.run_id}-i1`;
  const result = runCli(['proposal', 'inspect', proposalId], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  const proposal = JSON.parse(result.stdout);
  assert.equal(proposal.iteration, 1);
  assert.equal(proposal.expected_effect.primary_metric, 'quality_score');
  assert.deepEqual(proposal.changed_surface, ['score.txt']);
  assert.match(proposal.base_sha, /^[0-9a-f]{40,64}$/i);

  // DoD 2 failure side for this group.
  const missing = runCli(['proposal', 'inspect', 'does-not-exist'], fixture.root);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^\[PROPOSAL_NOT_FOUND\]/);
});

test('evidence run: re-runs the contract checks against the repository and exits 0', () => {
  const result = runCli(['evidence', 'run', '.'], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.all_public_passed, true);
  assert.equal(evidence.all_private_within_tolerance, true);
  assert.equal(evidence.objective.valid_score, true);
  assert.equal(evidence.objective.score, Number(BASELINE_SCORE));
  assert.ok(evidence.public.length >= 2, 'hard invariant + public command must both be reported');
});

test('evidence run: a failing public check exits 1', async () => {
  const { directory, root } = await makeRepo('evidence-fail');
  try {
    await seedBaseline(root);
    const init = runCli(['init'], root);
    assert.equal(init.status, 0, init.stderr);
    await writeFile(path.join(root, '.evofence', 'contract.yaml'), contractYaml({ publicCommand: 'node -e "process.exit(1)"' }), 'utf8');

    const result = runCli(['evidence', 'run', '.'], root);
    assert.equal(result.status, 1);
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.all_public_passed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('gate: prints the ACCEPT decision for the accepted proposal and exits 0', () => {
  const proposalId = `${fixture.outcome.run_id}-i1`;
  const result = runCli(['gate', proposalId], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.proposal_id, proposalId);
  assert.equal(decision.decision, 'ACCEPT');
  assert.equal(decision.reason, 'ALL_REQUIRED_EVIDENCE_PASSED');

  const missing = runCli(['gate', 'does-not-exist'], fixture.root);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^\[PROPOSAL_NOT_FOUND\]/);
});

test('ledger show: returns the events the run wrote, and exits 0', () => {
  const result = runCli(['ledger', 'show', fixture.outcome.run_id], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  const events = JSON.parse(result.stdout);
  assert.ok(Array.isArray(events) && events.length > 0);
  const kinds = events.map((event) => event.event_type);
  for (const required of ['run.started', 'evidence.baseline', 'proposal.created', 'candidate.accepted', 'run.finished']) {
    assert.ok(kinds.includes(required), `ledger show must include ${required}: ${kinds.join(', ')}`);
  }
  assert.ok(events.every((event) => event.run_id === fixture.outcome.run_id));
});

test('ledger verify: exits 0 on the healthy hash chain the run produced', () => {
  const result = runCli(['ledger', 'verify'], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  const verification = JSON.parse(result.stdout);
  assert.equal(verification.valid, true);
  assert.ok(verification.events >= 5);
  assert.match(verification.head, /^[0-9a-f]{64}$/);

  const json = runCli(['ledger', 'verify', '--json'], fixture.root);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).valid, true);
});

test('ledger recent: lists the run, and an out-of-range limit exits 1', () => {
  const result = runCli(['ledger', 'recent', '5'], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  const runs = JSON.parse(result.stdout);
  assert.ok(Array.isArray(runs) && runs.length >= 1);
  assert.ok(runs.some((run) => run.run_id === fixture.outcome.run_id));

  const invalid = runCli(['ledger', 'recent', '999'], fixture.root);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /^\[INVALID_RUN_LIMIT\]/);
});

test('ledger export: writes a new bundle, refuses to overwrite, and exits 0/1', async () => {
  const target = 'export-ledger.json';
  const result = runCli(['ledger', 'export', target], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Experiment evidence exported to /);
  const bundle = JSON.parse(await readFile(path.join(fixture.root, target), 'utf8'));
  assert.equal(bundle.integrity.valid, true);
  assert.ok(Array.isArray(bundle.events) && bundle.events.length > 0);
  assert.ok(Array.isArray(bundle.generations) && bundle.generations.length > 0);

  const json = runCli(['ledger', 'export', 'export-ledger-json.json', '--json'], fixture.root);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).exported, 'export-ledger-json.json');

  const existing = runCli(['ledger', 'export', target], fixture.root);
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /EEXIST/);
});

test('diff: verifies the accepted generation diff and exits 0', () => {
  const generationId = fixture.outcome.active_generation.generation_id;
  const result = runCli(['diff', generationId, '--json'], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.generation_id, generationId);
  assert.equal(report.accepted, true);
  assert.equal(report.diff_sha256_matches, true, 'the recorded diff hash must recompute');

  const text = runCli(['diff', generationId], fixture.root);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, new RegExp(`Generation ${generationId}`));

  const missing = runCli(['diff', 'does-not-exist'], fixture.root);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^\[GENERATION_NOT_FOUND\]/);
});

test('rollback: moves the active-generation ref and exits 0', () => {
  const generationId = fixture.outcome.active_generation.generation_id;
  const result = runCli(['rollback', generationId], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /The primary working tree was not changed/);

  const json = runCli(['rollback', generationId, '--json'], fixture.root);
  assert.equal(json.status, 0, json.stderr);
  const view = JSON.parse(json.stdout);
  assert.equal(view.generation_id, generationId);
  assert.equal(view.working_tree_changed, false);

  const missing = runCli(['rollback', 'does-not-exist'], fixture.root);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^\[GENERATION_NOT_FOUND\]/);
});

test('experiment run: drives a manifest through the stub adapter and exits 0', async () => {
  await writeFile(path.join(fixture.root, 'experiment.yaml'), 'goal_file: goal.md\nadapter: codex\niterations: 1\n', 'utf8');
  const result = runCli(['experiment', 'run', 'experiment.yaml'], fixture.root);
  // A second pass over an already-improved baseline plateaus rather than accept; both exit 0.
  assert.equal(result.status, 0, result.stderr);
  const outcome = JSON.parse(result.stdout);
  assert.ok(['ACCEPTED', 'PLATEAU'].includes(outcome.status), `unexpected status ${outcome.status}`);
  assert.notEqual(outcome.run_id, fixture.outcome.run_id, 'the manifest run is a new run');

  const invalid = runCli(['experiment', 'run', 'experiment.yaml', '--json'], fixture.root);
  assert.equal(invalid.status, 0, invalid.stderr);
  assert.ok(['ACCEPTED', 'PLATEAU'].includes(JSON.parse(invalid.stdout).status));
});

test('experiment run: a manifest without goal_file exits 1 with INVALID_EXPERIMENT', async () => {
  await writeFile(path.join(fixture.root, 'bad-experiment.yaml'), 'iterations: 1\n', 'utf8');
  const result = runCli(['experiment', 'run', 'bad-experiment.yaml'], fixture.root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[INVALID_EXPERIMENT\]/);
});

test('experiment export: writes the alias bundle and refuses to overwrite', () => {
  const result = runCli(['experiment', 'export', 'export-experiment.json'], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Experiment evidence exported to export-experiment\.json/);
  assert.ok(existsSync(path.join(fixture.root, 'export-experiment.json')));

  const existing = runCli(['experiment', 'export', 'export-experiment.json'], fixture.root);
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /EEXIST/);
});

test('report: writes Markdown to a file, prints JSON, and refuses protected paths', async () => {
  const result = runCli(['report', 'smoke-report.md'], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Report written to smoke-report\.md/);
  const markdown = await readFile(path.join(fixture.root, 'smoke-report.md'), 'utf8');
  assert.ok(markdown.trim().length > 0);

  const json = runCli(['report', '--json'], fixture.root);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(typeof JSON.parse(json.stdout).run_count, 'number');

  const protected_ = runCli(['report', '.evofence/report.md'], fixture.root);
  assert.equal(protected_.status, 1);
  assert.match(protected_.stderr, /^\[PROTECTED_PATH\]/);
});

test('status: prints the operational overview and exits 0', () => {
  const result = runCli(['status'], fixture.root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Ledger integrity: ok/);
  assert.match(result.stdout, /Totals:/);

  const json = runCli(['status', '--json'], fixture.root);
  assert.equal(json.status, 0, json.stderr);
  const status = JSON.parse(json.stdout);
  assert.equal(status.integrity.valid, true);
  assert.ok(status.totals.runs >= 1);
  assert.ok(status.policy, 'status must echo the validated policy snapshot');
  assert.equal(status.policy.contract.objective.name, 'quality_score');
});

test('status: a repository without a ledger reports the empty state and exits 0', async () => {
  const { directory, root } = await makeRepo('empty');
  try {
    runGit(root, ['commit', '--quiet', '--allow-empty', '-m', 'empty']);
    const result = runCli(['status'], root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Ledger integrity: ok/);
    assert.match(result.stdout, /Active generation: none/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * DoD 3 (1) — an invalid configuration exits non-zero
 * ------------------------------------------------------------------ */

async function makeConfiguredRepo(prefix) {
  const { directory, root } = await makeRepo(prefix);
  await seedBaseline(root);
  const init = runCli(['init'], root);
  assert.equal(init.status, 0, init.stderr);
  return { directory, root };
}

test('failure: a config.yaml with an UNKNOWN field is refused with INVALID_CONFIG', async () => {
  const { directory, root } = await makeConfiguredRepo('config-unknown');
  try {
    const valid = await readFile(path.join(root, '.evofence', 'config.yaml'), 'utf8');
    await writeFile(path.join(root, '.evofence', 'config.yaml'), `${valid}unknown_section: 1\n`, 'utf8');

    const result = runCli(['status'], root);
    assert.equal(result.status, 1, `status must reject an unknown config field: ${result.stdout}`);
    assert.match(result.stderr, /^\[INVALID_CONFIG\]/);

    const json = runCli(['status', '--json'], root);
    assert.equal(json.status, 1);
    const error = JSON.parse(json.stderr);
    assert.equal(error.error.code, 'INVALID_CONFIG');
    assert.equal(json.stdout, '', '--json failures keep stdout empty');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failure: a config.yaml with a MISSING required field is refused with INVALID_CONFIG', async () => {
  const { directory, root } = await makeConfiguredRepo('config-missing');
  try {
    await writeFile(path.join(root, '.evofence', 'config.yaml'), 'adapters:\n  codex:\n    command: codex\n    model: null\n', 'utf8');

    const result = runCli(['status'], root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^\[INVALID_CONFIG\]/);
    assert.match(result.stderr, /version/, 'the missing field must be named');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * DoD 3 (2) — a tampered ledger makes `ledger verify` exit non-zero
 * ------------------------------------------------------------------ */

test('failure: a tampered hash chain makes ledger verify exit 1', async () => {
  const { directory, root } = await makeRepo('tamper');
  try {
    // A fresh repository that carries a real, populated ledger copied from the healthy fixture, so
    // this case never depends on the order the tests above run in.
    runGit(root, ['commit', '--quiet', '--allow-empty', '-m', 'tamper baseline']);
    await copyLedger(fixture.root, root);

    const healthy = runCli(['ledger', 'verify'], root);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.equal(JSON.parse(healthy.stdout).valid, true);

    // Tamper: the events table is append-only by trigger, so the trigger is dropped first — exactly
    // the mutation the hash chain exists to catch.
    const ledger = new Ledger(ledgerPath(root));
    try {
      ledger.db.exec('DROP TRIGGER IF EXISTS events_no_update');
      const changed = ledger.db.prepare('UPDATE events SET created_at = ? WHERE seq = 1').run('1999-01-01T00:00:00.000Z');
      assert.equal(changed.changes, 1, 'the tamper must rewrite exactly one hashed column');
    } finally {
      ledger.close();
    }

    const tampered = runCli(['ledger', 'verify'], root);
    assert.equal(tampered.status, 1, 'a broken hash chain must exit 1');
    const verification = JSON.parse(tampered.stdout);
    assert.equal(verification.valid, false);
    assert.equal(verification.sequence, 1);

    // The same corruption makes `rollback` refuse instead of moving a ref over a broken ledger.
    const rollback = runCli(['rollback', 'g0-whatever'], root);
    assert.equal(rollback.status, 1);
    assert.match(rollback.stderr, /^\[LEDGER_CORRUPT\]/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
