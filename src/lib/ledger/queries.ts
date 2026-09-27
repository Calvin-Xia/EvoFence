/**
 * Read-only ledger views: the SELECTs behind `Ledger.events()`, `generations()`,
 * `generation()`, `activeGeneration()`, `schemaTables()` and `export()`.
 *
 * Every query is the 0.3.0 query (`src/lib/ledger.js:122-155, :218-248`) with the row shape
 * named. Two contracts are load-bearing and deliberately preserved:
 *
 *   - `events()` returns `{ ...row, payload: JSON.parse(row.payload_json) }` — the payload is
 *     parsed lazily, only for callers that ask for it, and a tampered scalar/array/null
 *     payload is handed over as-is (`docs/refactor-inventory.md` §10.4).
 *   - `activeGeneration()` resolves the `state.active_generation` pointer through the
 *     `generations` table, and returns `null` when either side is missing.
 */

import type {
  GenerationRecord,
  LedgerEvent,
  LedgerEventRecord,
  LedgerExport,
  LedgerTableName,
  LedgerVerification,
} from '../../types/ledger.js';
import { ACTIVE_GENERATION_STATE_KEY } from '../../types/ledger.js';
import type { SqliteDatabase } from './driver-types.js';

interface StateValueRow {
  value: string;
}

interface TableNameRow {
  name: string;
}

/** Every row of `events` in chain order — the input of {@link import('./chain.js').verifyChain}. */
export function listEventRecords(db: SqliteDatabase): LedgerEventRecord[] {
  return db.prepare<LedgerEventRecord>('SELECT * FROM events ORDER BY seq').all();
}

/** `Ledger.events(runId)`: rows plus their parsed `payload`. */
export function listEvents(db: SqliteDatabase, runId: string | null = null): LedgerEvent[] {
  const rows = runId
    ? db.prepare<LedgerEventRecord>('SELECT * FROM events WHERE run_id = ? ORDER BY seq').all(runId)
    : listEventRecords(db);
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
}

/** `Ledger.generations()`: history in `(created_at, generation_id)` order. */
export function listGenerations(db: SqliteDatabase): GenerationRecord[] {
  return db.prepare<GenerationRecord>('SELECT * FROM generations ORDER BY created_at, generation_id').all();
}

/** `Ledger.generation(id)`: one row or `null`. */
export function findGeneration(db: SqliteDatabase, generationId: string): GenerationRecord | null {
  return db.prepare<GenerationRecord>('SELECT * FROM generations WHERE generation_id = ?').get(generationId) ?? null;
}

/**
 * `Ledger.activeGeneration()`: follows the `state.active_generation` pointer, or `null` when
 * the pointer is absent or points at a generation that no longer exists.
 */
export function findActiveGeneration(db: SqliteDatabase): GenerationRecord | null {
  const active = db.prepare<StateValueRow>('SELECT value FROM state WHERE key = ?').get(ACTIVE_GENERATION_STATE_KEY);
  if (!active) return null;
  return findGeneration(db, active.value);
}

/** `Ledger.schemaTables()`: which of the three owned tables exist, in SQLite's order. */
export function listTables(db: SqliteDatabase): LedgerTableName[] {
  // The WHERE ... IN (...) clause already restricts `name` to the three owned table names.
  return db.prepare<TableNameRow>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('events', 'generations', 'state')",
  ).all().map((row) => row.name as LedgerTableName);
}

/**
 * `Ledger.export()`: the frozen export bundle. `schema_version: 1` here is the BUNDLE shape
 * (see {@link LedgerExport}), not the on-disk ledger schema version — the on-disk version is
 * `state.schema_version` (`schema.ts`).
 */
export function buildExport(
  integrity: LedgerVerification,
  activeGeneration: GenerationRecord | null,
  generations: GenerationRecord[],
  events: LedgerEvent[],
): LedgerExport {
  return { schema_version: 1, integrity, active_generation: activeGeneration, generations, events };
}
