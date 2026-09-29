// Manifest-driven acceptance oracle for the CLI command surface (node `l2_cli`, ADR-0003).
//
// This file does NOT hard-code a second copy of the command surface: it imports `COMMANDS` from
// the build output and drives every entry, so the manifest and the CLI cannot drift.
//   DoD 1 — `smoke`: every subcommand reproduces the exit code recorded in `src/lib/cli/catalog.ts`.
//   DoD 2 — `jsonSmoke`: every subcommand emits a JSON object on stdout with `--json`.
//   DoD 3 — invalid flags and invalid input exit non-zero with a readable, stack-free message.
//   DoD 4 — the downstream entry points (`ledger verify`, `status`, `report --json`) exist.
//   DoD 5 — the manifest and the handler registry describe exactly the same commands.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMAND_GROUPS, COMMANDS, SMOKE } from '../dist/lib/cli/commands.js';
import { JSON_WRITE_SMOKES } from '../dist/lib/cli/catalog.js';
import { HANDLERS } from '../dist/lib/cli/handlers/index.js';
import { diffHash } from '../dist/lib/git.js';
import { Ledger, ledgerPath } from '../dist/lib/ledger.js';
import { sha256, stableStringify } from '../dist/lib/fs.js';
import { repoRelativePath } from '../dist/lib/cli/output.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const BASELINE_SCORE = 0.5;
const OBJECTIVE_SCORE = 0.75;
const IMPROVEMENT = 0.25;
const MIN_DELTA = 0.2;
const GENERATION_CREATED_AT = '2026-01-02T03:04:05.000Z';

/** A contract whose evidence passes, with a `min_delta` the seeded improvement satisfies. */
const PASSING_CONTRACT = `contract_version: 1
objective:
  name: quality_score
  command: "node --version"
  direction: maximize
  min_delta: ${MIN_DELTA}
hard_invariants:
  - id: invocation
    command: "node --version"
allowed_evolution_surface:
  - "**/*"
protected_paths:
  - ".evofence/**"
evidence:
  public_commands:
    - "node --version"
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

/** Same shape, but the baseline evidence command fails — so `run` never needs an agent. */
const FAILING_BASELINE_CONTRACT = `contract_version: 1
objective:
  name: quality_score
  command: "node --version"
  direction: maximize
  min_delta: ${MIN_DELTA}
hard_invariants: []
allowed_evolution_surface:
  - "**/*"
protected_paths:
  - ".evofence/**"
evidence:
  public_commands:
    - 'node -e "process.exit(1)"'
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

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function spawnCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
}

async function makeRepo(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `evofence-cli-${prefix}-`));
  const root = path.join(directory, 'repo');
  await mkdir(root, { recursive: true });
  runGit(root, ['init', '--quiet', '--initial-branch=main']);
  runGit(root, ['config', 'user.name', 'EvoFence Fixture']);
  runGit(root, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  runGit(root, ['config', 'core.autocrlf', 'false']);
  await writeFile(path.join(root, 'README.md'), '# fixture repository\n');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'fixture']);
  return { directory, root };
}

