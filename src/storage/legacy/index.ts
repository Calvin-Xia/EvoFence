/** Optional legacy storage entry; deliberately not re-exported by storage or core. */
export { exportLegacy } from './exporter.js';
export { importLegacy, readHistoricalImport } from './importer.js';
export { BREAKING_CHANGES } from './breaking.js';
export { EXPORT_PROTOCOL, SOURCE_PROTOCOL, IMPORTER_VERSION, SOURCE_DIRECTORY, FORMATS } from './types.js';
export type { LegacyFormat, LegacySource, LegacyRecord, LegacyExport, Provenance,
  HistoricalRecord, HistoricalImport, ImportOutcome } from './types.js';
