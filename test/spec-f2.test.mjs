// Acceptance oracle for the evolution report exporter (`evofence report [file] [--json]`).
//
// This spec is mount-independent: every import of repository code is a dynamic import
// resolved from `process.cwd()`, so the same file can run from this repository root and
// against another candidate checkout used as cwd.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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

// Scratch ledgers live inside the fixture directory and are removed by the after() hook.
async function scratchLedger(name, writeEvents) {
  const scratchRoot = path.join(fixture.directory, 'scratch');
  await mkdir(scratchRoot, { recursive: true });
  const ledgerFile = path.join(scratchRoot, `${name}.sqlite`);
  const { Ledger } = await repoImport('src/lib/ledger.js');
  const ledger = new Ledger(ledgerFile);
  try {
    writeEvents(ledger);
  } finally {
    ledger.close();
  }
  return ledgerFile;
}

function scratchContractSnapshot(name, direction) {
  return {
    contract_version: 1,
    objective: { name, command: 'node --version', direction, min_delta: 0.1 },
  };
}

function acceptScratchGeneration(ledger, runId, iteration, generationId, score, improvement, createdAt) {
  const sha = generationId.padEnd(40, 'f');
  const parentSha = generationId.padEnd(40, 'e');
  ledger.recordGeneration({ generation_id: generationId, run_id: runId, sha, parent_sha: parentSha, created_at: createdAt });
  ledger.append('candidate.accepted', runId, {
    iteration,
    generation_id: generationId,
    sha,
    parent_sha: parentSha,
    objective_score: score,
    improvement,
  });
}

