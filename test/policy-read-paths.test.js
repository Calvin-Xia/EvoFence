// Acceptance oracle for the three read paths PR #12 review called out as still bypassing config
// v2 (R1 fix F1 follow-up):
//
//   1. `experiment run <manifest>` used `parseYamlText` + `as` casts, so a mistyped key (e.g.
//      `adaptor: claude`) was silently dropped and the run fell back to Codex.
//   2. the `run` pre-flight read the private holdout with the 0.3.0 loader, which accepted
//      unknown top-level keys and unknown entry keys (`enabled: false`).
//   3. `evidence run` used the 0.3.0 `loadContract`/`loadPrivateHoldout`, so the same policy file
//      could be rejected by `run`/`status` and accepted here.
//
// The fix routes every one of them through `src/lib/config/**` and makes the two published
// loaders (`loadContract`, `loadPrivateHoldout`) thin delegates, so there is one implementation.
// This file locks: the public API is unchanged, invalid documents fail with the SAME code on all
// paths, and legal documents still pass everywhere.
//
// Imports come from `dist/` on purpose (ADR-0002/0004: the build artifact is the tested object;
// `npm test` builds first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract, loadPrivateHoldout } from '../dist/index.js';
import { validateDocument } from '../dist/lib/config/index.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const IS_WINDOWS = process.platform === 'win32';

/* ------------------------------------------------------------------ *
 * Fixture helpers
 * ------------------------------------------------------------------ */

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
}

/** The `error.code` of a `--json` failure, or `null` when the run produced none. */
function errorCode(result) {
  const match = /"code":\s*"([A-Z_]+)"/.exec(result.stderr);
  return match ? match[1] : null;
}

async function makeRepo(label) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `evofence-read-paths-${label}-`));
  const root = path.join(directory, 'repo');
  await mkdir(root, { recursive: true });
  runGit(root, ['init', '--quiet', '--initial-branch=main']);
  runGit(root, ['config', 'user.name', 'EvoFence Fixture']);
  runGit(root, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  await writeFile(path.join(root, 'README.md'), '# fixture repository\n', 'utf8');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'fixture']);
  return { directory, root };
}

const CONTRACT = (root) => path.join(root, '.evofence', 'contract.yaml');
const HOLDOUT = (root) => path.join(root, '.evofence', 'private', 'holdout.yaml');

/** A contract that e2e would accept; `typo` swaps `max_output_bytes` for a misspelled key. */
function contractYaml({ typo = false, omitDefaults = false } = {}) {
  const outputLine = typo ? '  max_output_byte: 999' : (omitDefaults ? '' : '  max_output_bytes: 1048576');
  const timeoutLine = omitDefaults ? '' : '  per_command_timeout_ms: 60000';
  return `contract_version: 1
objective:
  name: quality_score
  command: 'node -e "console.log(1)"'
  direction: maximize
  min_delta: 0.01
hard_invariants: []
allowed_evolution_surface:
  - "**/*"
protected_paths:
  - ".evofence/**"
evidence:
  public_commands:
    - 'node -e "process.exit(0)"'
${timeoutLine}
${outputLine}
acceptance:
  require_rollback_point: true
  hidden_regression_tolerance: 0
capabilities:
  authority_ceiling: A1
budgets:
  max_iterations: 1
  max_wall_clock_ms: 60000
  max_failed_candidates: 1
  max_consecutive_no_improvement: 1
  max_tokens: null
  max_usd: null
`;
}

function configYaml(codexCommand) {
  return `version: 1
adapters:
  codex:
    command: '${codexCommand.replaceAll("'", "''")}'
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

/**
 * Emit a Codex stub that records its invocation in `marker` and exits 1. If a mistyped manifest
 * ever falls back to Codex, the marker exists — that is the observable this suite forbids.
 */
async function installMarkerStub(directory, marker) {
  const tools = path.join(directory, 'tools');
  await mkdir(tools, { recursive: true });
  const script = path.join(tools, 'codex-stub.mjs');
  await writeFile(script, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, 'codex\\n');\nprocess.exit(1);\n`, 'utf8');
  const wrapper = path.join(tools, IS_WINDOWS ? 'codex-stub.cmd' : 'codex-stub.sh');
  await writeFile(wrapper, IS_WINDOWS
    ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, 'utf8');
  if (!IS_WINDOWS) await chmod(wrapper, 0o755);
  return IS_WINDOWS ? `"${wrapper}"` : wrapper;
}

