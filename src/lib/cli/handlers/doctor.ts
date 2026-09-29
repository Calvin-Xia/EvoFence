/**
 * `evofence doctor` — read-only presentation of the run preflight judgement.
 *
 * DOMAIN: CLI handler (node `l2_doctor_align`). The checks call the same loaders and judgement
 * functions as `run`; this handler only turns their original errors into the stable view.
 */
import { lstat, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvoFenceContract } from '../../../types/index.js';
import { EvoFenceError } from '../../errors.js';
import { loadPrivateHoldout } from '../../contract.js';
import { loadRequiredConfigDocumentSync, loadRequiredContractDocumentSync } from '../../config/index.js';
import { Ledger, ledgerPath } from '../../ledger.js';
import { requireEvidenceConfigured } from '../../policy.js';
import { canTerminateProcessTree } from '../../process.js';
import { repositoryRoot } from '../../git.js';
import {
  checkAdapterIsolation,
  checkAdapterName,
  checkClaudeTokenBudget,
  checkCostBudget,
  checkHoldoutExposure,
  checkProcessTree,
  type PreflightRefusal,
} from '../../exec/preflight-policy.js';
import { ensurePrivateIgnored } from '../../exec/runner-candidate.js';
import { jsonDocument, type Write } from '../output.js';
import type { CommandContext } from './context.js';
import { booleanOption, stringOption } from './context.js';

export interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly status: 'ok' | 'refused';
  readonly code: string | null;
  readonly remediation: string;
  readonly action?: DoctorAction;
}

export interface DoctorAction {
  readonly status: 'fixed' | 'not-needed' | 'unfixable';
  readonly message: string;
  readonly original_code?: string;
}

const NO_ACTION = 'No action required.';
const POLICY_REMEDIATION = 'Fix the reported contract.yaml or config.yaml problem, then rerun doctor.';
const EVIDENCE_REMEDIATION = 'Add a hard invariant or public evidence command, or configure objective.command when improvement is required.';
const HOLDOUT_REMEDIATION = 'Keep .evofence/private/holdout.yaml excluded from Git; pass --allow-readable-holdout only if you accept possible oracle exposure, or use a container or VM with restricted mounts.';
const ADAPTER_REMEDIATION = 'Set the incompatible budget to null, choose a compatible adapter, or pass the required isolation opt-in.';
const PROCESS_REMEDIATION = 'Use a host that can terminate the agent process tree, or remove the live token/USD budget.';
const LEDGER_REMEDIATION = 'Restore or repair the ledger, then rerun doctor.';
const HOLDOUT_IGNORE_ENTRY = '.evofence/private/holdout.yaml';
type IgnoreFileStat = Awaited<ReturnType<typeof lstat>>;

interface HoldoutFix {
  readonly action: DoctorAction;
  readonly rollback: () => Promise<void>;
}

type CheckAction = () => void | null | PreflightRefusal | Promise<void | null | PreflightRefusal>;

async function presentCheck(
  id: string,
  label: string,
  remediation: string,
  action: CheckAction,
): Promise<DoctorCheck> {
  try {
    const refusal = await action();
    if (refusal) {
      return { id, label, status: 'refused', code: refusal.code, remediation };
    }
    return { id, label, status: 'ok', code: null, remediation: NO_ACTION };
  } catch (error) {
    if (!(error instanceof EvoFenceError)) throw error;
    return { id, label, status: 'refused', code: error.code, remediation };
  }
}

