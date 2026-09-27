/**
 * The sha256 hash chain: the product's core integrity primitive.
 *
 * The digest recipe is FROZEN (`docs/refactor-inventory.md` §4.4, §10.1). It is reproduced
 * byte for byte from `src/lib/ledger.js:8-16` / `:218-232`:
 *
 *     sha256(stableStringify({ seq, created_at, event_type, run_id, payload_json, previous_hash }))
 *
 * `event_hash` is the OUTPUT and never an input; `payload_json` is hashed as the raw string
 * that was stored, never re-serialised; `previous_hash` of `seq === 1` is {@link ZERO_HASH}.
 * `stableStringify` sorts object keys recursively, so the six keys above reach the hasher in
 * alphabetical order. Any change here silently invalidates every existing ledger, which is
 * exactly what `adr_0001` refuses to do.
 */

import type { EventHashInput, LedgerEventRecord, LedgerVerification } from '../../types/ledger.js';
import { ZERO_HASH } from '../../types/ledger.js';
import { sha256, stableStringify } from '../fs.js';

/**
 * `eventHash(event)` — the unkeyed digest of the six hashed columns.
 *
 * Copies the six fields explicitly (instead of hashing the row) so an added column can never
 * leak into the digest: `stableStringify` would otherwise sort it in and break every ledger.
 */
export function eventHash(event: EventHashInput): string {
  return sha256(stableStringify({
    seq: event.seq,
    created_at: event.created_at,
    event_type: event.event_type,
    run_id: event.run_id,
    payload_json: event.payload_json,
    previous_hash: event.previous_hash,
  }));
}

/**
 * `Ledger.verify()`'s whole body: walks the rows in `seq` order and returns the FIRST row that
 * breaks the chain, or the chain head. Three independent checks per row (§4.4):
 *
 *   1. `seq` is contiguous (`row.seq === index + 1`) — a deleted, inserted or skipped row;
 *   2. `previous_hash` links to the previous row's digest — a rewritten predecessor or reorder;
 *   3. `eventHash(row) === row.event_hash` — any hashed column of this row was changed.
 *
 * `payload_json` is never parsed here, so rewriting a payload is always caught by check 3.
 */
export function verifyChain(rows: LedgerEventRecord[]): LedgerVerification {
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
