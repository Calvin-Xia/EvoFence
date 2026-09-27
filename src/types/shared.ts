/**
 * Cross-cutting primitives and small domain enums shared by three or more L2 domains.
 *
 * DERIVED FROM: `src/lib/fs.js` (stableStringify/sha256 contract), `src/lib/errors.js`
 * (EvoFenceError.code), `src/lib/runner.js` + `src/lib/contract.js` + `src/lib/adapter.js`
 * (the four adapter names), `docs/refactor-inventory.md` §4.4 and §6.3 (hash + micro-USD
 * accounting).
 *
 * DEPENDENCY RULE: this module imports nothing. It sits at the bottom of the type graph
 * so every other `src/types/*` module may depend on it without creating a cycle.
 */

/** JSON scalar as parsed by `JSON.parse` — never `undefined`. */
export type JsonPrimitive = string | number | boolean | null;

/**
 * JSON value with the exact semantics of `JSON.parse`: no `undefined`, no functions,
 * no symbols. `stableStringify` (src/lib/fs.js) sorts object keys recursively, so the
 * declared key order here carries no meaning.
 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Object-shaped {@link JsonValue}. Ledger payloads may also be scalars/arrays. */
export type JsonObject = { [key: string]: JsonValue };

/** Lowercase hex SHA-256 digest, 64 characters (`src/lib/fs.js:17-19`). */
export type Hash256Hex = string;

/**
 * The all-zero digest a chain's first event points back to.
 * `ZERO_HASH = '0'.repeat(64)` in `src/lib/ledger.js:6`.
 */
export const ZERO_HASH: Hash256Hex = '0'.repeat(64);

/** `EvoFenceError.code`. An open set of string literals — no constant table exists in 0.3.0. */
export type EvoFenceErrorCode = string;

/** Path relative to the repository root, always using `/` separators. */
export type RepoRelativePath = string;

/**
 * An integral USD amount scaled by 1e6 (micro-dollars), matching `USD_MICROS` in
 * `src/lib/runner.js:15` and the BigInt rounding in `usdToMicros` (`src/lib/runner.js:41`,
 * `src/lib/adapter.js:26`). Never a float dollar amount.
 */
export type UsdMicros = number;

/** The four agent CLIs EvoFence can drive. Validated in `src/lib/runner.js:19`, dispatched in `src/lib/adapter.js`. */
export const ADAPTER_NAMES = ['codex', 'opencode', 'claude', 'pi'] as const;

/** Union derived from {@link ADAPTER_NAMES} so the list and the type cannot drift apart. */
export type AdapterName = (typeof ADAPTER_NAMES)[number];

/**
 * Every status `runEvolution` can write to `run.finished` (`src/lib/runner.js`: lines 501/510,
 * 523, 546/556/615/631/642/686/703/728/771/789/809, 831, 837). `RUNNING` is the in-memory
 * initial value and is replaced before any `run.finished` append.
 */
export const RUN_OUTCOME_STATUSES = [
  'RUNNING',
  'ACCEPTED',
  'PLATEAU',
  'ESCALATE',
  'QUARANTINE',
  'BASELINE_UNHEALTHY',
  'RESOURCE_EXHAUSTED',
  'HARNESS_ERROR',
] as const;

export type RunOutcomeStatus = (typeof RUN_OUTCOME_STATUSES)[number];

/**
 * A signal name as Node reports it on `child_process` `close`, or the reason a process ended.
 *
 * Deliberately declared as an open string type instead of `NodeJS.Signals`: the two `signal`
 * fields below end up in PUBLISHED declarations (adr_0002 ships `dist/*.d.ts`), and a bare
 * `NodeJS.Signals` reference fails to compile for any consumer that has not installed
 * `@types/node`. The runtime value is whatever Node supplies — a signal name like `'SIGTERM'`,
 * or `null` when the child exited normally.
 */
export type ProcessSignal = string & {};

/**
 * The status a ledger read view can report: the outcome statuses plus the read-side sentinels
 * `Ledger.recentRuns`/`summarizeRuns` synthesize — `INCOMPLETE` (no terminal event),
 * `FINISHED` (terminal event without a usable `status` string) and `FAILED` (`run.failed`).
 *
 * Kept open (`& {}`) because ledger reads are defensive: `payload_json` is raw TEXT, so a
 * tampered ledger can hold any string here. `INCOMPLETE` is never persisted to the ledger;
 * it only ever exists in a read view.
 */
export type RunSummaryStatus =
  | RunOutcomeStatus
  | 'INCOMPLETE'
  | 'FINISHED'
  | 'FAILED'
  | (string & {});
