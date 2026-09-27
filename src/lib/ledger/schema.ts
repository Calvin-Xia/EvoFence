/**
 * Ledger schema v2: the on-disk schema version marker, the DDL/pragmas, and the fail-closed
 * compatibility gate that refuses 0.3.0 (schema v1) ledgers.
 *
 * WHAT CHANGED IN v2 AND WHY (adr_0001: breaking change, no migration):
 *   - v2 stores its version identifier in the `state` table under the `schema_version` key.
 *     `state` is the one mutable, non-append-only table, so writing the marker adds no DDL and
 *     cannot touch the `events` chain, its triggers or any hashed column.
 *   - Opening a ledger that HAS an `events` table but does NOT declare schema v2 is refused
 *     with `LEDGER_SCHEMA_INCOMPATIBLE`. Nothing is converted, upgraded or downgraded, and the
 *     refusal happens before any pragma or DDL runs, so a v1 ledger is not even touched.
 *
 * WHAT DID NOT CHANGE (deliberate — `docs/refactor-inventory.md` §10.1):
 *   - the DDL, the three pragmas, the append-only triggers and their message text;
 *   - every hashed column and the digest recipe (see `chain.ts`);
 *   - the table set `Ledger.schemaTables()` reports.
 */

import type { LedgerTableName } from '../../types/ledger.js';
import { EvoFenceError } from '../errors.js';
import type { SqliteDatabase } from './driver-types.js';

/** The on-disk ledger schema version this build reads and writes. */
export const LEDGER_SCHEMA_VERSION = 2;

/** `state` key holding the on-disk ledger schema version marker. */
export const LEDGER_SCHEMA_VERSION_KEY = 'schema_version';

/** The three tables EvoFence owns (`Ledger.schemaTables()`, §4.1). */
export const LEDGER_TABLE_NAMES: readonly LedgerTableName[] = ['events', 'generations', 'state'];

/** Pragmas applied on every write-mode open, in the 0.3.0 order (`src/lib/ledger.js:28-30`). */
const WRITE_PRAGMAS: readonly string[] = ['foreign_keys = ON', 'journal_mode = WAL', 'synchronous = FULL'];

/** Idempotent DDL; SQL text identical to `src/lib/ledger.js:31-60` (only indentation differs). */
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  run_id TEXT,
  payload_json TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS generations (
  generation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sha TEXT NOT NULL,
  parent_sha TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS generations_no_update BEFORE UPDATE ON generations
  BEGIN SELECT RAISE(ABORT, 'generations are append-only'); END;
CREATE TRIGGER IF NOT EXISTS generations_no_delete BEFORE DELETE ON generations
  BEGIN SELECT RAISE(ABORT, 'generations are append-only'); END;
`;

/** What the on-disk schema looks like before any pragma or DDL runs. */
export interface LedgerSchemaProbe {
  /** An `events` table exists: the database carries an EvoFence ledger, not an empty file. */
  hasEvents: boolean;
  /** A `state` table exists: the version marker can live there. */
  hasState: boolean;
  /** Raw `state.schema_version` value, or `null` when the table or the row is absent. */
  version: string | null;
}

interface TableNameRow {
  name: string;
}

interface StateValueRow {
  value: string;
}

const CURRENT_VERSION = String(LEDGER_SCHEMA_VERSION);

/**
 * Reads the schema shape with plain `sqlite_master` / `state` lookups.
 *
 * This runs before any pragma or DDL so a rejected ledger is left untouched, and it stays
 * cheap for the empty/foreign databases `evofence status` is expected to classify.
 */
export function probeSchema(db: SqliteDatabase): LedgerSchemaProbe {
  const tables = db.prepare<TableNameRow>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('events', 'state')",
  ).all();
  const names = new Set(tables.map((row) => row.name));
  const hasEvents = names.has('events');
  const hasState = names.has('state');
  if (!hasEvents || !hasState) return { hasEvents, hasState, version: null };
  const marker = db.prepare<StateValueRow>('SELECT value FROM state WHERE key = ?').get(LEDGER_SCHEMA_VERSION_KEY);
  return { hasEvents, hasState, version: marker ? marker.value : null };
}

function describeObservedSchema(probe: LedgerSchemaProbe): string {
  if (!probe.hasState) {
    return 'no schema version marker (its `state` table is missing, so the version cannot be proven)';
  }
  if (probe.version === null) {
    return 'no schema version marker, which is the 0.3.0 (ledger schema v1) format';
  }
  return `schema version ${probe.version}`;
}

/**
 * The explicit incompatibility notice. Deliberately spells out that no migration exists
 * (adr_0001) so the failure can never be mistaken for a transient read error.
 */
export function incompatibleLedgerMessage(filename: string, probe: LedgerSchemaProbe): string {
  return `Ledger ${filename} declares ${describeObservedSchema(probe)}; `
    + `this build reads and writes ledger schema v${LEDGER_SCHEMA_VERSION} only. `
    + 'Ledger schema v2 is a breaking change and no migration is provided (adr_0001), '
    + 'so the ledger is refused instead of being converted or downgraded.';
}

/**
 * Fail-closed compatibility gate, used for read-only and write-mode opens alike.
 *
 * A database without an `events` table is left to the existing empty-ledger handling: a
 * zero-byte file, an interrupted creation and a foreign schema all have "no EvoFence schema
 * yet" and must keep behaving exactly as they did in 0.3.0 (`src/cli.js` classifies them).
 * Anything that HAS an events table must prove schema v2.
 */
export function assertCompatibleSchema(probe: LedgerSchemaProbe, filename: string): void {
  if (!probe.hasEvents) return;
  if (probe.hasState && probe.version === CURRENT_VERSION) return;
  throw new EvoFenceError('LEDGER_SCHEMA_INCOMPATIBLE', incompatibleLedgerMessage(filename, probe));
}

/** Applies the three write-mode pragmas (`foreign_keys`, `journal_mode`, `synchronous`). */
export function configureWritePragmas(db: SqliteDatabase): void {
  for (const pragma of WRITE_PRAGMAS) db.pragma(pragma);
}

/** Creates the v2 tables and append-only triggers; idempotent. */
export function createSchema(db: SqliteDatabase): void {
  db.exec(SCHEMA_DDL);
}

/**
 * Writes the v2 version marker once, and only when it is not already correct — a v2 ledger
 * opened for writing must not be modified merely by opening it.
 */
export function markSchemaVersion(db: SqliteDatabase, probe: LedgerSchemaProbe): void {
  if (probe.hasEvents && probe.hasState && probe.version === CURRENT_VERSION) return;
  db.prepare(
    "INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(LEDGER_SCHEMA_VERSION_KEY, CURRENT_VERSION);
}