/** Healthy fixture: a real two-commit generation plus a fully consistent seeded ledger. */
async function buildLedgerFixture() {
  const { directory, root } = await makeRepo('ledger');
  await writeFile(path.join(root, 'app.txt'), 'v1\n');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'baseline']);
  const parentSha = runGit(root, ['rev-parse', 'HEAD']);
  await writeFile(path.join(root, 'app.txt'), 'v1\nmid\n');
  await writeFile(path.join(root, 'new-file.txt'), 'added\n');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'candidate']);
  const sha = runGit(root, ['rev-parse', 'HEAD']);

  const init = spawnCli(['init'], root);
  assert.equal(init.status, 0, init.stderr);
  await writeFile(path.join(root, '.evofence', 'contract.yaml'), PASSING_CONTRACT, 'utf8');

  const recordedDiffHash = await diffHash(root, parentSha, sha, { env: { GIT_ATTR_SOURCE: sha } });
  const artifact = `.evofence/artifacts/${SMOKE.runId}/candidate-1-1.json`;
  const contractSnapshot = {
    contract_version: 1,
    objective: { name: 'quality_score', command: 'node --version', direction: 'maximize', min_delta: MIN_DELTA },
    hard_invariants: [{ id: 'invocation', command: 'node --version' }],
    allowed_evolution_surface: ['**/*'],
    protected_paths: ['.evofence/**'],
    evidence: { public_commands: ['node --version'], per_command_timeout_ms: 60000, max_output_bytes: 1048576 },
    acceptance: { require_rollback_point: true, hidden_regression_tolerance: 0 },
    capabilities: { authority_ceiling: 'A1' },
    budgets: { max_iterations: 3, max_wall_clock_ms: 600000, max_failed_candidates: 2, max_consecutive_no_improvement: 2, max_tokens: null, max_usd: null },
  };
  const proposal = {
    iteration: 1,
    base_sha: parentSha,
    hypothesis: 'the seeded candidate improves the quality score',
    changed_surface: ['app.txt', 'new-file.txt'],
    requested_capabilities: [],
    expected_effect: { primary_metric: 'quality_score', direction: 'increase' },
  };
  const proposalDigest = sha256(stableStringify(proposal));

  const ledger = new Ledger(ledgerPath(root));
  try {
    ledger.append('run.started', SMOKE.runId, { adapter: 'codex', base_sha: parentSha, contract_snapshot: contractSnapshot });
    ledger.append('evidence.baseline', SMOKE.runId, { all_public_passed: true, all_private_within_tolerance: true, objective: { score: BASELINE_SCORE, valid_score: true } });
    ledger.append('proposal.created', SMOKE.runId, {
      proposal_id: SMOKE.proposalId,
      iteration: 1,
      base_sha: parentSha,
      proposal_sha256: proposalDigest,
      proposal,
      hypothesis: proposal.hypothesis,
      changed_surface: proposal.changed_surface,
      requested_capabilities: [],
    });
    ledger.append('evidence.candidate', SMOKE.runId, {
      iteration: 1,
      base_sha: parentSha,
      evidence: { all_public_passed: true, all_private_within_tolerance: true, objective: { score: OBJECTIVE_SCORE, valid_score: true }, artifact },
    });
    ledger.recordGeneration({ generation_id: SMOKE.generationId, run_id: SMOKE.runId, sha, parent_sha: parentSha, created_at: GENERATION_CREATED_AT });
    ledger.append('gate.decision', SMOKE.runId, { iteration: 1, decision: 'ACCEPT', reason: 'ALL_REQUIRED_EVIDENCE_PASSED', evidence_ok: true, improvement: IMPROVEMENT, base_sha: parentSha });
    ledger.append('candidate.accepted', SMOKE.runId, {
      iteration: 1,
      generation_id: SMOKE.generationId,
      sha,
      parent_sha: parentSha,
      diff_sha256: recordedDiffHash,
      objective_score: OBJECTIVE_SCORE,
      improvement: IMPROVEMENT,
      evidence_artifact: artifact,
      proposal_sha256: proposalDigest,
    });
    ledger.append('run.finished', SMOKE.runId, { status: 'ACCEPTED', iterations: 1, active_generation: SMOKE.generationId, duration_ms: 1234 });
  } finally {
    ledger.close();
  }
  return { directory, root };
}

/** Agent-dependent fixture: the contract's baseline always fails, so `run` needs no agent. */
async function buildAgentlessFixture() {
  const { directory, root } = await makeRepo('agentless');
  const init = spawnCli(['init'], root);
  assert.equal(init.status, 0, init.stderr);
  await writeFile(path.join(root, '.evofence', 'contract.yaml'), FAILING_BASELINE_CONTRACT, 'utf8');
  await writeFile(path.join(root, SMOKE.goalFile), 'Raise the quality score.\n', 'utf8');
  await writeFile(path.join(root, SMOKE.experimentFile), `goal_file: ${SMOKE.goalFile}\niterations: 1\n`, 'utf8');
  return { directory, root };
}

let ledgerFixture = null;
let agentlessFixture = null;

before(async () => {
  ledgerFixture = await buildLedgerFixture();
  agentlessFixture = await buildAgentlessFixture();
});

after(async () => {
  for (const fixture of [ledgerFixture, agentlessFixture]) {
    if (fixture) await rm(fixture.directory, { recursive: true, force: true });
  }
});

function fixtureRoot(name) {
  return name === 'ledger' ? ledgerFixture.root : agentlessFixture.root;
}

function hasStack(text) {
  return /\n\s+at [^\n]+/.test(text) || text.includes('EvoFenceError');
}

/* ------------------------------------------------------------------ *
 * manifest integrity + DoD 5
 * ------------------------------------------------------------------ */

test('the manifest and the handler registry describe exactly the same commands', () => {
  const manifest = COMMANDS.map((spec) => spec.name).sort();
  assert.deepEqual(Object.keys(HANDLERS).sort(), manifest, 'every manifest command needs exactly one handler');
  assert.deepEqual(
    [...new Set(COMMANDS.map((spec) => spec.group))].sort(),
    [...COMMAND_GROUPS].sort(),
    'the eleven ADR-0003 groups must all be covered',
  );
});

