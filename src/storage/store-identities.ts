import { decode } from '../protocol/index.js';
import { canonical } from '../kernel/store/identity.js';
import { storeFail, storeOk } from '../kernel/store/contracts.js';
import type { Effect, StoreResult } from '../kernel/store/contracts.js';

/** Frozen Id grammar is ASCII and exact: reject aliases rather than trimming/normalizing them. */
export function uniqueIdentities<T>(rows: readonly T[], key: (row: T) => string): StoreResult<true> {
  const seen = new Map<string, T>();
  for (const row of rows) {
    if (row === null || typeof row !== 'object') return storeFail('EFK_SCHEMA_INVALID', 'identity-bearing content must be an object');
    const id = key(row), decoded = decode('Id', id);
    if (!decoded.ok) return decoded;
    if (id !== id.trim() || id !== id.normalize('NFC')) return storeFail('EFK_SCHEMA_INVALID', 'identity spelling must be canonical');
    if (seen.has(id)) {
      const same = canonical(seen.get(id)) === canonical(row);
      return storeFail('EFK_IDEMPOTENCY_COLLISION', `duplicate identity ${id} with ${same ? 'identical' : 'different'} content`, [id]);
    }
    seen.set(id, row);
  }
  return storeOk(true);
}

export function uniqueEffects(effects: readonly Effect[]): StoreResult<true> {
  const ids = uniqueIdentities(effects, row => row.effectId);
  return ids.ok ? uniqueIdentities(effects, row => row.idempotencyKey) : ids;
}
