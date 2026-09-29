import { isDeepStrictEqual } from 'node:util';
import type { LedgerExport, LedgerVerification } from '../../types/ledger.js';
import { EvoFenceError } from '../errors.js';
import { verifyChain } from './chain.js';

const BUNDLE_SCHEMA_VERSION = 1;

/** Verify an exported ledger bundle without opening the local SQLite ledger. */
export function verifyBundle(bundle: LedgerExport): LedgerVerification {
  if (bundle.schema_version !== BUNDLE_SCHEMA_VERSION) {
    throw new EvoFenceError(
      'LEDGER_BUNDLE_INCOMPATIBLE',
      `Unsupported ledger bundle schema_version ${String(bundle.schema_version)}; expected ${BUNDLE_SCHEMA_VERSION}.`,
    );
  }

  for (const event of bundle.events) {
    let payload: unknown;
    try {
      payload = JSON.parse(event.payload_json);
    } catch {
      throw new EvoFenceError(
        'LEDGER_BUNDLE_PAYLOAD_MISMATCH',
        `Bundle payload does not match payload_json at event sequence ${event.seq}: payload_json is not valid JSON.`,
      );
    }
    if (!isDeepStrictEqual(event.payload, payload)) {
      throw new EvoFenceError(
        'LEDGER_BUNDLE_PAYLOAD_MISMATCH',
        `Bundle payload does not match payload_json at event sequence ${event.seq}.`,
      );
    }
  }
  const computed = verifyChain(bundle.events);
  if (!computed.valid) return computed;
  if (!bundle.integrity.valid) return bundle.integrity;
  if (bundle.integrity.events !== computed.events || bundle.integrity.head !== computed.head) {
    return {
      valid: false,
      sequence: computed.events + 1,
      expected_previous_hash: computed.head,
      observed_hash: bundle.integrity.head,
    };
  }
  return computed;
}
