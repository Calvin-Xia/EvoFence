/**
 * The single place the ledger domain touches the native `better-sqlite3` binding.
 *
 * LOADING CONTRACT (unchanged from 0.3.0, `docs/refactor-inventory.md` §11.3): this is a
 * STATIC top-level default import inside the ledger entry module's import graph, so every
 * CLI command — including `evofence --help` and `evofence ledger verify` — still loads the
 * native module eagerly. Do not turn this into a dynamic `import()` or `createRequire`: that
 * would change the install/load contract (`@ts-expect-error` below is the only difference
 * from the 0.3.0 line, and it is erased at build time).
 */

// `better-sqlite3` has no bundled type declarations, so this import has no types to resolve; the
// cast on the next statement pins the native module to the structural contract declared in
// `driver-types.ts`. Any real typing change must go through that interface, not through a cast
// at a call site.
// @ts-expect-error better-sqlite3 ships no type declarations and @types/better-sqlite3 is not a dependency
import Database from 'better-sqlite3';
import type { SqliteDatabase, SqliteFactory, SqliteOpenOptions } from './driver-types.js';

const createDatabase = Database as unknown as SqliteFactory;

/** Opens the ledger database with the 0.3.0 open options (`src/lib/ledger.js:23-25`). */
export function openDatabase(filename: string, options: SqliteOpenOptions): SqliteDatabase {
  return new createDatabase(filename, options);
}
