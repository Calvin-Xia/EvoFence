// Acceptance oracle for the operational status command (`evofence status [--json]`).
//
// This spec is mount-independent: every import of repository code is a dynamic import
// resolved from `process.cwd()`, so the same file can run from this repository root and
// against another candidate checkout used as cwd.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EVIDENCE_SECRET = 'EVIDENCE-STDOUT-MUST-NOT-LEAK-f3c4e2';
const RUN_1 = 'run-f3-1';
const RUN_2 = 'run-f3-2';
const RUN_3 = 'run-f3-3';
const RUN_4 = 'run-f3-4';
const RUN_5 = 'run-f3-5';
const RUN_6 = 'run-f3-6';
const PARENT_SHA = 'a1'.repeat(20);
const GEN1_SHA = 'b2'.repeat(20);
const GEN2_SHA = 'c3'.repeat(20);
const GEN3_SHA = 'd4'.repeat(20);
const GEN1_ID = 'g-run-f3-1-i01';
const GEN2_ID = 'g-run-f3-2-i02';
const GEN3_ID = 'g-run-f3-3-i01';
const GEN1_CREATED_AT = '2026-03-01T10:00:00.000Z';
const GEN2_CREATED_AT = '2026-03-02T10:00:00.000Z';
const GEN3_CREATED_AT = '2026-03-03T10:00:00.000Z';
const TOTALS = { runs: 6, generations: 3, accepted_candidates: 3, rejected_candidates: 2 };

// Chronological run plan: 6 runs so recent_runs(5) must drop the oldest one.
const RUN_PLAN = [
  {
    run_id: RUN_1,
    adapter: 'codex',
    generation: { id: GEN1_ID, sha: GEN1_SHA, parent: PARENT_SHA, created_at: GEN1_CREATED_AT, score: 0.25, improvement: 0.25 },
    rejected: 0,
    finish: { status: 'ACCEPTED', iterations: 1 },
  },
  {
    run_id: RUN_2,
    adapter: 'claude',
    generation: { id: GEN2_ID, sha: GEN2_SHA, parent: GEN1_SHA, created_at: GEN2_CREATED_AT, score: 0.75, improvement: 0.5 },
    rejected: 1,
    finish: { status: 'ACCEPTED', iterations: 2 },
  },
  {
    run_id: RUN_3,
    adapter: 'pi',
    generation: { id: GEN3_ID, sha: GEN3_SHA, parent: GEN2_SHA, created_at: GEN3_CREATED_AT, score: 0.9, improvement: 0.15 },
    rejected: 0,
    finish: { status: 'ACCEPTED', iterations: 1 },
  },
  { run_id: RUN_4, adapter: 'codex', generation: null, rejected: 0, finish: null },
  { run_id: RUN_5, adapter: 'claude', generation: null, rejected: 1, finish: { status: 'PLATEAU', iterations: 1 } },
  { run_id: RUN_6, adapter: 'codex', generation: null, rejected: 0, finish: null },
];

