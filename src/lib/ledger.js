import Database from 'better-sqlite3';
import path from 'node:path';
import { EvoFenceError } from './errors.js';
import { sha256, stableStringify } from './fs.js';

const ZERO_HASH = '0'.repeat(64);

function eventHash(event) {
  return sha256(stableStringify({
    seq: event.seq,
    created_at: event.created_at,
    event_type: event.event_type,
    run_id: event.run_id,
    payload_json: event.payload_json,
    previous_hash: event.previous_hash,
  }));
}

export class Ledger {
  constructor(filename) {
    this.filename = path.resolve(filename);
    this.db = new Database(this.filename, { timeout: 5000 });
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec(`
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
    `);
    this.insertEvent = this.db.prepare(`
      INSERT INTO events (seq, created_at, event_type, run_id, payload_json, previous_hash, event_hash)
      VALUES (@seq, @created_at, @event_type, @run_id, @payload_json, @previous_hash, @event_hash)
    `);
    this.latestEvent = this.db.prepare('SELECT seq, event_hash FROM events ORDER BY seq DESC LIMIT 1');
    this.insertEventTx = this.db.transaction((eventType, runId, payload) => this.#insertEvent(eventType, runId, payload));
    this.recordGenerationTx = this.db.transaction((generation) => {
      this.db.prepare(`INSERT INTO generations (generation_id, run_id, sha, parent_sha, created_at)
        VALUES (@generation_id, @run_id, @sha, @parent_sha, @created_at)`).run(generation);
      this.#insertEvent('generation.accepted', generation.run_id, generation);
      this.db.prepare(`INSERT INTO state (key, value) VALUES ('active_generation', @value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run({ value: generation.generation_id });
    });
    this.rollbackTx = this.db.transaction((generationId) => {
      const generation = this.db.prepare('SELECT * FROM generations WHERE generation_id = ?').get(generationId);
      if (!generation) throw new EvoFenceError('GENERATION_NOT_FOUND', `Generation not found: ${generationId}`);
      this.#insertEvent('generation.rollback', null, { generation_id: generationId, sha: generation.sha });
      this.db.prepare(`INSERT INTO state (key, value) VALUES ('active_generation', @value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run({ value: generationId });
      return generation;
    });
  }

  #insertEvent(eventType, runId, payload) {
    const latest = this.latestEvent.get();
    const event = {
      seq: (latest?.seq ?? 0) + 1,
      created_at: new Date().toISOString(),
      event_type: eventType,
      run_id: runId ?? null,
      payload_json: stableStringify(payload),
      previous_hash: latest?.event_hash ?? ZERO_HASH,
    };
    event.event_hash = eventHash(event);
    this.insertEvent.run(event);
    return { ...event, payload: JSON.parse(event.payload_json) };
  }

  append(eventType, runId, payload) {
    return this.insertEventTx(eventType, runId ?? null, payload);
  }

  recordGeneration(generation) {
    const entry = {
      generation_id: generation.generation_id,
      run_id: generation.run_id,
      sha: generation.sha,
      parent_sha: generation.parent_sha,
      created_at: generation.created_at ?? new Date().toISOString(),
    };
    this.recordGenerationTx(entry);
    return entry;
  }

  rollback(generationId) {
    return this.rollbackTx(generationId);
  }

  activeGeneration() {
    const active = this.db.prepare("SELECT value FROM state WHERE key = 'active_generation'").get();
    if (!active) return null;
    return this.db.prepare('SELECT * FROM generations WHERE generation_id = ?').get(active.value) ?? null;
  }

  generation(generationId) {
    return this.db.prepare('SELECT * FROM generations WHERE generation_id = ?').get(generationId) ?? null;
  }

  generations() {
    return this.db.prepare('SELECT * FROM generations ORDER BY created_at, generation_id').all();
  }

  events(runId = null) {
    const rows = runId
      ? this.db.prepare('SELECT * FROM events WHERE run_id = ? ORDER BY seq').all(runId)
      : this.db.prepare('SELECT * FROM events ORDER BY seq').all();
    return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
  }

  verify() {
    const rows = this.db.prepare('SELECT * FROM events ORDER BY seq').all();
    let previous = ZERO_HASH;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.seq !== index + 1 || row.previous_hash !== previous || eventHash(row) !== row.event_hash) {
        return { valid: false, sequence: row.seq, expected_previous_hash: previous, observed_hash: row.event_hash };
      }
      previous = row.event_hash;
    }
    return { valid: true, events: rows.length, head: previous };
  }

  export() {
    const integrity = this.verify();
    return { schema_version: 1, integrity, active_generation: this.activeGeneration(), generations: this.generations(), events: this.events() };
  }

  close() {
    if (this.db.open) this.db.close();
  }
}

export function ledgerPath(root) {
  return path.join(root, '.evofence', 'ledger.sqlite');
}
