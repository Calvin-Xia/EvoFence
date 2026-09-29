/**
 * `evofence doctor` — read-only presentation of the run preflight judgement.
 *
 * DOMAIN: CLI handler (node `l2_doctor_align`). The checks call the same loaders and judgement
 * functions as `run`; this handler only turns their original errors into the stable view.
 */
import type { EvoFenceContract } from '../../../types/index.js';
import { EvoFenceError } from '../../errors.js';
import { loadPrivateHoldout } from '../../contract.js';
import { loadRequiredConfigDocumentSync, loadRequiredContractDocumentSync } from '../../config/index.js';
import { Ledger, ledgerPath } from '../../ledger.js';
import { requireEvidenceConfigured } from '../../policy.js';
import { canTerminateProcessTree } from '../../process.js';
import { repositoryRoot } from '../../git.js';
import { usdToMicros } from '../../exec/budget.js';
import { jsonDocument, type Write } from '../output.js';
import type { CommandContext } from './context.js';
import { stringOption } from './context.js';

export interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly status: 'ok' | 'refused';
  readonly code: string | null;
  readonly remediation: string;
}

const NO_ACTION = 'No action required.';
const POLICY_REMEDIATION = 'Fix the reported contract.yaml or config.yaml problem, then rerun doctor.';
const EVIDENCE_REMEDIATION = 'Add a hard invariant or public evidence command, or configure objective.command when improvement is required.';
const HOLDOUT_REMEDIATION = 'Pass --allow-readable-holdout only if you accept possible oracle exposure, or use a container or VM with restricted mounts.';
const ADAPTER_REMEDIATION = 'Set the incompatible budget to null, choose a compatible adapter, or pass the required isolation opt-in.';
const PROCESS_REMEDIATION = 'Use a host that can terminate the agent process tree, or remove the live token/USD budget.';
const LEDGER_REMEDIATION = 'Restore or repair the ledger, then rerun doctor.';

type CheckAction = () => void | Promise<void>;

async function presentCheck(
  id: string,
  label: string,
  remediation: string,
  action: CheckAction,
): Promise<DoctorCheck> {
  try {
    await action();
    return { id, label, status: 'ok', code: null, remediation: NO_ACTION };
  } catch (error) {
    if (!(error instanceof EvoFenceError)) throw error;
    return { id, label, status: 'refused', code: error.code, remediation };
  }
}

function budgetAdapterCheck(contract: EvoFenceContract, adapter: string): void {
  if (contract.budgets.max_usd !== null) {
    if (adapter !== 'claude') {
      throw new EvoFenceError('UNSUPPORTED_COST_BUDGET', 'Only Claude Code currently provides a native USD cap supported by EvoFence. Set max_usd to null or use the Claude Code adapter.');
    }
    const costLimitMicros = usdToMicros(contract.budgets.max_usd);
    if (costLimitMicros < 1) {
      throw new EvoFenceError('INVALID_BUDGET', 'budgets.max_usd must be at least $0.000001 for Claude Code USD budget enforcement.');
    }
  }
  if (adapter === 'claude') {
    throw new EvoFenceError('CLAUDE_SANDBOX_REQUIRED', 'EvoFence does not place the Claude Code CLI inside an OS sandbox. Re-run with --allow-unisolated-agent only if you accept that boundary, or run EvoFence in a Docker/VM with restricted mounts.');
  }
  if (adapter === 'pi') {
    throw new EvoFenceError('PI_SANDBOX_REQUIRED', 'EvoFence does not place the Pi CLI inside an OS sandbox. Re-run with --allow-unisolated-agent only if you accept that boundary, or run EvoFence in a Docker/VM with restricted mounts.');
  }
  if (adapter === 'claude' && contract.budgets.max_tokens !== null) {
    throw new EvoFenceError('UNSUPPORTED_CLAUDE_TOKEN_BUDGET', 'Claude Code reports complete whole-tree token usage only in its final result event. EvoFence cannot safely interrupt the run at the token threshold; set max_tokens to null or use Codex, OpenCode, or Pi for token-budgeted runs.');
  }
}

