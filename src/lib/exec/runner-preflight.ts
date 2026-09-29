/**
 * Exec domain · `runEvolution` pre-flight: gate refusals, budget ceilings, ledger and temp root
 * setup. Extracted verbatim from `src/lib/runner.js` (everything before its `try`).
 *
 * Every refusal here happens BEFORE any agent is dispatched, and in the same order as 0.3.0,
 * so the observed error codes are unchanged.
 */
import { loadPrivateHoldout } from '../contract.js';
// R1 fix F1: the run path reads contract.yaml/config.yaml through the same v2 validator that
// `init`/`status` use. `src/lib/contract.js::loadContract` (the 0.3.0 gate validator) accepted
// unknown fields, so `run` and `status` disagreed about the same file; adopting the required
// v2 loaders here is the L3 decision `src/lib/config/load.ts` had left open. Both loaders keep
// the 0.3.0 fail-closed identities (`MISSING_FILE` when absent, `INVALID_CONTRACT`/
// `INVALID_CONFIG` when rejected) and materialize the two `CONTRACT_DEFAULTS`.
import { loadRequiredConfigDocumentSync, loadRequiredContractDocumentSync } from '../config/index.js';
import { Ledger, ledgerPath } from '../ledger.js';
import { ensureDirectory } from '../fs.js';
import { EvoFenceError } from './errors.js';
import { requireEvidenceConfigured } from '../policy.js';
import { canTerminateProcessTree } from '../process.js';
import { createRunId, headSha, repositoryRoot } from '../git.js';
import { currentPolicyHashes } from './runner-events.js';
import { ensurePrivateIgnored } from './runner-candidate.js';
import { parseNumericBudget, usdFromMicros } from './budget.js';
import {
  checkAdapterIsolation,
  checkClaudeTokenBudget,
  checkCostBudget,
  checkHoldoutExposure,
  checkProcessTree,
} from './preflight-policy.js';
import { runTempRoot as runTempRootPath, worktreeTempParent } from './worktree-temp.js';
import type { RunContext, RunState } from './runner-context.js';
import type { AdapterName, EvoFenceConfig, EvoFenceContract, RunEvolutionOptions, RunOutcome } from '../../types/index.js';
import type { AdapterRunner } from './runner-adapter.js';

export async function prepareRun(options: RunEvolutionOptions): Promise<RunContext> {
  const {
    cwd,
    goal,
    adapter = 'codex',
    iterations,
    maxWallClockMs,
    allowUnisolatedOpenCode = false,
    allowUnisolatedAgent = allowUnisolatedOpenCode,
    allowReadableHoldout = false,
    onProgress = () => {},
  } = options;
  const adapterRunner = (options.adapterRunner ?? null) as AdapterRunner | null;

  const root = await repositoryRoot(cwd);
  const contract = loadRequiredContractDocumentSync(root) as EvoFenceContract;
  const config = loadRequiredConfigDocumentSync(root) as EvoFenceConfig;
  const holdout = await loadPrivateHoldout(root) as unknown[];
  requireEvidenceConfigured(contract);
  const holdoutRefusal = checkHoldoutExposure(holdout.length, allowReadableHoldout);
  if (holdoutRefusal) {
    throw new EvoFenceError(holdoutRefusal.code, holdoutRefusal.message);
  }
  let costLimitMicros: number | null = null;
  const costPolicy = checkCostBudget(contract.budgets.max_usd, adapter);
  if (costPolicy.refusal) {
    throw new EvoFenceError(costPolicy.refusal.code, costPolicy.refusal.message);
  }
  costLimitMicros = costPolicy.costLimitMicros;
  const isolationRefusal = checkAdapterIsolation(adapter, allowUnisolatedAgent, 'preflight');
  if (isolationRefusal) {
    throw new EvoFenceError(isolationRefusal.code, isolationRefusal.message);
  }
  const claudeTokenRefusal = checkClaudeTokenBudget(adapter, contract.budgets.max_tokens);
  if (claudeTokenRefusal) {
    throw new EvoFenceError(claudeTokenRefusal.code, claudeTokenRefusal.message);
  }
  if (contract.budgets.max_tokens !== null) {
    const processRefusal = checkProcessTree(
      contract.budgets.max_tokens,
      null,
      adapter,
      await canTerminateProcessTree(),
    );
    if (processRefusal) {
      throw new EvoFenceError(processRefusal.code, processRefusal.message);
    }
  }
  if (costLimitMicros !== null) {
    const processRefusal = checkProcessTree(
      null,
      costLimitMicros,
      adapter,
      await canTerminateProcessTree(),
    );
    if (processRefusal) {
      throw new EvoFenceError(processRefusal.code, processRefusal.message);
    }
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

  const tempParent = worktreeTempParent(root);
  const runTempRoot = runTempRootPath(tempParent, runId);
  await ensureDirectory(runTempRoot);
  const runStartedAt = Date.now();
  const activeGeneration = ledger.activeGeneration();
  const tokenLimit = contract.budgets.max_tokens;
  const state: RunState = {
    failureCount: 0,
    noImprovementCount: 0,
    activeGeneration,
    activeSha: activeGeneration?.sha ?? await headSha(root),
    baselineScore: null,
    observedTokens: 0,
    observedCostMicros: 0,
    costTotalUnknown: false,
    worktree: null,
  };
  const outcome: RunOutcome = {
    run_id: runId, status: 'RUNNING', adapter: adapter as AdapterName, base_sha: state.activeSha, iterations: [], active_generation: null,
    token_usage_total: tokenLimit === null ? null : state.observedTokens,
    cost_estimate_total_usd: costLimitMicros === null ? null : usdFromMicros(state.observedCostMicros),
  };

  return {
    root,
    goal,
    adapter: adapter as AdapterName,
    contract,
    config,
    holdout,
    limitIterations,
    wallClockLimit,
    deadlineAt,
    initialHashes,
    runId,
    ledger,
    tempParent,
    runTempRoot,
    runStartedAt,
    tokenLimit,
    costLimitMicros,
    adapterRunner,
    allowUnisolatedAgent,
    onProgress,
    outcome,
    state,
  };
}
