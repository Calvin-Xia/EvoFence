import { canonical } from '../../kernel/store/index.js';
import { LEDGER_EVENT_TYPES } from '../../types/ledger.js';
import type { JsonValue } from '../../types/shared.js';
import type { LegacyRecord } from './types.js';
import { array, json, keys, object, reject, text } from './boundary.js';

export const COLUMNS = {
  events: ['seq', 'created_at', 'event_type', 'run_id', 'payload_json', 'previous_hash', 'event_hash'],
  generations: ['generation_id', 'run_id', 'sha', 'parent_sha', 'created_at'],
  state: ['key', 'value'],
} as const;
function hash(value: unknown): string {
  const h = text(value);
  if (!/^[0-9a-f]{64}$/.test(h)) reject('EFK_SCHEMA_INVALID', 'invalid recorded legacy hash');
  return h;
}
/** Structural continuity only. Never computes or replaces an event_hash. */
export function ledgerRecords(events: unknown[], generations: unknown[], state: unknown[], bundle: boolean): LegacyRecord[] {
  let previous = '0'.repeat(64);
  const hashes = new Set<string>(), ids = new Set<string>();
  const records: LegacyRecord[] = events.map((value, index) => {
    const row = keys(value, bundle ? [...COLUMNS.events, 'payload'] : COLUMNS.events);
    const recordedHash = hash(row.event_hash), recordedPrevious = hash(row.previous_hash);
    if (row.seq !== index + 1 || recordedPrevious !== previous || hashes.has(recordedHash)) {
      reject('EFK_SCHEMA_INVALID', 'broken legacy sequence or recorded chain link');
    }
    previous = recordedHash; hashes.add(previous);
    text(row.created_at);
    if (!(LEDGER_EVENT_TYPES as readonly unknown[]).includes(row.event_type)) reject('EFK_SCHEMA_INVALID', 'unknown legacy event type');
    if (row.run_id !== null) text(row.run_id);
    const parsed = json(text(row.payload_json));
    if (bundle && canonical(parsed) !== canonical(row.payload)) reject('EFK_SCHEMA_INVALID', 'legacy payload differs from payload_json');
    return { kind: 'ledger-event', key: String(row.seq), value: row as JsonValue };
  });
  for (const value of generations) {
    const row = keys(value, COLUMNS.generations);
    for (const name of COLUMNS.generations) text(row[name]);
    const id = text(row.generation_id);
    if (ids.has(id)) reject('EFK_SCHEMA_INVALID', 'duplicate legacy generation');
    ids.add(id); records.push({ kind: 'generation', key: id, value: row as JsonValue });
  }
  const stateKeys = new Set<string>();
  for (const value of state) {
    const row = keys(value, COLUMNS.state), key = text(row.key);
    const stateValue = text(row.value);
    if (stateKeys.has(key)) reject('EFK_SCHEMA_INVALID', 'duplicate legacy state key');
    stateKeys.add(key); records.push({ kind: 'state', key, value: row as JsonValue });
    if (key === 'active_generation' && !ids.has(stateValue)) reject('EFK_SCHEMA_INVALID', 'dangling legacy generation pointer');
  }
  return records;
}
export function bundleRecords(value: unknown): LegacyRecord[] {
  const root = object(value);
  if (root.schema_version !== 1) reject('EFK_PROTOCOL_UNSUPPORTED', 'only legacy bundle schema_version 1 is supported');
  keys(root, ['schema_version', 'integrity', 'active_generation', 'generations', 'events']);
  const events = array(root.events), generations = array(root.generations);
  const records = ledgerRecords(events, generations, [], true);
  const integrity = keys(root.integrity, ['valid', 'events', 'head']);
  const head = events.length === 0 ? '0'.repeat(64) : object(events[events.length - 1]).event_hash;
  if (integrity.valid !== true || integrity.events !== events.length || integrity.head !== head) {
    reject('EFK_SCHEMA_INVALID', 'legacy bundle records invalid integrity or a conflicting tip');
  }
  if (root.active_generation !== null && !generations.some(g => canonical(g) === canonical(root.active_generation))) {
    reject('EFK_SCHEMA_INVALID', 'legacy bundle active generation is not in its generation list');
  }
  records.push({ kind: 'bundle-metadata', key: 'metadata', value: {
    integrity: root.integrity as JsonValue, active_generation: root.active_generation as JsonValue, schema_version: 1,
  } });
  return records;
}
