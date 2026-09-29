/**
 * Ledger domain entry point: SQLite audit ledger with a sha256 hash chain (schema v2).
 *
 * This file is the R1-stable path of `src/lib/ledger.js`; the domain's mechanics live in
 * `src/lib/ledger/` (`chain.ts`, `schema.ts`, `queries.ts`, `summaries.ts`, `driver*.ts`) and
 * this class is the facade that keeps the 0.3.0 export surface — `Ledger`, `ledgerPath` —
 * and every method's semantics intact (`docs/refactor-l2-protocol.md` R1/R2/R3).
 *
 * UNCHANGED FROM 0.3.0: the hash chain recipe, the DDL, the pragmas, the append-only triggers,
 * the write order (generation row -> `generation.accepted` event -> `state` upsert, one
 * transaction), every read view, and the `better-sqlite3` static top-level load (§10.1, §10.5,
 * §11.3). No method signature changed; no digest input changed.
 *
 * CHANGED IN v2 (adr_0001, breaking, no migration): a ledger must declare `schema v2` before
 * it can be opened — see {@link assertCompatibleSchema}. 0.3.0 ledgers are refused with
 * `LEDGER_SCHEMA_INCOMPATIBLE` instead of being read, converted or downgraded.
 */

import path from 'node:path';
import type { Hash256Hex } from '../types/shared.js';
import type {
  GenerationRecord,
  LedgerEvent,
  LedgerEventRecord,
  LedgerEventType,
  LedgerExport,
  LedgerSnapshot,
  LedgerTableName,
  LedgerVerification,
  RecentRunSummary,
} from '../types/ledger.js';
import { ZERO_HASH } from '../types/ledger.js';
import { EvoFenceError } from './errors.js';
import { stableStringify } from './fs.js';
import { eventHash, verifyChain } from './ledger/chain.js';
import type { SqliteDatabase, SqliteStatement } from './ledger/driver-types.js';
import { openDatabase } from './ledger/driver.js';
import {
  buildExport,
  findActiveGeneration,
  findGeneration,
  listEventRecords,
  listEvents,
  listGenerations,
  listTables,
} from './ledger/queries.js';
import {
  LEDGER_SCHEMA_VERSION,
  LEDGER_SCHEMA_VERSION_KEY,
  assertCompatibleSchema,
  configureWritePragmas,
  createSchema,
  markSchemaVersion,
  probeSchema,
} from './ledger/schema.js';
import { summarizeRuns } from './ledger/summaries.js';

export { LEDGER_SCHEMA_VERSION, LEDGER_SCHEMA_VERSION_KEY } from './ledger/schema.js';
export { verifyBundle } from './ledger/bundle.js';

/** Row shape of the `(seq, event_hash)` lookup that seeds the next event. */
interface LatestEventRow {
  seq: number;
  event_hash: Hash256Hex;
}

/** What `recordGeneration()` needs; it fills `created_at` when the caller omits it. */
export interface GenerationInput {
  generation_id: string;
  run_id: string;
  sha: string;
  parent_sha: string;
  created_at?: string;
}

export class Ledger {
  filename: string;
  readOnly: boolean;
  db: SqliteDatabase;
  insertEvent!: SqliteStatement<unknown>;
  latestEvent!: SqliteStatement<LatestEventRow>;
  insertEventTx!: (eventType: string, runId: string | null, payload: unknown) => LedgerEvent;
  recordGenerationTx!: (generation: GenerationRecord) => void;
  rollbackTx!: (generationId: string) => GenerationRecord;

