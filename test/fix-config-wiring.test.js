// Regression oracles for the F1/F2 review findings (R1 fix batch).
//
// F1 — `run` and `status` disagreed about the same `.evofence/contract.yaml`: `status` went
//      through the v2 validator and rejected unknown keys, while `run` used the 0.3.0 gate
//      loader and silently accepted them. Both paths now read through `src/lib/config/load.ts`
//      (`loadRequiredContractDocumentSync` / `loadRequiredConfigDocumentSync`).
// F2 — `evidence.per_command_timeout_ms` / `max_output_bytes` are the only two declared code
//      defaults, but the evidence collector read them as `undefined` when the key was omitted,
//      so `Math.min(undefined, remaining)` became `NaN` and Node turned `setTimeout(NaN)` into a
//      1 ms timer that killed the command. Every pre-existing fixture wrote the key explicitly,
//      so nothing covered the omitted shape.
//
// Imports come from `dist/` (ADR-0002/0004: the built artifact is the tested object).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEvidence } from '../dist/lib/evidence.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function spawnCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
}

/** In `--json` mode a failure prints exactly one object on stderr and nothing on stdout. */
function errorObject(result) {
  const text = result.stderr.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  assert.ok(start !== -1 && end !== -1, `expected an error object on stderr, got: ${JSON.stringify(result.stderr)}`);
  return JSON.parse(text.slice(start, end + 1));
}

/** A real `git init` + `evofence init` repository (valid template contract, valid config, ledger). */
async function makeRepo(label) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `evofence-fix-${label}-`));
  const root = path.join(directory, 'repo');
  await mkdir(root, { recursive: true });
  runGit(root, ['init', '--quiet', '--initial-branch=main']);
  runGit(root, ['config', 'user.name', 'EvoFence Fixture']);
  runGit(root, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  await writeFile(path.join(root, 'README.md'), '# fixture repository\n');
  await writeFile(path.join(root, 'goal.md'), 'Improve the objective without weakening the checks.\n');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'fixture']);
  const init = spawnCli(['init'], root);
  assert.equal(init.status, 0, `init must accept its own scaffolding: ${init.stderr}`);
  return { directory, root };
}

/** The shipped template with a runnable objective and NO evidence, so the run path reaches the gate. */
const ACCEPTED_SHAPE_CONTRACT = `contract_version: 1
objective:
  name: probe
  command: "node -e \\"process.exit(0)\\""
  direction: maximize
  min_delta: 0.01
hard_invariants: []
allowed_evolution_surface:
  - "**/*"
protected_paths:
  - ".evofence/**"
capabilities:
  authority_ceiling: A1
evidence:
  public_commands: []
  per_command_timeout_ms: 60000
  max_output_bytes: 1048576
acceptance:
  require_rollback_point: true
  hidden_regression_tolerance: 0
budgets:
  max_iterations: 1
  max_wall_clock_ms: 60000
  max_failed_candidates: 1
  max_consecutive_no_improvement: 1
  max_tokens: null
  max_usd: null
`;

/* ------------------------------------------------------------------ *
 * F1 — run and status agree on the same contract file
 * ------------------------------------------------------------------ */

