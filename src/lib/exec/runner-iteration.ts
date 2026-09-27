/**
 * Exec domain · one iteration's proposal + implementation stage.
 *
 * This is a behavior-preserving transplant of the first half of the 0.3.0 `runEvolution` loop
 * body (worktree setup → proposal adapter → implementation adapter → claims). The loop's
 * `break` / `continue` control flow became `return true` / `return false`, and the loop-carried
 * variables now live on {@link RunContext} / {@link RunState}. Nothing else changed order.
 */
/* Ledger payloads and failure packets are dynamic by construction. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJsonInside, sha256, stableStringify, writeNewFile } from '../fs.js';
import { invariant } from './errors.js';
import { checkClaims, checkProposal } from '../policy.js';
import { assessCapabilities } from '../policy.js';
import { changedPaths, createWorktree, restoreWorktreeMetadata, worktreeMetadataMatches, worktreeMetadataSnapshot } from '../git.js';
import { currentPolicyHashes, helperPath } from './runner-events.js';
import { publicFailurePacket, taskContents } from './runner-task.js';
import { removeCandidate } from './runner-candidate.js';
import { runBudgetedAdapter } from './runner-budgeted.js';
import { evaluateCandidate } from './runner-evaluate.js';
import type { RunContext } from './runner-context.js';
import type { Claims, Proposal } from '../../types/index.js';

export async function runIteration(ctx: RunContext, iteration: number): Promise<boolean> {
  const { state, outcome } = ctx;
  const countsReached = () => state.failureCount >= ctx.contract.budgets.max_failed_candidates
    || state.noImprovementCount >= ctx.contract.budgets.max_consecutive_no_improvement;
  const cleanup = async () => {
    await removeCandidate(ctx.root, worktree, ctx.runTempRoot);
    state.worktree = null;
  };
  /** Shared tail of the five plain-REJECT paths (identical in 0.3.0). */
  const rejectCandidate = async (kind: string, payload: any, failure: any): Promise<boolean> => {
    ctx.ledger.append(kind, ctx.runId, payload);
    outcome.iterations.push({ iteration, decision: 'REJECT', failure });
    state.failureCount += 1;
    state.noImprovementCount += 1;
    outcome.previous_failure_packet = publicFailurePacket('REJECT', failure);
    await cleanup();
    return countsReached();
  };

  const iterationId = `${ctx.runId}-i${String(iteration).padStart(2, '0')}`;
  const parentSha = state.activeSha;
  const worktree = path.join(ctx.runTempRoot, iterationId);
  state.worktree = worktree;
  await createWorktree(ctx.root, parentSha, worktree);
  const gitMetadata = await worktreeMetadataSnapshot(worktree);
  const artifactDirectory = path.join(worktree, '.evofence-out');
  await mkdir(artifactDirectory, { recursive: false });
  const taskFile = path.join(worktree, '.evofence-task.md');
  const proposalTask = taskContents({ goal: ctx.goal, iteration, baseSha: parentSha, contract: ctx.contract, previousFailure: outcome.previous_failure_packet, phase: 'proposal' });
  await writeNewFile(taskFile, proposalTask);
  ctx.ledger.append('prompt.prepared', ctx.runId, { iteration, phase: 'proposal', task_sha256: sha256(proposalTask) });

  ctx.onProgress({ type: 'candidate.proposal.start', iteration, adapter: ctx.adapter });
  const proposalResult = await runBudgetedAdapter(ctx, { iteration, phase: 'proposal', worktree, timeoutMs: Math.max(1, ctx.deadlineAt - Date.now()), contract: ctx.contract, allowUnisolatedAgent: ctx.allowUnisolatedAgent });
  if (!await worktreeMetadataMatches(worktree, gitMetadata)) {
    await restoreWorktreeMetadata(worktree, gitMetadata);
    const failure = { reason: 'WORKTREE_METADATA_CHANGED' };
    ctx.ledger.append('gate.decision', ctx.runId, { iteration, decision: 'QUARANTINE', failure });
    outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
    outcome.status = 'QUARANTINE';
    await cleanup();
    return true;
  }
  const policyAfterProposal = await currentPolicyHashes(ctx.root);
  if (stableStringify(policyAfterProposal) !== stableStringify(ctx.initialHashes)) {
    const failure = { reason: 'POLICY_CHANGED_DURING_PROPOSAL' };
    ctx.ledger.append('gate.decision', ctx.runId, { iteration, decision: 'QUARANTINE', failure });
    outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
    outcome.status = 'QUARANTINE';
    await cleanup();
    return true;
  }
  const phaseOnePaths = (await changedPaths(worktree, parentSha)).filter((filename) => !helperPath(filename));
  if (proposalResult.code !== 0 || proposalResult.timed_out || phaseOnePaths.length) {
    const failure = { reason: proposalResult.timed_out ? 'AGENT_TIMEOUT' : proposalResult.code !== 0 ? 'AGENT_CRASH' : 'PREMATURE_PROJECT_CHANGE', paths: phaseOnePaths };
    if (await rejectCandidate('candidate.rejected', { iteration, base_sha: parentSha, failure }, failure)) return true;
    return false;
  }

  const proposalFile = path.join(artifactDirectory, 'proposal.json');
  let proposal: Proposal;
  try {
    proposal = checkProposal(await readJsonInside(worktree, proposalFile));
    invariant(proposal.iteration === iteration && proposal.base_sha === parentSha, 'STALE_PROPOSAL', 'proposal iteration/base_sha does not match the current candidate.');
  } catch (error) {
    const failure = { reason: (error as any).code ?? 'INVALID_PROPOSAL', message: (error as Error).message };
    if (await rejectCandidate('candidate.rejected', { iteration, base_sha: parentSha, failure }, failure)) return true;
    return false;
  }

  const proposalDigest = sha256(stableStringify(proposal));
  const expectedDirection = ctx.contract.objective.direction === 'maximize' ? 'increase' : 'decrease';
  if (proposal.expected_effect.primary_metric !== ctx.contract.objective.name || proposal.expected_effect.direction !== expectedDirection) {
    const failure = { reason: 'PROPOSAL_OBJECTIVE_MISMATCH', expected_metric: ctx.contract.objective.name, expected_direction: expectedDirection };
    if (await rejectCandidate('candidate.rejected', { iteration, base_sha: parentSha, failure, proposal_sha256: proposalDigest }, failure)) return true;
    return false;
  }
  ctx.ledger.append('proposal.created', ctx.runId, { proposal_id: `${ctx.runId}-i${iteration}`, iteration, base_sha: parentSha, proposal_sha256: proposalDigest, proposal, hypothesis: proposal.hypothesis, changed_surface: proposal.changed_surface, requested_capabilities: proposal.requested_capabilities });
  const capabilityReview = assessCapabilities(proposal, ctx.contract);
  if (!capabilityReview.allowed) {
    ctx.ledger.append('capability.denied', ctx.runId, { iteration, requests: capabilityReview.requests });
    ctx.ledger.append('gate.decision', ctx.runId, { iteration, decision: 'ESCALATE', reason: 'CAPABILITY_DENIED' });
    outcome.iterations.push({ iteration, decision: 'ESCALATE', reason: 'CAPABILITY_DENIED', requests: capabilityReview.requests });
    await cleanup();
    outcome.status = 'ESCALATE';
    return true;
  }

  const taskInfo = await lstat(taskFile);
  invariant(taskInfo.isFile() && !taskInfo.isSymbolicLink(), 'UNSAFE_ARTIFACT', 'Candidate replaced the controller task file.');
  const implementationTask = taskContents({ goal: ctx.goal, iteration, baseSha: parentSha, contract: ctx.contract, previousFailure: outcome.previous_failure_packet, phase: 'implementation' });
  await writeFile(taskFile, implementationTask, { flag: 'w' });
  ctx.ledger.append('prompt.prepared', ctx.runId, { iteration, phase: 'implementation', task_sha256: sha256(implementationTask) });
  ctx.onProgress({ type: 'candidate.implementation.start', iteration, adapter: ctx.adapter });
  const implementationResult = await runBudgetedAdapter(ctx, { iteration, phase: 'implementation', worktree, timeoutMs: Math.max(1, ctx.deadlineAt - Date.now()), contract: ctx.contract, allowUnisolatedAgent: ctx.allowUnisolatedAgent });
  if (!await worktreeMetadataMatches(worktree, gitMetadata)) {
    await restoreWorktreeMetadata(worktree, gitMetadata);
    const failure = { reason: 'WORKTREE_METADATA_CHANGED' };
    ctx.ledger.append('gate.decision', ctx.runId, { iteration, decision: 'QUARANTINE', failure });
    outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
    outcome.status = 'QUARANTINE';
    await cleanup();
    return true;
  }

  const policyNow = await currentPolicyHashes(ctx.root);
  if (stableStringify(policyNow) !== stableStringify(ctx.initialHashes)) {
    const failure = { reason: 'POLICY_CHANGED_DURING_RUN' };
    ctx.ledger.append('gate.decision', ctx.runId, { iteration, decision: 'QUARANTINE', failure });
    outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
    outcome.status = 'QUARANTINE';
    await cleanup();
    return true;
  }

  let claims: Claims;
  try {
    claims = checkClaims(await readJsonInside(worktree, path.join(artifactDirectory, 'claims.json')));
    const finalProposal = checkProposal(await readJsonInside(worktree, proposalFile));
    invariant(sha256(stableStringify(finalProposal)) === proposalDigest, 'PROPOSAL_TAMPERING', 'The proposal changed after implementation began.');
  } catch (error) {
    const failure = { reason: (error as any).code ?? 'INVALID_CLAIMS', message: (error as Error).message };
    if (await rejectCandidate('candidate.rejected', { iteration, base_sha: parentSha, failure }, failure)) return true;
    return false;
  }

  ctx.ledger.append('claims.created', ctx.runId, { iteration, claims_sha256: sha256(stableStringify(claims)), claims });

  if (implementationResult.code !== 0 || implementationResult.timed_out) {
    const failure = { reason: implementationResult.timed_out ? 'AGENT_TIMEOUT' : 'AGENT_CRASH', exit_code: implementationResult.code };
    if (await rejectCandidate('candidate.rejected', { iteration, base_sha: parentSha, failure }, failure)) return true;
    return false;
  }

  if (claims.status !== 'CANDIDATE_READY') {
    const decision = claims.status === 'BLOCKED' ? 'QUARANTINE' : 'REJECT';
    const failure = { reason: claims.status === 'NO_CHANGE' ? 'NO_CHANGE' : claims.status };
    ctx.ledger.append('gate.decision', ctx.runId, { iteration, decision, failure });
    outcome.iterations.push({ iteration, decision, failure });
    if (decision === 'QUARANTINE') outcome.status = decision;
    state.failureCount += 1;
    state.noImprovementCount += 1;
    outcome.previous_failure_packet = publicFailurePacket(decision, failure);
    await cleanup();
    if (outcome.status === 'QUARANTINE' || countsReached()) return true;
    return false;
  }

  return evaluateCandidate(ctx, { iteration, parentSha, iterationId, proposal, proposalDigest, claims });
}
