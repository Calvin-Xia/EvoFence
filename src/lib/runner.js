import { mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadContract, loadPrivateHoldout, loadYamlFile } from './contract.js';
import { Ledger, ledgerPath } from './ledger.js';
import { adapterAgent, adapterCommand, adapterModel, runAgentAdapter } from './adapter.js';
import { assessCapabilities, assessRisk, checkChangedPaths, checkClaims, checkProposal, matchesGlob, requireEvidenceConfigured } from './policy.js';
import { collectEvidence } from './evidence.js';
import { assertInside, ensureDirectory, readJsonInside, sha256, stableStringify, writeNewFile } from './fs.js';
import { EvoFenceError, invariant } from './errors.js';
import { changedPaths, changedPathsBetween, commitCandidate, createRunId, createWorktree, diffHash, headSha, pinGeneration, removeWorktree, repositoryRoot, restoreWorktreeMetadata, setActiveGenerationRef, worktreeMetadataMatches, worktreeMetadataSnapshot } from './git.js';

const BUILTIN_TASK_RULES = `The control plane owns the contract, evidence, and decision. Do not change protected files. Do not claim acceptance. Keep the patch atomic and reversible.`;

async function loadConfig(root) {
  const config = await loadYamlFile(path.join(root, '.evofence', 'config.yaml'), root);
  invariant(config.version === 1, 'INVALID_CONFIG', 'config.version must be 1.');
  for (const name of ['codex', 'opencode']) {
    const item = config.adapters?.[name];
    if (item !== undefined) {
      invariant(item && typeof item === 'object', 'INVALID_CONFIG', `adapters.${name} must be an object.`);
      invariant(item.command === undefined || (typeof item.command === 'string' && item.command.trim()), 'INVALID_CONFIG', `adapters.${name}.command must be a non-empty string.`);
      invariant(item.model === undefined || item.model === null || typeof item.model === 'string', 'INVALID_CONFIG', `adapters.${name}.model must be a string or null.`);
    }
  }
  return config;
}

function parseNumericBudget(value, ceiling, name) {
  if (value === undefined || value === null) return ceiling;
  const parsed = Number(value);
  invariant(Number.isInteger(parsed) && parsed > 0, 'INVALID_BUDGET', `${name} must be a positive integer.`);
  invariant(parsed <= ceiling, 'BUDGET_ABOVE_POLICY', `${name} cannot exceed the contract limit (${ceiling}).`);
  return parsed;
}

function taskContents({ goal, iteration, baseSha, contract, previousFailure, phase }) {
  const summary = {
    contract_version: contract.contract_version,
    objective: contract.objective,
    hard_invariants: contract.hard_invariants.map(({ id }) => ({ id })),
    allowed_evolution_surface: contract.allowed_evolution_surface,
    protected_paths: contract.protected_paths,
    network: contract.capabilities.network,
    dependency_install: contract.capabilities.dependency_install,
    credentials: contract.capabilities.credentials,
  };
  return [
    '# EvoFence task',
    '',
    `Phase: ${phase}`,
    `Iteration: ${iteration}`,
    `Base generation: ${baseSha}`,
    '',
    '## Goal',
    goal.trim(),
    '',
    '## Control-plane policy snapshot',
    'Treat this summary as read-only. The controller has a separate authoritative copy.',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    '',
    previousFailure ? `## Previous failure packet\n${previousFailure}` : '',
    '',
    BUILTIN_TASK_RULES,
    phase === 'proposal'
      ? 'Create only .evofence-out/proposal.json. Do not modify project files in this phase.'
      : 'Implement only the approved proposal in .evofence-out/proposal.json. Then write .evofence-out/claims.json. Do not modify the proposal.',
    '',
  ].filter(Boolean).join('\n');
}

function publicFailurePacket(decision, details) {
  const visible = { decision, ...details };
  if (visible.private_regressions) {
    visible.private_regressions = 'failed; private oracle details withheld';
  }
  return `The previous candidate was ${decision}.\n\n${JSON.stringify(visible, null, 2)}\n\nDo not weaken tests or request hidden oracle details.`;
}