const EXPECTED_RECENT = [
  { run_id: RUN_6, adapter: 'codex', status: 'INCOMPLETE', iterations: 0, accepted_candidates: 0, rejected_candidates: 0 },
  { run_id: RUN_5, adapter: 'claude', status: 'PLATEAU', iterations: 1, accepted_candidates: 0, rejected_candidates: 1 },
  { run_id: RUN_4, adapter: 'codex', status: 'INCOMPLETE', iterations: 0, accepted_candidates: 0, rejected_candidates: 0 },
  { run_id: RUN_3, adapter: 'pi', status: 'ACCEPTED', iterations: 1, accepted_candidates: 1, rejected_candidates: 0 },
  { run_id: RUN_2, adapter: 'claude', status: 'ACCEPTED', iterations: 2, accepted_candidates: 1, rejected_candidates: 1 },
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

function candidateEvidence(runId, iteration, secret) {
  return {
    schema_version: 1,
    run_id: runId,
    iteration,
    phase: 'candidate',
    started_at: '2026-03-01T09:00:00.000Z',
    duration_ms: 12,
    public: [
      {
        id: 'invariant-a',
        kind: 'hard_invariant',
        passed: true,
        result: 'PASS',
        exit_code: 0,
        command: 'node --version',
        stdout: secret,
        command_output: secret,
      },
    ],
    private: { total: 0, passed: 0, failed: 0, cases: [] },
    objective: { passed: true, result: 'PASS', exit_code: 0, score: 0.5, configured: true, valid_score: true, stdout: secret },
    all_public_passed: true,
    all_private_within_tolerance: true,
    artifact: `.evofence/artifacts/${runId}/candidate-${iteration}.json`,
    raw_output: secret,
  };
}

async function buildFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-spec-f3-'));
  const root = path.join(directory, 'repo');
  await mkdir(path.join(root, 'src'), { recursive: true });
  runGit(root, ['init', '--quiet', '--initial-branch=main']);
  runGit(root, ['config', 'user.name', 'EvoFence Fixture']);
  runGit(root, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  runGit(root, ['config', 'core.autocrlf', 'false']);
  await writeFile(path.join(root, 'README.md'), '# fixture repository\n');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'fixture']);

  await mkdir(path.join(root, '.evofence'), { recursive: true });
  const { Ledger, ledgerPath } = await repoImport('src/lib/ledger.js');
  const ledgerFile = ledgerPath(root);
  const startedAt = {};
  const ledger = new Ledger(ledgerFile);
  try {
    for (const plan of RUN_PLAN) {
      startedAt[plan.run_id] = ledger.append('run.started', plan.run_id, {
        adapter: plan.adapter,
        base_sha: plan.generation?.parent ?? PARENT_SHA,
      }).created_at;
      if (plan.rejected > 0) {
        ledger.append('prompt.prepared', plan.run_id, { iteration: 1, phase: 'proposal', task_sha256: '1'.repeat(64) });
        ledger.append('candidate.rejected', plan.run_id, {
          iteration: 1,
          base_sha: plan.generation?.parent ?? PARENT_SHA,
          failure: { reason: 'PUBLIC_TEST_FAILURE' },
        });
      }
      if (plan.generation) {
        const iteration = plan.rejected > 0 ? 2 : 1;
        ledger.append('evidence.candidate', plan.run_id, {
          iteration,
          base_sha: plan.generation.parent,
          evidence: candidateEvidence(plan.run_id, iteration, EVIDENCE_SECRET),
        });
        ledger.recordGeneration({
          generation_id: plan.generation.id,
          run_id: plan.run_id,
          sha: plan.generation.sha,
          parent_sha: plan.generation.parent,
          created_at: plan.generation.created_at,
        });
        ledger.append('candidate.accepted', plan.run_id, {
          iteration,
          generation_id: plan.generation.id,
          sha: plan.generation.sha,
          parent_sha: plan.generation.parent,
          diff_sha256: '2'.repeat(64),
          objective_score: plan.generation.score,
          improvement: plan.generation.improvement,
          evidence_artifact: `.evofence/artifacts/${plan.run_id}/candidate-${iteration}-1.json`,
          proposal_sha256: '3'.repeat(64),
        });
      }
      if (plan.finish) {
        ledger.append('run.finished', plan.run_id, {
          status: plan.finish.status,
          iterations: plan.finish.iterations,
          duration_ms: 100,
        });
      }
    }
  } finally {
    ledger.close();
  }

  // A tampered copy of the ledger: break the hash chain so verify() reports invalid.
  const tamperedLedgerFile = path.join(root, '.evofence', 'ledger-tampered.sqlite');
  await copyFile(ledgerFile, tamperedLedgerFile);
  const tampered = new Ledger(tamperedLedgerFile);
  try {
    tampered.db.exec('DROP TRIGGER IF EXISTS events_no_update');
    tampered.db.prepare('UPDATE events SET created_at = ? WHERE seq = 1').run('1999-01-01T00:00:00.000Z');
  } finally {
    tampered.close();
  }

  const emptyLedgerFile = path.join(root, '.evofence', 'ledger-empty.sqlite');
  const emptyLedger = new Ledger(emptyLedgerFile);
  emptyLedger.close();

  return { directory, root, ledgerFile, tamperedLedgerFile, emptyLedgerFile, startedAt };
}

