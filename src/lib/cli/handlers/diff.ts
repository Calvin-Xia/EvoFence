/**
 * `evofence diff <generation-id>` — the verified generation diff (F1 surface).
 *
 * DOMAIN: CLI handler (node `l2_cli`). Fails closed through `generationDiff`; this handler only
 * renders `--json` or the Markdown-ish text view.
 */
import { formatGenerationDiff, generationDiff } from '../../audit.js';
import { repositoryRoot } from '../../git.js';
import { Ledger, ledgerPath } from '../../ledger.js';
import { jsonDocument } from '../output.js';
import { positional, type CommandContext } from './context.js';

export async function commandDiff(context: CommandContext): Promise<number> {
  const generationId = positional(context, 0) as string;
  const root = await repositoryRoot(context.cwd);
  const ledger = new Ledger(ledgerPath(root), { readOnly: true });
  try {
    const report = await generationDiff({ root, ledger, generationId });
    if (context.json) context.stdout(jsonDocument(report));
    else {
      const text = formatGenerationDiff(report);
      context.stdout(text.endsWith('\n') ? text : `${text}\n`);
    }
    return 0;
  } finally {
    ledger.close();
  }
}
