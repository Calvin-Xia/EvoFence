/**
 * `ledger show | verify | recent | export` — the ledger read/export surface.
 *
 * DOMAIN: CLI handler (node `l2_cli`). `show`/`verify`/`recent` open the ledger read-only (0.3.0
 * only opens it read-only for those three actions, so `export` keeps the read-write open and the
 * "a missing ledger is created" behaviour). Exit code `1` when the chain fails verification.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot } from '../../git.js';
import { Ledger, ledgerPath, verifyBundle } from '../../ledger.js';
import { jsonDocument, repoRelativePath } from '../output.js';
import { positional, stringOption, type CommandContext } from './context.js';

const READ_ONLY_ACTIONS = new Set(['show', 'verify', 'recent']);

async function withLedger<T>(context: CommandContext, action: string, run: (ledger: Ledger, root: string) => Promise<T> | T): Promise<T> {
  const root = await repositoryRoot(context.cwd);
  const ledger = new Ledger(ledgerPath(root), { readOnly: READ_ONLY_ACTIONS.has(action) });
  try {
    return await run(ledger, root);
  } finally {
    ledger.close();
  }
}

/** `ledger show [run-id]` — raw events (payloads included, exactly as 0.3.0 printed them). */
export async function commandLedgerShow(context: CommandContext): Promise<number> {
  return withLedger(context, 'show', (ledger) => {
    context.stdout(jsonDocument(ledger.events(positional(context, 0) ?? null)));
    return 0;
  });
}

/** `ledger verify` — hash-chain verification (a downstream DoD entry point). */
export async function commandLedgerVerify(context: CommandContext): Promise<number> {
  const bundle = stringOption(context, 'bundle');
  if (bundle !== undefined) {
    const content = await readFile(path.resolve(context.cwd, bundle), 'utf8');
    const result = verifyBundle(JSON.parse(content));
    context.stdout(jsonDocument(result));
    return result.valid ? 0 : 1;
  }

  return withLedger(context, 'verify', (ledger) => {
    const result = ledger.verify();
    context.stdout(jsonDocument(result));
    return result.valid ? 0 : 1;
  });
}

/** `ledger recent [limit]` — sanitized run summaries, newest first. */
export async function commandLedgerRecent(context: CommandContext): Promise<number> {
  return withLedger(context, 'recent', (ledger) => {
    const value = positional(context, 0);
    context.stdout(jsonDocument(ledger.recentRuns(value === undefined ? 10 : Number(value))));
    return 0;
  });
}

/**
 * `ledger export [file]` — write the bundle to a NEW file (`wx`, mode 0600) and report the path.
 * Shared with `experiment export`, which only differs in the default filename (0.3.0).
 */
export async function exportLedger(context: CommandContext, value: string | undefined): Promise<number> {
  return withLedger(context, 'export', async (ledger, root) => {
    const output = path.resolve(context.cwd, value ?? `.evofence/experiment-${new Date().toISOString().slice(0, 10)}.json`);
    await writeFile(output, `${JSON.stringify(ledger.export(), null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const relative = repoRelativePath(root, output);
    if (context.json) context.stdout(jsonDocument({ exported: relative }));
    else context.stdout(`Experiment evidence exported to ${relative}\n`);
    return 0;
  });
}

/** `ledger export [file]`. */
export async function commandLedgerExport(context: CommandContext): Promise<number> {
  return exportLedger(context, positional(context, 0));
}
