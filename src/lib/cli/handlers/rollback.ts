/**
 * `evofence rollback <generation-id>` — move the active-generation ref backwards.
 *
 * DOMAIN: CLI handler (node `l2_cli`). Verifies the chain first (`LEDGER_CORRUPT` otherwise) and
 * never touches the primary working tree; `--json` adds the machine-readable view.
 */
import { EvoFenceError } from '../../errors.js';
import { repositoryRoot, setActiveGenerationRef } from '../../git.js';
import { Ledger, ledgerPath } from '../../ledger.js';
import { jsonDocument } from '../output.js';
import { positional, type CommandContext } from './context.js';

export async function commandRollback(context: CommandContext): Promise<number> {
  const generationId = positional(context, 0) as string;
  const root = await repositoryRoot(context.cwd);
  const ledger = new Ledger(ledgerPath(root));
  try {
    const integrity = ledger.verify();
    if (!integrity.valid) throw new EvoFenceError('LEDGER_CORRUPT', `SQLite ledger hash chain failed at event ${integrity.sequence}.`);
    const generation = ledger.rollback(generationId);
    await setActiveGenerationRef(root, generation.sha);
    if (context.json) context.stdout(jsonDocument({ generation_id: generationId, sha: generation.sha, working_tree_changed: false }));
    else context.stdout(`Active generation rolled back to ${generationId} (${generation.sha.slice(0, 12)}). The primary working tree was not changed.\n`);
    return 0;
  } finally {
    ledger.close();
  }
}
