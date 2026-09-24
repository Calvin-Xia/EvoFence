import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finalNumericLine, runTrustedCommand } from './process.js';
import { sha256 } from './fs.js';
import { EvoFenceError } from './errors.js';

function summary(command, result, { hidden = false, score = undefined } = {}) {
  return {
    command_sha256: sha256(command),
    passed: result.code === 0 && !result.timed_out && !result.output_limited,
    result: result.timed_out ? 'TIMEOUT' : result.output_limited ? 'OUTPUT_LIMIT' : result.code === 0 ? 'PASS' : 'FAIL',
    exit_code: result.code,
    duration_ms: result.duration_ms,
    stdout_sha256: sha256(result.stdout),
    stderr_sha256: sha256(result.stderr),
    stdout_bytes: result.stdout_bytes,
    stderr_bytes: result.stderr_bytes,
    hidden,
    ...(score === undefined ? {} : { score }),
  };
}

async function execute(command, { cwd, timeoutMs, maxOutputBytes, env }) {
  const started = Date.now();
  const result = await runTrustedCommand(command, { cwd, timeoutMs, maxOutputBytes, env });
  result.duration_ms = Date.now() - started;
  return result;
}

function boundedTimeout(contract, deadlineAt) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new EvoFenceError('RESOURCE_EXHAUSTED', 'The run wall-clock budget has expired.');
  return Math.max(1, Math.min(contract.evidence.per_command_timeout_ms, remaining));
}

export async function collectEvidence({ root, artifactRoot, contract, holdout = [], runId, iteration = 0, deadlineAt = Infinity, phase = 'candidate', onProgress = () => {} }) {
  const startedAt = new Date();
  const results = [];
  const maxOutputBytes = contract.evidence.max_output_bytes;
  const env = {
    EVOFENCE_PHASE: phase,
    EVOFENCE_RUN_ID: runId,
    EVOFENCE_ITERATION: iteration,
    EVOFENCE_CANDIDATE_DIR: root,
  };
  const checks = [
    ...contract.hard_invariants.map((item) => ({ id: item.id, command: item.command, kind: 'hard_invariant' })),
    ...contract.evidence.public_commands.map((command, index) => ({ id: `public-${index + 1}`, command, kind: 'public_check' })),
  ];
  for (const check of checks) {
    onProgress({ phase, check: check.id });
    const result = await execute(check.command, { cwd: root, timeoutMs: boundedTimeout(contract, deadlineAt), maxOutputBytes, env });
    results.push({ id: check.id, kind: check.kind, ...summary(check.command, result), command: check.command });
  }

  const privateResults = [];
  for (let index = 0; index < holdout.length; index += 1) {
    const regression = holdout[index];
    onProgress({ phase: 'private_regression', case: index + 1 });
    const result = await execute(regression.command, { cwd: root, timeoutMs: boundedTimeout(contract, deadlineAt), maxOutputBytes, env });
    privateResults.push({ case: index + 1, ...summary(regression.command, result, { hidden: true }) });
  }

  let objective = null;
  if (contract.objective.command.trim()) {
    onProgress({ phase, check: 'objective' });
    const result = await execute(contract.objective.command, { cwd: root, timeoutMs: boundedTimeout(contract, deadlineAt), maxOutputBytes, env });
    const score = result.code === 0 && !result.timed_out && !result.output_limited ? finalNumericLine(result.stdout) : null;
    objective = { ...summary(contract.objective.command, result, { score }), configured: true, valid_score: Number.isFinite(score) };
  }

  const evidence = {
    schema_version: 1,
    run_id: runId,
    iteration,
    phase,
    candidate_sha: null,
    started_at: startedAt.toISOString(),
    duration_ms: Date.now() - startedAt.getTime(),
    public: results,
    private: {
      total: privateResults.length,
      passed: privateResults.filter((item) => item.passed).length,
      failed: privateResults.filter((item) => !item.passed).length,
      cases: privateResults.map(({ case: caseNumber, result, exit_code, passed, duration_ms }) => ({ case: caseNumber, result, exit_code, passed, duration_ms })),
    },
    objective,
    all_public_passed: results.every((item) => item.passed),
    all_private_within_tolerance: privateResults.filter((item) => !item.passed).length <= contract.acceptance.hidden_regression_tolerance,
  };
  const evidenceDirectory = path.join(artifactRoot ?? root, 'artifacts', runId);
  const filename = path.join(evidenceDirectory, `${phase}-${iteration}-${Date.now()}.json`);
  await mkdir(evidenceDirectory, { recursive: true });
  evidence.artifact = `.evofence/artifacts/${runId}/${path.basename(filename)}`;
  const artifactText = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(filename, artifactText, { flag: 'wx', mode: 0o600 });
  evidence.artifact_sha256 = sha256(artifactText);
  return evidence;
}
