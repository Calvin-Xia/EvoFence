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
import { parseNumericBudget, usdFromMicros, usdToMicros } from './budget.js';
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
  if (holdout.length > 0 && !allowReadableHoldout) {
    throw new EvoFenceError('PRIVATE_ORACLE_READABLE', 'The built-in Codex, OpenCode, Claude Code, and Pi adapters cannot guarantee read isolation from files elsewhere on this host. Re-run with --allow-readable-holdout only if you accept possible oracle exposure, or run EvoFence from a container/VM that mounts only the candidate and gate data.');
  }
  let costLimitMicros: number | null = null;
  if (contract.budgets.max_usd !== null) {
    if (adapter !== 'claude') {
      throw new EvoFenceError('UNSUPPORTED_COST_BUDGET', 'Only Claude Code currently provides a native USD cap supported by EvoFence. Set max_usd to null or use the Claude Code adapter.');
    }
    costLimitMicros = usdToMicros(contract.budgets.max_usd);
    if (costLimitMicros < 1) {
      throw new EvoFenceError('INVALID_BUDGET', 'budgets.max_usd must be at least $0.000001 for Claude Code USD budget enforcement.');
    }
  }
  if (adapter === 'claude' && !allowUnisolatedAgent) {
    throw new EvoFenceError('CLAUDE_SANDBOX_REQUIRED', 'EvoFence does not place the Claude Code CLI inside an OS sandbox. Re-run with --allow-unisolated-agent only if you accept that boundary, or run EvoFence in a Docker/VM with restricted mounts.');
  }
  if (adapter === 'pi' && !allowUnisolatedAgent) {
    throw new EvoFenceError('PI_SANDBOX_REQUIRED', 'EvoFence does not place the Pi CLI inside an OS sandbox. Re-run with --allow-unisolated-agent only if you accept that boundary, or run EvoFence in a Docker/VM with restricted mounts.');
  }
  if (adapter === 'claude' && contract.budgets.max_tokens !== null) {
    throw new EvoFenceError('UNSUPPORTED_CLAUDE_TOKEN_BUDGET', 'Claude Code reports complete whole-tree token usage only in its final result event. EvoFence cannot safely interrupt the run at the token threshold; set max_tokens to null or use Codex, OpenCode, or Pi for token-budgeted runs.');
  }
  if (contract.budgets.max_tokens !== null && !(await canTerminateProcessTree())) {
    throw new EvoFenceError('UNSUPPORTED_TOKEN_BUDGET_PROCESS_CONTROL', 'This host cannot terminate an agent process tree. EvoFence refused to start a token-budgeted run.');
  }
  if (costLimitMicros !== null && !(await canTerminateProcessTree())) {
    throw new EvoFenceError('UNSUPPORTED_COST_BUDGET_PROCESS_CONTROL', 'This host cannot terminate a Claude process tree. EvoFence refused to start a USD-budgeted run.');
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
