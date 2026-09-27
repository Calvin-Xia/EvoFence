/**
 * `evofence status`: ledger read-side aggregation and text rendering.
 *
 * Converted from `src/lib/status.js` (L2 io domain, node `l2_config`) and re-pointed at the
 * shared view contract by node `l2_report`. Export surface is unchanged (`emptyStatus` /
 * `buildStatus` / `formatStatus`, plus the `StatusLedger` type) and the aggregation logic is
 * byte-for-byte the same, including the best-effort rule: when `verify()` already reported the
 * chain invalid, an aggregation failure must not replace the failed-integrity presentation; when
 * the chain is valid, the aggregation error propagates.
 *
 * UNIFIED VIEW CONTRACT (node `l2_report`): `StatusView` now *extends* the frozen shared type
 * `src/types/report.ts` `StatusView` instead of re-declaring its fields, and the ledger read
 * interface plus the payload-narrowing primitives come from `./report/ledger-view.js` — the same
 * module `buildEvolutionReport` consumes. `report` and `status` therefore cannot drift, and
 * neither imports the ledger implementation or the runner (DoD 5).
 *
 * POLICY VALIDATION (node `l2_config`): an invalid `.evofence/contract.yaml` /
 * `.evofence/config.yaml` throws `INVALID_CONTRACT` / `INVALID_CONFIG` (listed field paths in the
 * message, exit code 1 via `cli.js`), and a valid one is echoed as a `policy` block. An absent
 * policy file stays tolerable: a repository without `.evofence/` state still has a status.
 */
import { inspectPolicySync, type PolicySnapshot } from './config/index.js';
import { iterationOf, payloadObject, type StatusLedger } from './report/ledger-view.js';
import type { LedgerEvent, RecentRunSummary, StatusTotals, StatusView as StatusViewContract } from '../types/index.js';

export type { StatusLedger } from './report/ledger-view.js';

/** `buildStatus()` return value: the shared status view plus the validated `policy` snapshot. */
export interface StatusView extends StatusViewContract {
  policy: PolicySnapshot | null;
}

function rejectionKey(event: LedgerEvent): string {
  const iteration = iterationOf(event.payload);
  return iteration !== null ? `iteration:${iteration}` : `event:${event.seq}`;
}

function zeroTotals(): StatusTotals {
  return { runs: 0, generations: 0, accepted_candidates: 0, rejected_candidates: 0 };
}

function aggregateRuns(ledger: StatusLedger): { totals: StatusTotals; recent_runs: RecentRunSummary[] } {
  const totals = zeroTotals();
  const rejectedByRun = new Map<string, Set<string>>();

  for (const event of ledger.events()) {
    const payload = payloadObject(event.payload) ?? {};
    if (event.event_type === 'run.started' && event.run_id) totals.runs += 1;
    else if (event.event_type === 'generation.accepted') totals.generations += 1;
    else if (event.event_type === 'candidate.accepted') totals.accepted_candidates += 1;

    if (
      event.event_type === 'candidate.rejected'
      || (event.event_type === 'gate.decision' && payload.decision === 'REJECT')
    ) {
      const scope = event.run_id ?? '(no run)';
      let keys = rejectedByRun.get(scope);
      if (!keys) {
        keys = new Set();
        rejectedByRun.set(scope, keys);
      }
      keys.add(rejectionKey(event));
    }
  }

  for (const keys of rejectedByRun.values()) totals.rejected_candidates += keys.size;

  return { totals, recent_runs: ledger.recentRuns(5) };
}

/** Zeroed status for a repository without a ledger. Validates policy, fail-closed. */
export function emptyStatus(root: string): StatusView {
  return {
    root: String(root).replaceAll('\\', '/'),
    active_generation: null,
    integrity: { valid: true },
    recent_runs: [],
    totals: zeroTotals(),
    policy: inspectPolicySync(root),
  };
}

/** Aggregate an open ledger. Validates policy, fail-closed. */
export async function buildStatus({ root, ledger }: { root: string; ledger: StatusLedger }): Promise<StatusView> {
  const verification = ledger.verify();
  const status: StatusView = {
    root: String(root).replaceAll('\\', '/'),
    active_generation: ledger.activeGeneration() ?? null,
    integrity: { valid: verification.valid },
    recent_runs: [],
    totals: zeroTotals(),
    policy: inspectPolicySync(root),
  };
  try {
    Object.assign(status, aggregateRuns(ledger));
  } catch (error) {
    // verify() hashes the raw payload_json column without parsing it, so payload
    // corruption surfaces here as an aggregation failure. Once integrity has failed,
    // aggregation is best-effort: keep the failed-integrity presentation instead of
    // letting the aggregation error replace it.
    if (verification.valid) throw error;
  }
  return status;
}

/** Render the text overview. Policy lines are appended only when a policy file was loaded. */
export function formatStatus(status: StatusView): string {
  const lines = [`EvoFence status: ${status.root}`];
  lines.push(status.active_generation
    ? `Active generation: ${status.active_generation.generation_id} (${status.active_generation.sha})`
    : 'Active generation: none');
  lines.push(`Ledger integrity: ${status.integrity?.valid ? 'ok' : 'FAILED'}`);
  const totals = status.totals ?? zeroTotals();
  lines.push(`Totals: runs=${totals.runs ?? 0} generations=${totals.generations ?? 0} accepted_candidates=${totals.accepted_candidates ?? 0} rejected_candidates=${totals.rejected_candidates ?? 0}`);
  lines.push('Recent runs:');
  for (const run of status.recent_runs ?? []) {
    lines.push(`  ${run.run_id}  ${run.adapter}  ${run.status}  iterations=${run.iterations}`);
  }
  const policy = status.policy;
  if (policy) {
    const contract = policy.contract;
    lines.push(contract
      ? `Policy: contract=${contract.objective.name} (direction=${contract.objective.direction}, min_delta=${contract.objective.min_delta}, budgets max_iterations=${contract.budgets.max_iterations} max_wall_clock_ms=${contract.budgets.max_wall_clock_ms}, hard_invariants=${contract.hard_invariants}, public_commands=${contract.evidence.public_commands.length})`
      : 'Policy: contract=none');
    lines.push(`Policy: adapters ${policy.adapters.map((adapter) => `${adapter.name}=${adapter.command}`).join(', ')}`);
  }
  return lines.join('\n');
}