async function doctorChecks(root: string, adapter: string): Promise<DoctorCheck[]> {
  let contract: EvoFenceContract | null = null;
  let processTreeAvailable: boolean | null = null;
  const contractForCheck = (): EvoFenceContract => {
    if (contract === null) contract = loadRequiredContractDocumentSync(root);
    return contract;
  };

  const checks: DoctorCheck[] = [];
  checks.push(await presentCheck('contract-config', 'Contract and config loading', POLICY_REMEDIATION, () => {
    contract = loadRequiredContractDocumentSync(root);
    loadRequiredConfigDocumentSync(root);
  }));
  checks.push(await presentCheck('evidence-config', 'Evidence configuration', EVIDENCE_REMEDIATION, () => {
    requireEvidenceConfigured(contractForCheck());
  }));
  checks.push(await presentCheck('holdout-exposure', 'Private holdout exposure', HOLDOUT_REMEDIATION, async () => {
    const holdout = await loadPrivateHoldout(root);
    if (holdout.length > 0) {
      throw new EvoFenceError('PRIVATE_ORACLE_READABLE', 'The built-in Codex, OpenCode, Claude Code, and Pi adapters cannot guarantee read isolation from files elsewhere on this host. Re-run with --allow-readable-holdout only if you accept possible oracle exposure, or run EvoFence from a container/VM that mounts only the candidate and gate data.');
    }
  }));
  checks.push(await presentCheck('budget-adapter', 'Budget and adapter compatibility', ADAPTER_REMEDIATION, () => {
    budgetAdapterCheck(contractForCheck(), adapter);
  }));
  checks.push(await presentCheck('process-tree', 'Process-tree termination capability', PROCESS_REMEDIATION, async () => {
    processTreeAvailable = await canTerminateProcessTree();
    const policy = contractForCheck();
    if (!processTreeAvailable && policy.budgets.max_tokens !== null) {
      throw new EvoFenceError('UNSUPPORTED_TOKEN_BUDGET_PROCESS_CONTROL', 'This host cannot terminate an agent process tree. EvoFence refused to start a token-budgeted run.');
    }
    if (!processTreeAvailable && policy.budgets.max_usd !== null) {
      throw new EvoFenceError('UNSUPPORTED_COST_BUDGET_PROCESS_CONTROL', 'This host cannot terminate a Claude process tree. EvoFence refused to start a USD-budgeted run.');
    }
  }));
  checks.push(await presentCheck('ledger-integrity', 'Ledger integrity', LEDGER_REMEDIATION, () => {
    const ledger = new Ledger(ledgerPath(root), { readOnly: true });
    try {
      const integrity = ledger.verify();
      if (!integrity.valid) throw new EvoFenceError('LEDGER_CORRUPT', `SQLite ledger hash chain failed at event ${integrity.sequence}.`);
    } finally {
      ledger.close();
    }
  }));
  return checks;
}

export function renderDoctor(checks: readonly DoctorCheck[], json: boolean, stdout: Write): number {
  if (json) stdout(jsonDocument({ checks }));
  else {
    for (const check of checks) {
      const code = check.code === null ? '' : ` (${check.code})`;
      const remediation = check.status === 'refused' ? ` — ${check.remediation}` : '';
      stdout(`${check.status.toUpperCase()} ${check.id}: ${check.label}${code}${remediation}\n`);
    }
  }
  return checks.some((check) => check.status === 'refused') ? 1 : 0;
}

export async function commandDoctor(context: CommandContext): Promise<number> {
  const root = await repositoryRoot(context.cwd);
  const adapter = stringOption(context, 'adapter') ?? 'codex';
  return renderDoctor(await doctorChecks(root, adapter), context.json, context.stdout);
}
