// Acceptance oracle for the report/status view contract added by node `l2_report`:
//   - `report.gate_decisions` (門禁结论) and `report.ledger` (账本引用) — DoD 1.
//   - the `--json` failure contract in `cli.js` `printError` — DoD 4.
// The pre-existing `spec-f1`/`spec-f2`/`spec-f3` oracles keep owning the 0.3.0 fields; this file
// only pins what is NEW, and imports from `dist/` (ADR-0004).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvolutionReport } from '../dist/lib/report.js';
import { formatEvolutionReport } from '../dist/lib/report.js';
import { buildBudgetForecast } from '../dist/lib/report.js';
import { formatReport, formatReportJunit, formatReportSarif } from '../dist/lib/report/formats.js';
import { Ledger, ledgerPath } from '../dist/lib/ledger.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const SANITIZATION_SECRET = 'PRIVATE-ORACLE-MUST-NOT-LEAK-l2report';
const PARENT_SHA = 'c3'.repeat(20);
const GEN_SHA = 'a1'.repeat(20);
const CONTRACT_SNAPSHOT = { objective: { name: 'quality_score', direction: 'maximize' } };

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function spawnCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
}

/** A ledger with one rejected-then-accepted run and one escalated run. */
function seedLedger(ledger) {
  ledger.append('run.started', 'run-a', { adapter: 'codex', base_sha: PARENT_SHA, contract_snapshot: CONTRACT_SNAPSHOT });
  ledger.append('gate.decision', 'run-a', {
    iteration: 1,
    decision: 'REJECT',
    reason: 'PUBLIC_TEST_FAILURE',
    // Both blobs carry private-oracle text and must never be projected into the report.
    failure: { reason: 'PUBLIC_TEST_FAILURE', stdout: SANITIZATION_SECRET },
    details: { stdout: SANITIZATION_SECRET },
    requests: [{ stdout: SANITIZATION_SECRET }],
  });
  ledger.append('gate.decision', 'run-a', {
    iteration: 2,
    decision: 'ACCEPT',
    reason: 'OBJECTIVE_IMPROVED',
    evidence_ok: true,
    risk: { band: 'LOW', score: 1 },
    improvement: 0.4,
    min_delta: 0.1,
    private_regressions: false,
  });
  ledger.append('candidate.accepted', 'run-a', { iteration: 2, generation_id: 'g-a-i2', sha: GEN_SHA, parent_sha: PARENT_SHA, objective_score: 0.5, improvement: 0.4 });
  ledger.recordGeneration({ generation_id: 'g-a-i2', run_id: 'run-a', sha: GEN_SHA, parent_sha: PARENT_SHA, created_at: '2026-03-02T00:00:00.000Z' });
  ledger.append('run.finished', 'run-a', { status: 'ACCEPTED', iterations: 2, observed_total: 1200 });
  ledger.append('run.started', 'run-b', { adapter: 'pi', base_sha: GEN_SHA, contract_snapshot: CONTRACT_SNAPSHOT });
  ledger.append('gate.decision', 'run-b', { iteration: 1, decision: 'ESCALATE', reason: 'CAPABILITY_DENIED' });
  ledger.append('run.finished', 'run-b', { status: 'ESCALATE', iterations: 1 });
}

async function scratchLedger(seed = seedLedger) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-report-'));
  const ledger = new Ledger(path.join(directory, 'ledger.sqlite'));
  try {
    seed(ledger);
  } finally {
    ledger.close();
  }
  return directory;
}

async function withLedger(directory, fn) {
  const ledger = new Ledger(path.join(directory, 'ledger.sqlite'));
  try {
    return await fn(ledger);
  } finally {
    ledger.close();
  }
}

async function makeRepo(label) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `evofence-report-${label}-`));
  const root = path.join(directory, 'repo');
  await mkdir(root, { recursive: true });
  runGit(root, ['init', '--quiet', '--initial-branch=main']);
  runGit(root, ['config', 'user.name', 'EvoFence Fixture']);
  runGit(root, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  await writeFile(path.join(root, 'README.md'), '# fixture repository\n');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'fixture']);
  return { directory, root };
}

/* ------------------------------------------------------------------ *
 * report view: gate decisions + ledger reference (DoD 1)
 * ------------------------------------------------------------------ */

