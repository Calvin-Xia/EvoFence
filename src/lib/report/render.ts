/**
 * `formatEvolutionReport`: the Markdown rendering of the report view.
 *
 * DOMAIN: report views (L2 node `l2_report`). Ported 1:1 from `src/lib/report.js`; the summary
 * bullets and the `## Generations` / `## Runs` tables keep their exact shape (spec-f2 asserts on
 * them), and this node adds a `## Gate decisions` table (門禁结论) plus a ledger-reference bullet.
 * The gate table is omitted entirely when the report has no gate decisions, so a report over an
 * empty ledger renders exactly as before.
 */
import type { ReportIntegrity } from '../../types/index.js';
import type { ReportView } from './view.js';

function formatNumber(value: number | null | undefined): string {
  return Number.isFinite(value) ? String(value) : 'n/a';
}

function formatDelta(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return 'n/a';
  return (value as number) > 0 ? `+${value}` : String(value);
}

function formatIntegrity(integrity: ReportIntegrity): string {
  if (integrity?.valid) return 'valid';
  if (integrity?.parse_failed) return 'INVALID (unparseable event payload)';
  if (integrity?.generations_mismatch) return 'INVALID (generations table disagrees with the event chain)';
  return `INVALID${Number.isInteger(integrity?.failed_at_seq) ? ` (failed at seq ${integrity.failed_at_seq})` : ''}`;
}

function formatLedgerReference(ledger: ReportView['ledger']): string {
  const span = ledger.first_seq === null || ledger.last_seq === null ? 'no readable events' : `seq ${ledger.first_seq}..${ledger.last_seq}`;
  const head = ledger.head_hash === null ? 'unknown' : ledger.head_hash.slice(0, 12);
  return `${ledger.event_count ?? 'unknown'} events, ${span}, head ${head}`;
}

export function formatEvolutionReport(report: ReportView): string {
  const lines = [
    '# EvoFence Evolution Report',
    '',
    `- Runs: ${report.run_count}`,
    `- Generations: ${report.generation_count}`,
    `- Objective delta: ${formatDelta(report.objective?.delta)}`,
    `- Tokens total: ${formatNumber(report.budgets?.tokens_total)}`,
    `- USD total: ${formatNumber(report.budgets?.usd_total)}`,
    `- Ledger integrity: ${formatIntegrity(report.integrity)}`,
    `- Ledger reference: ${formatLedgerReference(report.ledger)}`,
  ];
  for (const group of report.objective?.groups ?? []) {
    lines.push(`- Objective ${group.metric ?? 'unknown'} (${group.direction ?? 'unknown direction'}): delta ${formatDelta(group.delta)}`);
  }
  lines.push(
    '',
    '## Generations',
    '',
    '| generation | sha | score | improvement |',
    '| --- | --- | --- | --- |',
  );
  for (const generation of report.generations ?? []) {
    lines.push(`| ${generation.generation_id} | ${generation.sha ?? 'n/a'} | ${formatNumber(generation.objective_score)} | ${formatDelta(generation.improvement)} |`);
  }
  lines.push('', '## Runs', '', '| run | adapter | status | failure_code | iterations | accepted | rejected |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const run of report.runs ?? []) {
    lines.push(`| ${run.run_id} | ${run.adapter} | ${run.status} | ${run.failure_code ?? ''} | ${run.iterations} | ${run.accepted_candidates} | ${run.rejected_candidates} |`);
  }
  if (report.gate_decisions.length) {
    lines.push('', '## Gate decisions', '', '| # | run | iteration | decision | reason | evidence_ok | seq |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const decision of report.gate_decisions) {
      lines.push(`| ${decision.seq} | ${decision.run_id ?? ''} | ${decision.iteration ?? ''} | ${decision.decision} | ${decision.reason ?? ''} | ${decision.evidence_ok ?? ''} | ${decision.seq} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}