// Mirrors Ledger's unkeyed eventHash so a scratch ledger can carry a forged (recomputed)
// hash chain around a payload that is not valid JSON.
async function forgeEventHashChain(ledger) {
  const { sha256, stableStringify } = await repoImport('src/lib/fs.js');
  ledger.db.exec('DROP TRIGGER IF EXISTS events_no_update');
  const rows = ledger.db.prepare('SELECT * FROM events ORDER BY seq').all();
  let previous = '0'.repeat(64);
  for (const row of rows) {
    const eventHash = sha256(stableStringify({
      seq: row.seq,
      created_at: row.created_at,
      event_type: row.event_type,
      run_id: row.run_id,
      payload_json: row.payload_json,
      previous_hash: previous,
    }));
    ledger.db.prepare('UPDATE events SET previous_hash = ?, event_hash = ? WHERE seq = ?').run(previous, eventHash, row.seq);
    previous = eventHash;
  }
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

test('buildEvolutionReport marks run.failed runs as FAILED and reports the failure code', async () => {
  const ledgerFile = await scratchLedger('run-failed', (ledger) => {
    ledger.append('run.started', 'run-f2-failed', { adapter: 'claude', contract_snapshot: CONTRACT_SNAPSHOT });
    ledger.append('budget.exhausted', 'run-f2-failed', { metric: 'wall_clock', reason: 'agent_timeout', observed_total: 5000 });
    ledger.append('run.failed', 'run-f2-failed', {
      code: 'RESOURCE_EXHAUSTED',
      message: 'The wall-clock budget stopped the agent.',
      token_usage_total: 5000,
    });
    ledger.append('run.started', 'run-f2-interrupted', { adapter: 'pi', contract_snapshot: CONTRACT_SNAPSHOT });
  });

  const report = await callBuildEvolutionReport(ledgerFile);
  const failed = report.runs.find((run) => run.run_id === 'run-f2-failed');
  assert.equal(failed.status, 'FAILED', 'run.failed must not be summarized as INCOMPLETE');
  assert.equal(failed.failure_code, 'RESOURCE_EXHAUSTED');
  assert.equal(
    report.runs.find((run) => run.run_id === 'run-f2-interrupted').status,
    'INCOMPLETE',
    'runs without a terminal event stay INCOMPLETE',
  );
});

test('buildEvolutionReport counts final cumulative totals from exhaustion and run-level events', async () => {
  const ledgerFile = await scratchLedger('budget-exhausted', (ledger) => {
    ledger.append('run.started', 'run-f2-timeout', { adapter: 'claude', contract_snapshot: CONTRACT_SNAPSHOT, token_budget: 100000 });
    ledger.append('budget.tokens.observed', 'run-f2-timeout', {
      metric: 'tokens', phase: 'implementation', iteration: 1,
      invocation_tokens: 3000, observed_total: 3000, limit: 100000, stop_reason: null,
    });
    ledger.append('budget.usd.observed', 'run-f2-timeout', {
      metric: 'estimated_usd', phase: 'implementation', iteration: 1,
      observed_total_usd: 0.25, observed_total_usd_micros: 250000,
    });
    // Timeout with complete telemetry: the final cumulative totals land only in
    // budget.exhausted (no further *.observed event is appended before the throw).
    ledger.append('budget.exhausted', 'run-f2-timeout', {
      metric: 'wall_clock', reason: 'agent_timeout', previous_observed_total: 3000,
      invocation_tokens: 2000, observed_total: 5000,
      observed_total_usd: 0.75, observed_total_usd_micros: 750000,
    });
    ledger.append('run.failed', 'run-f2-timeout', {
      code: 'RESOURCE_EXHAUSTED', token_usage_total: 5000, cost_estimate_total_usd: 0.75,
    });
    // Run-level totals on run.finished/run.failed count even without budget.*.observed.
    ledger.append('run.started', 'run-f2-runlevel', { adapter: 'codex', contract_snapshot: CONTRACT_SNAPSHOT });
    ledger.append('run.finished', 'run-f2-runlevel', {
      status: 'PLATEAU', iterations: 1, token_usage_total: 42, cost_estimate_total_usd: 2,
    });
  });

  const report = await callBuildEvolutionReport(ledgerFile);
  assert.equal(report.budgets.tokens_total, 5000 + 42, 'the timed-out invocation tokens must not be dropped');
  assert.equal(report.budgets.usd_total, 0.75 + 2, 'the timed-out invocation USD must not be dropped');
});

test('buildEvolutionReport derives objective metadata from historical run contract snapshots', async () => {
  const ledgerFile = await scratchLedger('objective-snapshots', (ledger) => {
    ledger.append('run.started', 'run-f2-quality', { adapter: 'codex', contract_snapshot: scratchContractSnapshot('quality_score', 'maximize') });
    acceptScratchGeneration(ledger, 'run-f2-quality', 1, 'g-q1', 0.25, 0.25, '2026-03-01T00:00:00.000Z');
    acceptScratchGeneration(ledger, 'run-f2-quality', 2, 'g-q2', 0.75, 0.5, '2026-03-02T00:00:00.000Z');
    ledger.append('run.finished', 'run-f2-quality', { status: 'ACCEPTED', iterations: 2 });
    ledger.append('run.started', 'run-f2-latency', { adapter: 'codex', contract_snapshot: scratchContractSnapshot('latency_ms', 'minimize') });
    acceptScratchGeneration(ledger, 'run-f2-latency', 1, 'g-l1', 200, 10, '2026-03-03T00:00:00.000Z');
    acceptScratchGeneration(ledger, 'run-f2-latency', 2, 'g-l2', 100, 100, '2026-03-04T00:00:00.000Z');
    ledger.append('run.finished', 'run-f2-latency', { status: 'ACCEPTED', iterations: 2 });
  });

  const report = await callBuildEvolutionReport(ledgerFile);
  // The contract currently on disk (fixture.root) says quality_score/maximize; the report
  // must neither borrow those labels nor mix the two incompatible objectives.
  assert.equal(report.objective.metric, null);
  assert.equal(report.objective.direction, null);
  assert.equal(report.objective.first_score, null);
  assert.equal(report.objective.best_score, null);
  assert.equal(report.objective.delta, null);
  assert.equal(report.objective.groups.length, 2);
  assert.deepEqual(
    report.objective.groups.find((group) => group.metric === 'quality_score'),
    { metric: 'quality_score', direction: 'maximize', first_score: 0.25, best_score: 0.75, delta: 0.5 },
  );
  assert.deepEqual(
    report.objective.groups.find((group) => group.metric === 'latency_ms'),
    { metric: 'latency_ms', direction: 'minimize', first_score: 200, best_score: 100, delta: 100 },
  );
});

test('buildEvolutionReport aggregates a single objective group with that group\'s own direction', async () => {
  const ledgerFile = await scratchLedger('objective-single', (ledger) => {
    ledger.append('run.started', 'run-f2-minimize', { adapter: 'codex', contract_snapshot: scratchContractSnapshot('latency_ms', 'minimize') });
    acceptScratchGeneration(ledger, 'run-f2-minimize', 1, 'g-m1', 200, 10, '2026-03-05T00:00:00.000Z');
    acceptScratchGeneration(ledger, 'run-f2-minimize', 2, 'g-m2', 100, 100, '2026-03-06T00:00:00.000Z');
    ledger.append('run.finished', 'run-f2-minimize', { status: 'ACCEPTED', iterations: 2 });
  });

  const report = await callBuildEvolutionReport(ledgerFile);
  assert.deepEqual(report.objective, {
    metric: 'latency_ms',
    direction: 'minimize',
    first_score: 200,
    best_score: 100,
    delta: 100,
  });
});

test('buildEvolutionReport leaves unknown objective direction null instead of defaulting to maximize', async () => {
  const ledgerFile = await scratchLedger('objective-unknown', (ledger) => {
    // Legacy run without a contract_snapshot in run.started.
    ledger.append('run.started', 'run-f2-nosnap', { adapter: 'codex' });
    acceptScratchGeneration(ledger, 'run-f2-nosnap', 1, 'g-n1', 0.25, 0.25, '2026-03-07T00:00:00.000Z');
    acceptScratchGeneration(ledger, 'run-f2-nosnap', 2, 'g-n2', 0.75, 0.5, '2026-03-08T00:00:00.000Z');
    ledger.append('run.finished', 'run-f2-nosnap', { status: 'ACCEPTED', iterations: 2 });
  });

  const report = await callBuildEvolutionReport(ledgerFile);
  assert.equal(report.objective.metric, null);
  assert.equal(report.objective.direction, null);
  assert.equal(report.objective.first_score, 0.25);
  assert.equal(report.objective.best_score, null, 'an unknown direction must not silently compute Math.max');
  assert.equal(report.objective.delta, null);
});

test('buildEvolutionReport reports a broken hash chain instead of throwing on malformed payloads', async () => {
  const ledgerFile = await scratchLedger('corrupt-chain', (ledger) => {
    ledger.append('run.started', 'run-f2-corrupt', { adapter: 'codex', contract_snapshot: CONTRACT_SNAPSHOT });
    ledger.append('run.finished', 'run-f2-corrupt', { status: 'PLATEAU', iterations: 0 });
    ledger.db.exec('DROP TRIGGER IF EXISTS events_no_update');
    ledger.db.prepare("UPDATE events SET payload_json = '{oops malformed' WHERE seq = 2").run();
  });

  const report = await callBuildEvolutionReport(ledgerFile);
  assert.equal(report.integrity.valid, false, 'malformed payloads must surface as integrity.valid: false, not an exception');
  assert.equal(report.integrity.failed_at_seq, 2);
  assert.equal(typeof report.integrity.expected_previous_hash, 'string');
  assert.equal(typeof report.integrity.observed_hash, 'string');
  assert.equal('parse_failed' in report.integrity, false);
  assert.deepEqual(report.runs, []);
  assert.deepEqual(report.generations, []);
  assert.equal(report.objective, null);
  assert.equal(report.budgets.tokens_total, null);
  assert.equal(report.budgets.usd_total, null);
});

test('buildEvolutionReport refuses to summarize payloads behind a forged hash chain', async () => {
  const ledgerFile = await scratchLedger('forged-chain', (ledger) => {
    ledger.append('run.started', 'run-f2-forged', { adapter: 'codex', contract_snapshot: CONTRACT_SNAPSHOT });
    ledger.append('run.finished', 'run-f2-forged', { status: 'PLATEAU', iterations: 0 });
  });
  const { Ledger } = await repoImport('src/lib/ledger.js');
  const tamperer = new Ledger(ledgerFile);
  try {
    tamperer.db.exec('DROP TRIGGER IF EXISTS events_no_update');
    tamperer.db.prepare("UPDATE events SET payload_json = '{oops malformed' WHERE seq = 2").run();
    await forgeEventHashChain(tamperer);
  } finally {
    tamperer.close();
  }

  const proof = new Ledger(ledgerFile);
  try {
    assert.equal(proof.verify().valid, true, 'fixture proof: a recomputed chain passes verify()');
  } finally {
    proof.close();
  }

  const report = await callBuildEvolutionReport(ledgerFile);
  assert.equal(report.integrity.valid, false, 'unreadable payloads must not be summarized');
  assert.equal(report.integrity.parse_failed, true);
  assert.deepEqual(report.runs, []);
  assert.deepEqual(report.generations, []);
  assert.equal(report.objective, null);
});

test('CLI report refuses to write the report over protected EvoFence state', async () => {
  const before = await readFile(path.join(fixture.root, '.evofence', 'contract.yaml'), 'utf8');

  const relativeAttempt = spawnCli(['report', '.evofence/contract.yaml']);
  assert.notEqual(relativeAttempt.status, 0, 'writing onto the contract must be rejected');
  assert.match(relativeAttempt.stderr, /^\[PROTECTED_PATH\]/, relativeAttempt.stderr);
  assert.equal(
    await readFile(path.join(fixture.root, '.evofence', 'contract.yaml'), 'utf8'),
    before,
    'the contract must be untouched after the rejected write',
  );

  const absoluteAttempt = spawnCli(['report', fixture.ledgerFile]);
  assert.notEqual(absoluteAttempt.status, 0, 'writing onto the ledger must be rejected');
  assert.match(absoluteAttempt.stderr, /^\[PROTECTED_PATH\]/, absoluteAttempt.stderr);
  const ledgerProof = new (await repoImport('src/lib/ledger.js')).Ledger(fixture.ledgerFile);
  try {
    assert.equal(ledgerProof.verify().valid, true, 'the ledger must be untouched after the rejected write');
  } finally {
    ledgerProof.close();
  }
});

test('buildEvolutionReport refuses to summarize when the generations table contradicts the verified events', async () => {
  const ledgerFile = await scratchLedger('generations-mismatch', (ledger) => {
    ledger.append('run.started', 'run-f2-table', { adapter: 'codex', contract_snapshot: CONTRACT_SNAPSHOT });
    acceptScratchGeneration(ledger, 'run-f2-table', 1, 'g-t1', 0.25, 0.25, '2026-03-09T00:00:00.000Z');
    ledger.append('run.finished', 'run-f2-table', { status: 'ACCEPTED', iterations: 1 });
    // Corrupt the unhashed generations table while the event chain stays intact.
    ledger.db.exec('DROP TRIGGER IF EXISTS generations_no_update');
    ledger.db.prepare("UPDATE generations SET sha = 'deadbeef' WHERE generation_id = 'g-t1'").run();
  });

  const report = await callBuildEvolutionReport(ledgerFile);
  assert.equal(report.integrity.valid, false, 'an altered generations table must not be summarized as integrity.valid: true');
  assert.equal(report.integrity.generations_mismatch, true);
  assert.deepEqual(report.runs, []);
  assert.deepEqual(report.generations, []);
  assert.equal(report.objective, null);
});

test('buildEvolutionReport falls back to complete adapter telemetry when usage budgets are disabled', async () => {
  const usage = (tokens, cost) => ({
    tokens_complete: true,
    tokens_total: tokens,
    cost_complete: true,
    cost_currency: 'USD',
    reported_cost: cost,
    cost_source: 'fixture',
  });
  const ledgerFile = await scratchLedger('unbudgeted-telemetry', (ledger) => {
    // Unbudgeted run (shipped default: max_tokens/max_usd null): no budget.*.observed
    // events and null run-level totals, but adapter.finished keeps complete usage.
    ledger.append('run.started', 'run-f2-unbudgeted', { adapter: 'pi', contract_snapshot: CONTRACT_SNAPSHOT, token_budget: null });
    ledger.append('adapter.finished', 'run-f2-unbudgeted', { adapter: 'pi', phase: 'implementation', iteration: 1, reported_usage: usage(300, 0.4) });
    ledger.append('adapter.finished', 'run-f2-unbudgeted', { adapter: 'pi', phase: 'implementation', iteration: 2, reported_usage: usage(300, 0.4) });
    ledger.append('run.finished', 'run-f2-unbudgeted', {
      status: 'PLATEAU', iterations: 2, token_usage_total: null, cost_estimate_total_usd: null,
    });
    // Budgeted run: cumulative observations win and adapter sums must not double count.
    ledger.append('run.started', 'run-f2-budgeted', { adapter: 'claude', contract_snapshot: CONTRACT_SNAPSHOT, token_budget: 100000 });
    ledger.append('adapter.finished', 'run-f2-budgeted', { adapter: 'claude', phase: 'implementation', iteration: 1, reported_usage: usage(500, 1) });
    ledger.append('budget.tokens.observed', 'run-f2-budgeted', {
      metric: 'tokens', phase: 'implementation', iteration: 1, invocation_tokens: 500, observed_total: 3000, limit: 100000, stop_reason: null,
    });
    ledger.append('budget.usd.observed', 'run-f2-budgeted', {
      metric: 'estimated_usd', phase: 'implementation', iteration: 1, observed_total_usd: 2, observed_total_usd_micros: 2000000,
    });
    ledger.append('run.finished', 'run-f2-budgeted', {
      status: 'PLATEAU', iterations: 1, token_usage_total: 3000, cost_estimate_total_usd: 2,
    });
  });

  const report = await callBuildEvolutionReport(ledgerFile);
  assert.equal(report.budgets.tokens_total, 300 + 300 + 3000, 'unbudgeted adapter telemetry must be counted exactly once');
  assert.equal(report.budgets.usd_total, 0.8 + 2, 'unbudgeted adapter cost must be counted exactly once');
});

test('buildEvolutionReport counts complete invocations trailing behind the latest cumulative observation', async () => {
  const ledgerFile = await scratchLedger('trailing-telemetry', (ledger) => {
    ledger.append('run.started', 'run-f2-trailing', { adapter: 'claude', contract_snapshot: CONTRACT_SNAPSHOT, token_budget: 100000 });
    ledger.append('adapter.finished', 'run-f2-trailing', {
      adapter: 'claude', phase: 'implementation', iteration: 1,
      reported_usage: { tokens_complete: true, tokens_total: 100, cost_complete: true, cost_currency: 'USD', reported_cost: 0.1 },
    });
    ledger.append('budget.tokens.observed', 'run-f2-trailing', {
      metric: 'tokens', phase: 'implementation', iteration: 1, invocation_tokens: 100, observed_total: 100, limit: 100000, stop_reason: null,
    });
    // Second invocation completes with 50 tokens / $0.50; the USD cap trips inside
    // recordCostUsage, which throws before recordTokenUsage can observe the tokens.
    ledger.append('adapter.finished', 'run-f2-trailing', {
      adapter: 'claude', phase: 'implementation', iteration: 2,
      reported_usage: { tokens_complete: true, tokens_total: 50, cost_complete: true, cost_currency: 'USD', reported_cost: 0.5 },
    });
    ledger.append('budget.usd.observed', 'run-f2-trailing', {
      metric: 'estimated_usd', phase: 'implementation', iteration: 2, observed_total_usd: 0.6, observed_total_usd_micros: 600000,
    });
    ledger.append('budget.exhausted', 'run-f2-trailing', {
      metric: 'estimated_usd', reason: 'claude_native_usd_cap_reached', observed_total_usd: 0.6, observed_total_usd_micros: 600000,
    });
    ledger.append('run.failed', 'run-f2-trailing', {
      code: 'RESOURCE_EXHAUSTED', token_usage_total: 100, cost_estimate_total_usd: 0.6,
    });
  });

  const report = await callBuildEvolutionReport(ledgerFile);
  assert.equal(report.budgets.tokens_total, 150, 'the trailing invocation tokens must join the earlier cumulative observation');
  assert.equal(report.budgets.usd_total, 0.6, 'the trailing invocation cost must not be dropped or double counted');
});

test('CLI report rejects state-alias symlink paths that resolve into .evofence', async (t) => {
  const alias = path.join(fixture.root, 'state-alias');
  try {
    await symlink(path.join(fixture.root, '.evofence'), alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    t.skip('symlink/junction creation is unavailable in this environment');
    return;
  }

  const result = spawnCli(['report', 'state-alias/new/report.json']);
  assert.notEqual(result.status, 0, 'a path resolving into .evofence through an alias must be rejected');
  assert.match(result.stderr, /^\[PROTECTED_PATH\]/, result.stderr);
  assert.equal(
    existsSync(path.join(fixture.root, '.evofence', 'new', 'report.json')),
    false,
    'no file may be created under .evofence via the alias',
  );
});

test('Ledger.readSnapshot returns integrity, events and generations from one transaction', async () => {
  const ledgerFile = await scratchLedger('read-snapshot', (ledger) => {
    ledger.append('run.started', 'run-f2-snapshot', { adapter: 'codex', contract_snapshot: CONTRACT_SNAPSHOT });
    acceptScratchGeneration(ledger, 'run-f2-snapshot', 1, 'g-s1', 0.25, 0.25, '2026-03-10T00:00:00.000Z');
    ledger.append('run.finished', 'run-f2-snapshot', { status: 'ACCEPTED', iterations: 1 });
  });

  const { Ledger } = await repoImport('src/lib/ledger.js');
  const ledger = new Ledger(ledgerFile);
  try {
    const snapshot = ledger.readSnapshot();
    assert.equal(snapshot.integrity.valid, true);
    assert.ok(Array.isArray(snapshot.events) && snapshot.events.length > 0);
    assert.equal(snapshot.generations.length, 1);
    for (const row of snapshot.generations) {
      assert.ok(
        snapshot.events.some((event) => event.event_type === 'generation.accepted'
          && event.payload?.generation_id === row.generation_id
          && event.payload?.sha === row.sha),
        'every table row must be attested by an event in the same snapshot',
      );
    }
  } finally {
    ledger.close();
  }
});

test('buildEvolutionReport reads integrity, events and generations through one atomic snapshot', async () => {
  const { buildEvolutionReport } = await repoImport('src/lib/report.js');
  const refuse = (method) => () => {
    throw new Error(`buildEvolutionReport must not call ${method}() directly; use one readSnapshot()`);
  };
  const stub = {
    readSnapshot: () => ({
      integrity: { valid: true },
      events: [
        {
          seq: 1,
          event_type: 'run.started',
          run_id: 'run-f2-stub',
          created_at: '2026-03-11T00:00:00.000Z',
          payload: { adapter: 'codex', contract_snapshot: CONTRACT_SNAPSHOT },
        },
        {
          seq: 2,
          event_type: 'run.finished',
          run_id: 'run-f2-stub',
          created_at: '2026-03-11T00:00:01.000Z',
          payload: { status: 'ACCEPTED', iterations: 1 },
        },
      ],
      generations: [],
    }),
    verify: refuse('verify'),
    events: refuse('events'),
    generations: refuse('generations'),
  };

  const report = await buildEvolutionReport({ root: fixture.root, ledger: stub });
  assert.equal(report.integrity.valid, true);
  assert.equal(report.run_count, 1);
  assert.equal(report.runs[0].status, 'ACCEPTED');
});