function adapterEvent(result, adapter, phase, iteration) {
  return {
    adapter,
    model: result.model ?? null,
    phase,
    iteration,
    exit_code: result.code ?? null,
    signal: result.signal ?? null,
    timed_out: result.timed_out === true,
    output_limited: result.output_limited === true,
    duration_ms: result.duration_ms ?? null,
    estimated_tokens: result.estimated_tokens ?? null,
    estimated_cost_usd: null,
    stdout_sha256: sha256(result.stdout ?? ''),
    stderr_sha256: sha256(result.stderr ?? ''),
  };
}

async function currentPolicyHashes(root) {
  const contract = await loadContract(root);
  const holdout = await loadPrivateHoldout(root);
  const config = await loadConfig(root);
  return {
    contract: sha256(stableStringify(contract)),
    holdout: sha256(stableStringify(holdout)),
    config: sha256(stableStringify(config)),
  };
}

function helperPath(filename) {
  return filename === '.evofence-task.md' || filename === '.evofence-out' || filename.startsWith('.evofence-out/');
}

async function runAdapter({ adapter, config, worktree, timeoutMs, allowUnisolatedOpenCode }) {
  const entry = {
    name: adapter,
    command: adapterCommand(config, adapter),
    model: adapterModel(config, adapter),
    agent: adapterAgent(config, adapter),
    cwd: worktree,
    timeoutMs,
    maxOutputBytes: 20_000_000,
    allowUnisolatedOpenCode,
  };
  return runAgentAdapter(entry);
}

async function invokeAdapter(options, adapterRunner) {
  if (adapterRunner) return adapterRunner(options);
  return runAdapter(options);
}

function checkTaskFile(contract, actualPaths, proposal, claims) {
  const violations = checkChangedPaths(actualPaths, contract);
  if (violations.length) return { accepted: false, code: 'POLICY_VIOLATION', violations };
  if (!actualPaths.length) return { accepted: false, code: 'NO_CHANGE', message: 'The candidate did not change any project file.' };
  const undeclared = actualPaths.filter((filename) => !proposal.changed_surface.some((pattern) => matchesGlob(filename, pattern)));
  if (undeclared.length) return { accepted: false, code: 'UNDECLARED_CHANGE', paths: undeclared };
  const claimsPaths = [...new Set(claims.files_changed.map((name) => name.replaceAll('\\', '/')))].sort();
  const actual = [...actualPaths].sort();
  if (stableStringify(claimsPaths) !== stableStringify(actual)) return { accepted: false, code: 'CLAIMS_DIFF_MISMATCH', expected: actual, declared: claimsPaths };
  const builtInCapabilities = new Set(['filesystem:scoped_write', 'shell:evidence_commands_only']);
  const approvedCapabilities = new Set(proposal.requested_capabilities.map((item) => typeof item === 'string' ? item : item?.capability).filter((item) => typeof item === 'string'));
  const used = claims.capabilities_used.filter((item) => !builtInCapabilities.has(item) && !approvedCapabilities.has(item));
  if (used.length) return { accepted: false, code: 'CAPABILITY_VIOLATION', capabilities_used: used };
  if (claims.missing_evidence.length) return { accepted: false, code: 'INSUFFICIENT_EVIDENCE', missing_evidence: claims.missing_evidence };
  return { accepted: true };
}

export function checkFinalCandidate(contract, actualPaths, proposal, claims, beforeEvidenceHash, afterEvidenceHash) {
  const fileCheck = checkTaskFile(contract, actualPaths, proposal, claims);
  if (!fileCheck.accepted) return fileCheck;
  if (beforeEvidenceHash !== afterEvidenceHash) {
    return { accepted: false, code: 'EVIDENCE_MODIFIED_CANDIDATE', before_evidence_sha256: beforeEvidenceHash, after_evidence_sha256: afterEvidenceHash };
  }
  return { accepted: true };
}

async function ensurePrivateIgnored(root) {
  const file = path.join(root, '.evofence', 'private', 'holdout.yaml');
  const check = await import('./process.js').then(({ runProcess }) => runProcess('git', ['check-ignore', '-q', file], { cwd: root, timeoutMs: 10000, maxOutputBytes: 10000 }));
  if (check.code !== 0) throw new EvoFenceError('HOLDOUT_NOT_IGNORED', 'The private holdout file must be excluded from Git. Keep private regression tests out of commits and worktrees.');
}