before(async () => {
  cliPath = path.resolve('src/cli.js');
  fixture = await buildFixture();
});

after(async () => {
  if (fixture) await rm(fixture.directory, { recursive: true, force: true });
});

async function callBuildStatus(ledgerFile) {
  const { buildStatus } = await repoImport('src/lib/status.js');
  const { Ledger } = await repoImport('src/lib/ledger.js');
  const ledger = new Ledger(ledgerFile);
  try {
    // The documented signature receives an open ledger; tolerate an implementation that
    // interprets `ledger` as the ledger path instead (a TypeError from the other shape).
    return await buildStatus({ root: fixture.root, ledger });
  } catch (error) {
    if (error instanceof TypeError) {
      return await buildStatus({ root: fixture.root, ledger: ledgerFile });
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

test('buildStatus returns the documented status with totals across all runs and a capped recent_runs', async () => {
  const status = await callBuildStatus(fixture.ledgerFile);

  assert.equal(typeof status.root, 'string');
  assert.equal(status.root.includes('\\'), false, 'root must use forward slashes');
  assert.equal(status.root.toLowerCase(), fixture.root.replaceAll('\\', '/').toLowerCase());

  assert.ok(status.active_generation && typeof status.active_generation === 'object', 'active_generation must be the active generation row');
  assert.deepEqual(
    {
      generation_id: status.active_generation.generation_id,
      run_id: status.active_generation.run_id,
      sha: status.active_generation.sha,
      parent_sha: status.active_generation.parent_sha,
      created_at: status.active_generation.created_at,
    },
    { generation_id: GEN3_ID, run_id: RUN_3, sha: GEN3_SHA, parent_sha: GEN2_SHA, created_at: GEN3_CREATED_AT },
  );

  assert.ok(status.integrity && typeof status.integrity === 'object');
  assert.equal(status.integrity.valid, true);

  assert.ok(Array.isArray(status.recent_runs));
  assert.equal(status.recent_runs.length, 5, 'recent_runs must be capped at 5');
  assert.deepEqual(status.recent_runs.map((run) => run.run_id), EXPECTED_RECENT.map((run) => run.run_id));
  assert.equal(status.recent_runs.some((run) => run.run_id === RUN_1), false, 'the oldest run must be outside the cap');
  for (const run of status.recent_runs) {
    assert.equal(typeof run.started_at, 'string');
    assert.equal(typeof run.adapter, 'string');
    assert.equal(typeof run.status, 'string');
    assert.equal(typeof run.iterations, 'number');
    assert.equal(typeof run.accepted_candidates, 'number');
    assert.equal(typeof run.rejected_candidates, 'number');
  }
  for (const expected of EXPECTED_RECENT) {
    const run = status.recent_runs.find((item) => item.run_id === expected.run_id);
    assert.ok(run, `recent_runs must contain ${expected.run_id}`);
    assert.deepEqual(
      {
        run_id: run.run_id,
        started_at: run.started_at,
        adapter: run.adapter,
        status: run.status,
        iterations: run.iterations,
        accepted_candidates: run.accepted_candidates,
        rejected_candidates: run.rejected_candidates,
      },
      { ...expected, started_at: fixture.startedAt[expected.run_id] },
    );
  }

  assert.ok(status.totals && typeof status.totals === 'object');
  for (const key of ['runs', 'generations', 'accepted_candidates', 'rejected_candidates']) {
    assert.ok(Object.hasOwn(status.totals, key), `totals is missing "${key}"`);
    assert.ok(Number.isInteger(status.totals[key]), `totals.${key} must be an integer`);
  }
  assert.equal(status.totals.runs, TOTALS.runs, 'totals.runs must count every run, not just the recent five');
  assert.equal(status.totals.generations, TOTALS.generations);
  assert.equal(status.totals.accepted_candidates, TOTALS.accepted_candidates);
  assert.equal(status.totals.rejected_candidates, TOTALS.rejected_candidates);

  assert.equal(JSON.stringify(status).includes(EVIDENCE_SECRET), false, 'the status must never embed evidence output');
});

test('buildStatus reports zero totals and null active generation for an empty ledger', async () => {
  const status = await callBuildStatus(fixture.emptyLedgerFile);

  assert.equal(typeof status.root, 'string');
  assert.equal(status.root.includes('\\'), false, 'root must use forward slashes');
  assert.equal(status.active_generation, null);
  assert.equal(status.integrity.valid, true);
  assert.deepEqual(status.recent_runs, []);
  assert.equal(status.totals.runs, 0);
  assert.equal(status.totals.generations, 0);
  assert.equal(status.totals.accepted_candidates, 0);
  assert.equal(status.totals.rejected_candidates, 0);
});

test('buildStatus reports invalid ledger integrity for a tampered ledger', async () => {
  const status = await callBuildStatus(fixture.tamperedLedgerFile);

  assert.equal(status.integrity.valid, false);
  assert.equal(status.totals.runs, TOTALS.runs);
});

test('formatStatus renders the root, active generation, integrity, totals and recent runs', async () => {
  const { formatStatus } = await repoImport('src/lib/status.js');
  const status = await callBuildStatus(fixture.ledgerFile);
  const text = formatStatus(status);

  assert.equal(typeof text, 'string');
  assert.ok(text.includes(status.root), 'output must contain the root path');
  const lines = text.split(/\r?\n/);

  const activeLine = lines.find((line) => line.startsWith('Active generation:'));
  assert.ok(activeLine, 'output must contain an Active generation line');
  assert.ok(activeLine.includes(GEN3_ID), `Active generation line must contain ${GEN3_ID}: ${activeLine}`);
  assert.ok(activeLine.includes(GEN3_SHA.slice(0, 7)), `Active generation line must contain the sha: ${activeLine}`);

  assert.ok(text.includes('Ledger integrity: ok'), `output must contain "Ledger integrity: ok": ${text}`);

  const totalsLine = lines.find((line) => line.includes('Totals:'));
  assert.ok(totalsLine, 'output must contain a Totals line');
  for (const label of [/run/i, /generation/i, /accept/i, /reject/i]) {
    assert.ok(label.test(totalsLine), `Totals line must mention ${label}: ${totalsLine}`);
  }
  assert.ok(totalsLine.includes(String(TOTALS.runs)), `Totals line must include ${TOTALS.runs}: ${totalsLine}`);
  assert.ok(totalsLine.includes(String(TOTALS.generations)), `Totals line must include ${TOTALS.generations}: ${totalsLine}`);
  assert.ok(totalsLine.includes(String(TOTALS.rejected_candidates)), `Totals line must include ${TOTALS.rejected_candidates}: ${totalsLine}`);

  assert.ok(text.includes('Recent runs:'), 'output must contain the Recent runs section');
  const recentRunsIndex = lines.findIndex((line) => line.includes('Recent runs:'));
  assert.ok(recentRunsIndex >= 0, 'output must contain the Recent runs section');
  const recentLines = lines.slice(recentRunsIndex + 1);
  for (const run of status.recent_runs) {
    const line = recentLines.find((item) => item.includes(run.run_id));
    assert.ok(line, `Recent runs must contain a line for ${run.run_id}`);
    assert.ok(line.includes(run.adapter), `Recent runs line must contain the adapter of ${run.run_id}: ${line}`);
    assert.ok(line.includes(run.status), `Recent runs line must contain the status of ${run.run_id}: ${line}`);
    assert.ok(line.includes(String(run.iterations)), `Recent runs line must contain the iterations of ${run.run_id}: ${line}`);
  }

  assert.equal(text.includes(EVIDENCE_SECRET), false, 'formatted status must never embed evidence output');
});

test('formatStatus renders Active generation: none and Ledger integrity: FAILED for a stub status', async () => {
  const { formatStatus } = await repoImport('src/lib/status.js');
  const text = formatStatus({
    root: fixture.root.replaceAll('\\', '/'),
    active_generation: null,
    integrity: { valid: false },
    recent_runs: [],
    totals: { runs: 0, generations: 0, accepted_candidates: 0, rejected_candidates: 0 },
  });

  assert.ok(text.includes('Active generation: none'), `output must contain "Active generation: none": ${text}`);
  assert.ok(text.includes('Ledger integrity: FAILED'), `output must contain "Ledger integrity: FAILED": ${text}`);
  assert.ok(text.includes('Totals:'), 'output must contain a Totals line');
  assert.ok(text.includes('Recent runs:'), 'output must contain the Recent runs section');
});

test('CLI status --json prints the documented status as parseable JSON', async () => {
  const result = spawnCli(['status', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(typeof status.root, 'string');
  assert.equal(status.root.includes('\\'), false, 'root must use forward slashes in JSON output');
  assert.equal(status.root.toLowerCase(), fixture.root.replaceAll('\\', '/').toLowerCase());
  assert.equal(status.active_generation.generation_id, GEN3_ID);
  assert.equal(status.active_generation.sha, GEN3_SHA);
  assert.equal(status.integrity.valid, true);
  assert.deepEqual(status.recent_runs.map((run) => run.run_id), EXPECTED_RECENT.map((run) => run.run_id));
  assert.equal(status.totals.runs, TOTALS.runs);
  assert.equal(status.totals.generations, TOTALS.generations);
  assert.equal(status.totals.accepted_candidates, TOTALS.accepted_candidates);
  assert.equal(status.totals.rejected_candidates, TOTALS.rejected_candidates);
  assert.equal(result.stdout.includes(EVIDENCE_SECRET), false, 'CLI output must never embed evidence output');
});

test('CLI status prints the formatted overview to stdout', async () => {
  const result = spawnCli(['status']);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(fixture.root.replaceAll('\\', '/')), 'stdout must contain the root path');
  assert.ok(result.stdout.includes('Active generation:'), 'stdout must contain the active generation line');
  assert.ok(result.stdout.includes(GEN3_ID), 'stdout must contain the active generation id');
  assert.ok(result.stdout.includes('Ledger integrity: ok'), 'stdout must contain the integrity line');
  assert.ok(result.stdout.includes('Totals:'), 'stdout must contain the totals line');
  assert.ok(result.stdout.includes('Recent runs:'), 'stdout must contain the recent runs section');
  assert.ok(result.stdout.includes(RUN_6) && result.stdout.includes(RUN_2), 'stdout must contain the recent run ids');
  assert.equal(result.stdout.includes(EVIDENCE_SECRET), false, 'CLI output must never embed evidence output');
});

test('CLI status exits 1 with the documented usage error for extra arguments', () => {
  const result = spawnCli(['status', 'extra-arg']);

  assert.equal(result.status, 1, `expected exit code 1, got ${result.status}`);
  assert.equal(result.stderr.trim(), '[USAGE] Use: evofence status [--json]');
});

test('CLI help lists the status command', () => {
  const result = spawnCli(['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('status [--json]'),
    `help text must document the status command:\n${result.stdout}`,
  );
});
