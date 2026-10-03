import type { JsonValue } from '../../types/shared.js';

/** Local storage formats only: these are neither runtime DTOs nor asset qualifications. */
export const EXPORT_PROTOCOL = Object.freeze({ namespace: 'evofence.legacy-export/1', schemaVersion: '1.0.0' } as const);
export const SOURCE_PROTOCOL = Object.freeze({ namespace: 'evofence.legacy-source/1', schemaVersion: '1.0.0' } as const);
export const IMPORTER_VERSION = '1.0.0' as const;
export const SOURCE_DIRECTORY = 'legacy-source-v1';
export const FORMATS = Object.freeze(['ledger-sqlite-v2', 'ledger-bundle-v1', 'contract-yaml-v1',
  'config-yaml-v1', 'holdout-validator-v2', 'experiment-validator-v2'] as const);
export type LegacyFormat = (typeof FORMATS)[number];
export interface LegacySource {
  readonly file: string;
  readonly digest: string;
  readonly byteLength: number;
  readonly format: LegacyFormat;
}
export interface LegacyRecord {
  readonly kind: 'ledger-event' | 'generation' | 'state' | 'document' | 'bundle-metadata';
  readonly key: string;
  readonly value: JsonValue;
}
export interface LegacyExport {
  readonly protocol: typeof EXPORT_PROTOCOL;
  readonly classification: 'historical-source';
  readonly executable: false;
  readonly source: LegacySource;
  /** Exact source bytes, including raw payload_json and recorded hashes. */
  readonly originalBase64: string;
  readonly records: readonly LegacyRecord[];
}
export interface Provenance {
  readonly sourceDigest: string;
  readonly sourceFile: string;
  readonly sourceFormat: LegacyFormat;
  readonly importedAt: number;
  readonly importerVersion: typeof IMPORTER_VERSION;
  readonly classification: 'historical-source';
}
export interface HistoricalRecord extends LegacyRecord {
  readonly executable: false;
  readonly provenance: Provenance;
}
export interface HistoricalImport {
  readonly protocol: typeof SOURCE_PROTOCOL;
  readonly importId: string;
  readonly bundle: LegacyExport;
  readonly records: readonly HistoricalRecord[];
}
export interface ImportOutcome {
  readonly disposition: 'imported' | 'duplicate';
  readonly file: string;
  readonly archive: HistoricalImport;
}