async function doctorChecksOnce(root: string, adapter: string): Promise<DoctorCheck[]> {
  let contract: EvoFenceContract | null = null;
  let costLimitMicros: number | null = null;
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
    const exposureRefusal = checkHoldoutExposure(holdout.length, false);
    if (exposureRefusal) return exposureRefusal;
    await ensurePrivateIgnored(root);
  }));
  const budgetCheck = await presentCheck('budget-adapter', 'Budget and adapter compatibility', ADAPTER_REMEDIATION, () => {
    const policy = contractForCheck();
    const costPolicy = checkCostBudget(policy.budgets.max_usd, adapter);
    costLimitMicros = costPolicy.costLimitMicros;
    if (costPolicy.refusal) return costPolicy.refusal;
    const adapterRefusal = checkAdapterName(adapter);
    if (adapterRefusal) return adapterRefusal;
    const isolationRefusal = checkAdapterIsolation(adapter, false, 'dispatch');
    if (isolationRefusal) return isolationRefusal;
    return checkClaudeTokenBudget(adapter, policy.budgets.max_tokens);
  });
  checks.push(budgetCheck);
  // `run` stops at the first adapter/budget refusal. Do not report a dependent process-tree
  // refusal for a configuration that can never reach that check; the shared policy still owns
  // both judgements, and this keeps doctor/run's first blocking code aligned on every host.
  if (budgetCheck.status === 'ok') {
    checks.push(await presentCheck('process-tree', 'Process-tree termination capability', PROCESS_REMEDIATION, async () => {
      return checkProcessTree(
        contractForCheck().budgets.max_tokens,
        costLimitMicros,
        adapter,
        await canTerminateProcessTree(),
      );
    }));
  }
  checks.push(await presentCheck('ledger-integrity', 'Ledger integrity', LEDGER_REMEDIATION, () => {
    try {
      const ledger = new Ledger(ledgerPath(root), { readOnly: true });
      try {
        const integrity = ledger.verify();
        if (!integrity.valid) throw new EvoFenceError('LEDGER_CORRUPT', `SQLite ledger hash chain failed at event ${integrity.sequence}.`);
      } finally {
        ledger.close();
      }
    } catch (error) {
      if (error instanceof EvoFenceError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new EvoFenceError('LEDGER_UNAVAILABLE', `Cannot read the ledger at ${ledgerPath(root)}: ${message}`);
    }
  }));
  return checks;
}

