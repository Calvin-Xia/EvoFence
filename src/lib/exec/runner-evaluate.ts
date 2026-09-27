/**
 * Exec domain · one iteration's evaluation + accept stage.
 *
 * Behavior-preserving transplant of the second half of the 0.3.0 `runEvolution` loop body:
 * candidate diff check → evidence → risk/verdict → policy re-check → pre-commit re-check →
 * commit + pin + `candidate.accepted`. The loop's `break` / `continue` became `return true` /
 * `return false`; ordering, payloads and error codes are unchanged.
 */
/* Evidence bundles, risk assessments and gate verdicts are dynamic ledger payloads. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { sha256, stableStringify } from '../fs.js';
import path from 'node:path';
import { collectEvidence } from '../evidence.js';
import { assessRisk } from '../policy.js';
import { changedPaths, changedPathsBetween, commitCandidate, diffHash, pinGeneration } from '../git.js';
import { checkFinalCandidate, checkTaskFile } from './runner-candidate.js';
import { currentPolicyHashes, helperPath } from './runner-events.js';
import { publicFailurePacket } from './runner-task.js';
import { removeCandidate } from './runner-candidate.js';
import type { CandidateStage, RunContext } from './runner-context.js';

export async function evaluateCandidate(ctx: RunContext, stage: CandidateStage): Promise<boolean> {
  const { state, outcome } = ctx;
  const { iteration, parentSha, iterationId, proposal, proposalDigest, claims } = stage;
  const worktree = state.worktree as string;
  const countsReached = () => state.failureCount >= ctx.contract.budgets.max_failed_candidates
    || state.noImprovementCount >= ctx.contract.budgets.max_consecutive_no_improvement;
  const cleanup = async () => {
    await removeCandidate(ctx.root, worktree, ctx.runTempRoot);
    state.worktree = null;
  };

  let actualPaths = (await changedPaths(worktree, parentSha)).filter((filename) => !helperPath(filename));
  const diffCheck = checkTaskFile(ctx.contract, actualPaths, proposal, claims);
  if (!diffCheck.accepted) {
    const decision = diffCheck.code === 'CAPABILITY_VIOLATION' ? 'ESCALATE' : diffCheck.code === 'POLICY_VIOLATION' ? 'QUARANTINE' : 'REJECT';
    const failure: any = { ...diffCheck };
    ctx.ledger.append('gate.decision', ctx.runId, { iteration, decision, failure });
    outcome.iterations.push({ iteration, decision, failure });
    if (decision === 'ESCALATE' || decision === 'QUARANTINE') outcome.status = decision;
    state.failureCount += 1;
    state.noImprovementCount += 1;
    outcome.previous_failure_packet = publicFailurePacket(decision, failure);
    await cleanup();
    if (decision === 'ESCALATE' || decision === 'QUARANTINE' || countsReached()) return true;
    return false;
  }

  const candidateDiffBeforeEvidence = await diffHash(worktree, parentSha);
  const candidateEvidence: any = await collectEvidence({ root: worktree, artifactRoot: path.join(ctx.root, '.evofence'), contract: ctx.contract, holdout: ctx.holdout as any, runId: ctx.runId, iteration, deadlineAt: ctx.deadlineAt, phase: 'candidate', onProgress: ctx.onProgress as any });
  ctx.ledger.append('evidence.candidate', ctx.runId, { iteration, base_sha: parentSha, evidence: candidateEvidence });
  if (candidateEvidence.objective?.score === undefined) candidateEvidence.objective = null;

  actualPaths = (await changedPaths(worktree, parentSha)).filter((filename) => !helperPath(filename));
  const candidateDiffAfterEvidence = await diffHash(worktree, parentSha);
  const finalFileCheck = checkFinalCandidate(ctx.contract, actualPaths, proposal, claims, candidateDiffBeforeEvidence, candidateDiffAfterEvidence);
  if (!finalFileCheck.accepted) {
    const decision = finalFileCheck.code === 'CAPABILITY_VIOLATION' ? 'ESCALATE'
      : finalFileCheck.code === 'POLICY_VIOLATION' || finalFileCheck.code === 'EVIDENCE_MODIFIED_CANDIDATE' ? 'QUARANTINE'
        : 'REJECT';
    const failure: any = { ...finalFileCheck };
    ctx.ledger.append('gate.decision', ctx.runId, { iteration, decision, failure, base_sha: parentSha });
    outcome.iterations.push({ iteration, decision, failure });
    if (decision === 'ESCALATE' || decision === 'QUARANTINE') outcome.status = decision;
    state.failureCount += 1;
    state.noImprovementCount += 1;
    outcome.previous_failure_packet = publicFailurePacket(decision, failure);
    await cleanup();
    if (decision === 'ESCALATE' || decision === 'QUARANTINE' || countsReached()) return true;
    return false;
  }

  const risk: any = assessRisk(actualPaths, proposal, ctx.contract);
  const candidateScore = candidateEvidence.objective?.score as number | undefined;
  const improvement = Number.isFinite(candidateScore)
    ? (ctx.contract.objective.direction === 'maximize' ? (candidateScore as number) - (state.baselineScore as number) : (state.baselineScore as number) - (candidateScore as number))
    : null;
  const evidenceOk = candidateEvidence.all_public_passed
    && candidateEvidence.all_private_within_tolerance
    && candidateEvidence.objective?.valid_score
    && improvement !== null
    && improvement >= ctx.contract.objective.min_delta;
  const gateResult: any = !candidateEvidence.all_public_passed
    ? { decision: 'REJECT', reason: 'PUBLIC_TEST_FAILURE' }
    : !candidateEvidence.all_private_within_tolerance
      ? { decision: 'REJECT', reason: 'HIDDEN_REGRESSION', private_regressions: true }
      : !candidateEvidence.objective?.valid_score
        ? { decision: 'QUARANTINE', reason: 'OBJECTIVE_SCORE_INVALID' }
        : (improvement as number) < ctx.contract.objective.min_delta
          ? { decision: 'REJECT', reason: 'NO_PRACTICAL_IMPROVEMENT', improvement, min_delta: ctx.contract.objective.min_delta }
          : risk.band === 'CRITICAL'
            ? { decision: 'QUARANTINE', reason: 'CRITICAL_CHANGE_RISK', risk }
            : risk.band === 'HIGH'
              ? { decision: 'ESCALATE', reason: 'HIGH_CHANGE_RISK', risk }
              : { decision: 'ACCEPT', reason: 'ALL_REQUIRED_EVIDENCE_PASSED', risk, improvement };

  const policyAfterEvidence = await currentPolicyHashes(ctx.root);
  if (stableStringify(policyAfterEvidence) !== stableStringify(ctx.initialHashes)) {
    gateResult.decision = 'QUARANTINE';
    gateResult.reason = 'POLICY_CHANGED_DURING_EVALUATION';
  }
  ctx.ledger.append('gate.decision', ctx.runId, { iteration, ...gateResult, evidence_ok: evidenceOk, base_sha: parentSha });

  if (gateResult.decision !== 'ACCEPT') {
    outcome.iterations.push({ iteration, ...gateResult });
    if (gateResult.decision === 'ESCALATE' || gateResult.decision === 'QUARANTINE') outcome.status = gateResult.decision;
    state.failureCount += 1;
    state.noImprovementCount += 1;
    outcome.previous_failure_packet = publicFailurePacket(gateResult.decision, gateResult);
    await cleanup();
    if (outcome.status === 'ESCALATE' || outcome.status === 'QUARANTINE' || countsReached()) return true;
    return false;
  }

  const generationId = `g-${iterationId}`;
  const preCommitPaths = (await changedPaths(worktree, parentSha)).filter((filename) => !helperPath(filename));
  const preCommitDiffHash = await diffHash(worktree, parentSha);
  const preCommitCheck = checkFinalCandidate(ctx.contract, preCommitPaths, proposal, claims, candidateDiffAfterEvidence, preCommitDiffHash);
  if (!preCommitCheck.accepted) {
    const failure = { reason: 'PRECOMMIT_VALIDATION_FAILED', ...preCommitCheck };
    ctx.ledger.append('gate.decision', ctx.runId, { iteration, decision: 'QUARANTINE', failure, base_sha: parentSha });
    outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
    outcome.status = 'QUARANTINE';
    outcome.previous_failure_packet = publicFailurePacket('QUARANTINE', failure);
    await cleanup();
    return true;
  }

  const acceptedSha = await commitCandidate(worktree, parentSha, generationId);
  const finalDiffHash = await diffHash(worktree, parentSha, acceptedSha);
  const committedPaths = (await changedPathsBetween(worktree, parentSha, acceptedSha)).filter((filename) => !helperPath(filename));
  const committedFileCheck = checkTaskFile(ctx.contract, committedPaths, proposal, claims);
  if (!committedFileCheck.accepted || finalDiffHash !== preCommitDiffHash) {
    const failure = {
      reason: 'COMMITTED_CANDIDATE_MISMATCH',
      ...(committedFileCheck.accepted ? {} : committedFileCheck),
      pre_commit_diff_sha256: preCommitDiffHash,
      committed_diff_sha256: finalDiffHash,
    };
    ctx.ledger.append('gate.decision', ctx.runId, { iteration, decision: 'QUARANTINE', failure, base_sha: parentSha });
    outcome.iterations.push({ iteration, decision: 'QUARANTINE', failure });
    outcome.status = 'QUARANTINE';
    outcome.previous_failure_packet = publicFailurePacket('QUARANTINE', failure);
    await cleanup();
    return true;
  }

  await pinGeneration(ctx.root, generationId, acceptedSha);
  ctx.ledger.recordGeneration({ generation_id: generationId, run_id: ctx.runId, sha: acceptedSha, parent_sha: parentSha, created_at: new Date().toISOString() });
  const record = { generation_id: generationId, sha: acceptedSha, parent_sha: parentSha, diff_sha256: finalDiffHash, objective_score: candidateScore, improvement };
  ctx.ledger.append('candidate.accepted', ctx.runId, { iteration, ...record, evidence_artifact: candidateEvidence.artifact, proposal_sha256: proposalDigest });
  state.activeGeneration = ctx.ledger.activeGeneration();
  state.activeSha = acceptedSha;
  state.baselineScore = candidateScore as number;
  state.noImprovementCount = 0;
  outcome.iterations.push({ iteration, decision: 'ACCEPT', ...record } as any);
  outcome.active_generation = state.activeGeneration;
  ctx.onProgress({ type: 'candidate.accepted', iteration, generation_id: generationId, sha: acceptedSha, improvement });
  await cleanup();
  return false;
}