test('the manifest is internally consistent', () => {
  for (const spec of COMMANDS) {
    assert.match(spec.usage, /^(init|run|proposal|evidence|gate|ledger|diff|rollback|experiment|report|status|doctor|budget)\b/, spec.name);
    assert.deepEqual(spec.flags.filter((flag) => flag.name === 'json').length, 1, `${spec.name} must declare --json`);
    assert.deepEqual(spec.exits.map((exit) => exit.code).sort(), [0, 1], `${spec.name} exit codes`);
    assert.equal([0, 1].includes(spec.smoke.code), true);
    assert.equal([0, 1].includes(spec.jsonSmoke.code), true);
    const keys = spec.flags.map((flag) => flag.key);
    assert.equal(new Set(keys).size, keys.length, `${spec.name} flag keys must be unique`);
  }
});

/* ------------------------------------------------------------------ *
 * DoD 1 / 2 / 3
 * ------------------------------------------------------------------ */

test('every subcommand reproduces the exit code recorded in the manifest (DoD 1)', () => {
  const mismatches = [];
  for (const spec of COMMANDS) {
    const result = spawnCli(spec.smoke.args, fixtureRoot(spec.smoke.fixture));
    if (result.status !== spec.smoke.code) {
      mismatches.push(`${spec.name}: declared ${spec.smoke.code}, observed ${result.status} | stderr: ${result.stderr.trim().slice(0, 200)}`);
    }
  }
  assert.deepEqual(mismatches, [], `manifest/smoke mismatches:\n${mismatches.join('\n')}`);
});

test('every subcommand emits a parseable JSON object on stdout with --json (DoD 2)', () => {
  const problems = [];
  for (const spec of COMMANDS) {
    const result = spawnCli(spec.jsonSmoke.args, fixtureRoot(spec.jsonSmoke.fixture));
    if (result.status !== spec.jsonSmoke.code) {
      problems.push(`${spec.name}: declared ${spec.jsonSmoke.code}, observed ${result.status} | stderr: ${result.stderr.trim().slice(0, 200)}`);
      continue;
    }
    try {
      const value = JSON.parse(result.stdout);
      if (value === null || typeof value !== 'object') problems.push(`${spec.name}: stdout is not a JSON object`);
    } catch (error) {
      problems.push(`${spec.name}: stdout is not JSON (${error.message}) | stdout: ${result.stdout.slice(0, 120)}`);
    }
  }
  assert.deepEqual(problems, [], `--json problems:\n${problems.join('\n')}`);
});

// F8c regression guard: `report <file> --json` used to print `Report written to <file>` on stdout
// instead of JSON. `CommandSpec` holds a single `jsonSmoke`, so the write-file shapes live in the
// manifest's `JSON_WRITE_SMOKES` table instead of a second copy here.
test('every write-file --json form prints a bare JSON envelope and really writes the file (DoD 2)', async () => {
  // Structural guard: a command with a `file` positional writes a file, so it must pin its
  // write-file `--json` shape in the table. A new such command without a row fails right here.
  const fileCommands = COMMANDS
    .filter((spec) => spec.positionals.some((entry) => entry.name === 'file'))
    .map((spec) => spec.name)
    .sort();
  assert.deepEqual(
    JSON_WRITE_SMOKES.map((row) => row.command).sort(),
    fileCommands,
    'JSON_WRITE_SMOKES must cover exactly the commands with a file positional',
  );

  const problems = [];
  for (const row of JSON_WRITE_SMOKES) {
    const root = fixtureRoot(row.fixture);
    const result = spawnCli(row.args, root);
    if (result.status !== 0) {
      problems.push(`${row.command}: expected exit 0, got ${result.status} | stderr: ${result.stderr.trim().slice(0, 200)}`);
      continue;
    }
    let envelope;
    try {
      envelope = JSON.parse(result.stdout);
    } catch (error) {
      problems.push(`${row.command}: stdout is not JSON (${error.message}) | stdout: ${result.stdout.slice(0, 160)}`);
      continue;
    }
    // stdout must carry the JSON document and nothing else — no human-readable line around it.
    if (result.stdout.trim() !== JSON.stringify(envelope, null, 2)) {
      problems.push(`${row.command}: stdout carries more than the JSON envelope | stdout: ${result.stdout.slice(0, 160)}`);
    }
    if (envelope[row.pathKey] !== row.path) {
      problems.push(`${row.command}: ${row.pathKey} is ${JSON.stringify(envelope[row.pathKey])}, want ${row.path}`);
    }
    // Spelling-independent invariant: a repo-relative envelope path must stay inside the repo.
    // A bare lexical `path.relative` under a short-named or symlinked cwd still yields a path
    // that resolves — but outside the repo — which is the shape CI hit on windows-latest.
    const reported = envelope[row.pathKey];
    if (typeof reported !== 'string' || path.isAbsolute(reported) || reported.startsWith('..')) {
      problems.push(`${row.command}: ${row.pathKey} is not an in-repo relative path: ${JSON.stringify(reported)}`);
    }
    try {
      JSON.parse(await readFile(path.join(root, row.path), 'utf8'));
    } catch (error) {
      problems.push(`${row.command}: ${row.path} is not the written JSON file (${error.message})`);
    }
  }
  assert.deepEqual(problems, [], `write-file --json problems:\n${problems.join('\n')}`);
});

