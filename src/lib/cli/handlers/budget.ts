/** `evofence budget` — deterministic, read-only ledger budget forecast. */
import { EvoFenceError } from '../../errors.js';
import { repositoryRoot } from '../../git.js';
import { Ledger, ledgerPath } from '../../ledger.js';
import { buildBudgetForecast, formatBudgetForecast } from '../../report.js';
import { jsonDocument } from '../output.js';
import type { CommandContext } from './context.js';

export async function commandBudget(context: CommandContext): Promise<number> {
  const root = await repositoryRoot(context.cwd);
  const ledger = new Ledger(ledgerPath(root), { readOnly: true });
  try {
    let snapshot;
    try {
      snapshot = ledger.readSnapshot();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new EvoFenceError('LEDGER_UNAVAILABLE', `Cannot parse the ledger at ${ledgerPath(root)}.`);
      }
      throw error;
    }
    if (!snapshot.integrity.valid) {
      throw new EvoFenceError('LEDGER_CORRUPT', `SQLite ledger hash chain failed at event ${snapshot.integrity.sequence}.`);
    }
    const forecast = buildBudgetForecast(snapshot);
    context.stdout(context.json ? jsonDocument(forecast) : formatBudgetForecast(forecast));
    return 0;
  } finally {
    ledger.close();
  }
}
