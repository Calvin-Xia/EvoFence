/**
 * `evofence report`: the cross-run evolution report.
 *
 * DOMAIN: report view (L2 node `l2_report`). Converted 1:1 from `src/lib/report.js` (R1 keeps the
 * path, R2 keeps the two exports `buildEvolutionReport` / `formatEvolutionReport`) and split into
 * `src/lib/report/**` because the 0.3.0 file was 388 lines — over the 350-line gate.
 *
 * LAYERING (DoD 5): this facade consumes exactly two things — the exec domain's *results*
 * (`run.started`/`candidate.*`/`gate.decision`/`budget.*` ledger events) and a ledger READ
 * INTERFACE (`SnapshotLedger.readSnapshot()`, declared in `./report/ledger-view.js`). It never
 * imports the runner, the ledger implementation, the gate or the adapter: a view must be
 * re-renderable from the ledger alone.
 *
 * ONE READ (spec-f2 locks this): everything is derived from a single transactional
 * `readSnapshot()`. Calling `verify()`/`events()`/`generations()` separately would let the three
 * reads describe different ledger states.
 */
import type { LedgerSnapshot, ReportIntegrity } from '../types/index.js';
import { buildBudgets } from './report/budget.js';
import { buildGateDecisions } from './report/gates.js';
import { buildGenerations, generationEventRecords, generationsTableConsistent } from './report/generations.js';
import type { SnapshotLedger } from './report/ledger-view.js';
import { buildObjective } from './report/objective.js';
import { buildLedgerReference } from './report/reference.js';
import { summarizeRuns } from './report/runs.js';
import type { ReportView } from './report/view.js';

export { formatEvolutionReport } from './report/render.js';
export { formatReport, formatReportJunit, formatReportSarif } from './report/formats.js';
export type { ReportFormat } from './report/formats.js';
export type { ReportGateDecision, ReportLedgerReference, ReportView } from './report/view.js';
export type { SnapshotLedger, StatusLedger } from './report/ledger-view.js';

/** `buildEvolutionReport` input. `root` stays part of the contract even though the view is ledger-derived. */
export interface ReportInput {
  root: string;
  ledger: SnapshotLedger;
}

function emptyReport(generated_at: string, integrity: ReportIntegrity, ledger: ReportView['ledger']): ReportView {
  return {
    schema_version: 1,
    generated_at,
    run_count: 0,
    generation_count: 0,
    runs: [],
    generations: [],
    objective: null,
    budgets: { tokens_total: null, usd_total: null },
    integrity,
    gate_decisions: [],
    ledger,
  };
}

/** Assemble the report view from one atomic ledger snapshot. */
function assembleReport(generated_at: string, snapshot: LedgerSnapshot): ReportView {
  const { integrity, events, generations: tableGenerations } = snapshot;
  const generations = buildGenerations(events, tableGenerations);
  const runs = summarizeRuns(events);
  return {
    schema_version: 1,
    generated_at,
    run_count: runs.length,
    generation_count: generations.length,
    runs,
    generations,
    objective: buildObjective(events, generations),
    budgets: buildBudgets(events),
    integrity: { valid: true },
    gate_decisions: buildGateDecisions(events),
    ledger: buildLedgerReference({ integrity, events, read_at: generated_at }),
  };
}

export async function buildEvolutionReport({ ledger }: ReportInput): Promise<ReportView> {
  const generated_at = new Date().toISOString();
  let snapshot: LedgerSnapshot;
  try {
    // One transaction: verification and both reads see the same ledger state.
    snapshot = ledger.readSnapshot();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // The hash chain matched but at least one payload is not valid JSON (for example a
    // tampered ledger whose chain was recomputed). Refuse to summarize unreadable payloads.
    return emptyReport(generated_at, {
      valid: false,
      failed_at_seq: null,
      expected_previous_hash: null,
      observed_hash: null,
      parse_failed: true,
    }, buildLedgerReference({ integrity: { valid: false }, read_at: generated_at }));
  }

  const integrity = snapshot.integrity;
  if (!integrity.valid) {
    return emptyReport(generated_at, {
      valid: false,
      failed_at_seq: integrity.sequence ?? null,
      expected_previous_hash: integrity.expected_previous_hash ?? null,
      observed_hash: integrity.observed_hash ?? null,
    }, buildLedgerReference({ integrity, read_at: generated_at }));
  }

  const events = snapshot.events;
  const tableGenerations = snapshot.generations;
  if (!generationsTableConsistent(tableGenerations, generationEventRecords(events))) {
    return emptyReport(generated_at, {
      valid: false,
      failed_at_seq: null,
      expected_previous_hash: null,
      observed_hash: null,
      generations_mismatch: true,
    }, buildLedgerReference({ integrity, events, read_at: generated_at }));
  }

  return assembleReport(generated_at, snapshot);
}
