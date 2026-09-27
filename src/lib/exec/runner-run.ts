/**
 * Exec domain · `runEvolution` orchestration.
 *
 * 0.3.0's `runEvolution` was one 490-line function with a `try` / `catch` / `finally`. This
 * module keeps only the skeleton: baseline → iteration loop → finish, the error-code folding in
 * `catch`, and the teardown in `finally`. The phases themselves live in `runner-baseline.ts`,
 * `runner-iteration.ts` and `runner-evaluate.ts`.
 *
 * `finally` now also releases the shared `<TMPDIR>/evofence-worktrees/<repoId>` parent when it
 * is empty, so a run no longer leaks an empty directory (0.3.0 leaked one per run; the parent
 * removal is empty-only so a concurrent sibling run is never disturbed).
 */
/* Error details from the budget helpers are dynamic. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { rm } from 'node:fs/promises';
import { assertInside } from '../fs.js';
import { removeCandidate } from './runner-candidate.js';
import { prepareRun } from './runner-preflight.js';
import { runBaseline } from './runner-baseline.js';
import { runIteration } from './runner-iteration.js';
import { runCostFields } from './runner-budgeted.js';
import { cleanupEmptyWorktreeTempParent } from './worktree-temp.js';
import { usdFromMicros } from './budget.js';
import type { RunEvolutionOptions, RunOutcome } from '../../types/index.js';

export async function runEvolution(options: RunEvolutionOptions): Promise<RunOutcome> {
  const ctx = await prepareRun(options);
  const { state, outcome, ledger } = ctx;
  try {
    if (await runBaseline(ctx)) return outcome;

    for (let iteration = 1; iteration <= ctx.limitIterations; iteration += 1) {
      if (Date.now() >= ctx.deadlineAt) {
        outcome.status = 'RESOURCE_EXHAUSTED';
        outcome.failure = { reason: 'max_wall_clock_ms' };
        break;
      }
      if (await runIteration(ctx, iteration)) break;
    }

    if (outcome.status === 'RUNNING') outcome.status = outcome.iterations.some((item) => item.decision === 'ACCEPT') ? 'ACCEPTED' : 'PLATEAU';
    outcome.duration_ms = Date.now() - ctx.runStartedAt;
    outcome.active_generation = ledger.activeGeneration();
    ledger.append('run.finished', ctx.runId, { status: outcome.status, iterations: outcome.iterations.length, active_generation: outcome.active_generation?.generation_id ?? null, duration_ms: outcome.duration_ms, token_usage_total: ctx.tokenLimit === null ? null : state.observedTokens, ...runCostFields(ctx) });
    return outcome;
  } catch (error) {
    const failureError = error as { code?: string; message?: string; details?: any };
    outcome.status = ['RESOURCE_EXHAUSTED', 'TOKEN_USAGE_UNAVAILABLE', 'USD_USAGE_UNAVAILABLE', 'PROCESS_TREE_TERMINATION_FAILED'].includes(failureError.code as string) ? 'RESOURCE_EXHAUSTED' : 'HARNESS_ERROR';
    outcome.failure = { code: failureError.code ?? 'UNKNOWN', message: failureError.message };
    if (Number.isSafeInteger(failureError.details?.observed_total)) {
      state.observedTokens = failureError.details.observed_total;
      outcome.token_usage_total = state.observedTokens;
    }
    if (Number.isSafeInteger(failureError.details?.observed_total_usd_micros)) {
      state.observedCostMicros = failureError.details.observed_total_usd_micros;
    }
    if (failureError.details?.cost_usage_unknown === true) state.costTotalUnknown = true;
    outcome.cost_estimate_total_usd = ctx.costLimitMicros === null || state.costTotalUnknown ? null : usdFromMicros(state.observedCostMicros);
    const tokenTotalUnknown = ['agent_timeout', 'process_tree_termination_failed'].includes(failureError.details?.reason as string)
      && !Number.isSafeInteger(failureError.details?.observed_total);
    ledger.append('run.failed', ctx.runId, { ...outcome.failure, token_usage_total: ctx.tokenLimit === null || tokenTotalUnknown ? null : state.observedTokens, token_budget: ctx.tokenLimit, ...runCostFields(ctx) });
    throw error;
  } finally {
    if (state.worktree) await removeCandidate(ctx.root, state.worktree, ctx.runTempRoot).catch(() => {});
    assertInside(ctx.tempParent, ctx.runTempRoot);
    await rm(ctx.runTempRoot, { recursive: true, force: true }).catch(() => {});
    // DoD (l2_exec): release the shared per-repo temp parent once it is empty. `rmdir`-style
    // removal only succeeds on an empty directory, so a concurrent run under the same parent
    // keeps it alive.
    await cleanupEmptyWorktreeTempParent(ctx.tempParent);
    ledger.close();
  }
}