test('F1: run rejects an unknown contract field with the same code and field name as status', async () => {
  const { directory, root } = await makeRepo('f1-unknown');
  const contractFile = path.join(root, '.evofence', 'contract.yaml');
  try {
    // Control: the same contract WITHOUT the unknown key is accepted by the run path, which then
    // fails on its next gate (`NO_EVIDENCE_CONFIGURED`) — so the rejection below is about the
    // unknown field, not about some other part of the run.
    await writeFile(contractFile, ACCEPTED_SHAPE_CONTRACT, 'utf8');
    const control = spawnCli(['run', '--goal', 'goal.md', '--json'], root);
    assert.equal(control.status, 1, `the control run must fail at the evidence gate: ${control.stdout}`);
    assert.equal(control.stdout, '', `--json failures keep stdout empty: ${control.stdout}`);
    assert.equal(errorObject(control).error.code, 'NO_EVIDENCE_CONFIGURED', 'the control contract must be ACCEPTED by the run path');

    // Same document plus one unknown top-level key.
    await writeFile(contractFile, `${ACCEPTED_SHAPE_CONTRACT}unknown_toplevel_key: 42\n`, 'utf8');

    const status = spawnCli(['status', '--json'], root);
    const run = spawnCli(['run', '--goal', 'goal.md', '--json'], root);

    assert.equal(status.status, 1, `status must fail closed:\n${status.stdout}`);
    assert.equal(run.status, 1, `run must fail closed:\n${run.stdout}`);
    assert.equal(status.stdout, '', 'status --json keeps stdout empty on failure');
    assert.equal(run.stdout, '', 'run --json keeps stdout empty on failure');

    const statusError = errorObject(status).error;
    const runError = errorObject(run).error;

    assert.equal(statusError.code, 'INVALID_CONTRACT', status.stderr);
    assert.equal(runError.code, 'INVALID_CONTRACT', run.stderr);
    assert.equal(runError.code, statusError.code, 'run and status must agree on the same file');
    assert.match(JSON.stringify(runError), /unknown_toplevel_key/, 'the run error must name the rejected field');
    assert.match(JSON.stringify(statusError), /unknown_toplevel_key/, 'the status error must name the rejected field');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('F1: run rejects an unknown config.yaml field with INVALID_CONFIG, like status', async () => {
  const { directory, root } = await makeRepo('f1-config');
  const configFile = path.join(root, '.evofence', 'config.yaml');
  try {
    await writeFile(contractFileFor(root), ACCEPTED_SHAPE_CONTRACT, 'utf8');
    const validConfig = await readFile(configFile, 'utf8');
    await writeFile(configFile, `${validConfig}shady_option: true\n`, 'utf8');

    const status = spawnCli(['status', '--json'], root);
    const run = spawnCli(['run', '--goal', 'goal.md', '--json'], root);

    assert.equal(status.status, 1, status.stdout);
    assert.equal(run.status, 1, run.stdout);
    assert.equal(errorObject(status).error.code, 'INVALID_CONFIG', status.stderr);
    assert.equal(errorObject(run).error.code, 'INVALID_CONFIG', run.stderr);
    assert.match(JSON.stringify(errorObject(run).error), /shady_option/, run.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function contractFileFor(root) {
  return path.join(root, '.evofence', 'contract.yaml');
}

/* ------------------------------------------------------------------ *
 * F2 — the two declared defaults actually reach the evidence collector
 * ------------------------------------------------------------------ */

test('F2: an evidence command passes when both defaulted keys are omitted', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-fix-f2-direct-'));
  try {
    const probe = path.join(directory, 'probe.mjs');
    // 250 ms: comfortably above the 1 ms timer `setTimeout(NaN)` decays to, and below the
    // 120000 ms declared default.
    await writeFile(probe, "await new Promise((resolve) => setTimeout(resolve, 250));\nprocess.stdout.write('1\\n');\n", 'utf8');

    const contract = {
      objective: { name: 'probe', command: '', direction: 'maximize', min_delta: 0.01 },
      hard_invariants: [],
      // Both keys DELIBERATELY omitted (the shape every existing fixture avoided).
      evidence: { public_commands: ['node probe.mjs'] },
      acceptance: { hidden_regression_tolerance: 0 },
    };

    const bundle = await collectEvidence({
      root: directory,
      artifactRoot: directory,
      contract,
      runId: 'fix-config-wiring',
      iteration: 0,
      phase: 'manual',
    });

    assert.equal(bundle.public.length, 1);
    assert.equal(bundle.public[0].result, 'PASS', 'an omitted per_command_timeout_ms must not time the command out');
    assert.equal(bundle.public[0].passed, true);
    assert.ok(
      bundle.public[0].duration_ms >= 200,
      `the command must actually run (~250 ms), not be killed by a 1 ms timer (saw ${bundle.public[0].duration_ms} ms)`,
    );
    assert.equal(bundle.all_public_passed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('F2: `evidence run` passes with empty stderr when both defaulted keys are omitted', async () => {
  const { directory, root } = await makeRepo('f2-cli');
  try {
    await writeFile(
      path.join(root, 'probe.mjs'),
      "await new Promise((resolve) => setTimeout(resolve, 250));\nprocess.stdout.write('1\\n');\n",
      'utf8',
    );
    // Same contract shape as above, written through YAML: `evidence` omits both defaulted keys.
    await writeFile(contractFileFor(root), `contract_version: 1
objective:
  name: probe
  command: ""
  direction: maximize
  min_delta: 0.01
hard_invariants: []
allowed_evolution_surface:
  - "**/*"
protected_paths:
  - ".evofence/**"
capabilities:
  authority_ceiling: A1
evidence:
  public_commands:
    - "node probe.mjs"
acceptance:
  require_rollback_point: true
  hidden_regression_tolerance: 0
budgets:
  max_iterations: 1
  max_wall_clock_ms: 60000
  max_failed_candidates: 1
  max_consecutive_no_improvement: 1
  max_tokens: null
  max_usd: null
`, 'utf8');

    const result = spawnCli(['evidence', 'run', '.', '--json'], root);
    assert.equal(result.status, 0, `evidence run must pass: ${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, '', `an omitted defaulted key must not print Node warnings to stderr: ${result.stderr}`);

    const bundle = JSON.parse(result.stdout);
    assert.equal(bundle.public[0].result, 'PASS');
    assert.equal(bundle.all_public_passed, true);
    assert.ok(bundle.public[0].duration_ms >= 200, `saw ${bundle.public[0].duration_ms} ms`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