async function removeCandidate(root, worktree, tempRoot) {
  assertInside(tempRoot, worktree);
  await removeWorktree(root, worktree).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function runEvolution({ cwd, goal, adapter = 'codex', iterations, maxWallClockMs, allowUnisolatedOpenCode = false, allowReadableHoldout = false, onProgress = () => {}, adapterRunner = null }) {
  const root = await repositoryRoot(cwd);
  const contract = await loadContract(root);
  const config = await loadConfig(root);
  const holdout = await loadPrivateHoldout(root);
  requireEvidenceConfigured(contract);
  if (holdout.length > 0 && !allowReadableHoldout) {
    throw new EvoFenceError('PRIVATE_ORACLE_READABLE', 'The built-in Codex and OpenCode adapters cannot guarantee read isolation from files elsewhere on this host. Re-run with --allow-readable-holdout only if you accept possible oracle exposure, or run EvoFence from a container/VM that mounts only the candidate and gate data.');
  }
  if (contract.budgets.max_tokens !== null || contract.budgets.max_usd !== null) {
    throw new EvoFenceError('UNSUPPORTED_BUDGET', 'This release enforces iteration, wall-clock, failed-candidate, and no-improvement budgets. Token and USD budgets are not yet enforced; keep max_tokens and max_usd set to null.');
  }
  await ensurePrivateIgnored(root);

  const limitIterations = parseNumericBudget(iterations, contract.budgets.max_iterations, '--iterations');
  const wallClockLimit = parseNumericBudget(maxWallClockMs, contract.budgets.max_wall_clock_ms, '--max-wall-clock-ms');
  const deadlineAt = Date.now() + wallClockLimit;
  const initialHashes = await currentPolicyHashes(root);
  const runId = createRunId();
  const ledger = new Ledger(ledgerPath(root));
  const integrity = ledger.verify();
  if (!integrity.valid) {
    ledger.close();
    throw new EvoFenceError('LEDGER_CORRUPT', `SQLite ledger hash chain failed at event ${integrity.sequence}.`);
  }

  const repoId = sha256(root.toLowerCase()).slice(0, 16);
  const tempParent = path.join(os.tmpdir(), 'evofence-worktrees', repoId);
  const runTempRoot = path.join(tempParent, runId);
  await ensureDirectory(runTempRoot);
  const runStartedAt = Date.now();
  let failureCount = 0;
  let noImprovementCount = 0;
  let activeGeneration = ledger.activeGeneration();
  let activeSha = activeGeneration?.sha ?? await headSha(root);
  let baselineScore = null;
  const outcome = { run_id: runId, status: 'RUNNING', adapter, base_sha: activeSha, iterations: [], active_generation: null };
  let worktree = null;

  try {
    if (!activeGeneration) {
      const baselineGeneration = { generation_id: `g0-${activeSha.slice(0, 12)}`, run_id: runId, sha: activeSha, parent_sha: activeSha, created_at: new Date().toISOString() };
      await pinGeneration(root, baselineGeneration.generation_id, activeSha);
      ledger.recordGeneration(baselineGeneration);
      activeGeneration = ledger.activeGeneration();
    } else {
      await setActiveGenerationRef(root, activeGeneration.sha);
    }

    ledger.append('run.started', runId, {
      adapter,
      adapter_config: { command: adapterCommand(config, adapter), model: adapterModel(config, adapter), agent: adapterAgent(config, adapter) },
      base_sha: activeSha,
      goal_sha256: sha256(goal),
      requested_iterations: limitIterations,
      max_wall_clock_ms: wallClockLimit,
      contract_sha256: initialHashes.contract,
      contract_snapshot: contract,
      holdout_sha256: initialHashes.holdout,
      private_regression_count: holdout.length,
      private_holdout_host_readable: holdout.length > 0,
      token_budget: null,
      cost_budget_usd: null,
    });
    onProgress({ type: 'run.started', run_id: runId, base_sha: activeSha, iterations: limitIterations });

    worktree = path.join(runTempRoot, 'baseline');
    await createWorktree(root, activeSha, worktree);
    const baselineEvidence = await collectEvidence({ root: worktree, artifactRoot: path.join(root, '.evofence'), contract, holdout, runId, iteration: 0, deadlineAt, phase: 'baseline', onProgress });
    ledger.append('evidence.baseline', runId, baselineEvidence);
    if (!baselineEvidence.all_public_passed || !baselineEvidence.all_private_within_tolerance || !baselineEvidence.objective?.valid_score) {
      const details = { public_passed: baselineEvidence.all_public_passed, private_regressions: baselineEvidence.all_private_within_tolerance ? 0 : 'failed', objective_valid: baselineEvidence.objective?.valid_score ?? false };
      const decision = 'QUARANTINE';
      ledger.append('gate.decision', runId, { decision, reason: 'BASELINE_UNHEALTHY', details });
      outcome.status = 'BASELINE_UNHEALTHY';
      outcome.decision = decision;
      outcome.failure = details;
      outcome.duration_ms = Date.now() - runStartedAt;
      ledger.append('run.finished', runId, { status: outcome.status, decision, duration_ms: outcome.duration_ms });
      return outcome;
    }
    baselineScore = baselineEvidence.objective.objective?.score ?? baselineEvidence.objective.score;
    if (!Number.isFinite(baselineScore)) {
      outcome.status = 'BASELINE_UNHEALTHY';
      outcome.decision = 'QUARANTINE';
      outcome.failure = { reason: 'BASELINE_OBJECTIVE_INVALID' };
      ledger.append('gate.decision', runId, { decision: 'QUARANTINE', reason: 'BASELINE_OBJECTIVE_INVALID' });
      outcome.duration_ms = Date.now() - runStartedAt;
      ledger.append('run.finished', runId, { status: outcome.status, decision: 'QUARANTINE', duration_ms: outcome.duration_ms });
      return outcome;
    }
    await removeCandidate(root, worktree, runTempRoot);
    worktree = null;

    for (let iteration = 1; iteration <= limitIterations; iteration += 1) {
      if (Date.now() >= deadlineAt) {
        outcome.status = 'RESOURCE_EXHAUSTED';
        outcome.failure = { reason: 'max_wall_clock_ms' };
        break;
      }
      const iterationId = `${runId}-i${String(iteration).padStart(2, '0')}`;
      const parentSha = activeSha;
      worktree = path.join(runTempRoot, iterationId);
      await createWorktree(root, parentSha, worktree);
      const gitMetadata = await worktreeMetadataSnapshot(worktree);
      const artifactDirectory = path.join(worktree, '.evofence-out');
      await mkdir(artifactDirectory, { recursive: false });
      const taskFile = path.join(worktree, '.evofence-task.md');
      const proposalTask = taskContents({ goal, iteration, baseSha: parentSha, contract, previousFailure: outcome.previous_failure_packet, phase: 'proposal' });
      await writeNewFile(taskFile, proposalTask);
      ledger.append('prompt.prepared', runId, { iteration, phase: 'proposal', task_sha256: sha256(proposalTask) });

      onProgress({ type: 'candidate.proposal.start', iteration, adapter });
      const proposalResult = await invokeAdapter({ adapter, config, worktree, phase: 'proposal', timeoutMs: Math.max(1, deadlineAt - Date.now()), contract, allowUnisolatedOpenCode }, adapterRunner);
      ledger.append('adapter.finished', runId, adapterEvent(proposalResult, adapter, 'proposal', iteration));
      if (!await worktreeMetadataMatches(worktree, gitMetadata)) {
        await restoreWorktreeMetadata(worktree, gitMetadata);
        const failure = { reason: 'WORKTREE_METADATA_CHANGED' };
        ledger.append('gate.decision', runId, { iteration, decision: 'QUARANTINE', failure });
        outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
        outcome.status = 'QUARANTINE';
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        break;
      }
      const policyAfterProposal = await currentPolicyHashes(root);
      if (stableStringify(policyAfterProposal) !== stableStringify(initialHashes)) {
        const failure = { reason: 'POLICY_CHANGED_DURING_PROPOSAL' };
        ledger.append('gate.decision', runId, { iteration, decision: 'QUARANTINE', failure });
        outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
        outcome.status = 'QUARANTINE';
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        break;
      }
      const phaseOnePaths = (await changedPaths(worktree, parentSha)).filter((filename) => !helperPath(filename));
      if (proposalResult.code !== 0 || proposalResult.timed_out || phaseOnePaths.length) {
        const failure = { reason: proposalResult.timed_out ? 'AGENT_TIMEOUT' : proposalResult.code !== 0 ? 'AGENT_CRASH' : 'PREMATURE_PROJECT_CHANGE', paths: phaseOnePaths };
        ledger.append('candidate.rejected', runId, { iteration, base_sha: parentSha, failure });
        outcome.iterations.push({ iteration, decision: 'REJECT', failure });
        failureCount += 1;
        noImprovementCount += 1;
        outcome.previous_failure_packet = publicFailurePacket('REJECT', failure);
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        if (failureCount >= contract.budgets.max_failed_candidates || noImprovementCount >= contract.budgets.max_consecutive_no_improvement) break;
        continue;
      }

      const proposalFile = path.join(artifactDirectory, 'proposal.json');
      let proposal;
      try {
        proposal = checkProposal(await readJsonInside(worktree, proposalFile));
        invariant(proposal.iteration === iteration && proposal.base_sha === parentSha, 'STALE_PROPOSAL', 'proposal iteration/base_sha does not match the current candidate.');
      } catch (error) {
        const failure = { reason: error.code ?? 'INVALID_PROPOSAL', message: error.message };
        ledger.append('candidate.rejected', runId, { iteration, base_sha: parentSha, failure });
        outcome.iterations.push({ iteration, decision: 'REJECT', failure });
        failureCount += 1;
        noImprovementCount += 1;
        outcome.previous_failure_packet = publicFailurePacket('REJECT', failure);
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        if (failureCount >= contract.budgets.max_failed_candidates || noImprovementCount >= contract.budgets.max_consecutive_no_improvement) break;
        continue;
      }

      const proposalDigest = sha256(stableStringify(proposal));
      const expectedDirection = contract.objective.direction === 'maximize' ? 'increase' : 'decrease';
      if (proposal.expected_effect.primary_metric !== contract.objective.name || proposal.expected_effect.direction !== expectedDirection) {
        const failure = { reason: 'PROPOSAL_OBJECTIVE_MISMATCH', expected_metric: contract.objective.name, expected_direction: expectedDirection };
        ledger.append('candidate.rejected', runId, { iteration, base_sha: parentSha, failure, proposal_sha256: proposalDigest });
        outcome.iterations.push({ iteration, decision: 'REJECT', failure });
        failureCount += 1;
        noImprovementCount += 1;
        outcome.previous_failure_packet = publicFailurePacket('REJECT', failure);
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        if (failureCount >= contract.budgets.max_failed_candidates || noImprovementCount >= contract.budgets.max_consecutive_no_improvement) break;
        continue;
      }
      ledger.append('proposal.created', runId, { proposal_id: `${runId}-i${iteration}`, iteration, base_sha: parentSha, proposal_sha256: proposalDigest, proposal, hypothesis: proposal.hypothesis, changed_surface: proposal.changed_surface, requested_capabilities: proposal.requested_capabilities });
      const capabilityReview = assessCapabilities(proposal, contract);
      if (!capabilityReview.allowed) {
        ledger.append('capability.denied', runId, { iteration, requests: capabilityReview.requests });
        ledger.append('gate.decision', runId, { iteration, decision: 'ESCALATE', reason: 'CAPABILITY_DENIED' });
        outcome.iterations.push({ iteration, decision: 'ESCALATE', reason: 'CAPABILITY_DENIED', requests: capabilityReview.requests });
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        outcome.status = 'ESCALATE';
        break;
      }

      const taskInfo = await (await import('node:fs/promises')).lstat(taskFile);
      invariant(taskInfo.isFile() && !taskInfo.isSymbolicLink(), 'UNSAFE_ARTIFACT', 'Candidate replaced the controller task file.');
      const implementationTask = taskContents({ goal, iteration, baseSha: parentSha, contract, previousFailure: outcome.previous_failure_packet, phase: 'implementation' });
      await writeFile(taskFile, implementationTask, { flag: 'w' });
      ledger.append('prompt.prepared', runId, { iteration, phase: 'implementation', task_sha256: sha256(implementationTask) });
      onProgress({ type: 'candidate.implementation.start', iteration, adapter });
      const implementationResult = await invokeAdapter({ adapter, config, worktree, phase: 'implementation', timeoutMs: Math.max(1, deadlineAt - Date.now()), contract, allowUnisolatedOpenCode }, adapterRunner);
      ledger.append('adapter.finished', runId, adapterEvent(implementationResult, adapter, 'implementation', iteration));
      if (!await worktreeMetadataMatches(worktree, gitMetadata)) {
        await restoreWorktreeMetadata(worktree, gitMetadata);
        const failure = { reason: 'WORKTREE_METADATA_CHANGED' };
        ledger.append('gate.decision', runId, { iteration, decision: 'QUARANTINE', failure });
        outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
        outcome.status = 'QUARANTINE';
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        break;
      }

      const policyNow = await currentPolicyHashes(root);
      if (stableStringify(policyNow) !== stableStringify(initialHashes)) {
        const failure = { reason: 'POLICY_CHANGED_DURING_RUN' };
        ledger.append('gate.decision', runId, { iteration, decision: 'QUARANTINE', failure });
        outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
        outcome.status = 'QUARANTINE';
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        break;
      }

      let claims;
      try {
        claims = checkClaims(await readJsonInside(worktree, path.join(artifactDirectory, 'claims.json')));
        const finalProposal = checkProposal(await readJsonInside(worktree, proposalFile));
        invariant(sha256(stableStringify(finalProposal)) === proposalDigest, 'PROPOSAL_TAMPERING', 'The proposal changed after implementation began.');
      } catch (error) {
        const failure = { reason: error.code ?? 'INVALID_CLAIMS', message: error.message };
        ledger.append('candidate.rejected', runId, { iteration, base_sha: parentSha, failure });
        outcome.iterations.push({ iteration, decision: 'REJECT', failure });
        failureCount += 1;
        noImprovementCount += 1;
        outcome.previous_failure_packet = publicFailurePacket('REJECT', failure);
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        if (failureCount >= contract.budgets.max_failed_candidates || noImprovementCount >= contract.budgets.max_consecutive_no_improvement) break;
        continue;
      }

      ledger.append('claims.created', runId, { iteration, claims_sha256: sha256(stableStringify(claims)), claims });

      if (implementationResult.code !== 0 || implementationResult.timed_out) {
        const failure = { reason: implementationResult.timed_out ? 'AGENT_TIMEOUT' : 'AGENT_CRASH', exit_code: implementationResult.code };
        ledger.append('candidate.rejected', runId, { iteration, base_sha: parentSha, failure });
        outcome.iterations.push({ iteration, decision: 'REJECT', failure });
        failureCount += 1;
        noImprovementCount += 1;
        outcome.previous_failure_packet = publicFailurePacket('REJECT', failure);
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        if (failureCount >= contract.budgets.max_failed_candidates || noImprovementCount >= contract.budgets.max_consecutive_no_improvement) break;
        continue;
      }

      if (claims.status !== 'CANDIDATE_READY') {
        const decision = claims.status === 'BLOCKED' ? 'QUARANTINE' : 'REJECT';
        const failure = { reason: claims.status === 'NO_CHANGE' ? 'NO_CHANGE' : claims.status };
        ledger.append('gate.decision', runId, { iteration, decision, failure });
        outcome.iterations.push({ iteration, decision, failure });
        if (decision === 'QUARANTINE') outcome.status = decision;
        failureCount += 1;
        noImprovementCount += 1;
        outcome.previous_failure_packet = publicFailurePacket(decision, failure);
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        if (outcome.status === 'QUARANTINE' || failureCount >= contract.budgets.max_failed_candidates || noImprovementCount >= contract.budgets.max_consecutive_no_improvement) break;
        continue;
      }

      let actualPaths = (await changedPaths(worktree, parentSha)).filter((filename) => !helperPath(filename));
      const diffCheck = checkTaskFile(contract, actualPaths, proposal, claims);
      if (!diffCheck.accepted) {
        const decision = diffCheck.code === 'CAPABILITY_VIOLATION' ? 'ESCALATE' : diffCheck.code === 'POLICY_VIOLATION' ? 'QUARANTINE' : 'REJECT';
        const failure = { ...diffCheck };
        ledger.append('gate.decision', runId, { iteration, decision, failure });
        outcome.iterations.push({ iteration, decision, failure });
        if (decision === 'ESCALATE' || decision === 'QUARANTINE') outcome.status = decision;
        failureCount += 1;
        noImprovementCount += 1;
        outcome.previous_failure_packet = publicFailurePacket(decision, failure);
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        if (decision === 'ESCALATE' || decision === 'QUARANTINE' || failureCount >= contract.budgets.max_failed_candidates || noImprovementCount >= contract.budgets.max_consecutive_no_improvement) break;
        continue;
      }

      const candidateDiffBeforeEvidence = await diffHash(worktree, parentSha);
      const candidateEvidence = await collectEvidence({ root: worktree, artifactRoot: path.join(root, '.evofence'), contract, holdout, runId, iteration, deadlineAt, phase: 'candidate', onProgress });
      ledger.append('evidence.candidate', runId, { iteration, base_sha: parentSha, evidence: candidateEvidence });
      if (candidateEvidence.objective?.score === undefined) candidateEvidence.objective = null;

      actualPaths = (await changedPaths(worktree, parentSha)).filter((filename) => !helperPath(filename));
      const candidateDiffAfterEvidence = await diffHash(worktree, parentSha);
      const finalFileCheck = checkFinalCandidate(contract, actualPaths, proposal, claims, candidateDiffBeforeEvidence, candidateDiffAfterEvidence);
      if (!finalFileCheck.accepted) {
        const decision = finalFileCheck.code === 'CAPABILITY_VIOLATION' ? 'ESCALATE'
          : finalFileCheck.code === 'POLICY_VIOLATION' || finalFileCheck.code === 'EVIDENCE_MODIFIED_CANDIDATE' ? 'QUARANTINE'
            : 'REJECT';
        const failure = { ...finalFileCheck };
        ledger.append('gate.decision', runId, { iteration, decision, failure, base_sha: parentSha });
        outcome.iterations.push({ iteration, decision, failure });
        if (decision === 'ESCALATE' || decision === 'QUARANTINE') outcome.status = decision;
        failureCount += 1;
        noImprovementCount += 1;
        outcome.previous_failure_packet = publicFailurePacket(decision, failure);
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        if (decision === 'ESCALATE' || decision === 'QUARANTINE' || failureCount >= contract.budgets.max_failed_candidates || noImprovementCount >= contract.budgets.max_consecutive_no_improvement) break;
        continue;
      }

      const risk = assessRisk(actualPaths, proposal, contract);
      const candidateScore = candidateEvidence.objective?.score;
      const improvement = Number.isFinite(candidateScore)
        ? (contract.objective.direction === 'maximize' ? candidateScore - baselineScore : baselineScore - candidateScore)
        : null;
      const evidenceOk = candidateEvidence.all_public_passed
        && candidateEvidence.all_private_within_tolerance
        && candidateEvidence.objective?.valid_score
        && improvement !== null
        && improvement >= contract.objective.min_delta;
      const gateResult = !candidateEvidence.all_public_passed
        ? { decision: 'REJECT', reason: 'PUBLIC_TEST_FAILURE' }
        : !candidateEvidence.all_private_within_tolerance
          ? { decision: 'REJECT', reason: 'HIDDEN_REGRESSION', private_regressions: true }
          : !candidateEvidence.objective?.valid_score
            ? { decision: 'QUARANTINE', reason: 'OBJECTIVE_SCORE_INVALID' }
            : improvement < contract.objective.min_delta
              ? { decision: 'REJECT', reason: 'NO_PRACTICAL_IMPROVEMENT', improvement, min_delta: contract.objective.min_delta }
              : risk.band === 'CRITICAL'
                ? { decision: 'QUARANTINE', reason: 'CRITICAL_CHANGE_RISK', risk }
                : risk.band === 'HIGH'
                  ? { decision: 'ESCALATE', reason: 'HIGH_CHANGE_RISK', risk }
                  : { decision: 'ACCEPT', reason: 'ALL_REQUIRED_EVIDENCE_PASSED', risk, improvement };

      const policyAfterEvidence = await currentPolicyHashes(root);
      if (stableStringify(policyAfterEvidence) !== stableStringify(initialHashes)) {
        gateResult.decision = 'QUARANTINE';
        gateResult.reason = 'POLICY_CHANGED_DURING_EVALUATION';
      }
      ledger.append('gate.decision', runId, { iteration, ...gateResult, evidence_ok: evidenceOk, base_sha: parentSha });

      if (gateResult.decision !== 'ACCEPT') {
        outcome.iterations.push({ iteration, ...gateResult });
        if (gateResult.decision === 'ESCALATE' || gateResult.decision === 'QUARANTINE') outcome.status = gateResult.decision;
        failureCount += 1;
        noImprovementCount += 1;
        outcome.previous_failure_packet = publicFailurePacket(gateResult.decision, gateResult);
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        if (outcome.status === 'ESCALATE' || outcome.status === 'QUARANTINE' || failureCount >= contract.budgets.max_failed_candidates || noImprovementCount >= contract.budgets.max_consecutive_no_improvement) break;
        continue;
      }

      const generationId = `g-${iterationId}`;
      const preCommitPaths = (await changedPaths(worktree, parentSha)).filter((filename) => !helperPath(filename));
      const preCommitDiffHash = await diffHash(worktree, parentSha);
      const preCommitCheck = checkFinalCandidate(contract, preCommitPaths, proposal, claims, candidateDiffAfterEvidence, preCommitDiffHash);
      if (!preCommitCheck.accepted) {
        const failure = { reason: 'PRECOMMIT_VALIDATION_FAILED', ...preCommitCheck };
        ledger.append('gate.decision', runId, { iteration, decision: 'QUARANTINE', failure, base_sha: parentSha });
        outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
        outcome.status = 'QUARANTINE';
        outcome.previous_failure_packet = publicFailurePacket('QUARANTINE', failure);
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        break;
      }

      const acceptedSha = await commitCandidate(worktree, parentSha, generationId);
      const finalDiffHash = await diffHash(worktree, parentSha, acceptedSha);
      const committedPaths = (await changedPathsBetween(worktree, parentSha, acceptedSha)).filter((filename) => !helperPath(filename));
      const committedFileCheck = checkTaskFile(contract, committedPaths, proposal, claims);
      if (!committedFileCheck.accepted || finalDiffHash !== preCommitDiffHash) {
        const failure = {
          reason: 'COMMITTED_CANDIDATE_MISMATCH',
          ...(committedFileCheck.accepted ? {} : committedFileCheck),
          pre_commit_diff_sha256: preCommitDiffHash,
          committed_diff_sha256: finalDiffHash,
        };
        ledger.append('gate.decision', runId, { iteration, decision: 'QUARANTINE', failure, base_sha: parentSha });
        outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
        outcome.status = 'QUARANTINE';
        outcome.previous_failure_packet = publicFailurePacket('QUARANTINE', failure);
        await removeCandidate(root, worktree, runTempRoot);
        worktree = null;
        break;
      }

      await pinGeneration(root, generationId, acceptedSha);
      ledger.recordGeneration({ generation_id: generationId, run_id: runId, sha: acceptedSha, parent_sha: parentSha, created_at: new Date().toISOString() });
      const record = { generation_id: generationId, sha: acceptedSha, parent_sha: parentSha, diff_sha256: finalDiffHash, objective_score: candidateScore, improvement };
      ledger.append('candidate.accepted', runId, { iteration, ...record, evidence_artifact: candidateEvidence.artifact, proposal_sha256: proposalDigest });
      activeGeneration = ledger.activeGeneration();
      activeSha = acceptedSha;
      baselineScore = candidateScore;
      noImprovementCount = 0;
      outcome.iterations.push({ iteration, decision: 'ACCEPT', ...record });
      outcome.active_generation = activeGeneration;
      onProgress({ type: 'candidate.accepted', iteration, generation_id: generationId, sha: acceptedSha, improvement });
      await removeCandidate(root, worktree, runTempRoot);
      worktree = null;
    }

    if (outcome.status === 'RUNNING') outcome.status = outcome.iterations.some((item) => item.decision === 'ACCEPT') ? 'ACCEPTED' : 'PLATEAU';
    outcome.duration_ms = Date.now() - runStartedAt;
    outcome.active_generation = ledger.activeGeneration();
    ledger.append('run.finished', runId, { status: outcome.status, iterations: outcome.iterations.length, active_generation: outcome.active_generation?.generation_id ?? null, duration_ms: outcome.duration_ms });
    return outcome;
  } catch (error) {
    outcome.status = error.code === 'RESOURCE_EXHAUSTED' ? 'RESOURCE_EXHAUSTED' : 'HARNESS_ERROR';
    outcome.failure = { code: error.code ?? 'UNKNOWN', message: error.message };
    ledger.append('run.failed', runId, outcome.failure);
    throw error;
  } finally {
    if (worktree) await removeCandidate(root, worktree, runTempRoot).catch(() => {});
    assertInside(tempParent, runTempRoot);
    await rm(runTempRoot, { recursive: true, force: true }).catch(() => {});
    ledger.close();
  }
}
