/** Interoperable renderings of the sanitized evolution report view. */
import type { ReportView } from './view.js';
import { formatEvolutionReport } from './render.js';

export type ReportFormat = 'text' | 'json' | 'sarif' | 'junit';

const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
const SARIF_RULE_ID = 'evofence.gate-decision';

function reportJson(report: ReportView): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function sarifLevel(decision: string): 'none' | 'note' | 'warning' | 'error' {
  if (decision === 'ACCEPT') return 'note';
  if (decision === 'REJECT' || decision === 'QUARANTINE') return 'error';
  return 'warning';
}

function decisionMessage(decision: ReportView['gate_decisions'][number]): string {
  const parts = [`${decision.decision} gate decision`];
  if (decision.reason !== null) parts.push(`reason=${decision.reason}`);
  if (decision.run_id !== null) parts.push(`run=${decision.run_id}`);
  if (decision.iteration !== null) parts.push(`iteration=${decision.iteration}`);
  return parts.join('; ');
}

/** SARIF 2.1.0 log: one result per projected gate decision, located at its ledger sequence. */
export function formatReportSarif(report: ReportView): string {
  const results = report.gate_decisions.map((decision) => ({
    ruleId: SARIF_RULE_ID,
    level: sarifLevel(decision.decision),
    message: { text: decisionMessage(decision) },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: '.evofence/ledger.sqlite' },
        region: { startLine: Math.max(1, Math.floor(decision.seq)) },
      },
    }],
    properties: {
      run_id: decision.run_id,
      iteration: decision.iteration,
      ledger_seq: decision.seq,
    },
  }));
  const sarif = {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'EvoFence',
          informationUri: 'https://github.com/Calvin-Xia/EvoFence',
          rules: [{
            id: SARIF_RULE_ID,
            name: 'Gate decision',
            shortDescription: { text: 'A projected EvoFence gate decision.' },
          }],
        },
      },
      results,
    }],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function cdata(value: string): string {
  return value.replaceAll(']]>', ']]]]><![CDATA[>');
}

/** JUnit XML: one testcase per projected gate decision. */
export function formatReportJunit(report: ReportView): string {
  const decisions = report.gate_decisions;
  const failures = decisions.filter((decision) => decision.decision !== 'ACCEPT');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="EvoFence report" tests="${decisions.length}" failures="${failures.length}" errors="0" skipped="0">`,
  ];
  for (const decision of decisions) {
    const name = `gate-decision-${decision.seq}`;
    lines.push(`  <testcase classname="EvoFence.gate" name="${xmlEscape(name)}" time="0">`);
    if (decision.decision !== 'ACCEPT') {
      const message = decisionMessage(decision);
      lines.push(`    <failure message="${xmlEscape(message)}"><![CDATA[${cdata(message)}]]></failure>`);
    }
    lines.push('  </testcase>');
  }
  lines.push('</testsuite>');
  return `${lines.join('\n')}\n`;
}

/** Render a report without changing the existing Markdown renderer. */
export function formatReport(report: ReportView, format: ReportFormat): string {
  if (format === 'text') return formatEvolutionReport(report);
  if (format === 'json') return reportJson(report);
  if (format === 'sarif') return formatReportSarif(report);
  if (format === 'junit') return formatReportJunit(report);
  return formatEvolutionReport(report);
}
