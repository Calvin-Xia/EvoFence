// Acceptance oracle for the generation audit view (`evofence diff <generation-id> [--json]`).
//
// This spec is mount-independent: every import of repository code is a dynamic import
// resolved from `process.cwd()`, so the same file can run from this repository root and
// against another candidate checkout used as cwd.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EVIDENCE_SECRET = 'EVIDENCE-STDOUT-MUST-NOT-LEAK-7f3c9a';
const RUN_ID = 'run-f1-fixture';
const ORPHAN_RUN_ID = 'run-f1-orphan';
const GENERATION_ID = `g-${RUN_ID}-i01`;
const ORPHAN_GENERATION_ID = 'g-orphan-fixture';
const PROPOSAL_ID = 'prop-f1-fixture-01';
const GENERATION_CREATED_AT = '2026-01-02T03:04:05.000Z';
const ORPHAN_CREATED_AT = '2026-01-02T04:05:06.000Z';
const OBJECTIVE_METRIC = 'quality_score';
const OBJECTIVE_SCORE = 0.75;
const OBJECTIVE_IMPROVEMENT = 0.25;
const EXPECTED_CHANGED_PATHS = ['src/app.txt', 'src/new-file.txt', 'src/old.txt'];
const EXPECTED_CHECKS = [
  { id: 'invariant-a', kind: 'hard_invariant', result: 'PASS' },
  { id: 'public-1', kind: 'public_check', result: 'PASS' },
];
const DOCUMENTED_KEYS = [
  'generation_id', 'run_id', 'sha', 'parent_sha', 'diff_sha256', 'changed_paths',
  'diff', 'diff_truncated', 'objective', 'evidence', 'proposal_id', 'accepted_at',
];

let fixture = null;
let cliPath = null;

