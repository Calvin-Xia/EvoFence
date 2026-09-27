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
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { repositoryRoot } from '../../git.js';
import { Ledger, ledgerPath } from '../../ledger.js';
import { buildEvolutionReport, formatEvolutionReport } from '../../report.js';
import { assertReportOutputOutsideState } from '../report-output.js';
import { jsonDocument, writePayload } from '../output.js';
import { positional, type CommandContext } from './context.js';

export async function commandReport(context: CommandContext): Promise<number> {
  const requested = positional(context, 0);
  const root = await repositoryRoot(context.cwd);
  const output = requested === undefined ? null : path.resolve(context.cwd, requested);
  if (output !== null) assertReportOutputOutsideState(root, output, requested as string);

  const ledger = new Ledger(ledgerPath(root), { readOnly: true });
  try {
    const report = await buildEvolutionReport({ root, ledger });
    const content = context.json ? `${JSON.stringify(report, null, 2)}\n` : formatEvolutionReport(report);
    if (output === null) {
      context.stdout(content);
      return 0;
    }
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, content, { mode: 0o600 });
    const relative = path.relative(realpathSync.native(root), realpathSync.native(output)).replaceAll('\\', '/');
    context.stdout(context.json ? jsonDocument(writePayload(relative, content)) : `Report written to ${relative}\n`);
    return 0;
  } finally {
    ledger.close();
  }
}