/* ------------------------------------------------------------------ *
 * 1. the published loaders now read through v2 (one implementation)
 * ------------------------------------------------------------------ */

test('loadContract (public) fails closed on unknown keys and applies exactly the two defaults', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-read-paths-contract-'));
  const root = path.join(directory, 'repo');
  try {
    await mkdir(path.join(root, '.evofence'), { recursive: true });

    await writeFile(CONTRACT(root), contractYaml({ typo: true }), 'utf8');
    await assert.rejects(loadContract(root), (error) => error?.code === 'INVALID_CONTRACT');

    await writeFile(CONTRACT(root), contractYaml({ omitDefaults: true }), 'utf8');
    const contract = await loadContract(root);
    assert.equal(contract.evidence.per_command_timeout_ms, 120000);
    assert.equal(contract.evidence.max_output_bytes, 1048576);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('loadPrivateHoldout (public) rejects unknown top-level and entry keys, and stays fail-open when absent', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-read-paths-holdout-'));
  const root = path.join(directory, 'repo');
  try {
    await mkdir(path.join(root, '.evofence', 'private'), { recursive: true });

    // Missing file: deliberate fail-open ([]), not an error.
    assert.deepEqual(await loadPrivateHoldout(root), []);

    await writeFile(HOLDOUT(root), 'regressions: []\nenabled: false\n', 'utf8');
    await assert.rejects(loadPrivateHoldout(root), (error) => error?.code === 'INVALID_HOLDOUT');

    await writeFile(HOLDOUT(root), 'regressions:\n  - id: hidden\n    command: "true"\n    enabled: false\n', 'utf8');
    await assert.rejects(loadPrivateHoldout(root), (error) => error?.code === 'INVALID_HOLDOUT');

    await writeFile(HOLDOUT(root), 'regressions:\n  - id: hidden\n    command: "true"\n', 'utf8');
    assert.deepEqual(await loadPrivateHoldout(root), [{ id: 'hidden', command: 'true' }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the v2 validators reject a mistyped manifest key and an unknown holdout entry key', () => {
  const badManifest = validateDocument('experiment', { goal_file: 'goal.md', adaptor: 'claude' }, 'experiment.yaml');
  assert.equal(badManifest.valid, false);
  assert.ok(badManifest.rejected_fields.some((issue) => issue.path === 'adaptor' && issue.code === 'INVALID_EXPERIMENT'));
  assert.equal(validateDocument('experiment', { goal_file: 'goal.md', adapter: 'codex', iterations: 1 }, 'experiment.yaml').valid, true);

  const badHoldout = validateDocument('holdout', { regressions: [{ id: 'a', command: 'true', enabled: false }] }, 'holdout.yaml');
  assert.equal(badHoldout.valid, false);
  assert.ok(badHoldout.rejected_fields.some((issue) => issue.path === 'regressions[0].enabled' && issue.code === 'INVALID_HOLDOUT'));
});

/* ------------------------------------------------------------------ *
 * 2. CLI paths
 * ------------------------------------------------------------------ */

test('experiment run rejects a mistyped manifest key and never falls back to Codex', async () => {
  const { directory, root } = await makeRepo('experiment-typo');
  try {
    assert.equal(runCli(['init'], root).status, 0);
    await writeFile(CONTRACT(root), contractYaml(), 'utf8');
    const marker = path.join(directory, 'codex-ran.txt');
    await writeFile(path.join(root, '.evofence', 'config.yaml'), configYaml(await installMarkerStub(directory, marker)), 'utf8');
    await writeFile(path.join(root, 'goal.md'), 'goal body\n', 'utf8');
    await writeFile(path.join(root, 'experiment.yaml'), 'goal_file: goal.md\niterations: 1\nadaptor: claude\n', 'utf8');

    const result = runCli(['experiment', 'run', 'experiment.yaml', '--json'], root);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(errorCode(result), 'INVALID_EXPERIMENT');
    assert.match(result.stderr, /adaptor/);
    assert.equal(existsSync(marker), false, 'the Codex adapter must not be dispatched for a mistyped manifest');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('evidence run fails closed on unknown holdout keys', async () => {
  const { directory, root } = await makeRepo('holdout');
  try {
    assert.equal(runCli(['init'], root).status, 0);
    await writeFile(CONTRACT(root), contractYaml(), 'utf8');

    await writeFile(HOLDOUT(root), 'regressions: []\nenabled: false\n', 'utf8');
    const topLevel = runCli(['evidence', 'run', '.', '--json'], root);
    assert.equal(topLevel.status, 1);
    assert.equal(errorCode(topLevel), 'INVALID_HOLDOUT');

    await writeFile(HOLDOUT(root), 'regressions:\n  - id: hidden\n    command: \'node -e "process.exit(0)"\'\n    enabled: false\n', 'utf8');
    const entry = runCli(['evidence', 'run', '.', '--json'], root);
    assert.equal(entry.status, 1);
    assert.equal(errorCode(entry), 'INVALID_HOLDOUT');

    // No regression: a legal holdout still runs evidence.
    await writeFile(HOLDOUT(root), 'regressions: []\n', 'utf8');
    const legal = runCli(['evidence', 'run', '.', '--json'], root);
    assert.equal(legal.status, 0, legal.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('status, run, evidence run and experiment run agree on the same rejected contract (INVALID_CONTRACT)', async () => {
  const { directory, root } = await makeRepo('cross-path');
  try {
    await mkdir(path.join(root, '.evofence'), { recursive: true });
    await writeFile(CONTRACT(root), contractYaml({ typo: true }), 'utf8');
    await writeFile(path.join(root, 'goal.md'), 'goal body\n', 'utf8');
    await writeFile(path.join(root, 'experiment.yaml'), 'goal_file: goal.md\niterations: 1\n', 'utf8');

    const status = runCli(['status', '--json'], root);
    const run = runCli(['run', '--goal', 'goal.md', '--json'], root);
    const evidence = runCli(['evidence', 'run', '.', '--json'], root);
    const experiment = runCli(['experiment', 'run', 'experiment.yaml', '--json'], root);

    for (const [name, result] of [['status', status], ['run', run], ['evidence run', evidence], ['experiment run', experiment]]) {
      assert.equal(result.status, 1, `${name} must fail: ${result.stdout}`);
      assert.equal(errorCode(result), 'INVALID_CONTRACT', `${name} must report the shared v2 code`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a legal policy still passes status and evidence run, and a legal manifest clears validation', async () => {
  const { directory, root } = await makeRepo('legal');
  try {
    assert.equal(runCli(['init'], root).status, 0);
    await writeFile(CONTRACT(root), contractYaml(), 'utf8');
    await writeFile(HOLDOUT(root), 'regressions: []\n', 'utf8');

    const status = runCli(['status', '--json'], root);
    assert.equal(status.status, 0, status.stderr);

    const evidence = runCli(['evidence', 'run', '.', '--json'], root);
    assert.equal(evidence.status, 0, evidence.stderr);

    // A legal manifest gets PAST validation: the missing goal file is a later, different failure.
    await writeFile(path.join(root, 'experiment.yaml'), 'goal_file: does-not-exist.md\nadapter: codex\niterations: 1\n', 'utf8');
    const experiment = runCli(['experiment', 'run', 'experiment.yaml', '--json'], root);
    assert.equal(experiment.status, 1);
    assert.notEqual(errorCode(experiment), 'INVALID_EXPERIMENT');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