async function addHoldoutIgnoreEntry(root: string): Promise<HoldoutFix> {
  const file = path.join(root, '.gitignore');
  const lstatIfPresent = async (): Promise<IgnoreFileStat | null> => {
    try {
      return await lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const assertSafeTarget = (info: IgnoreFileStat): void => {
    if (!info.isFile()) {
      throw new EvoFenceError('DOCTOR_UNFIXABLE', `Cannot safely update ${file}: it is not a regular file.`);
    }
    if (info.nlink !== 1) {
      throw new EvoFenceError('DOCTOR_UNFIXABLE', `Cannot safely update ${file}: it has multiple hard links.`);
    }
  };
  const sameIdentity = (left: IgnoreFileStat, right: IgnoreFileStat): boolean => left.dev === right.dev && left.ino === right.ino;
  let before: IgnoreFileStat | null;
  try {
    before = await lstatIfPresent();
    if (before !== null) assertSafeTarget(before);
  } catch (error) {
    if (error instanceof EvoFenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new EvoFenceError('DOCTOR_UNFIXABLE', `Cannot inspect ${file}: ${message}`);
  }

  try {
    const contents = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    });
    const prefix = contents.length === 0 || contents.endsWith('\n') || contents.endsWith('\r') ? '' : '\n';

    const after = await lstatIfPresent();
    if (before === null) {
      if (after !== null) throw new EvoFenceError('DOCTOR_UNFIXABLE', `Cannot safely update ${file}: its identity changed while it was inspected.`);
    } else {
      if (after === null || !sameIdentity(before, after)) {
        throw new EvoFenceError('DOCTOR_UNFIXABLE', `Cannot safely update ${file}: its identity changed while it was inspected.`);
      }
      assertSafeTarget(after);
    }
    await writeFile(file, `${contents}${prefix}${HOLDOUT_IGNORE_ENTRY}\n`, { encoding: 'utf8', flag: before === null ? 'wx' : 'w' });
    const written = await lstatIfPresent();
    if (written === null || (before !== null && !sameIdentity(before, written))) {
      throw new EvoFenceError('DOCTOR_UNFIXABLE', `Cannot safely update ${file}: its identity changed after it was written.`);
    }
    assertSafeTarget(written);
    return {
      action: {
        status: 'fixed',
        message: `Added ${HOLDOUT_IGNORE_ENTRY} to .gitignore; rechecked Git ignore status.`,
        original_code: 'HOLDOUT_NOT_IGNORED',
      },
      rollback: async () => {
        const current = await lstatIfPresent();
        if (current === null || !sameIdentity(written, current)) {
          throw new EvoFenceError('DOCTOR_UNFIXABLE', `Cannot restore ${file}: its identity changed after the fix.`);
        }
        assertSafeTarget(current);
        if (before === null) await rm(file);
        else await writeFile(file, contents, { encoding: 'utf8', flag: 'w' });
      },
    };
  } catch (error) {
    if (error instanceof EvoFenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new EvoFenceError('DOCTOR_UNFIXABLE', `Cannot update ${file}: ${message}`);
  }
}

async function doctorChecks(root: string, adapter: string, fix: boolean): Promise<DoctorCheck[]> {
  const initial = await doctorChecksOnce(root, adapter);
  if (!fix) return initial;

  const actions = new Map<string, { action: DoctorAction; rollback?: () => Promise<void> }>();
  let recheck = false;
  for (const check of initial) {
    if (check.status === 'ok') {
      actions.set(check.id, { action: { status: 'not-needed', message: 'No action required.' } });
      continue;
    }
    if (check.id === 'holdout-exposure' && check.code === 'HOLDOUT_NOT_IGNORED') {
      let fix: HoldoutFix | null = null;
      try {
        fix = await addHoldoutIgnoreEntry(root);
        await ensurePrivateIgnored(root);
        actions.set(check.id, fix);
        recheck = true;
      } catch (error) {
        let restoreFailure = '';
        if (fix !== null) {
          try {
            await fix.rollback();
          } catch (restoreError) {
            const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
            restoreFailure = ` Restore failed: ${message}`;
          }
        }
        const originalCode = check.code!;
        const message = error instanceof Error ? error.message : String(error);
        actions.set(check.id, { action: { status: 'unfixable', message: `Automatic fix failed: ${message}.${restoreFailure}`, original_code: originalCode } });
      }
      continue;
    }
    actions.set(check.id, { action: {
      status: 'unfixable',
      message: `No safe automatic fix for ${check.code!}.`,
      original_code: check.code!,
    } });
  }

  const observed = recheck ? await doctorChecksOnce(root, adapter) : initial;
  const observedHoldout = observed.find((check) => check.id === 'holdout-exposure');
  const fixedHoldout = actions.get('holdout-exposure');
  if (observedHoldout?.status === 'refused' && fixedHoldout?.action.status === 'fixed' && fixedHoldout.rollback) {
    let restoreFailure = '';
    try {
      await fixedHoldout.rollback();
    } catch (restoreError) {
      const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
      restoreFailure = ` Restore failed: ${message}`;
    }
    actions.set('holdout-exposure', { action: {
      status: 'unfixable',
      message: `Automatic fix did not pass recheck: ${observedHoldout.code!}.${restoreFailure}`,
      original_code: 'HOLDOUT_NOT_IGNORED',
    } });
  }
  return observed.map((check) => {
    const entry = actions.get(check.id);
    if (!entry) return check;
    const action = entry.action;
    if (action.status === 'unfixable') {
      return { ...check, status: 'refused', code: 'DOCTOR_UNFIXABLE', action };
    }
    if (action.status === 'fixed' && check.status === 'refused') {
      return {
        ...check,
        status: 'refused',
        code: 'DOCTOR_UNFIXABLE',
        action: {
          status: 'unfixable',
          message: `Automatic fix did not pass recheck: ${check.code!}.`,
          original_code: check.code!,
        },
      };
    }
    return { ...check, action };
  });
}

export function renderDoctor(checks: readonly DoctorCheck[], json: boolean, stdout: Write): number {
  if (json) {
    const refused = checks.filter((check) => check.status === 'refused');
    if (refused.length > 0) {
      throw new EvoFenceError(refused[0].code!, 'Doctor preflight refused.', { checks });
    }
    stdout(jsonDocument({ checks }));
  }
  else {
    for (const check of checks) {
      const code = check.code === null ? '' : ` (${check.code})`;
      const remediation = check.status === 'refused' ? ` — ${check.remediation}` : '';
      const action = check.action ? ` — ${check.action.message}` : '';
      stdout(`${check.status.toUpperCase()} ${check.id}: ${check.label}${code}${remediation}${action}\n`);
    }
  }
  return checks.some((check) => check.status === 'refused') ? 1 : 0;
}

export async function commandDoctor(context: CommandContext): Promise<number> {
  const root = await repositoryRoot(context.cwd);
  const adapter = stringOption(context, 'adapter') ?? 'codex';
  return renderDoctor(await doctorChecks(root, adapter, booleanOption(context, 'fix')), context.json, context.stdout);
}
