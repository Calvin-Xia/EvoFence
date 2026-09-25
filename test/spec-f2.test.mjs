// Acceptance oracle for the evolution report exporter (`evofence report [file] [--json]`).
//
// This spec is mount-independent: every import of repository code is a dynamic import
// resolved from `process.cwd()`, so the same file can run from this repository root and
// against another candidate checkout used as cwd.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EVIDENCE_SECRET = 'EVIDENCE-STDOUT-MUST-NOT-LEAK-f2b6d1';
const RUN_A_ID = 'run-f2-a';
const RUN_B_ID = 'run-f2-b';
const RUN_C_ID = 'run-f2-c';
const GEN1_ID = 'g-run-f2-a-i01';
const GEN2_ID = 'g-run-f2-b-i02';
const PARENT_SHA = 'a1'.repeat(20);
const GEN1_SHA = 'b2'.repeat(20);
const GEN2_SHA = 'c3'.repeat(20);
const SCORE1 = 0.25;
const SCORE2 = 0.75;
const IMPROVEMENT1 = 0.25;
const IMPROVEMENT2 = 0.5;
const OBJECTIVE_DELTA = 0.5;
const TOKENS_TOTAL = 1200;
const USD_TOTAL = 0.5;
const OBJECTIVE_METRIC = 'quality_score';
const GENERATION_CREATED_AT_1 = '2026-02-01T10:00:00.000Z';
const GENERATION_CREATED_AT_2 = '2026-02-02T10:00:00.000Z';

