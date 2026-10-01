import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error better-sqlite3 ships no types; no dependency installation is needed.
import Database from 'better-sqlite3';
import type { SqliteDatabase, SqliteFactory } from '../../lib/ledger/driver-types.js';
import type { LegacyRecord } from './types.js';
import { COLUMNS, ledgerRecords } from './ledger.js';
import { external, reject } from './boundary.js';

const open = Database as SqliteFactory;
function snapshotRecords(db: SqliteDatabase): LegacyRecord[] {
  const tables = db.prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  if (tables.map(t => t.name).join(',') !== 'events,generations,state') reject('EFK_SCHEMA_INVALID', 'unsupported legacy SQLite table set');
  for (const [table, expected] of Object.entries(COLUMNS)) {
    const fields = db.prepare<{ name: string; type: string; pk: number; notnull: number }>(`PRAGMA table_info(${table})`).all();
    if (fields.length !== expected.length || fields.some((f, i) => f.name !== expected[i] ||
      f.type.toUpperCase() !== (table === 'events' && i === 0 ? 'INTEGER' : 'TEXT') ||
      f.pk !== (i === 0 ? 1 : 0) || f.notnull !== (i === 0 || f.name === 'run_id' && table === 'events' ? 0 : 1))) {
      reject('EFK_SCHEMA_INVALID', 'unsupported legacy SQLite columns');
    }
  }
  const version = db.prepare<{ value: string }>("SELECT value FROM state WHERE key='schema_version'").get();
  if (version?.value !== '2') reject('EFK_PROTOCOL_UNSUPPORTED', 'only explicitly marked legacy ledger schema v2 is supported; unmarked v1 is refused');
  const integrity = db.prepare<{ integrity_check: string }>('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') reject('EFK_SCHEMA_INVALID', 'damaged legacy SQLite snapshot');
  return ledgerRecords(db.prepare('SELECT * FROM events ORDER BY seq').all(),
    db.prepare('SELECT * FROM generations ORDER BY generation_id').all(), db.prepare('SELECT * FROM state ORDER BY key').all(), false);
}
/** SQLite only ever opens a private, disposable copy, with readonly + fileMustExist. */
export function sqliteRecords(bytes: Buffer): LegacyRecord[] {
  const scratch = external('EFK_ARTIFACT_UNAVAILABLE', 'cannot create legacy snapshot', () => mkdtempSync(path.join(os.tmpdir(), 'efk-legacy-')));
  try {
    const file = path.join(scratch, 'snapshot.sqlite');
    external('EFK_ARTIFACT_UNAVAILABLE', 'cannot write private snapshot', () => writeFileSync(file, bytes, { flag: 'wx' }));
    const db = external('EFK_SCHEMA_INVALID', 'unreadable legacy SQLite snapshot', () => new open(file, { readonly: true, fileMustExist: true }));
    try { return external('EFK_SCHEMA_INVALID', 'unreadable legacy SQLite schema', () => snapshotRecords(db)); }
    finally { db.close(); }
  } finally { rmSync(scratch, { recursive: true }); }
}
