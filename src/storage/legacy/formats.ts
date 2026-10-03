import { parseDocument } from 'yaml';
import { validateDocument } from '../../lib/config/validate.js';
import type { ConfigDocumentKind } from '../../types/config.js';
import type { JsonValue } from '../../types/shared.js';
import type { LegacyFormat, LegacyRecord } from './types.js';
import { bundleRecords } from './ledger.js';
import { sqliteRecords } from './sqlite.js';
import { external, json, jsonShape, object, reject, utf8 } from './boundary.js';

const documentKinds: Partial<Record<LegacyFormat, ConfigDocumentKind>> = {
  'contract-yaml-v1': 'contract', 'config-yaml-v1': 'config',
  'holdout-validator-v2': 'holdout', 'experiment-validator-v2': 'experiment',
};
export function recordsFrom(bytes: Buffer, format: LegacyFormat): LegacyRecord[] {
  if (format === 'ledger-sqlite-v2') return sqliteRecords(bytes);
  if (format === 'ledger-bundle-v1') return bundleRecords(json(utf8(bytes)));
  const kind = documentKinds[format]!;
  const doc = external('EFK_SCHEMA_INVALID', 'invalid legacy YAML', () => parseDocument(utf8(bytes), { uniqueKeys: true }));
  if (doc.errors.length > 0) reject('EFK_SCHEMA_INVALID', 'invalid or duplicate-key legacy YAML');
  const value: unknown = external('EFK_SCHEMA_INVALID', 'unsupported legacy YAML alias graph', () => doc.toJS());
  jsonShape(value);
  const root = object(value);
  const marker = kind === 'contract' ? 'contract_version' : 'version';
  if ((kind === 'contract' || kind === 'config') && root[marker] !== 1) {
    reject('EFK_PROTOCOL_UNSUPPORTED', 'only legacy YAML version 1 is supported');
  }
  // Holdout/experiment have no on-disk version: the explicit format names pin validator v2.
  if (!validateDocument(kind, value, 'legacy snapshot').valid) reject('EFK_SCHEMA_INVALID', 'legacy YAML fails its pinned validator');
  return [{ kind: 'document', key: kind, value: value as JsonValue }];
}