  constructor(filename: string, { readOnly = false }: { readOnly?: boolean } = {}) {
    this.filename = path.resolve(filename);
    this.readOnly = readOnly;
    this.db = openDatabase(this.filename, readOnly
      ? { readonly: true, fileMustExist: true, timeout: 5000 }
      : { timeout: 5000 });

    // Every failure below (an incompatible schema, an unreadable file, a failing pragma or DDL)
    // must release the native handle: a refused ledger must not leave a connection, a `-wal` or
    // a `-shm` file behind for a caller that catches the error and keeps running.
    try {
      const probe = probeSchema(this.db);
      assertCompatibleSchema(probe, this.filename);
      if (readOnly) return;

      this.db.pragma('foreign_keys = ON');
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
      createSchema(this.db);
      markSchemaVersion(this.db, probe);

      this.insertEvent = this.db.prepare(`
        INSERT INTO events (seq, created_at, event_type, run_id, payload_json, previous_hash, event_hash)
        VALUES (@seq, @created_at, @event_type, @run_id, @payload_json, @previous_hash, @event_hash)
      `);
      this.latestEvent = this.db.prepare('SELECT seq, event_hash FROM events ORDER BY seq DESC LIMIT 1');
      this.insertEventTx = this.db.transaction((eventType: string, runId: string | null, payload: unknown) => this.#insertEvent(eventType, runId, payload));
      this.recordGenerationTx = this.db.transaction((generation: GenerationRecord) => {
        this.db.prepare(`INSERT INTO generations (generation_id, run_id, sha, parent_sha, created_at)
          VALUES (@generation_id, @run_id, @sha, @parent_sha, @created_at)`).run(generation);
        this.#insertEvent('generation.accepted', generation.run_id, generation);
        this.db.prepare(`INSERT INTO state (key, value) VALUES ('active_generation', @value)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run({ value: generation.generation_id });
      });
      this.rollbackTx = this.db.transaction((generationId: string) => {
        const generation = findGeneration(this.db, generationId);
        if (!generation) throw new EvoFenceError('GENERATION_NOT_FOUND', `Generation not found: ${generationId}`);
        this.#insertEvent('generation.rollback', null, { generation_id: generationId, sha: generation.sha });
        this.db.prepare(`INSERT INTO state (key, value) VALUES ('active_generation', @value)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run({ value: generationId });
        return generation;
      });
    } catch (error) {
      if (this.db.open) this.db.close();
      throw error;
    }
  }

  #insertEvent(eventType: string, runId: string | null, payload: unknown): LedgerEvent {
    const latest = this.latestEvent.get();
    const event: Omit<LedgerEventRecord, 'event_hash'> = {
      seq: (latest?.seq ?? 0) + 1,
      created_at: new Date().toISOString(),
      event_type: eventType as LedgerEventType,
      run_id: runId ?? null,
      payload_json: stableStringify(payload),
      previous_hash: latest?.event_hash ?? ZERO_HASH,
    };
    const record: LedgerEventRecord = { ...event, event_hash: eventHash(event) };
    this.insertEvent.run(record);
    return { ...record, payload: JSON.parse(record.payload_json) };
  }

  append(eventType: string, runId: string | null, payload: unknown): LedgerEvent {
    if (this.readOnly) throw new EvoFenceError('LEDGER_READ_ONLY', 'Cannot append events through a read-only ledger.');
    return this.insertEventTx(eventType, runId ?? null, payload);
  }

  recordGeneration(generation: GenerationInput): GenerationRecord {
    if (this.readOnly) throw new EvoFenceError('LEDGER_READ_ONLY', 'Cannot record generations through a read-only ledger.');
    const entry: GenerationRecord = {
      generation_id: generation.generation_id,
      run_id: generation.run_id,
      sha: generation.sha,
      parent_sha: generation.parent_sha,
      created_at: generation.created_at ?? new Date().toISOString(),
    };
    this.recordGenerationTx(entry);
    return entry;
  }

  rollback(generationId: string): GenerationRecord {
    if (this.readOnly) throw new EvoFenceError('LEDGER_READ_ONLY', 'Cannot roll back generations through a read-only ledger.');
    return this.rollbackTx(generationId);
  }

  activeGeneration(): GenerationRecord | null {
    return findActiveGeneration(this.db);
  }

  generation(generationId: string): GenerationRecord | null {
    return findGeneration(this.db, generationId);
  }

  generations(): GenerationRecord[] {
    return listGenerations(this.db);
  }

  events(runId: string | null = null): LedgerEvent[] {
    return listEvents(this.db, runId);
  }

  recentRuns(limit = 10): RecentRunSummary[] {
    return summarizeRuns(this.db, limit);
  }

  schemaTables(): LedgerTableName[] {
    return listTables(this.db);
  }

  verify(): LedgerVerification {
    return verifyChain(listEventRecords(this.db));
  }

  // One read transaction so verification and the summaries observe the same ledger
  // state even while an evolution run appends events from another process. Event
  // payloads are not parsed when the chain is invalid.
  readSnapshot(): LedgerSnapshot {
    return this.db.transaction(() => {
      const integrity = this.verify();
      return {
        integrity,
        events: integrity.valid ? this.events() : [],
        generations: this.generations(),
      };
    })();
  }

  export(): LedgerExport {
    const integrity = this.verify();
    return buildExport(integrity, this.activeGeneration(), this.generations(), this.events());
  }

  close(): void {
    if (this.db.open) this.db.close();
  }
}

export function ledgerPath(root: string): string {
  return path.join(root, '.evofence', 'ledger.sqlite');
}