test('gate_decisions projects every gate.decision event, oldest first, with its ledger seq', async () => {
  const directory = await scratchLedger();
  try {
    const report = await withLedger(directory, (ledger) => buildEvolutionReport({ root: directory, ledger }));

    assert.deepEqual(report.gate_decisions.map((row) => row.decision), ['REJECT', 'ACCEPT', 'ESCALATE']);
    assert.deepEqual(report.gate_decisions.map((row) => row.run_id), ['run-a', 'run-a', 'run-b']);
    assert.deepEqual(report.gate_decisions.map((row) => row.iteration), [1, 2, 1]);
    // `seq` is the traceability handle: strictly increasing, and the last one is the chain tip - 3.
    const seqs = report.gate_decisions.map((row) => row.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
    assert.equal(typeof report.gate_decisions[0].seq, 'number');

    const [rejected, accepted, escalated] = report.gate_decisions;
    assert.equal(rejected.reason, 'PUBLIC_TEST_FAILURE');
    assert.equal(rejected.failure_code, 'PUBLIC_TEST_FAILURE');
    assert.equal(rejected.evidence_ok, null);
    assert.equal(rejected.risk_band, null);
    assert.equal(accepted.evidence_ok, true);
    assert.equal(accepted.risk_band, 'LOW');
    assert.equal(accepted.improvement, 0.4);
    assert.equal(accepted.min_delta, 0.1);
    assert.equal(accepted.private_regressions, false);
    assert.equal(accepted.failure_code, null);
    assert.equal(escalated.reason, 'CAPABILITY_DENIED');
    assert.equal(escalated.failure_code, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('gate_decisions never project the raw failure/details/requests blobs', async () => {
  const directory = await scratchLedger();
  try {
    const report = await withLedger(directory, (ledger) => buildEvolutionReport({ root: directory, ledger }));
    assert.equal(JSON.stringify(report).includes(SANITIZATION_SECRET), false, 'private-oracle text must not reach the report');
    for (const row of report.gate_decisions) {
      assert.equal(Object.hasOwn(row, 'failure'), false);
      assert.equal(Object.hasOwn(row, 'details'), false);
      assert.equal(Object.hasOwn(row, 'requests'), false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('ledger reference points back at the chain the report was computed from', async () => {
  const directory = await scratchLedger();
  try {
    const report = await withLedger(directory, (ledger) => buildEvolutionReport({ root: directory, ledger }));
    const tip = await withLedger(directory, (ledger) => ledger.verify());

    assert.equal(report.ledger.event_count, tip.events);
    assert.equal(report.ledger.head_hash, tip.head);
    assert.equal(report.ledger.first_seq, 1);
    assert.equal(report.ledger.last_seq, tip.events);
    assert.equal(typeof report.ledger.read_at, 'string');
    assert.equal(Number.isNaN(Date.parse(report.ledger.read_at)), false, 'read_at must be an ISO timestamp');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('report text remains byte-stable and SARIF/JUnit cover every gate decision', async () => {
  const directory = await scratchLedger();
  try {
    const report = await withLedger(directory, (ledger) => buildEvolutionReport({ root: directory, ledger }));
    const sarif = JSON.parse(formatReportSarif(report));
    assert.equal(sarif.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
    assert.equal(sarif.version, '2.1.0');
    assert.equal(Array.isArray(sarif.runs), true);
    assert.equal(sarif.runs.length, 1);
    assert.equal(sarif.runs[0].tool.driver.name, 'EvoFence');
    assert.equal(sarif.runs[0].results.length, report.gate_decisions.length);
    for (const result of sarif.runs[0].results) {
      assert.equal(typeof result.ruleId, 'string');
      assert.equal(result.locations.length, 1);
      assert.equal(typeof result.locations[0].physicalLocation.artifactLocation.uri, 'string');
      assert.equal(Number.isInteger(result.locations[0].physicalLocation.region.startLine), true);
      assert.equal(typeof result.message.text, 'string');
    }

    const junit = formatReportJunit(report);
    assert.match(junit, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<testsuite /);
    assert.match(junit, new RegExp(`<testsuite name="EvoFence report" tests="${report.gate_decisions.length}"`));
    assert.equal((junit.match(/<testcase\b/g) ?? []).length, report.gate_decisions.length);
    assert.equal((junit.match(/<failure\b/g) ?? []).length, report.gate_decisions.filter((item) => item.decision !== 'ACCEPT').length);

    const baseline = formatEvolutionReport(report);
    const explicitText = formatReport(report, 'text');
    assert.equal(Buffer.compare(Buffer.from(explicitText), Buffer.from(baseline)), 0);
    assert.equal(Buffer.byteLength(baseline), 867);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('budget forecast uses sorted runs, complete usage, and ledger thresholds only', () => {
  const snapshot = {
    integrity: { valid: true, events: 6, head: 'd'.repeat(64) },
    generations: [],
    events: [
      { seq: 1, created_at: '2026-09-29T00:00:00.000Z', event_type: 'run.started', run_id: 'run-b', payload: { requested_iterations: 4, contract_snapshot: { budgets: { max_iterations: 4, max_tokens: 100, max_usd: 1 } } } },
      { seq: 2, created_at: '2026-09-29T00:00:01.000Z', event_type: 'run.finished', run_id: 'run-b', payload: { status: 'PLATEAU', iterations: 2, token_usage_total: 30, cost_estimate_total_usd: 0.5 } },
      { seq: 3, created_at: '2026-09-29T00:00:02.000Z', event_type: 'run.started', run_id: 'run-a', payload: { requested_iterations: 4, contract_snapshot: { budgets: { max_iterations: 4, max_tokens: 100, max_usd: 1 } } } },
      { seq: 4, created_at: '2026-09-29T00:00:03.000Z', event_type: 'budget.tokens.observed', run_id: 'run-a', payload: { limit: 100, observed_total: 20 } },
      { seq: 5, created_at: '2026-09-29T00:00:04.000Z', event_type: 'budget.usd.observed', run_id: 'run-a', payload: { limit_usd: 1, observed_total_usd: 0.25 } },
      { seq: 6, created_at: '2026-09-29T00:00:05.000Z', event_type: 'run.finished', run_id: 'run-a', payload: { status: 'ACCEPTED', iterations: 1, token_usage_total: 20, cost_estimate_total_usd: 0.25 } },
    ],
  };
  const forecast = buildBudgetForecast(snapshot);
  assert.deepEqual(forecast.runs.map((run) => run.run_id), ['run-a', 'run-b']);
  assert.equal(forecast.rounds_used, 3);
  assert.equal(forecast.rounds_limit, 8);
  assert.equal(forecast.used_ratio, 3 / 8);
  assert.equal(forecast.historical_mean_rounds_per_run, 1.5);
  assert.equal(forecast.remaining_rounds_estimate, 5 / 1.5);
  assert.equal(forecast.tokens.used, 50);
  assert.equal(forecast.tokens.limit, 200);
  assert.equal(forecast.tokens.historical_mean_per_round, 50 / 3);
  assert.equal(forecast.usd.used, 0.75);
  assert.equal(forecast.usd.limit, 2);
  assert.equal(forecast.usd.historical_mean_per_round, 0.75 / 3);
});

test('budget forecast consumes complete adapter usage when terminal totals are null', () => {
  const forecast = buildBudgetForecast({
    integrity: { valid: true, events: 3, head: 'e'.repeat(64) },
    generations: [],
    events: [
      { seq: 1, created_at: '2026-09-29T01:00:00.000Z', event_type: 'run.started', run_id: 'run-adapter', payload: { requested_iterations: 2, contract_snapshot: { budgets: { max_iterations: 2, max_tokens: 200, max_usd: 2 } } } },
      { seq: 2, created_at: '2026-09-29T01:00:01.000Z', event_type: 'adapter.finished', run_id: 'run-adapter', payload: { reported_usage: { tokens_total: 123, tokens_complete: true, reported_cost: 0.42, cost_complete: true, cost_currency: 'USD' } } },
      { seq: 3, created_at: '2026-09-29T01:00:02.000Z', event_type: 'run.finished', run_id: 'run-adapter', payload: { status: 'ACCEPTED', iterations: 2, token_usage_total: null, cost_estimate_total_usd: null } },
    ],
  });

  assert.equal(forecast.tokens.used, 123);
  assert.equal(forecast.usd.used, 0.42);
  assert.equal(forecast.runs[0].tokens_used, 123);
  assert.equal(forecast.runs[0].usd_used, 0.42);
});

test('budget forecast excludes an only-started run from historical aggregates', () => {
  const forecast = buildBudgetForecast({
    integrity: { valid: true, events: 4, head: 'f'.repeat(64) },
    generations: [],
    events: [
      { seq: 1, created_at: '2026-09-29T02:00:00.000Z', event_type: 'run.started', run_id: 'run-complete', payload: { requested_iterations: 1, contract_snapshot: { budgets: { max_iterations: 1, max_tokens: 100, max_usd: 1 } } } },
      { seq: 2, created_at: '2026-09-29T02:00:01.000Z', event_type: 'run.finished', run_id: 'run-complete', payload: { status: 'ACCEPTED', iterations: 1, token_usage_total: 30, cost_estimate_total_usd: 0.3 } },
      { seq: 3, created_at: '2026-09-29T02:00:02.000Z', event_type: 'run.started', run_id: 'run-partial', payload: { requested_iterations: 4, contract_snapshot: { budgets: { max_iterations: 4, max_tokens: 100, max_usd: 1 } } } },
      { seq: 4, created_at: '2026-09-29T02:00:03.000Z', event_type: 'budget.tokens.observed', run_id: 'run-partial', payload: { limit: 100, observed_total: 50 } },
    ],
  });

  assert.equal(forecast.rounds_used, 1);
  assert.equal(forecast.tokens.used, 30);
  assert.equal(forecast.run_count, 1);
  assert.equal(forecast.runs.length, 2);
  assert.equal(forecast.tokens.limit, 100);
  assert.equal(forecast.tokens.used_ratio, 0.3);
  assert.equal(forecast.tokens.remaining_rounds_estimate, 70 / 30);
  assert.equal(forecast.usd.used, 0.3);
  assert.equal(forecast.usd.limit, 1);
  assert.equal(forecast.usd.used_ratio, 0.3);
  assert.equal(forecast.usd.remaining_rounds_estimate, 0.7 / 0.3);
  assert.equal(forecast.runs.find((run) => run.run_id === 'run-partial').status, 'INCOMPLETE');
  assert.equal(forecast.runs.find((run) => run.run_id === 'run-partial').tokens_used, null);
});

test('budget forecast keeps valid observations when terminal payload totals are null', () => {
  const forecast = buildBudgetForecast({
    integrity: { valid: true, events: 4, head: '0'.repeat(64) },
    generations: [],
    events: [
      { seq: 1, created_at: '2026-09-29T03:00:00.000Z', event_type: 'run.started', run_id: 'run-observed', payload: { requested_iterations: 1, contract_snapshot: { budgets: { max_iterations: 1, max_tokens: 100, max_usd: 1 } } } },
      { seq: 2, created_at: '2026-09-29T03:00:01.000Z', event_type: 'budget.tokens.observed', run_id: 'run-observed', payload: { limit: 100, observed_total: 20 } },
      { seq: 3, created_at: '2026-09-29T03:00:02.000Z', event_type: 'budget.usd.observed', run_id: 'run-observed', payload: { limit_usd: 1, observed_total_usd: 0.25 } },
      { seq: 4, created_at: '2026-09-29T03:00:03.000Z', event_type: 'run.finished', run_id: 'run-observed', payload: { status: 'ACCEPTED', iterations: 1, token_usage_total: null, cost_estimate_total_usd: null } },
    ],
  });

  assert.equal(forecast.tokens.used, 20);
  assert.equal(forecast.usd.used, 0.25);
});

test('a broken chain still returns every view class, with unknown ledger facts left null', async () => {
  const stub = {
    readSnapshot: () => ({
      integrity: { valid: false, sequence: 3, expected_previous_hash: 'aa', observed_hash: 'bb' },
      events: [],
      generations: [],
    }),
  };
  const report = await buildEvolutionReport({ root: '<stub>', ledger: stub });

  assert.equal(report.integrity.valid, false);
  assert.deepEqual(report.runs, []);
  assert.deepEqual(report.gate_decisions, []);
  assert.deepEqual(report.ledger, {
    event_count: null,
    head_hash: null,
    first_seq: null,
    last_seq: null,
    read_at: report.ledger.read_at,
  });
});

test('a valid snapshot that reports no tip metadata still yields a usable reference', async () => {
  // Mirrors the spec-f2 stub shape: `integrity: { valid: true }` without `events`/`head`.
  const events = [
    { seq: 1, event_type: 'run.started', run_id: 'run-stub', created_at: '2026-03-11T00:00:00.000Z', payload: { adapter: 'codex' } },
    { seq: 2, event_type: 'run.finished', run_id: 'run-stub', created_at: '2026-03-11T00:00:01.000Z', payload: { status: 'PLATEAU', iterations: 1 } },
  ];
  const report = await buildEvolutionReport({ root: '<stub>', ledger: { readSnapshot: () => ({ integrity: { valid: true }, events, generations: [] }) } });

  assert.equal(report.integrity.valid, true);
  assert.equal(report.ledger.event_count, 2);
  assert.equal(report.ledger.head_hash, null);
  assert.equal(report.ledger.first_seq, 1);
  assert.equal(report.ledger.last_seq, 2);
});

/* ------------------------------------------------------------------ *
 * CLI surfaces (DoD 1 / 2 / 4)
 * ------------------------------------------------------------------ */

test('CLI report --json carries run summaries, gate decisions and the ledger reference', async () => {
  const directory = await scratchLedger();
  try {
    const ledgerFile = path.join(directory, 'ledger.sqlite');
    const source = new Ledger(ledgerFile);
    source.close();
    // Run the CLI from a git repo whose .evofence/ledger.sqlite is the seeded ledger.
    const probe = await makeRepo('report-json');
    try {
      await mkdir(path.join(probe.root, '.evofence'), { recursive: true });
      await writeFile(path.join(probe.root, '.evofence', 'ledger.sqlite'), await readFile(ledgerFile));

      const result = spawnCli(['report', '--json'], probe.root);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.ok(Array.isArray(report.runs) && report.runs.length === 2, 'run summaries');
      assert.ok(Array.isArray(report.gate_decisions) && report.gate_decisions.length === 3, 'gate conclusions');
      assert.equal(typeof report.ledger.event_count, 'number', 'ledger reference');
      assert.equal(report.ledger.event_count, report.ledger.last_seq);
      assert.equal(result.stdout.includes(SANITIZATION_SECRET), false, 'CLI output must never embed private-oracle text');
    } finally {
      await rm(probe.directory, { recursive: true, force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI report renders the gate decisions table only when there are decisions', async () => {
  const directory = await scratchLedger();
  try {
    const probe = await makeRepo('report-text');
    try {
      await mkdir(path.join(probe.root, '.evofence'), { recursive: true });
      await writeFile(path.join(probe.root, '.evofence', 'ledger.sqlite'), await readFile(path.join(directory, 'ledger.sqlite')));

      const result = spawnCli(['report'], probe.root);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('## Gate decisions'), result.stdout);
      assert.ok(result.stdout.includes('CAPABILITY_DENIED'), result.stdout);
      assert.ok(result.stdout.includes('- Ledger reference:'), result.stdout);
      assert.equal(result.stdout.includes(SANITIZATION_SECRET), false);
    } finally {
      await rm(probe.directory, { recursive: true, force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI report dispatches SARIF and JUnit formats and rejects conflicting JSON flags', async () => {
  const directory = await scratchLedger();
  const probe = await makeRepo('report-format-dispatch');
  try {
    await mkdir(path.join(probe.root, '.evofence'), { recursive: true });
    await writeFile(path.join(probe.root, '.evofence', 'ledger.sqlite'), await readFile(path.join(directory, 'ledger.sqlite')));

    const sarifResult = spawnCli(['report', '--format', 'sarif'], probe.root);
    assert.equal(sarifResult.status, 0, sarifResult.stderr);
    const sarif = JSON.parse(sarifResult.stdout);
    assert.equal(sarif.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
    assert.equal(sarif.version, '2.1.0');
    assert.equal(sarif.runs[0].results.length, 3);
    assert.equal(sarif.runs[0].results[0].ruleId, 'evofence.gate-decision');

    const junitResult = spawnCli(['report', '--format', 'junit'], probe.root);
    assert.equal(junitResult.status, 0, junitResult.stderr);
    assert.match(junitResult.stdout, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<testsuite /);
    assert.match(junitResult.stdout, /<testsuite[^>]* tests="3"/);
    assert.equal((junitResult.stdout.match(/<testcase\b/g) ?? []).length, 3);

    const textResult = spawnCli(['report'], probe.root);
    assert.equal(textResult.status, 0, textResult.stderr);
    assert.match(textResult.stdout, /^# EvoFence Evolution Report\n/);
    assert.match(textResult.stdout, /## Gate decisions/);

    const conflict = spawnCli(['report', '--json', '--format', 'sarif'], probe.root);
    assert.equal(conflict.status, 1);
    assert.equal(conflict.stdout, '');
    const error = JSON.parse(conflict.stderr);
    assert.equal(error.error.code, 'USAGE');
    assert.match(error.error.message, /cannot be combined/);
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI status --json exits 0 with parseable JSON', async () => {
  const probe = await makeRepo('status-json');
  try {
    const result = spawnCli(['status', '--json'], probe.root);
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(typeof status.root, 'string');
    assert.equal(typeof status.totals.runs, 'number');
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
  }
});

test('a --json failure is one parseable error object on stderr and leaves stdout empty', async () => {
  const probe = await makeRepo('json-error');
  try {
    const result = spawnCli(['status', '--json', 'bogus'], probe.root);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '', 'stdout must stay clean in --json mode');
    const payload = JSON.parse(result.stderr);
    assert.deepEqual(payload, { error: { code: 'USAGE', message: 'Use: evofence status [--json]' } });
    assert.equal(Object.hasOwn(payload.error, 'details'), false, 'no details key when there are none');
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
  }
});

test('a --json failure with details exposes them under error.details', async () => {
  const probe = await makeRepo('json-error-details');
  try {
    await mkdir(path.join(probe.root, '.evofence'), { recursive: true });
    await writeFile(path.join(probe.root, '.evofence', 'contract.yaml'), 'contract_version: 1\nmystery_field: 1\n', 'utf8');

    const result = spawnCli(['status', '--json'], probe.root);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.error.code, 'INVALID_CONTRACT');
    assert.equal(typeof payload.error.message, 'string');
    assert.deepEqual(payload.error.details.rejected_fields.map((issue) => issue.path), ['mystery_field']);
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
  }
});

test('the non-JSON text failure path is unchanged', async () => {
  const probe = await makeRepo('text-error');
  try {
    const result = spawnCli(['status', 'bogus'], probe.root);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), '[USAGE] Use: evofence status [--json]');
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
  }
});

test('the JSON error contract covers commands outside report/status too', async () => {
  // Replaces the earlier scope boundary. ADR-0003 (l2_cli handoff) unified the failure output:
  // `--json` anywhere in argv makes ANY failure one JSON object on stderr, and spec-f1's two
  // `diff --json` assertions were updated to the same envelope.
  const probe = await makeRepo('json-error-scope');
  try {
    const usage = spawnCli(['diff', '--json'], probe.root);
    assert.equal(usage.status, 1);
    assert.equal(usage.stdout, '');
    assert.deepEqual(JSON.parse(usage.stderr), {
      error: { code: 'USAGE', message: 'Use: evofence diff <generation-id> [--json]' },
    });

    const init = spawnCli(['init'], probe.root);
    assert.equal(init.status, 0, init.stderr);
    const unknown = spawnCli(['proposal', 'inspect', 'no-such-proposal', '--json'], probe.root);
    assert.equal(unknown.status, 1);
    assert.equal(unknown.stdout, '');
    assert.equal(JSON.parse(unknown.stderr).error.code, 'PROPOSAL_NOT_FOUND');
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
  }
});

test('a policy failure keeps its own code and details even with a ledger present', async () => {
  // l2_cli handoff from l2_config: `commandStatus` used to rewrite every `buildStatus` failure as
  // LEDGER_UNAVAILABLE, which hid the real code. The config codes are now re-thrown untouched.
  const probe = await makeRepo('config-code-with-ledger');
  try {
    const init = spawnCli(['init'], probe.root);
    assert.equal(init.status, 0, init.stderr);
    await writeFile(path.join(probe.root, '.evofence', 'contract.yaml'), 'contract_version: 1\nmystery_field: 1\n', 'utf8');

    const result = spawnCli(['status', '--json'], probe.root);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.error.code, 'INVALID_CONTRACT', 'the ledger wrapper must not rewrite the code');
    assert.deepEqual(payload.error.details.rejected_fields.map((issue) => issue.path), ['mystery_field']);
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * view-module boundaries (DoD 5)
 * ------------------------------------------------------------------ */

test('the view modules never import the runner or the ledger implementation', async () => {
  const viewModules = [
    '../dist/lib/report.js',
    '../dist/lib/status.js',
    '../dist/lib/report/budget.js',
    '../dist/lib/report/gates.js',
    '../dist/lib/report/generations.js',
    '../dist/lib/report/ledger-view.js',
    '../dist/lib/report/objective.js',
    '../dist/lib/report/reference.js',
    '../dist/lib/report/render.js',
    '../dist/lib/report/runs.js',
    '../dist/lib/report/view.js',
  ];
  for (const relative of viewModules) {
    const source = await readFile(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
    const specifiers = [...source.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.equal(/runner|adapter|\.\.\/ledger\.js|git\.js|process\.js/.test(specifier), false, `${relative} must not import ${specifier}`);
    }
  }
});
