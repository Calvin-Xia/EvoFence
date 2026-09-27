/**
 * `evofence status` — operational overview (a downstream DoD entry point).
 *
 * DOMAIN: CLI handler (node `l2_cli`). Two behaviours matter here:
 *
 *   1. A missing / zero-byte / schema-less ledger is the documented EMPTY state; only a genuinely
 *      unreadable ledger is `LEDGER_UNAVAILABLE` (0.3.0, pinned by spec-f3).
 *   2. HANDOFF from `l2_config`: the wrapper used to rewrite every `buildStatus` failure as
 *      `LEDGER_UNAVAILABLE`, which turned a policy-validation failure into the wrong error code.
 *      Configuration codes are now re-thrown untouched, so `INVALID_CONTRACT` / `INVALID_CONFIG` /
 *      `UNSUPPORTED_CONTRACT` (and their `details`) survive to the caller and to `--json`.
 */
import { lstat } from 'node:fs/promises';
import { EvoFenceError } from '../../errors.js';
import { repositoryRoot } from '../../git.js';
import { Ledger, ledgerPath } from '../../ledger.js';
import { buildStatus, emptyStatus, formatStatus } from '../../status.js';
import { jsonDocument } from '../output.js';
import type { CommandContext } from './context.js';

/** Error codes owned by the policy validator (`src/lib/config`); never rewrapped. */
const CONFIGURATION_ERROR_CODES = new Set(['INVALID_CONTRACT', 'INVALID_CONFIG', 'UNSUPPORTED_CONTRACT']);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConfigurationError(error: unknown): boolean {
  const code = error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && CONFIGURATION_ERROR_CODES.has(code);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false;
    throw error;
  }
}

// A missing events table means the ledger carries no schema yet (for example a zero-byte file
// left by an interrupted creation) or a damaged partial schema. Only a database with no
// EvoFence schema at all is an empty ledger; a partial schema stays LEDGER_UNAVAILABLE.
function isMissingEventsSchema(error: unknown): boolean {
  const candidate = error as { code?: string; message?: unknown };
  return candidate?.code === 'SQLITE_ERROR' && /no such table: ['"]?events['"]?$/.test(String(candidate.message));
}

export async function commandStatus(context: CommandContext): Promise<number> {
  const root = await repositoryRoot(context.cwd);
  const file = ledgerPath(root);
  let status;
  if (!(await pathExists(file))) {
    status = emptyStatus(root);
  } else {
    let ledger;
    try {
      ledger = new Ledger(file, { readOnly: true });
    } catch (error) {
      throw new EvoFenceError('LEDGER_UNAVAILABLE', `Cannot open the ledger at ${file}: ${errorMessage(error)}`);
    }
    try {
      status = await buildStatus({ root, ledger });
    } catch (error) {
      if (isConfigurationError(error)) throw error;
      if (!isMissingEventsSchema(error) || ledger.schemaTables().length > 0) {
        throw new EvoFenceError('LEDGER_UNAVAILABLE', `Cannot read the ledger at ${file}: ${errorMessage(error)}`);
      }
      status = emptyStatus(root);
    } finally {
      ledger.close();
    }
  }
  if (context.json) context.stdout(jsonDocument(status));
  else context.stdout(`${formatStatus(status)}\n`);
  return status.integrity.valid ? 0 : 1;
}
