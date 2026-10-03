import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { canonical } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { EXPORT_PROTOCOL, FORMATS } from './types.js';
import type { LegacyExport, LegacyFormat } from './types.js';
import { recordsFrom } from './formats.js';
import { boundary, digest, external, keys, readRegular, reject, text } from './boundary.js';

function requireFormat(format: unknown): LegacyFormat {
  if (!(FORMATS as readonly unknown[]).includes(format)) reject('EFK_PROTOCOL_UNSUPPORTED', 'unsupported legacy source format');
  return format as LegacyFormat;
}
/** Explicit format selection avoids guessing an unversioned document's meaning. */
export function exportLegacy(file: string, format: LegacyFormat): StoreResult<LegacyExport> {
  return boundary(() => {
    requireFormat(format);
    const source = readRegular(file);
    if (format === 'ledger-sqlite-v2') {
      for (const suffix of ['-wal', '-journal']) {
        const sidecar = `${source.file}${suffix}`;
        if (external('EFK_ARTIFACT_UNAVAILABLE', 'cannot inspect snapshot sidecars', () => existsSync(sidecar) && statSync(sidecar).size > 0)) {
          reject('EFK_SOURCE_PIN_DRIFT', 'snapshot has a WAL or journal; supply a settled, complete copy');
        }
      }
    }
    const originalDigest = digest(source.bytes);
    const records = recordsFrom(source.bytes, format);
    if (digest(readRegular(source.file).bytes) !== originalDigest) reject('EFK_SOURCE_PIN_DRIFT', 'source changed during export');
    return { protocol: EXPORT_PROTOCOL, classification: 'historical-source', executable: false,
      source: { file: source.file, digest: originalDigest, byteLength: source.bytes.length, format },
      originalBase64: source.bytes.toString('base64'), records };
  });
}
/** Untrusted exports are decoded again at the import/read boundary; records cannot be forged. */
export function decodeExport(value: unknown): LegacyExport {
  const root = keys(value, ['protocol', 'classification', 'executable', 'source', 'originalBase64', 'records']);
  const protocol = keys(root.protocol, ['namespace', 'schemaVersion']);
  if (canonical(protocol) !== canonical(EXPORT_PROTOCOL)) reject('EFK_PROTOCOL_UNSUPPORTED', 'unsupported legacy export namespace/schema');
  if (root.classification !== 'historical-source' || root.executable !== false) reject('EFK_LEGACY_NOT_EXECUTABLE', 'legacy material must remain historical and non-executable');
  const source = keys(root.source, ['file', 'digest', 'byteLength', 'format']), format = requireFormat(source.format);
  if (!path.isAbsolute(text(source.file))) reject('EFK_SCHEMA_INVALID', 'source locator must be absolute');
  const encoded = text(root.originalBase64), bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || source.byteLength !== bytes.length || source.digest !== digest(bytes)) {
    reject('EFK_ARTIFACT_DIGEST_MISMATCH', 'legacy bytes differ from the pinned source digest/length');
  }
  if (canonical(root.records) !== canonical(recordsFrom(bytes, format))) reject('EFK_ARTIFACT_DIGEST_MISMATCH', 'legacy records differ from original bytes');
  return root as unknown as LegacyExport;
}
