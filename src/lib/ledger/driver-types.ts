/**
 * Structural SQLite driver contracts for the audit ledger domain.
 *
 * `better-sqlite3` (12.11.1) ships no type declarations of its own and `@types/better-sqlite3`
 * is not a dependency of this package (`package.json` belongs to the base domain), so instead
 * of inventing a new dependency the ledger domain declares the exact slice of the driver API
 * it uses. `driver.ts` performs the single, documented cast that pins the native module to
 * {@link SqliteFactory}. Nothing here is designed: every member is called by the 0.3.0
 * implementation (`docs/refactor-inventory.md` §4.1, §10.5).
 *
 * The driver is used SYNCHRONOUSLY — `prepare().get()/all()/run()`, `exec()`, `transaction()`,
 * `pragma()` — which is a compatibility surface in its own right (§10.5 item 23): making any
 * of these async would change every `Ledger` signature and every ledger test.
 */

/** Open options `Ledger` actually passes (`src/lib/ledger.js:23-25`). */
export interface SqliteOpenOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  timeout?: number;
}

/** `Statement.run()` result, narrowed to the two fields the ledger reads. */
export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * A prepared statement. `Row` is the shape of one row as returned by `get()`/`all()`; the
 * ledger parameterises it per query with the table shape that query selects.
 */
export interface SqliteStatement<Row> {
  /** Binds named (`@name`) or positional parameters, then executes the statement once. */
  run(...params: unknown[]): SqliteRunResult;
  /** First matching row, or `undefined`. */
  get(...params: unknown[]): Row | undefined;
  /** Every matching row, in query order. */
  all(...params: unknown[]): Row[];
}

/** A synchronous `better-sqlite3` database handle. */
export interface SqliteDatabase {
  prepare<Row = unknown>(source: string): SqliteStatement<Row>;
  exec(source: string): unknown;
  pragma(source: string): unknown;
  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result;
  readonly open: boolean;
  close(): unknown;
}

/** The `better-sqlite3` default export: a constructor for {@link SqliteDatabase}. */
export interface SqliteFactory {
  new (filename: string, options?: SqliteOpenOptions): SqliteDatabase;
}