test('the envelope path survives a root spelled differently from the target (symlink / 8.3 alias)', async (t) => {
  // `path.relative` is purely lexical, so a root and a target that name the same directory
  // through different spellings cannot be related: it returns a `../..` chain. CI temp dirs
  // carry 8.3 short names (`C:\Users\RUNNER~1\...`) while git reports the long spelling, which
  // is how windows-latest exposed this in `ledger export`. A link reproduces the same mismatch
  // deterministically on every platform instead of waiting for a short-named temp directory.
  const base = await mkdtemp(path.join(os.tmpdir(), 'evofence-repo-rel-'));
  try {
    const real = path.join(base, 'real');
    const link = path.join(base, 'link');
    await mkdir(real);
    try {
      await symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`cannot create a directory link here: ${error.code ?? error.message}`);
      return;
    }
    const file = path.join(real, 'out.json');
    await writeFile(file, '{}\n');

    assert.equal(repoRelativePath(link, file), 'out.json');
    // The bare lexical call is the regression this guards: it must not be what the envelope uses.
    assert.notEqual(path.relative(link, file), 'out.json');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('the write-file envelope reports an in-repo path when the cwd is spelled differently from the git root', async (t) => {
  // `git rev-parse --show-toplevel` resolves a directory link to its real path while
  // `process.cwd()` keeps the link spelling, so root and target disagree lexically — the same
  // mismatch a CI temp directory causes through its 8.3 short name (`C:\Users\RUNNER~1\...`),
  // which is how windows-latest caught the bare `path.relative` in `ledger export`.
  const { directory, root } = await makeRepo('envelope-link');
  try {
    spawnCli(['init'], root);
    const link = path.join(directory, 'link');
    try {
      await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`cannot create a directory link here: ${error.code ?? error.message}`);
      return;
    }
    const result = spawnCli(['ledger', 'export', 'write-link.json', '--json'], link);
    assert.equal(result.status, 0, `ledger export failed: ${result.stderr.slice(0, 300)}`);
    assert.equal(JSON.parse(result.stdout).exported, 'write-link.json');
    const written = await readFile(path.join(root, 'write-link.json'), 'utf8');
    assert.doesNotThrow(() => JSON.parse(written), 'the exported bundle must be JSON');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an unknown flag fails closed with a stack-free usage error for every subcommand (DoD 3)', () => {
  const problems = [];
  for (const spec of COMMANDS) {
    const result = spawnCli([...spec.smoke.args, '--definitely-not-a-flag'], fixtureRoot(spec.smoke.fixture));
    if (result.status !== 1) problems.push(`${spec.name}: expected exit 1, got ${result.status}`);
    if (!result.stderr.startsWith('[USAGE]')) problems.push(`${spec.name}: stderr is not a usage error: ${result.stderr.trim().slice(0, 160)}`);
    if (hasStack(result.stderr)) problems.push(`${spec.name}: stderr leaked a stack: ${result.stderr.slice(0, 200)}`);
  }
  assert.deepEqual(problems, [], `invalid-flag problems:\n${problems.join('\n')}`);
});

test('invalid input fails closed with a readable, stack-free error', async () => {
  // A pre-existing export target keeps the EEXIST case independent of test ordering.
  await writeFile(path.join(ledgerFixture.root, 'existing-export.json'), '{}\n', 'utf8');
  const cases = [
    { args: ['proposal', 'inspect', 'no-such-proposal'], code: 'PROPOSAL_NOT_FOUND' },
    { args: ['gate', 'no-such-proposal'], code: 'PROPOSAL_NOT_FOUND' },
    { args: ['diff', 'no-such-generation'], code: 'GENERATION_NOT_FOUND' },
    { args: ['ledger', 'recent', '999'], code: 'INVALID_RUN_LIMIT' },
    { args: ['ledger', 'export', 'existing-export.json'], code: 'EEXIST' },
  ];
  for (const item of cases) {
    const result = spawnCli(item.args, ledgerFixture.root);
    assert.equal(result.status, 1, `${item.args.join(' ')} must exit 1: ${result.stderr}`);
    assert.ok(result.stderr.trim().length > 0, `${item.args.join(' ')} must explain itself`);
    assert.equal(hasStack(result.stderr), false, `${item.args.join(' ')} must not leak a stack: ${result.stderr}`);
  }
  // The last case is a *filesystem* failure, not an EvoFenceError, so only the first four carry a code.
  for (const item of cases.slice(0, 4)) {
    const result = spawnCli(item.args, ledgerFixture.root);
    assert.ok(result.stderr.includes(`[${item.code}]`), `${item.args.join(' ')}: ${result.stderr}`);
  }
});

/* ------------------------------------------------------------------ *
 * DoD 4 + help
 * ------------------------------------------------------------------ */

test('the downstream entry points exist in the new command surface (DoD 4)', () => {
  const byName = new Map(COMMANDS.map((spec) => [spec.name, spec]));
  for (const required of ['ledger verify', 'status', 'report']) {
    assert.ok(byName.has(required), `${required} must exist`);
  }
  assert.equal(byName.get('report').flags.some((flag) => flag.name === 'json'), true, 'report must support --json');

  assert.equal(spawnCli(['ledger', 'verify'], ledgerFixture.root).status, 0);
  assert.equal(spawnCli(['status'], ledgerFixture.root).status, 0);
  assert.equal(spawnCli(['status', '--json'], ledgerFixture.root).status, 0);
  const json = spawnCli(['report', '--json'], ledgerFixture.root);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(typeof JSON.parse(json.stdout).run_count, 'number');
});

test('budget forecast is deterministic and does not change status', () => {
  const statusBefore = spawnCli(['status'], ledgerFixture.root);
  assert.equal(statusBefore.status, 0, statusBefore.stderr);
  const first = spawnCli(['budget', '--json'], ledgerFixture.root);
  const second = spawnCli(['budget', '--json'], ledgerFixture.root);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout, 'same ledger fixture must produce byte-identical forecasts');

  const forecast = JSON.parse(first.stdout);
  assert.equal(forecast.schema_version, 1);
  assert.equal(forecast.basis, 'historical_mean');
  assert.equal(typeof forecast.explanation, 'string');
  assert.equal(forecast.rounds_used, 1);
  assert.equal(forecast.rounds_limit, 3);
  assert.equal(forecast.used_ratio, 1 / 3);
  assert.equal(forecast.historical_mean_rounds_per_run, 1);
  assert.equal(forecast.remaining_rounds_estimate, 2);
  assert.equal(forecast.runs.length, 1);
  assert.deepEqual(forecast.runs[0], {
    run_id: SMOKE.runId,
    started_at: forecast.runs[0].started_at,
    status: 'ACCEPTED',
    iterations: 1,
    iteration_limit: 3,
    tokens_used: null,
    tokens_limit: null,
    usd_used: null,
    usd_limit: null,
  });
  assert.equal(forecast.tokens.used, null);
  assert.equal(forecast.usd.used, null);

  const statusAfter = spawnCli(['status'], ledgerFixture.root);
  assert.equal(statusAfter.status, 0, statusAfter.stderr);
  assert.equal(statusAfter.stdout, statusBefore.stdout, 'budget must not mutate the status view');
});

test('--help documents every manifest command plus the exit-code convention', () => {
  const result = spawnCli(['--help'], ledgerFixture.root);
  assert.equal(result.status, 0, result.stderr);
  for (const spec of COMMANDS) {
    assert.ok(result.stdout.includes(`evofence ${spec.usage}`), `help must document ${spec.name}`);
  }
  assert.ok(result.stdout.includes('diff <generation-id> [--json]'));
  assert.ok(result.stdout.includes('report [file] [--format <text|json|sarif|junit>] [--json]'));
  assert.ok(result.stdout.includes('status [--json]'));
  assert.ok(result.stdout.includes('Exit codes:'));
  assert.equal(hasStack(result.stderr), false);
});

test('--version prints the package version', () => {
  const result = spawnCli(['--version'], ledgerFixture.root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});
