/**
 * `evofence report [file] [--json]` — the cross-run report view (a downstream DoD entry point).
 *
 * DOMAIN: CLI handler (node `l2_cli`). Renders Markdown or JSON to stdout, or writes the same
 * content to a path after the output-safety gate refuses anything inside `.evofence/**` or any
 * hard link to control-plane state.
 *
 * `--json` contract (F8c): stdout is JSON and nothing else in EVERY shape. Without a path it is
 * the report document; with a path it is the `{written,bytes}` envelope from `writePayload` (the
 * `Report written to <path>` line stays text-mode only).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EvoFenceError } from '../../errors.js';
import { repositoryRoot } from '../../git.js';
import { Ledger, ledgerPath } from '../../ledger.js';
import { buildEvolutionReport } from '../../report.js';
import { formatReport, type ReportFormat } from '../../report/formats.js';
import { assertReportOutputOutsideState } from '../report-output.js';
import { jsonDocument, repoRelativePath, writePayload } from '../output.js';
import { positional, type CommandContext } from './context.js';

const REPORT_FORMATS: readonly ReportFormat[] = ['text', 'json', 'sarif', 'junit'];
const REPORT_USAGE = 'Use: evofence report [file] [--format <text|json|sarif|junit>] [--json]';

function selectedFormat(context: CommandContext): { format: ReportFormat; json: boolean } {
  const requested = context.options.format;
  const format = requested === undefined ? null : typeof requested === 'string' ? requested : null;
  if (format !== null && !(REPORT_FORMATS as readonly string[]).includes(format)) {
    throw new EvoFenceError('USAGE', `Option --format must be one of: text, json, sarif, junit. ${REPORT_USAGE}`);
  }
  const hasJson = context.options.json === true;
  if (hasJson && format !== null && format !== 'json') {
    throw new EvoFenceError('USAGE', `Option --json cannot be combined with --format text, --format sarif, or --format junit. ${REPORT_USAGE}`);
  }
  const selected = (format ?? (hasJson ? 'json' : 'text')) as ReportFormat;
  return { format: selected, json: selected === 'json' };
}

function renderReport(report: Awaited<ReturnType<typeof buildEvolutionReport>>, format: ReportFormat): string {
  return formatReport(report, format);
}

export async function commandReport(context: CommandContext): Promise<number> {
  const selected = selectedFormat(context);
  const requested = positional(context, 0);
  const root = await repositoryRoot(context.cwd);
  const output = requested === undefined ? null : path.resolve(context.cwd, requested);
  if (output !== null) assertReportOutputOutsideState(root, output, requested as string);

  const ledger = new Ledger(ledgerPath(root), { readOnly: true });
  try {
    const report = await buildEvolutionReport({ root, ledger });
    const content = renderReport(report, selected.format);
    if (output === null) {
      context.stdout(content);
      return 0;
    }
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, content, { mode: 0o600 });
    const relative = repoRelativePath(root, output);
    context.stdout(selected.json ? jsonDocument(writePayload(relative, content)) : `Report written to ${relative}\n`);
    return 0;
  } finally {
    ledger.close();
  }
}
