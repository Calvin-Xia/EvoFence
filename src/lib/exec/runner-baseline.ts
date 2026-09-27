/**
 * Exec domain · baseline generation + baseline evidence phase.
 *
 * Behavior-preserving transplant of the 0.3.0 `runEvolution` baseline block. Returns `true`
 * when the run ended here (`BASELINE_UNHEALTHY`) so the caller returns the outcome, exactly as
 * the original `return outcome` did inside the `try`.
 */
/* Baseline evidence is a dynamic ledger payload. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'node:path';
import { sha256 } from '../fs.js';
import { collectEvidence } from '../evidence.js';
import { createWorktree, pinGeneration, setActiveGenerationRef } from '../git.js';
import { adapterAgent, adapterCommand, adapterModel } from '../adapter.js';
import { removeCandidate } from './runner-candidate.js';
import { runCostFields } from './runner-budgeted.js';
import type { RunContext } from './runner-context.js';

export async function runBaseline(ctx: RunContext): Promise<boolean> {
  const { state, outcome } = ctx;
  if (!state.activeGeneration) {
    const baselineGeneration = { generation_id: `g0-${state.activeSha.slice(0, 12)}`, run_id: ctx.runId, sha: state.activeSha, parent_sha: state.activeSha, created_at: new Date().toISOString() };
    await pinGeneration(ctx.root, baselineGeneration.generation_id, state.activeSha);
    ctx.ledger.recordGeneration(baselineGeneration);
    state.activeGeneration = ctx.ledger.activeGeneration();
  } else {
    await setActiveGenerationRef(ctx.root, state.activeGeneration.sha);
  }

  ctx.ledger.append('run.started', ctx.runId, {
    adapter: ctx.adapter,
    adapter_config: { command: adapterCommand(ctx.config, ctx.adapter), model: adapterModel(ctx.config, ctx.adapter), agent: adapterAgent(ctx.config, ctx.adapter) },
    base_sha: state.activeSha,
    goal_sha256: sha256(ctx.goal),
    requested_iterations: ctx.limitIterations,
    max_wall_clock_ms: ctx.wallClockLimit,
    contract_sha256: ctx.initialHashes.contract,
    contract_snapshot: ctx.contract,
    holdout_sha256: ctx.initialHashes.holdout,
    private_regression_count: ctx.holdout.length,
    private_holdout_host_readable: ctx.holdout.length > 0,
    token_budget: ctx.tokenLimit,
    cost_budget_usd: ctx.contract.budgets.max_usd,
    cost_budget_source: ctx.costLimitMicros === null ? null : 'claude-cli --max-budget-usd; result.total_cost_usd estimate',
  });
  ctx.onProgress({ type: 'run.started', run_id: ctx.runId, base_sha: state.activeSha, iterations: ctx.limitIterations });

  const worktree = path.join(ctx.runTempRoot, 'baseline');
  state.worktree = worktree;
  await createWorktree(ctx.root, state.activeSha, worktree);
  const baselineEvidence: any = await collectEvidence({ root: worktree, artifactRoot: path.join(ctx.root, '.evofence'), contract: ctx.contract, holdout: ctx.holdout as any, runId: ctx.runId, iteration: 0, deadlineAt: ctx.deadlineAt, phase: 'baseline', onProgress: ctx.onProgress as any });
  ctx.ledger.append('evidence.baseline', ctx.runId, baselineEvidence);
  if (!baselineEvidence.all_public_passed || !baselineEvidence.all_private_within_tolerance || !baselineEvidence.objective?.valid_score) {
    const details = { public_passed: baselineEvidence.all_public_passed, private_regressions: baselineEvidence.all_private_within_tolerance ? 0 : 'failed', objective_valid: baselineEvidence.objective?.valid_score ?? false };
    const decision = 'QUARANTINE';
    ctx.ledger.append('gate.decision', ctx.runId, { decision, reason: 'BASELINE_UNHEALTHY', details });
    outcome.status = 'BASELINE_UNHEALTHY';
    outcome.decision = decision;
    outcome.failure = details;
    outcome.duration_ms = Date.now() - ctx.runStartedAt;
    ctx.ledger.append('run.finished', ctx.runId, { status: outcome.status, decision, duration_ms: outcome.duration_ms, ...runCostFields(ctx) });
    return true;
  }
  state.baselineScore = baselineEvidence.objective.objective?.score ?? baselineEvidence.objective.score;
  if (!Number.isFinite(state.baselineScore)) {
    outcome.status = 'BASELINE_UNHEALTHY';
    outcome.decision = 'QUARANTINE';
    outcome.failure = { reason: 'BASELINE_OBJECTIVE_INVALID' };
    ctx.ledger.append('gate.decision', ctx.runId, { decision: 'QUARANTINE', reason: 'BASELINE_OBJECTIVE_INVALID' });
    outcome.duration_ms = Date.now() - ctx.runStartedAt;
    ctx.ledger.append('run.finished', ctx.runId, { status: outcome.status, decision: 'QUARANTINE', duration_ms: outcome.duration_ms, ...runCostFields(ctx) });
    return true;
  }
  await removeCandidate(ctx.root, worktree, ctx.runTempRoot);
  state.worktree = null;
  return false;
}