function repoImport(relativePath) {
  return import(pathToFileURL(path.resolve(process.cwd(), relativePath)).href);
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout || result.error}`);
  return result.stdout.trim();
}

async function buildFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-spec-f1-'));
  const root = path.join(directory, 'repo');
  await mkdir(path.join(root, 'src'), { recursive: true });
  runGit(root, ['init', '--quiet', '--initial-branch=main']);
  runGit(root, ['config', 'user.name', 'EvoFence Fixture']);
  runGit(root, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  runGit(root, ['config', 'core.autocrlf', 'false']);

  await writeFile(path.join(root, 'src', 'app.txt'), 'version: 1\nkeep\n');
  await writeFile(path.join(root, 'src', 'old.txt'), 'remove me\n');
  await writeFile(path.join(root, 'src', 'stable.txt'), 'unchanged\n');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'baseline']);
  const parentSha = runGit(root, ['rev-parse', 'HEAD']);

  await writeFile(path.join(root, 'src', 'app.txt'), 'version: 1\nkeep\nadded line\n');
  await rm(path.join(root, 'src', 'old.txt'));
  await writeFile(path.join(root, 'src', 'new-file.txt'), 'new file contents\n');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'accept generation']);
  const sha = runGit(root, ['rev-parse', 'HEAD']);

  const { Ledger, ledgerPath } = await repoImport('src/lib/ledger.js');
  const { changedPathsBetween, diffHash } = await repoImport('src/lib/git.js');
  const ledgerFile = ledgerPath(root);
  const recordedDiffHash = await diffHash(root, parentSha, sha);
  const recordedChangedPaths = [...(await changedPathsBetween(root, parentSha, sha))].sort();

  const candidateEvidence = {
    schema_version: 1,
    run_id: RUN_ID,
    iteration: 1,
    phase: 'candidate',
    candidate_sha: sha,
    started_at: '2026-01-02T03:04:10.000Z',
    duration_ms: 32,
    public: [
      {
        id: 'invariant-a',
        kind: 'hard_invariant',
        command_sha256: '1'.repeat(64),
        passed: true,
        result: 'PASS',
        exit_code: 0,
        duration_ms: 8,
        stdout_sha256: '2'.repeat(64),
        stderr_sha256: '3'.repeat(64),
        stdout_bytes: 24,
        stderr_bytes: 0,
        hidden: false,
        command: 'node --version',
        stdout: EVIDENCE_SECRET,
        command_output: EVIDENCE_SECRET,
      },
      {
        id: 'public-1',
        kind: 'public_check',
        command_sha256: '4'.repeat(64),
        passed: true,
        result: 'PASS',
        exit_code: 0,
        duration_ms: 9,
        stdout_sha256: '5'.repeat(64),
        stderr_sha256: '6'.repeat(64),
        stdout_bytes: 24,
        stderr_bytes: 0,
        hidden: false,
        command: 'node --version',
        stdout: EVIDENCE_SECRET,
      },
    ],
    private: {
      total: 1,
      passed: 1,
      failed: 0,
      cases: [{ case: 1, result: 'PASS', exit_code: 0, passed: true, duration_ms: 6 }],
    },
    objective: {
      command_sha256: '7'.repeat(64),
      passed: true,
      result: 'PASS',
      exit_code: 0,
      duration_ms: 11,
      stdout_sha256: '8'.repeat(64),
      stderr_sha256: '9'.repeat(64),
      stdout_bytes: 5,
      stderr_bytes: 0,
      score: OBJECTIVE_SCORE,
      configured: true,
      valid_score: true,
      stdout: EVIDENCE_SECRET,
    },
    all_public_passed: true,
    all_private_within_tolerance: true,
    artifact: `.evofence/artifacts/${RUN_ID}/candidate-1-1.json`,
    artifact_sha256: 'a'.repeat(64),
    raw_output: EVIDENCE_SECRET,
  };

  await mkdir(path.dirname(ledgerFile), { recursive: true });
  let acceptedAt = null;
  const ledger = new Ledger(ledgerFile);
  try {
    ledger.append('run.started', RUN_ID, {
      adapter: 'codex',
      adapter_config: { command: 'codex', model: null, agent: null },
      base_sha: parentSha,
      goal_sha256: 'b'.repeat(64),
      requested_iterations: 3,
      max_wall_clock_ms: 600000,
      contract_sha256: 'c'.repeat(64),
      contract_snapshot: {
        contract_version: 1,
        objective: { name: OBJECTIVE_METRIC, command: 'node --version', direction: 'maximize', min_delta: 0.2 },
        hard_invariants: [{ id: 'invariant-a', command: 'node --version' }],
        allowed_evolution_surface: ['src/**'],
        protected_paths: ['.evofence/**'],
        evidence: { public_commands: ['node --version'], per_command_timeout_ms: 60000, max_output_bytes: 1048576 },
        acceptance: { require_rollback_point: true, hidden_regression_tolerance: 0 },
        capabilities: { authority_ceiling: 'A1' },
        budgets: {
          max_iterations: 3,
          max_wall_clock_ms: 600000,
          max_failed_candidates: 2,
          max_consecutive_no_improvement: 2,
          max_tokens: null,
          max_usd: null,
        },
      },
      holdout_sha256: 'd'.repeat(64),
      private_regression_count: 1,
      private_holdout_host_readable: true,
      token_budget: null,
      cost_budget_usd: null,
      cost_budget_source: null,
    });
    ledger.append('proposal.created', RUN_ID, {
      proposal_id: PROPOSAL_ID,
      iteration: 1,
      base_sha: parentSha,
      proposal_sha256: 'e'.repeat(64),
      proposal: {
        iteration: 1,
        base_sha: parentSha,
        hypothesis: 'adding one line improves the quality score',
        changed_surface: EXPECTED_CHANGED_PATHS,
        requested_capabilities: [],
        expected_effect: { primary_metric: OBJECTIVE_METRIC, direction: 'increase' },
      },
      hypothesis: 'adding one line improves the quality score',
      changed_surface: EXPECTED_CHANGED_PATHS,
      requested_capabilities: [],
    });
    ledger.append('claims.created', RUN_ID, {
      iteration: 1,
      claims_sha256: 'f'.repeat(64),
      claims: {
        status: 'CANDIDATE_READY',
        files_changed: EXPECTED_CHANGED_PATHS,
        capabilities_used: [],
        missing_evidence: [],
      },
    });
    ledger.append('evidence.candidate', RUN_ID, { iteration: 1, base_sha: parentSha, evidence: candidateEvidence });
    ledger.recordGeneration({
      generation_id: GENERATION_ID,
      run_id: RUN_ID,
      sha,
      parent_sha: parentSha,
      created_at: GENERATION_CREATED_AT,
    });
    acceptedAt = ledger.append('candidate.accepted', RUN_ID, {
      iteration: 1,
      generation_id: GENERATION_ID,
      sha,
      parent_sha: parentSha,
      diff_sha256: recordedDiffHash,
      objective_score: OBJECTIVE_SCORE,
      improvement: OBJECTIVE_IMPROVEMENT,
      evidence_artifact: candidateEvidence.artifact,
      proposal_sha256: 'e'.repeat(64),
    }).created_at;
    ledger.append('run.finished', RUN_ID, {
      status: 'ACCEPTED',
      iterations: 1,
      active_generation: GENERATION_ID,
      duration_ms: 1234,
    });
    ledger.recordGeneration({
      generation_id: ORPHAN_GENERATION_ID,
      run_id: ORPHAN_RUN_ID,
      sha: parentSha,
      parent_sha: parentSha,
      created_at: ORPHAN_CREATED_AT,
    });
  } finally {
    ledger.close();
  }

  return { directory, root, ledgerFile, parentSha, sha, recordedDiffHash, recordedChangedPaths, acceptedAt };
}

before(async () => {
  cliPath = path.resolve('src/cli.js');
  fixture = await buildFixture();
});

after(async () => {
  if (fixture) await rm(fixture.directory, { recursive: true, force: true });
});

async function callGenerationDiff(generationId) {
  const { generationDiff } = await repoImport('src/lib/audit.js');
  const { Ledger } = await repoImport('src/lib/ledger.js');
  const ledger = new Ledger(fixture.ledgerFile);
  try {
    // The documented signature receives an open ledger; tolerate an implementation that
    // interprets `ledger` as the ledger path instead (a TypeError from the other shape).
    return await generationDiff({ root: fixture.root, ledger, generationId });
  } catch (error) {
    if (error instanceof TypeError) {
      return await generationDiff({ root: fixture.root, ledger: fixture.ledgerFile, generationId });
    }
    throw error;
  } finally {
    ledger.close();
  }
}

function spawnCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: fixture.root,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

test('generationDiff returns the full documented report for an accepted generation', async () => {
  const report = await callGenerationDiff(GENERATION_ID);

  for (const key of DOCUMENTED_KEYS) {
    assert.ok(Object.hasOwn(report, key), `report is missing the documented key "${key}"`);
  }

  assert.equal(report.generation_id, GENERATION_ID);
  assert.equal(report.run_id, RUN_ID);
  assert.equal(report.sha, fixture.sha);
  assert.equal(report.parent_sha, fixture.parentSha);
  assert.match(report.sha, /^[0-9a-f]{40}$/);
  assert.match(report.parent_sha, /^[0-9a-f]{40}$/);
  assert.equal(report.diff_sha256, fixture.recordedDiffHash);
  assert.deepEqual(report.changed_paths, fixture.recordedChangedPaths);
  assert.deepEqual(report.changed_paths, EXPECTED_CHANGED_PATHS);
  assert.equal(report.diff_truncated, false);
  assert.equal(typeof report.diff, 'string');
  assert.ok(report.diff.includes('diff --git a/src/app.txt b/src/app.txt'), report.diff);
  assert.ok(report.diff.includes('+added line'), report.diff);
  assert.ok(report.diff.includes('diff --git a/src/new-file.txt b/src/new-file.txt'), report.diff);
  assert.ok(report.diff.includes('diff --git a/src/old.txt b/src/old.txt'), report.diff);
  assert.ok(report.diff.includes('-remove me'), report.diff);
  assert.ok(Buffer.byteLength(report.diff, 'utf8') <= 200 * 1024, 'diff must be capped at 200 KiB');
  assert.deepEqual(report.objective, {
    metric: OBJECTIVE_METRIC,
    direction: 'maximize',
    score: OBJECTIVE_SCORE,
    improvement: OBJECTIVE_IMPROVEMENT,
  });
  assert.deepEqual(report.evidence, {
    all_public_passed: true,
    all_private_within_tolerance: true,
    checks: EXPECTED_CHECKS,
  });
  assert.equal(report.proposal_id, PROPOSAL_ID);
  assert.equal(typeof report.accepted_at, 'string');
  assert.equal(Number.isNaN(Date.parse(report.accepted_at)), false, 'accepted_at must be an ISO timestamp');
  assert.ok(
    [GENERATION_CREATED_AT, fixture.acceptedAt].includes(report.accepted_at),
    `accepted_at "${report.accepted_at}" must be the generation or accepted-event timestamp`,
  );
  assert.equal(JSON.stringify(report).includes(EVIDENCE_SECRET), false, 'the report must never embed evidence output');
});

test('generationDiff reports null links for a generation without candidate events', async () => {
  const report = await callGenerationDiff(ORPHAN_GENERATION_ID);

  assert.equal(report.generation_id, ORPHAN_GENERATION_ID);
  assert.equal(report.run_id, ORPHAN_RUN_ID);
  assert.equal(report.sha, fixture.parentSha);
  assert.equal(report.parent_sha, fixture.parentSha);
  assert.deepEqual(report.changed_paths, []);
  assert.equal(report.diff_truncated, false);
  assert.equal(typeof report.diff, 'string');
  assert.equal(report.diff.trim(), '');
  assert.equal(report.objective, null);
  assert.equal(report.evidence, null);
  assert.equal(report.proposal_id, null);
  assert.equal(typeof report.accepted_at, 'string');
  assert.equal(Number.isNaN(Date.parse(report.accepted_at)), false);
});

test('generationDiff rejects an unknown generation with EvoFenceError GENERATION_NOT_FOUND', async () => {
  const { EvoFenceError } = await repoImport('src/lib/errors.js');

  await assert.rejects(callGenerationDiff('g-does-not-exist'), (error) => {
    assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
    assert.equal(error.name, 'EvoFenceError');
    assert.equal(error.code, 'GENERATION_NOT_FOUND');
    assert.match(error.message, /g-does-not-exist/);
    return true;
  });
});

test('formatGenerationDiff renders the audit view without leaking evidence output', async () => {
  const { formatGenerationDiff } = await repoImport('src/lib/audit.js');
  const report = await callGenerationDiff(GENERATION_ID);
  const text = formatGenerationDiff(report);

  assert.equal(typeof text, 'string');
  assert.ok(text.includes(GENERATION_ID), 'output must include the generation id');
  assert.ok(text.includes(fixture.sha.slice(0, 7)), 'output must include the short sha');
  assert.ok(text.includes(String(OBJECTIVE_IMPROVEMENT)), 'output must include the objective delta');
  for (const changedPath of EXPECTED_CHANGED_PATHS) {
    assert.ok(text.includes(changedPath), `output must include changed path ${changedPath}`);
  }
  assert.ok(text.includes('diff --git a/src/app.txt b/src/app.txt'), 'output must include the unified diff');
  assert.ok(text.includes('+added line'), 'output must include diff content');

  const lines = text.split(/\r?\n/);
  for (const check of EXPECTED_CHECKS) {
    assert.ok(
      lines.some((line) => line.includes(check.id) && line.includes(check.kind) && line.includes(check.result)),
      `output must contain one evidence line for ${check.id} ${check.kind} ${check.result}`,
    );
  }

  assert.equal(text.includes(EVIDENCE_SECRET), false, 'formatted output must never embed evidence output');
});

test('CLI diff --json prints the documented report as parseable JSON', async () => {
  const result = spawnCli(['diff', GENERATION_ID, '--json']);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  for (const key of DOCUMENTED_KEYS) {
    assert.ok(Object.hasOwn(report, key), `CLI JSON is missing the documented key "${key}"`);
  }
  assert.equal(report.generation_id, GENERATION_ID);
  assert.equal(report.run_id, RUN_ID);
  assert.equal(report.sha, fixture.sha);
  assert.equal(report.parent_sha, fixture.parentSha);
  assert.equal(report.diff_sha256, fixture.recordedDiffHash);
  assert.deepEqual(report.changed_paths, EXPECTED_CHANGED_PATHS);
  assert.ok(report.diff.includes('+added line'), report.diff);
  assert.deepEqual(report.objective, {
    metric: OBJECTIVE_METRIC,
    direction: 'maximize',
    score: OBJECTIVE_SCORE,
    improvement: OBJECTIVE_IMPROVEMENT,
  });
  assert.deepEqual(report.evidence, {
    all_public_passed: true,
    all_private_within_tolerance: true,
    checks: EXPECTED_CHECKS,
  });
  assert.equal(report.proposal_id, PROPOSAL_ID);
  assert.equal(result.stdout.includes(EVIDENCE_SECRET), false, 'CLI output must never embed evidence output');
});

test('CLI diff exits 1 with GENERATION_NOT_FOUND for an unknown generation', async () => {
  const result = spawnCli(['diff', 'g-missing-fixture', '--json']);

  assert.equal(result.status, 1, `expected exit code 1, got ${result.status}`);
  assert.ok(
    result.stderr.startsWith('[GENERATION_NOT_FOUND] '),
    `stderr must start with "[GENERATION_NOT_FOUND] ": ${result.stderr}`,
  );
  assert.match(result.stderr, /g-missing-fixture/);
});

test('CLI diff exits 1 with the documented usage error when the generation id is missing', () => {
  for (const args of [['diff'], ['diff', '--json']]) {
    const result = spawnCli(args);
    assert.equal(result.status, 1, `expected exit code 1 for "evofence ${args.join(' ')}", got ${result.status}`);
    assert.equal(
      result.stderr.trim(),
      '[USAGE] Use: evofence diff <generation-id> [--json]',
      `unexpected usage error for "evofence ${args.join(' ')}": ${result.stderr}`,
    );
  }
});

test('CLI help lists the diff command', () => {
  const result = spawnCli(['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('diff <generation-id> [--json]'),
    `help text must document the diff command:\n${result.stdout}`,
  );
});
