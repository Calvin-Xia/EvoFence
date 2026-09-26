// Acceptance oracle for the generation audit view (`evofence diff <generation-id> [--json]`).
//
// This spec is mount-independent: every import of repository code is a dynamic import
// resolved from `process.cwd()`, so the same file can run from this repository root and
// against another candidate checkout used as cwd.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EVIDENCE_SECRET = 'EVIDENCE-STDOUT-MUST-NOT-LEAK-7f3c9a';
const RUN_ID = 'run-f1-fixture';
const ORPHAN_RUN_ID = 'run-f1-orphan';
const AUDIT_RUN_ID = 'run-f1-audit-fixture';
const AUDIT_ARTIFACT = '.evofence/artifacts/run-f1-audit-fixture/candidate-1-1.json';
const AUDIT_PRIOR_ARTIFACT = '.evofence/artifacts/run-f1-audit-fixture/candidate-1-0.json';
const AUDIT_FORGED_ARTIFACT = '.evofence/artifacts/run-f1-audit-fixture/candidate-1-9.json';
const GENERATION_ID = `g-${RUN_ID}-i01`;
const ORPHAN_GENERATION_ID = 'g-orphan-fixture';
const PROPOSAL_ID = 'prop-f1-fixture-01';
const GENERATION_CREATED_AT = '2026-01-02T03:04:05.000Z';
const ORPHAN_CREATED_AT = '2026-01-02T04:05:06.000Z';
const OBJECTIVE_METRIC = 'quality_score';
const OBJECTIVE_SCORE = 0.75;
const OBJECTIVE_IMPROVEMENT = 0.25;
const BASELINE_SCORE = 0.5;
const PRIOR_SCORE = 0.6;
const EXPECTED_CHANGED_PATHS = ['src/app.txt', 'src/new-file.txt', 'src/old.txt'];
const EXPECTED_CHECKS = [
  { id: 'invariant-a', kind: 'hard_invariant', result: 'PASS' },
  { id: 'public-1', kind: 'public_check', result: 'PASS' },
];
const DOCUMENTED_KEYS = [
  'generation_id', 'run_id', 'sha', 'parent_sha', 'accepted', 'diff_sha256', 'diff_sha256_recorded',
  'diff_sha256_matches', 'changed_paths',
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
  const { sha256, stableStringify } = await repoImport('src/lib/fs.js');
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
  const fixtureProposal = {
    iteration: 1,
    base_sha: parentSha,
    hypothesis: 'adding one line improves the quality score',
    changed_surface: EXPECTED_CHANGED_PATHS,
    requested_capabilities: [],
    expected_effect: { primary_metric: OBJECTIVE_METRIC, direction: 'increase' },
  };
  const fixtureProposalDigest = sha256(stableStringify(fixtureProposal));
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
    ledger.append('evidence.baseline', RUN_ID, {
      all_public_passed: true,
      all_private_within_tolerance: true,
      objective: { score: BASELINE_SCORE, valid_score: true },
    });
    ledger.append('proposal.created', RUN_ID, {
      proposal_id: PROPOSAL_ID,
      iteration: 1,
      base_sha: parentSha,
      proposal_sha256: fixtureProposalDigest,
      proposal: fixtureProposal,
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
    ledger.append('gate.decision', RUN_ID, {
      iteration: 1,
      decision: 'ACCEPT',
      reason: 'ALL_REQUIRED_EVIDENCE_PASSED',
      evidence_ok: true,
      improvement: OBJECTIVE_IMPROVEMENT,
      base_sha: parentSha,
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
      proposal_sha256: fixtureProposalDigest,
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

async function buildAuditFixture({
  bigDiff = false,
  recordedDiffHashOverride = null,
  acceptedShaMismatch = false,
  acceptedForeignRun = false,
  evidenceArtifactMismatch = false,
  evidenceAmbiguous = false,
  proposalDigestMismatch = false,
  legacyAccepted = false,
  gitattributesShift = false,
  acceptedDuplicate = false,
  acceptedScoreMismatch = false,
  proposalDuplicate = false,
  improvementMismatch = false,
  proposalContentMismatch = false,
  priorAccepted = false,
  priorEvidenceScoreMismatch = false,
  evidenceBaselineDuplicate = false,
  evidenceBaselineLate = false,
  proposalMissing = false,
  proposalLate = false,
  evidenceLate = false,
  runStartedLate = false,
  runStartedDuplicate = false,
  gateDecisionMissing = false,
  gateDecisionReject = false,
  evidenceFailedGate = false,
  evidenceLegacyDuplicate = false,
  evidenceInvalidScore = false,
  minDeltaAboveImprovement = false,
  acceptedMissingScore = false,
  baselineFailedGate = false,
  baselineInvalidScore = false,
  gateEvidenceOkFalse = false,
  gateImprovementMismatch = false,
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-spec-f1-audit-'));
  const root = path.join(directory, 'repo');
  await mkdir(path.join(root, 'src'), { recursive: true });
  runGit(root, ['init', '--quiet', '--initial-branch=main']);
  runGit(root, ['config', 'user.name', 'EvoFence Fixture']);
  runGit(root, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  runGit(root, ['config', 'core.autocrlf', 'false']);

  await writeFile(path.join(root, 'src/app.txt'), 'v1\n');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'baseline']);
  const parentSha = runGit(root, ['rev-parse', 'HEAD']);

  await writeFile(path.join(root, 'src/app.txt'), bigDiff ? `${'x'.repeat(300 * 1024)}\n` : 'v2\n');
  if (gitattributesShift) {
    await writeFile(path.join(root, 'src/data.bin'), 'BBBB\n');
    await writeFile(path.join(root, '.gitattributes'), 'src/data.bin binary\n');
  }
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'accept']);
  const sha = runGit(root, ['rev-parse', 'HEAD']);

  const { Ledger, ledgerPath } = await repoImport('src/lib/ledger.js');
  const { diffHash } = await repoImport('src/lib/git.js');
  const { sha256, stableStringify } = await repoImport('src/lib/fs.js');
  const ledgerFile = ledgerPath(root);
  const recordedDiffHash = recordedDiffHashOverride ?? (await diffHash(root, parentSha, sha));
  if (gitattributesShift) {
    // Simulate the real topology: the accepted generation is not checked out in the
    // primary worktree, whose .gitattributes therefore diverge from the generation's.
    runGit(root, ['checkout', '--quiet', parentSha]);
  }
  const generationId = 'g-audit-fixture-i01';
  const mainIteration = priorAccepted ? 2 : 1;
  const mainProposal = { expected_effect: { primary_metric: OBJECTIVE_METRIC, direction: 'increase' } };
  const mainProposalDigest = proposalContentMismatch ? 'e'.repeat(64) : sha256(stableStringify(mainProposal));
  const fixtureImprovement = acceptedMissingScore
    ? undefined
    : (improvementMismatch ? 0.99 : (priorAccepted ? (OBJECTIVE_SCORE - PRIOR_SCORE) : OBJECTIVE_IMPROVEMENT));

  await mkdir(path.dirname(ledgerFile), { recursive: true });
  const ledger = new Ledger(ledgerFile);
  const appendRunStarted = () => ledger.append('run.started', AUDIT_RUN_ID, {
    contract_snapshot: { objective: { name: OBJECTIVE_METRIC, direction: 'maximize', min_delta: minDeltaAboveImprovement ? 1.0 : 0.1 } },
  });
  const appendMainProposal = () => {
    ledger.append('proposal.created', AUDIT_RUN_ID, {
      proposal_id: 'prop-audit-fixture-01',
      iteration: mainIteration,
      proposal_sha256: mainProposalDigest,
      ...(proposalMissing ? {} : { proposal: mainProposal }),
    });
    if (proposalDuplicate) {
      ledger.append('proposal.created', AUDIT_RUN_ID, {
        proposal_id: 'prop-audit-fixture-02',
        iteration: mainIteration,
        proposal_sha256: mainProposalDigest,
        proposal: { expected_effect: { primary_metric: 'other_metric', direction: 'increase' } },
      });
    }
  };
  const appendMainEvidence = () => {
    ledger.append('evidence.candidate', AUDIT_RUN_ID, {
      iteration: mainIteration,
      evidence: {
        artifact: AUDIT_ARTIFACT,
        objective: { score: OBJECTIVE_SCORE, valid_score: !evidenceInvalidScore },
        all_public_passed: !evidenceFailedGate,
        all_private_within_tolerance: true,
        public: [{ id: 'check-1', kind: 'public_check', result: 'PASS' }],
      },
    });
    if (evidenceAmbiguous) {
      ledger.append('evidence.candidate', AUDIT_RUN_ID, {
        iteration: mainIteration,
        evidence: {
          artifact: AUDIT_ARTIFACT,
          objective: { score: OBJECTIVE_SCORE, valid_score: true },
          all_public_passed: true,
          all_private_within_tolerance: true,
          public: [{ id: 'check-dup', kind: 'public_check', result: 'PASS' }],
        },
      });
    }
    if (evidenceLegacyDuplicate) {
      ledger.append('evidence.candidate', AUDIT_RUN_ID, {
        iteration: mainIteration,
        evidence: {
          artifact: AUDIT_FORGED_ARTIFACT,
          objective: { score: OBJECTIVE_SCORE, valid_score: true },
          all_public_passed: true,
          all_private_within_tolerance: true,
          public: [{ id: 'check-2', kind: 'public_check', result: 'PASS' }],
        },
      });
    }
  };
  try {
    if (!runStartedLate) {
      appendRunStarted();
      if (runStartedDuplicate) {
        ledger.append('run.started', AUDIT_RUN_ID, {
          contract_snapshot: { objective: { name: 'other_metric', direction: 'minimize' } },
        });
      }
    }
    ledger.append('evidence.baseline', AUDIT_RUN_ID, {
      all_public_passed: !baselineFailedGate,
      all_private_within_tolerance: true,
      objective: { score: BASELINE_SCORE, valid_score: !baselineInvalidScore },
    });
    if (evidenceBaselineDuplicate) {
      ledger.append('evidence.baseline', AUDIT_RUN_ID, {
        all_public_passed: true,
        all_private_within_tolerance: true,
        objective: { score: 0.9, valid_score: true },
      });
    }
    if (priorAccepted) {
      const priorProposal = { expected_effect: { primary_metric: OBJECTIVE_METRIC, direction: 'increase' }, hypothesis: 'the prior candidate' };
      const priorProposalDigest = sha256(stableStringify(priorProposal));
      ledger.append('proposal.created', AUDIT_RUN_ID, {
        proposal_id: 'prop-audit-fixture-00',
        iteration: 1,
        proposal_sha256: priorProposalDigest,
        proposal: priorProposal,
      });
      ledger.append('evidence.candidate', AUDIT_RUN_ID, {
        iteration: 1,
        evidence: {
          artifact: AUDIT_PRIOR_ARTIFACT,
          objective: { score: priorEvidenceScoreMismatch ? 0.4 : PRIOR_SCORE, valid_score: true },
          all_public_passed: true,
          all_private_within_tolerance: true,
          public: [{ id: 'check-0', kind: 'public_check', result: 'PASS' }],
        },
      });
      ledger.recordGeneration({
        generation_id: 'g-audit-fixture-i00',
        run_id: AUDIT_RUN_ID,
        sha,
        parent_sha: parentSha,
        created_at: GENERATION_CREATED_AT,
      });
      ledger.append('gate.decision', AUDIT_RUN_ID, {
        iteration: 1,
        decision: 'ACCEPT',
        reason: 'ALL_REQUIRED_EVIDENCE_PASSED',
        evidence_ok: true,
        improvement: PRIOR_SCORE - BASELINE_SCORE,
        base_sha: parentSha,
      });
      ledger.append('candidate.accepted', AUDIT_RUN_ID, {
        iteration: 1,
        generation_id: 'g-audit-fixture-i00',
        sha,
        parent_sha: parentSha,
        diff_sha256: recordedDiffHash,
        objective_score: PRIOR_SCORE,
        improvement: PRIOR_SCORE - BASELINE_SCORE,
        evidence_artifact: AUDIT_PRIOR_ARTIFACT,
        proposal_sha256: priorProposalDigest,
      });
    }
    if (!proposalLate) appendMainProposal();
    if (!evidenceLate) appendMainEvidence();
    if (!gateDecisionMissing) {
      ledger.append('gate.decision', AUDIT_RUN_ID, {
        iteration: mainIteration,
        decision: gateDecisionReject ? 'REJECT' : 'ACCEPT',
        reason: gateDecisionReject ? 'NO_PRACTICAL_IMPROVEMENT' : 'ALL_REQUIRED_EVIDENCE_PASSED',
        evidence_ok: gateEvidenceOkFalse ? false : !gateDecisionReject,
        ...(gateImprovementMismatch ? { improvement: 0.42 } : (fixtureImprovement === undefined ? {} : { improvement: fixtureImprovement })),
        base_sha: parentSha,
      });
    }
    ledger.recordGeneration({
      generation_id: generationId,
      run_id: AUDIT_RUN_ID,
      sha,
      parent_sha: parentSha,
      created_at: GENERATION_CREATED_AT,
    });
    const acceptedPayload = {
      iteration: mainIteration,
      generation_id: generationId,
      sha: acceptedShaMismatch ? parentSha : sha,
      parent_sha: parentSha,
      diff_sha256: recordedDiffHash,
      ...(acceptedMissingScore ? {} : {
        objective_score: acceptedScoreMismatch ? 0.99 : OBJECTIVE_SCORE,
        improvement: fixtureImprovement,
      }),
    };
    if (!legacyAccepted) {
      acceptedPayload.proposal_sha256 = proposalDigestMismatch ? 'f'.repeat(64) : mainProposalDigest;
      acceptedPayload.evidence_artifact = evidenceArtifactMismatch ? AUDIT_FORGED_ARTIFACT : AUDIT_ARTIFACT;
    }
    ledger.append('candidate.accepted', acceptedForeignRun ? 'run-forged' : AUDIT_RUN_ID, acceptedPayload);
    if (acceptedDuplicate) {
      ledger.append('candidate.accepted', AUDIT_RUN_ID, {
        ...acceptedPayload,
        iteration: 2,
        objective_score: 0.5,
        improvement: 0.1,
      });
    }
    if (evidenceLate) appendMainEvidence();
    if (proposalLate) appendMainProposal();
    if (runStartedLate) appendRunStarted();
    if (evidenceBaselineLate) {
      ledger.append('evidence.baseline', AUDIT_RUN_ID, {
        all_public_passed: true,
        all_private_within_tolerance: true,
        objective: { score: 0.9, valid_score: true },
      });
    }
  } finally {
    ledger.close();
  }
  return { directory, root, ledgerFile, generationId, parentSha, sha, recordedDiffHash };
}

async function callGenerationDiffAt(auditFixture, generationId) {
  const { generationDiff } = await repoImport('src/lib/audit.js');
  const { Ledger } = await repoImport('src/lib/ledger.js');
  const ledger = new Ledger(auditFixture.ledgerFile);
  try {
    return await generationDiff({ root: auditFixture.root, ledger, generationId });
  } finally {
    ledger.close();
  }
}

function tamperAcceptedPayload(ledgerFile, mutate) {
  const requireFromCwd = createRequire(path.join(process.cwd(), 'package.json'));
  const Database = requireFromCwd('better-sqlite3');
  const db = new Database(ledgerFile);
  try {
    db.exec('DROP TRIGGER IF EXISTS events_no_update');
    const row = db.prepare("SELECT seq, payload_json FROM events WHERE event_type = 'candidate.accepted' ORDER BY seq DESC LIMIT 1").get();
    assert.ok(row, 'tamper fixture must contain a candidate.accepted event');
    const payload = JSON.parse(row.payload_json);
    mutate(payload);
    db.prepare('UPDATE events SET payload_json = ? WHERE seq = ?').run(JSON.stringify(payload), row.seq);
  } finally {
    db.close();
  }
}

function tamperGenerationRow(ledgerFile, mutate) {
  const requireFromCwd = createRequire(path.join(process.cwd(), 'package.json'));
  const Database = requireFromCwd('better-sqlite3');
  const db = new Database(ledgerFile);
  try {
    db.exec('DROP TRIGGER IF EXISTS generations_no_update');
    const row = db.prepare('SELECT * FROM generations ORDER BY generation_id LIMIT 1').get();
    assert.ok(row, 'tamper fixture must contain a generations row');
    mutate(row);
    db.prepare('UPDATE generations SET run_id = ?, sha = ?, parent_sha = ?, created_at = ? WHERE generation_id = ?')
      .run(row.run_id, row.sha, row.parent_sha, row.created_at, row.generation_id);
  } finally {
    db.close();
  }
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

function spawnCliIn(root, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function spawnCli(args) {
  return spawnCliIn(fixture.root, args);
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
  assert.equal(report.accepted, true);
  assert.equal(report.diff_sha256_recorded, fixture.recordedDiffHash);
  assert.equal(report.diff_sha256_matches, true);
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
  assert.equal(report.accepted, false);
  assert.equal(report.diff_sha256_recorded, null);
  assert.equal(report.diff_sha256_matches, null);
  assert.equal(report.objective, null);
  assert.equal(report.evidence, null);
  assert.equal(report.proposal_id, null);
  assert.equal(typeof report.accepted_at, 'string');
  assert.equal(Number.isNaN(Date.parse(report.accepted_at)), false);
  const { formatGenerationDiff } = await repoImport('src/lib/audit.js');
  const text = formatGenerationDiff(report);
  assert.ok(text.includes('not accepted'), `text output must label the generation as not accepted:\n${text}`);
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

test('generationDiff rejects a tampered ledger with EvoFenceError LEDGER_CORRUPT before presenting evidence', async () => {
  const auditFixture = await buildAuditFixture();
  try {
    tamperAcceptedPayload(auditFixture.ledgerFile, (payload) => {
      payload.objective_score = 0.99;
      payload.improvement = 0.49;
    });
    const { Ledger } = await repoImport('src/lib/ledger.js');
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    const probe = new Ledger(auditFixture.ledgerFile);
    try {
      assert.equal(probe.verify().valid, false, 'the tampered fixture must break the hash chain');
    } finally {
      probe.close();
    }
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /hash chain failed at event \d+/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('CLI diff exits 1 with LEDGER_CORRUPT when the ledger hash chain is broken', async () => {
  const auditFixture = await buildAuditFixture();
  try {
    tamperAcceptedPayload(auditFixture.ledgerFile, (payload) => {
      payload.objective_score = 0.99;
      payload.improvement = 0.49;
    });
    const result = spawnCliIn(auditFixture.root, ['diff', auditFixture.generationId]);
    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}`);
    assert.ok(
      result.stderr.startsWith('[LEDGER_CORRUPT] '),
      `stderr must start with "[LEDGER_CORRUPT] ": ${result.stderr}`,
    );
    assert.equal(result.stdout, '', 'a corrupt ledger must never yield a printed audit record');
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff caps an oversized diff and formatGenerationDiff marks the truncation', async () => {
  const auditFixture = await buildAuditFixture({ bigDiff: true });
  try {
    const report = await callGenerationDiffAt(auditFixture, auditFixture.generationId);
    assert.equal(report.diff_truncated, true);
    assert.ok(Buffer.byteLength(report.diff, 'utf8') <= 200 * 1024, 'diff must be capped at 200 KiB');
    assert.ok(
      Buffer.byteLength(report.diff, 'utf8') > 200 * 1024 - 1024,
      'the cap should keep nearly 200 KiB of the oversized diff',
    );
    const { formatGenerationDiff } = await repoImport('src/lib/audit.js');
    const text = formatGenerationDiff(report);
    assert.match(text, /\[diff truncated at 204800 bytes;/, `text output must announce the truncation:\n${text.slice(-200)}`);
    assert.ok(text.endsWith('[... diff truncated ...]'), 'text output must end with a truncation marker');
    const result = spawnCliIn(auditFixture.root, ['diff', auditFixture.generationId]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[diff truncated at 204800 bytes;/);
    assert.match(result.stdout, /\[\.\.\. diff truncated \.\.\.\]/);
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff recomputes diff_sha256 and flags a ledger claim that does not match the git diff', async () => {
  const bogus = 'f'.repeat(64);
  const auditFixture = await buildAuditFixture({ recordedDiffHashOverride: bogus });
  try {
    const report = await callGenerationDiffAt(auditFixture, auditFixture.generationId);
    const { diffHash } = await repoImport('src/lib/git.js');
    const expected = await diffHash(auditFixture.root, auditFixture.parentSha, auditFixture.sha);
    assert.equal(report.diff_sha256, expected, 'diff_sha256 must be recomputed from git at report time');
    assert.notEqual(report.diff_sha256, bogus);
    assert.equal(report.diff_sha256_recorded, bogus);
    assert.equal(report.diff_sha256_matches, false);
    const { formatGenerationDiff } = await repoImport('src/lib/audit.js');
    const text = formatGenerationDiff(report);
    assert.ok(text.includes('[diff hash mismatch:'), `text output must mark the mismatch:\n${text.split('\n')[0]}`);
    assert.ok(text.includes(bogus) && text.includes(expected), 'the mismatch marker must show both hashes');
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects a generation row that disagrees with its hash-chained record', async () => {
  const auditFixture = await buildAuditFixture();
  try {
    tamperGenerationRow(auditFixture.ledgerFile, (row) => {
      row.run_id = 'run-forged';
      row.created_at = '2099-01-01T00:00:00.000Z';
    });
    const { Ledger } = await repoImport('src/lib/ledger.js');
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    const probe = new Ledger(auditFixture.ledgerFile);
    try {
      assert.equal(probe.verify().valid, true, 'the hash chain alone cannot detect a modified generations row');
    } finally {
      probe.close();
    }
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /generation\.accepted record/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects candidate.accepted evidence that disagrees with the generation row', async () => {
  const auditFixture = await buildAuditFixture({ acceptedShaMismatch: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /candidate\.accepted evidence disagrees/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects candidate.accepted evidence recorded under a different run', async () => {
  const auditFixture = await buildAuditFixture({ acceptedForeignRun: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /recorded under run run-forged/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects evidence bound to a different artifact than the acceptance record', async () => {
  const auditFixture = await buildAuditFixture({ evidenceArtifactMismatch: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /evidence_artifact .* matches 0 evidence\.candidate events/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects ambiguous evidence candidates for the accepted artifact', async () => {
  const auditFixture = await buildAuditFixture({ evidenceAmbiguous: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /evidence_artifact .* matches 2 evidence\.candidate events/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects an acceptance record whose proposal digest matches no proposal', async () => {
  const auditFixture = await buildAuditFixture({ proposalDigestMismatch: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /proposal_sha256 .* matches no proposal\.created/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff keeps the run/iteration fallback for legacy acceptance events without bindings', async () => {
  const auditFixture = await buildAuditFixture({ legacyAccepted: true });
  try {
    const report = await callGenerationDiffAt(auditFixture, auditFixture.generationId);
    assert.equal(report.proposal_id, 'prop-audit-fixture-01');
    assert.deepEqual(report.evidence.checks, [{ id: 'check-1', kind: 'public_check', result: 'PASS' }]);
    assert.equal(report.diff_sha256_matches, true);
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff pins diff attributes to the generation despite a divergent primary worktree', async () => {
  const auditFixture = await buildAuditFixture({ gitattributesShift: true });
  try {
    const report = await callGenerationDiffAt(auditFixture, auditFixture.generationId);
    assert.equal(report.diff_sha256_matches, true, 'the acceptance-time hash must reproduce despite the shifted primary checkout');
    assert.ok(
      report.diff.includes('Binary files /dev/null and b/src/data.bin differ'),
      `the diff must follow the generation tree attributes (binary marker):\n${report.diff}`,
    );
    assert.ok(!report.diff.includes('+BBBB'), 'the diff must not fall back to the primary checkout textual rendering');
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects ambiguous acceptance records for a generation', async () => {
  const auditFixture = await buildAuditFixture({ acceptedDuplicate: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /2 candidate\.accepted events; the acceptance record is ambiguous/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects an acceptance score that disagrees with its bound evidence', async () => {
  const auditFixture = await buildAuditFixture({ acceptedScoreMismatch: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /objective_score 0\.99 disagrees with bound evidence score 0\.75/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects ambiguous proposal digest matches', async () => {
  const auditFixture = await buildAuditFixture({ proposalDuplicate: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /matches 2 proposal\.created events for run .*; the proposal link is ambiguous/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects ambiguous proposal links in the legacy fallback', async () => {
  const auditFixture = await buildAuditFixture({ proposalDuplicate: true, legacyAccepted: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /iteration 1 matches 2 proposal\.created events for run .*; the proposal link is ambiguous/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects an improvement that disagrees with the ledger evidence', async () => {
  const auditFixture = await buildAuditFixture({ improvementMismatch: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /improvement 0\.99 disagrees with ledger evidence \(expected 0\.25\)/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects a proposal digest claim that does not match its proposal content', async () => {
  const auditFixture = await buildAuditFixture({ proposalContentMismatch: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /digest claim .* does not match its proposal content/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects an improvement baseline from an unsupported prior acceptance', async () => {
  const auditFixture = await buildAuditFixture({ priorAccepted: true, priorEvidenceScoreMismatch: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /objective_score 0\.6 disagrees with bound evidence score 0\.4/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff derives improvement from a validated prior acceptance', async () => {
  const auditFixture = await buildAuditFixture({ priorAccepted: true });
  try {
    const report = await callGenerationDiffAt(auditFixture, auditFixture.generationId);
    assert.equal(report.objective.score, OBJECTIVE_SCORE);
    assert.equal(report.objective.improvement, OBJECTIVE_SCORE - PRIOR_SCORE);
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects an ambiguous baseline preceding the acceptance', async () => {
  const auditFixture = await buildAuditFixture({ evidenceBaselineDuplicate: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /2 evidence\.baseline events precede the acceptance/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff ignores baseline evidence that follows the acceptance', async () => {
  const auditFixture = await buildAuditFixture({ evidenceBaselineLate: true });
  try {
    const report = await callGenerationDiffAt(auditFixture, auditFixture.generationId);
    assert.equal(report.objective.score, OBJECTIVE_SCORE);
    assert.equal(report.objective.improvement, OBJECTIVE_IMPROVEMENT);
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects a digest claim with no proposal object', async () => {
  const auditFixture = await buildAuditFixture({ proposalMissing: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /digest claim .* has no proposal object to recompute/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects gate evidence that follows the acceptance', async () => {
  const auditFixture = await buildAuditFixture({ evidenceLate: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /matches 0 evidence\.candidate events/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects a proposal that follows the acceptance', async () => {
  const auditFixture = await buildAuditFixture({ proposalLate: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /matches no proposal\.created event/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects a contract snapshot that follows the acceptance', async () => {
  const auditFixture = await buildAuditFixture({ runStartedLate: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /cannot be derived from ledger evidence/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects ambiguous run started events before the acceptance', async () => {
  const auditFixture = await buildAuditFixture({ runStartedDuplicate: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /2 run\.started events before the acceptance/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects a generation with no ACCEPT gate decision', async () => {
  const auditFixture = await buildAuditFixture({ gateDecisionMissing: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /0 gate\.decision records \(0 ACCEPT\); a unique preceding ACCEPT gate decision is required/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects a generation whose gate decision is not ACCEPT', async () => {
  const auditFixture = await buildAuditFixture({ gateDecisionReject: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /1 gate\.decision records \(0 ACCEPT\); a unique preceding ACCEPT gate decision is required/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects bound evidence that failed its gate', async () => {
  const auditFixture = await buildAuditFixture({ evidenceFailedGate: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /did not pass its gate \(all_public_passed=false, all_private_within_tolerance=true\)/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects ambiguous legacy evidence links', async () => {
  const auditFixture = await buildAuditFixture({ legacyAccepted: true, evidenceLegacyDuplicate: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /matches 2 evidence\.candidate events for run .*; the evidence link is ambiguous/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects bound evidence with an invalid objective score', async () => {
  const auditFixture = await buildAuditFixture({ evidenceInvalidScore: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /objective\.valid_score=false; the acceptance predicate requires a valid score/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects an improvement below the contract min_delta', async () => {
  const auditFixture = await buildAuditFixture({ minDeltaAboveImprovement: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /does not meet the contract min_delta/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects an acceptance without a numeric score and improvement', async () => {
  const auditFixture = await buildAuditFixture({ acceptedMissingScore: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /lacks a numeric objective_score\/improvement/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects an improvement baseline that failed its gate', async () => {
  const auditFixture = await buildAuditFixture({ baselineFailedGate: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /evidence\.baseline .* did not pass its gate/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects an improvement baseline with an invalid objective score', async () => {
  const auditFixture = await buildAuditFixture({ baselineInvalidScore: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /evidence\.baseline .* objective\.valid_score=false/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects an ACCEPT gate decision whose evidence_ok is not true', async () => {
  const auditFixture = await buildAuditFixture({ gateEvidenceOkFalse: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /ACCEPT gate decision .* records evidence_ok=false/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
});

test('generationDiff rejects a gate decision whose improvement disagrees with the acceptance', async () => {
  const auditFixture = await buildAuditFixture({ gateImprovementMismatch: true });
  try {
    const { EvoFenceError } = await repoImport('src/lib/errors.js');
    await assert.rejects(callGenerationDiffAt(auditFixture, auditFixture.generationId), (error) => {
      assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
      assert.equal(error.code, 'LEDGER_CORRUPT');
      assert.match(error.message, /ACCEPT gate decision improvement 0\.42 disagrees with candidate\.accepted improvement 0\.25/);
      return true;
    });
  } finally {
    await rm(auditFixture.directory, { recursive: true, force: true });
  }
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
