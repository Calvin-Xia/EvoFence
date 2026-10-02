import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { canonical } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { IMPORTER_VERSION, SOURCE_DIRECTORY, SOURCE_PROTOCOL } from './types.js';
import type { HistoricalImport, ImportOutcome, LegacyExport } from './types.js';
import { boundary, digest, external, json, keys, readRegular, reject, utf8 } from './boundary.js';
import { decodeExport } from './exporter.js';

function importId(bundle: LegacyExport): string { return digest(`${bundle.source.format}\n${bundle.source.digest}`).slice(7); }
function historical(bundle: LegacyExport, importedAt: number): HistoricalImport {
  return { protocol: SOURCE_PROTOCOL, importId: importId(bundle), bundle,
    records: bundle.records.map(record => ({ ...record, executable: false,
      provenance: { sourceDigest: bundle.source.digest, sourceFile: bundle.source.file,
        sourceFormat: bundle.source.format, importedAt, importerVersion: IMPORTER_VERSION,
        classification: 'historical-source' } })) };
}
function instant(at: unknown): asserts at is number {
  if (!Number.isSafeInteger(at) || (at as number) < 0) reject('EFK_SCHEMA_INVALID', 'importedAt must be an explicit UTC epoch millisecond instant');
}
function decodeImport(value: unknown): HistoricalImport {
  const row = keys(value, ['protocol', 'importId', 'bundle', 'records']);
  if (canonical(row.protocol) !== canonical(SOURCE_PROTOCOL)) reject('EFK_PROTOCOL_UNSUPPORTED', 'unsupported historical source namespace/schema');
  const bundle = decodeExport(row.bundle);
  if (!Array.isArray(row.records) || row.records.length !== bundle.records.length) reject('EFK_SCHEMA_INVALID', 'historical records differ from source record count');
  // Every supported format has a document, schema state, or bundle metadata record.
  const first = keys(row.records[0], ['kind', 'key', 'value', 'executable', 'provenance']);
  const provenance = keys(first.provenance, ['sourceDigest', 'sourceFile', 'sourceFormat', 'importedAt', 'importerVersion', 'classification']);
  instant(provenance.importedAt);
  if (canonical(row) !== canonical(historical(bundle, provenance.importedAt))) {
    reject('EFK_LEGACY_NOT_EXECUTABLE', 'historical provenance/records were rewritten or given execution semantics');
  }
  return row as unknown as HistoricalImport;
}
export function readHistoricalImport(file: string): StoreResult<HistoricalImport> {
  return boundary(() => decodeImport(json(utf8(readRegular(file).bytes))));
}
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
function sourcePath(file: string): string {
  if (existsSync(file)) return realpathSync.native(file);
  const absolute = path.resolve(file), parent = path.dirname(absolute);
  // Source-less history remains readable, but an existing parent still has a
  // native identity: Windows 8.3 aliases cannot turn it into an archive target.
  return existsSync(parent) ? path.join(realpathSync.native(parent), path.basename(absolute)) : absolute;
}
function destination(archiveRoot: string, bundle: LegacyExport): string {
  const root = external('EFK_ARTIFACT_UNAVAILABLE', 'archiveRoot must be an existing directory', () => realpathSync.native(archiveRoot));
  if (!lstatSync(root).isDirectory()) reject('EFK_AUTHORITY_DENIED', 'archiveRoot is not a directory');
  const source = sourcePath(bundle.source.file);
  const directory = path.join(root, SOURCE_DIRECTORY);
  if (inside(path.dirname(source), directory) || inside(directory, source)) {
    reject('EFK_AUTHORITY_DENIED', 'historical namespace must be separate from the source directory');
  }
  try { mkdirSync(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') reject('EFK_ARTIFACT_UNAVAILABLE', 'cannot create historical namespace');
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) reject('EFK_AUTHORITY_DENIED', 'historical namespace must be a non-symlink directory');
  return path.join(directory, `${importId(bundle)}.json`);
}
function duplicate(file: string, bundle: LegacyExport): ImportOutcome {
  const archive = decodeImport(json(utf8(readRegular(file).bytes)));
  if (canonical(archive.bundle) !== canonical(bundle)) reject('EFK_IDEMPOTENCY_COLLISION', 'source identity already has different immutable content or provenance');
  return { disposition: 'duplicate', file, archive };
}
/** Explicit import only. No EventStore/ArtifactStore/AssetRegistry port is accepted or called. */
export function importLegacy(value: unknown, archiveRoot: string, importedAt: number): StoreResult<ImportOutcome> {
  return boundary(() => {
    instant(importedAt);
    const bundle = decodeExport(value);
    return external('EFK_ARTIFACT_UNAVAILABLE', 'historical import filesystem operation failed', () => {
      const file = destination(archiveRoot, bundle);
      if (existsSync(file)) return duplicate(file, bundle);
      const archive = historical(bundle, importedAt), staging = `${file}.${randomUUID()}.pending`;
      const fd = openSync(staging, 'wx');
      try { writeFileSync(fd, `${canonical(archive)}\n`); fsyncSync(fd); }
      finally { closeSync(fd); }
      try {
        // Atomic publication without overwrite; a crash never exposes half of a JSON record.
        try { linkSync(staging, file); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') return duplicate(file, bundle);
          throw error;
        }
        return { disposition: 'imported', file, archive };
      } finally { unlinkSync(staging); }
    });
  });
}