const CONTRACT_TEXT = `contract_version: 1
objective:
  name: ${OBJECTIVE_METRIC}
  command: node --version
  direction: maximize
  min_delta: 0.1
hard_invariants:
  - id: invariant-a
    command: node --version
allowed_evolution_surface:
  - src/**
protected_paths:
  - .evofence/**
evidence:
  public_commands:
    - node --version
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

const CONTRACT_SNAPSHOT = {
  contract_version: 1,
  objective: { name: OBJECTIVE_METRIC, command: 'node --version', direction: 'maximize', min_delta: 0.1 },
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
};

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
    started_at: '2026-02-01T09:00:00.000Z',
    duration_ms: 12,
    public: [
      {
        id: 'invariant-a',
        kind: 'hard_invariant',
        passed: true,
        result: 'PASS',
        exit_code: 0,
        duration_ms: 5,
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
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-spec-f2-'));
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
  await writeFile(path.join(root, '.evofence', 'contract.yaml'), CONTRACT_TEXT);
  const { parseYamlText, validateContract } = await repoImport('src/lib/contract.js');
  validateContract(parseYamlText(CONTRACT_TEXT, 'contract.yaml'));

  const { Ledger, ledgerPath } = await repoImport('src/lib/ledger.js');
  const ledgerFile = ledgerPath(root);
  const startedAt = {};
  const ledger = new Ledger(ledgerFile);
  try {
    // Run A: one accepted generation.
    startedAt[RUN_A_ID] = ledger.append('run.started', RUN_A_ID, {
      adapter: 'codex',
      base_sha: PARENT_SHA,
      contract_snapshot: CONTRACT_SNAPSHOT,
    }).created_at;
    ledger.append('prompt.prepared', RUN_A_ID, { iteration: 1, phase: 'implementation', task_sha256: '1'.repeat(64) });
    ledger.append('evidence.candidate', RUN_A_ID, {
      iteration: 1,
      base_sha: PARENT_SHA,
      evidence: candidateEvidence(RUN_A_ID, 1, EVIDENCE_SECRET),
    });
    ledger.recordGeneration({
      generation_id: GEN1_ID,
      run_id: RUN_A_ID,
      sha: GEN1_SHA,
      parent_sha: PARENT_SHA,
      created_at: GENERATION_CREATED_AT_1,
    });
    ledger.append('candidate.accepted', RUN_A_ID, {
      iteration: 1,
      generation_id: GEN1_ID,
      sha: GEN1_SHA,
      parent_sha: PARENT_SHA,
      diff_sha256: '2'.repeat(64),
      objective_score: SCORE1,
      improvement: IMPROVEMENT1,
      evidence_artifact: `.evofence/artifacts/${RUN_A_ID}/candidate-1-1.json`,
      proposal_sha256: '3'.repeat(64),
    });
    ledger.append('run.finished', RUN_A_ID, {
      status: 'ACCEPTED',
      iterations: 1,
      active_generation: GEN1_ID,
      duration_ms: 100,
    });

    // Run B: one rejected candidate, then one accepted generation plus budget observations.
    startedAt[RUN_B_ID] = ledger.append('run.started', RUN_B_ID, {
      adapter: 'claude',
      base_sha: GEN1_SHA,
      contract_snapshot: CONTRACT_SNAPSHOT,
    }).created_at;
    ledger.append('prompt.prepared', RUN_B_ID, { iteration: 1, phase: 'proposal', task_sha256: '4'.repeat(64) });
    ledger.append('candidate.rejected', RUN_B_ID, {
      iteration: 1,
      base_sha: GEN1_SHA,
      failure: { reason: 'PUBLIC_TEST_FAILURE' },
    });
    ledger.append('prompt.prepared', RUN_B_ID, { iteration: 2, phase: 'implementation', task_sha256: '5'.repeat(64) });
    ledger.append('budget.tokens.observed', RUN_B_ID, {
      metric: 'tokens',
      phase: 'implementation',
      iteration: 2,
      invocation_tokens: TOKENS_TOTAL,
      observed_total: TOKENS_TOTAL,
      limit: 100000,
      stop_reason: null,
    });
    ledger.append('budget.usd.observed', RUN_B_ID, {
      metric: 'estimated_usd',
      phase: 'implementation',
      iteration: 2,
      limit_usd: 5,
      previous_observed_usd: 0,
      invocation_estimate_usd: USD_TOTAL,
      observed_total_usd: USD_TOTAL,
      observed_total_usd_micros: USD_TOTAL * 1_000_000,
      cost_source: 'claude-result',
      native_cap_reached: false,
    });
    ledger.append('evidence.candidate', RUN_B_ID, {
      iteration: 2,
      base_sha: GEN1_SHA,
      evidence: candidateEvidence(RUN_B_ID, 2, EVIDENCE_SECRET),
    });
    ledger.recordGeneration({
      generation_id: GEN2_ID,
      run_id: RUN_B_ID,
      sha: GEN2_SHA,
      parent_sha: GEN1_SHA,
      created_at: GENERATION_CREATED_AT_2,
    });
    ledger.append('candidate.accepted', RUN_B_ID, {
      iteration: 2,
      generation_id: GEN2_ID,
      sha: GEN2_SHA,
      parent_sha: GEN1_SHA,
      diff_sha256: '6'.repeat(64),
      objective_score: SCORE2,
      improvement: IMPROVEMENT2,
      evidence_artifact: `.evofence/artifacts/${RUN_B_ID}/candidate-2-2.json`,
      proposal_sha256: '7'.repeat(64),
    });
    ledger.append('run.finished', RUN_B_ID, {
      status: 'ACCEPTED',
      iterations: 2,
      active_generation: GEN2_ID,
      duration_ms: 200,
    });

    // Run C: started but never finished -> INCOMPLETE.
    startedAt[RUN_C_ID] = ledger.append('run.started', RUN_C_ID, {
      adapter: 'pi',
      base_sha: GEN2_SHA,
      contract_snapshot: CONTRACT_SNAPSHOT,
    }).created_at;
  } finally {
    ledger.close();
  }

  const emptyLedgerFile = path.join(root, '.evofence', 'ledger-empty.sqlite');
  const emptyLedger = new Ledger(emptyLedgerFile);
  emptyLedger.close();

  return { directory, root, ledgerFile, emptyLedgerFile, startedAt };
}

before(async () => {
  cliPath = path.resolve('src/cli.js');
  fixture = await buildFixture();
});

after(async () => {
  if (fixture) await rm(fixture.directory, { recursive: true, force: true });
});

async function callBuildEvolutionReport(ledgerFile) {
  const { buildEvolutionReport } = await repoImport('src/lib/report.js');
  const { Ledger } = await repoImport('src/lib/ledger.js');
  const ledger = new Ledger(ledgerFile);
  try {
    // The documented signature receives an open ledger; tolerate an implementation that
    // interprets `ledger` as the ledger path instead (a TypeError from the other shape).
    return await buildEvolutionReport({ root: fixture.root, ledger });
  } catch (error) {
    if (error instanceof TypeError) {
      return await buildEvolutionReport({ root: fixture.root, ledger: ledgerFile });
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

test('buildEvolutionReport returns the documented report shape for a seeded ledger', async () => {
  const report = await callBuildEvolutionReport(fixture.ledgerFile);

  assert.equal(report.schema_version, 1);
  assert.equal(typeof report.generated_at, 'string');
  assert.equal(Number.isNaN(Date.parse(report.generated_at)), false, 'generated_at must be an ISO timestamp');
  assert.ok(Math.abs(Date.now() - Date.parse(report.generated_at)) < 300000, 'generated_at must be generated at call time');
  assert.equal(report.run_count, 3);
  assert.equal(report.generation_count, 2);
  assert.ok(Number.isInteger(report.run_count) && Number.isInteger(report.generation_count));

  assert.ok(Array.isArray(report.runs));
  assert.equal(report.runs.length, 3);
  assert.deepEqual(report.runs.map((run) => run.run_id), [RUN_C_ID, RUN_B_ID, RUN_A_ID], 'runs must be newest first');
  for (const run of report.runs) {
    assert.equal(typeof run.run_id, 'string');
    assert.equal(typeof run.started_at, 'string');
    assert.equal(typeof run.adapter, 'string');
    assert.equal(typeof run.status, 'string');
    assert.equal(typeof run.iterations, 'number');
    assert.equal(typeof run.accepted_candidates, 'number');
    assert.equal(typeof run.rejected_candidates, 'number');
  }
  const runA = report.runs.find((run) => run.run_id === RUN_A_ID);
  assert.deepEqual(
    {
      started_at: runA.started_at,
      adapter: runA.adapter,
      status: runA.status,
      iterations: runA.iterations,
      accepted: runA.accepted_candidates,
      rejected: runA.rejected_candidates,
    },
    { started_at: fixture.startedAt[RUN_A_ID], adapter: 'codex', status: 'ACCEPTED', iterations: 1, accepted: 1, rejected: 0 },
  );
  const runB = report.runs.find((run) => run.run_id === RUN_B_ID);
  assert.deepEqual(
    {
      started_at: runB.started_at,
      adapter: runB.adapter,
      status: runB.status,
      iterations: runB.iterations,
      accepted: runB.accepted_candidates,
      rejected: runB.rejected_candidates,
    },
    { started_at: fixture.startedAt[RUN_B_ID], adapter: 'claude', status: 'ACCEPTED', iterations: 2, accepted: 1, rejected: 1 },
  );
  const runC = report.runs.find((run) => run.run_id === RUN_C_ID);
  assert.deepEqual(
    {
      started_at: runC.started_at,
      adapter: runC.adapter,
      status: runC.status,
      iterations: runC.iterations,
      accepted: runC.accepted_candidates,
      rejected: runC.rejected_candidates,
    },
    { started_at: fixture.startedAt[RUN_C_ID], adapter: 'pi', status: 'INCOMPLETE', iterations: 0, accepted: 0, rejected: 0 },
  );

  assert.ok(Array.isArray(report.generations));
  assert.equal(report.generations.length, 2);
  const gen1 = report.generations.find((generation) => generation.generation_id === GEN1_ID);
  assert.deepEqual(
    {
      sha: gen1.sha,
      parent_sha: gen1.parent_sha,
      objective_score: gen1.objective_score,
      improvement: gen1.improvement,
      run_id: gen1.run_id,
    },
    { sha: GEN1_SHA, parent_sha: PARENT_SHA, objective_score: SCORE1, improvement: IMPROVEMENT1, run_id: RUN_A_ID },
  );
  const gen2 = report.generations.find((generation) => generation.generation_id === GEN2_ID);
  assert.deepEqual(
    {
      sha: gen2.sha,
      parent_sha: gen2.parent_sha,
      objective_score: gen2.objective_score,
      improvement: gen2.improvement,
      run_id: gen2.run_id,
    },
    { sha: GEN2_SHA, parent_sha: GEN1_SHA, objective_score: SCORE2, improvement: IMPROVEMENT2, run_id: RUN_B_ID },
  );

  assert.ok(report.objective && typeof report.objective === 'object');
  for (const key of ['metric', 'direction', 'first_score', 'best_score', 'delta']) {
    assert.ok(Object.hasOwn(report.objective, key), `objective is missing "${key}"`);
  }
  assert.equal(report.objective.metric, OBJECTIVE_METRIC);
  assert.equal(report.objective.direction, 'maximize');
  assert.equal(report.objective.first_score, SCORE1);
  assert.equal(report.objective.best_score, SCORE2);
  assert.equal(report.objective.delta, OBJECTIVE_DELTA);

  assert.ok(report.budgets && typeof report.budgets === 'object');
  assert.equal(report.budgets.tokens_total, TOKENS_TOTAL);
  assert.equal(report.budgets.usd_total, USD_TOTAL);

  assert.ok(report.integrity && typeof report.integrity === 'object');
  assert.equal(report.integrity.valid, true);

  assert.equal(JSON.stringify(report).includes(EVIDENCE_SECRET), false, 'the report must never embed evidence output');
});

test('buildEvolutionReport reports zero counts and nulls for an empty ledger', async () => {
  const report = await callBuildEvolutionReport(fixture.emptyLedgerFile);

  assert.equal(report.schema_version, 1);
  assert.equal(typeof report.generated_at, 'string');
  assert.equal(Number.isNaN(Date.parse(report.generated_at)), false);
  assert.equal(report.run_count, 0);
  assert.equal(report.generation_count, 0);
  assert.deepEqual(report.runs, []);
  assert.deepEqual(report.generations, []);
  assert.equal(report.objective, null);
  assert.ok(report.budgets && typeof report.budgets === 'object');
  assert.equal(report.budgets.tokens_total, null);
  assert.equal(report.budgets.usd_total, null);
  assert.equal(report.integrity.valid, true);
});

test('formatEvolutionReport renders Markdown headings, summary bullets and both tables', async () => {
  const { formatEvolutionReport } = await repoImport('src/lib/report.js');
  const report = await callBuildEvolutionReport(fixture.ledgerFile);
  const markdown = formatEvolutionReport(report);

  assert.equal(typeof markdown, 'string');
  const lines = markdown.split(/\r?\n/);
  assert.ok(lines.some((line) => /^#\s+\S/.test(line)), 'Markdown must contain an H1 title');

  const bullets = lines.filter((line) => /^[-*]\s+\S/.test(line));
  assert.ok(bullets.length >= 4, `expected at least 4 summary bullets, got ${bullets.length}`);
  assert.ok(bullets.some((line) => /run/i.test(line) && line.includes('3')), 'summary must mention the run count');
  assert.ok(bullets.some((line) => /generation/i.test(line) && line.includes('2')), 'summary must mention the generation count');
  assert.ok(bullets.some((line) => /objective|delta/i.test(line) && line.includes('0.5')), 'summary must mention the objective delta');
  assert.ok(bullets.some((line) => /token/i.test(line) && (line.includes('1200') || line.includes('1,200'))), 'summary must mention the token total');
  assert.ok(bullets.some((line) => /usd|cost|\$/i.test(line) && line.includes('0.5')), 'summary must mention the USD total');

  assert.ok(markdown.includes('## Generations'), 'Markdown must contain the ## Generations table');
  assert.ok(markdown.includes('## Runs'), 'Markdown must contain the ## Runs table');
  const generationsSection = markdown.split('## Generations')[1].split('## Runs')[0];
  const runsSection = markdown.split('## Runs')[1];
  const generationRows = generationsSection.split(/\r?\n/);
  const runRows = runsSection.split(/\r?\n/);

  assert.ok(
    generationRows.some((line) => line.trim().startsWith('|')
      && /generation/i.test(line) && /sha/i.test(line) && /score/i.test(line) && /improvement/i.test(line)),
    'generations table must document the generation/sha/score/improvement columns',
  );
  assert.ok(
    runRows.some((line) => line.trim().startsWith('|')
      && /run/i.test(line) && /adapter/i.test(line) && /status/i.test(line)
      && /iterations/i.test(line) && /accepted/i.test(line) && /rejected/i.test(line)),
    'runs table must document the run/adapter/status/iterations/accepted/rejected columns',
  );

  for (const generation of report.generations) {
    const row = generationRows.find((line) => line.includes(generation.generation_id));
    assert.ok(row, `generations table must contain ${generation.generation_id}`);
    assert.ok(row.includes(generation.sha.slice(0, 7)), `generations table must contain the sha of ${generation.generation_id}`);
    assert.ok(row.includes(String(generation.objective_score)), `generations table must contain the score of ${generation.generation_id}`);
  }
  for (const run of report.runs) {
    const row = runRows.find((line) => line.includes(run.run_id));
    assert.ok(row, `runs table must contain ${run.run_id}`);
    assert.ok(row.includes(run.adapter), `runs table must contain the adapter of ${run.run_id}`);
    assert.ok(row.includes(run.status), `runs table must contain the status of ${run.run_id}`);
  }

  assert.equal(markdown.includes(EVIDENCE_SECRET), false, 'formatted report must never embed evidence output');
});

test('CLI report --json prints the documented report as parseable JSON', async () => {
  const result = spawnCli(['report', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema_version, 1);
  assert.equal(typeof report.generated_at, 'string');
  assert.equal(report.run_count, 3);
  assert.equal(report.generation_count, 2);
  assert.deepEqual(report.runs.map((run) => run.run_id), [RUN_C_ID, RUN_B_ID, RUN_A_ID]);
  assert.equal(report.runs.find((run) => run.run_id === RUN_B_ID).rejected_candidates, 1);
  assert.equal(report.runs.find((run) => run.run_id === RUN_C_ID).status, 'INCOMPLETE');
  assert.equal(report.generations.length, 2);
  assert.equal(report.objective.first_score, SCORE1);
  assert.equal(report.objective.best_score, SCORE2);
  assert.equal(report.objective.delta, OBJECTIVE_DELTA);
  assert.equal(report.budgets.tokens_total, TOKENS_TOTAL);
  assert.equal(report.budgets.usd_total, USD_TOTAL);
  assert.equal(report.integrity.valid, true);
  assert.equal(result.stdout.includes(EVIDENCE_SECRET), false, 'CLI output must never embed evidence output');
});

test('CLI report prints the Markdown report to stdout', async () => {
  const result = spawnCli(['report']);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.split(/\r?\n/).some((line) => /^#\s+\S/.test(line)), 'stdout must start with an H1 title');
  assert.ok(result.stdout.includes('## Generations'), result.stdout);
  assert.ok(result.stdout.includes('## Runs'), result.stdout);
  assert.ok(result.stdout.includes(GEN1_ID) && result.stdout.includes(GEN2_ID), 'stdout must include the generations');
  assert.equal(result.stdout.includes(EVIDENCE_SECRET), false, 'CLI output must never embed evidence output');
});

test('CLI report <file> writes Markdown, creates parent directories and prints the relative path', async () => {
  const relative = 'reports/nested/evolution.md';
  const result = spawnCli(['report', relative]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `Report written to ${relative}`);
  const written = await readFile(path.join(fixture.root, 'reports', 'nested', 'evolution.md'), 'utf8');
  assert.ok(/^#\s+\S/m.test(written), 'written file must contain the H1 title');
  assert.ok(written.includes('## Generations') && written.includes('## Runs'), 'written file must contain both tables');
  assert.ok(written.includes(GEN1_ID) && written.includes(GEN2_ID), 'written file must include the generations');
  assert.equal(written.includes(EVIDENCE_SECRET), false, 'written report must never embed evidence output');
});

test('CLI report <file> --json writes the JSON report', async () => {
  const relative = 'reports/nested/evolution.json';
  const result = spawnCli(['report', relative, '--json']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `Report written to ${relative}`);
  const written = await readFile(path.join(fixture.root, 'reports', 'nested', 'evolution.json'), 'utf8');
  const report = JSON.parse(written);
  assert.equal(report.schema_version, 1);
  assert.equal(report.run_count, 3);
  assert.equal(report.generation_count, 2);
  assert.equal(report.budgets.tokens_total, TOKENS_TOTAL);
  assert.equal(written.includes(EVIDENCE_SECRET), false, 'written report must never embed evidence output');
});

test('CLI report exits 1 with the documented usage error for extra arguments', () => {
  const result = spawnCli(['report', 'a.md', 'b.md']);

  assert.equal(result.status, 1, `expected exit code 1, got ${result.status}`);
  assert.equal(result.stderr.trim(), '[USAGE] Use: evofence report [file] [--json]');
});

test('CLI help lists the report command', () => {
  const result = spawnCli(['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('report [file] [--json]'),
    `help text must document the report command:\n${result.stdout}`,
  );
});
