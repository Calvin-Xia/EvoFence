/**
 * Gate domain entry — R1 path: `src/lib/contract.js` -> `src/lib/contract.ts`.
 *
 * The document loaders only: locate the policy file, refuse symlinks/escapes (`UNSAFE_POLICY_FILE`,
 * `PATH_ESCAPE`), parse YAML with duplicate-key rejection (`INVALID_YAML`) and hand the object to
 * the pure validators in `src/lib/gate/`. `validateContract` is re-exported from
 * `src/lib/gate/contract-document.js` so this module keeps its exact 0.3.0 export surface (R2):
 * `validateContract`, `loadYamlFile`, `loadContract`, `loadPrivateHoldout`, `parseYamlText`.
 *
 * The contract *gate* itself (policy drift, evidence-configured refusal) is
 * `src/lib/gate/contract.ts`; it takes digests and a validated contract, so it can be imported
 * and tested without touching the filesystem.
 */

import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { EvoFenceError, invariant } from './errors.js';
import { assertInside } from './fs.js';
import { validateContract } from './gate/contract-document.js';
import type { EvoFenceContract, PrivateRegressionConfig } from '../types/config.js';

export { validateContract } from './gate/contract-document.js';

/** A parsed YAML object before any document-specific validation. */
export type YamlObject = Record<string, any>;

function parseYaml(text: string, filename: string): YamlObject {
  const document = parseDocument(text, { uniqueKeys: true, schema: 'core' });
  if (document.errors.length) {
    throw new EvoFenceError('INVALID_YAML', `${filename}: ${document.errors.map((error) => error.message).join('; ')}`);
  }
  const value: unknown = document.toJS();
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_CONTRACT', `${filename} must contain a YAML object.`);
  return value as YamlObject;
}

/** Read a policy file that must be a regular, non-symlinked file inside `root`. */
export async function loadYamlFile(filename: string, root: string = path.dirname(filename)): Promise<YamlObject> {
  let text: string;
  try {
    const info = await lstat(filename);
    invariant(info.isFile() && !info.isSymbolicLink(), 'UNSAFE_POLICY_FILE', `Policy file must be a regular file: ${filename}`);
    const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root), realpath(filename)]);
    assertInside(canonicalRoot, canonicalFile);
    text = await readFile(filename, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') throw new EvoFenceError('MISSING_FILE', `Required file not found: ${filename}`);
    throw error;
  }
  return parseYaml(text, filename);
}

/** Load and validate `.evofence/contract.yaml`. */
export async function loadContract(root: string): Promise<EvoFenceContract> {
  const file = path.join(root, '.evofence', 'contract.yaml');
  return validateContract((await loadYamlFile(file, root)) as EvoFenceContract);
}

/**
 * Load `.evofence/private/holdout.yaml`.
 *
 * A missing file is `[]` (fail-open, deliberate: no private oracle configured); a present but
 * malformed file is `INVALID_HOLDOUT` (fail-closed).
 */
export async function loadPrivateHoldout(root: string): Promise<PrivateRegressionConfig[]> {
  const file = path.join(root, '.evofence', 'private', 'holdout.yaml');
  try {
    const value = await loadYamlFile(file, root);
    invariant(Array.isArray(value.regressions), 'INVALID_HOLDOUT', 'private holdout regressions must be a list.');
    const ids = new Set<string>();
    for (const regression of value.regressions) {
      invariant(regression && typeof regression === 'object', 'INVALID_HOLDOUT', 'Each private regression must be an object.');
      invariant(typeof regression.id === 'string' && regression.id.trim(), 'INVALID_HOLDOUT', 'Each private regression requires an id.');
      invariant(typeof regression.command === 'string' && regression.command.trim(), 'INVALID_HOLDOUT', `Private regression ${regression.id} requires a command.`);
      invariant(!ids.has(regression.id), 'INVALID_HOLDOUT', `Duplicate private regression id: ${regression.id}.`);
      ids.add(regression.id);
    }
    return value.regressions as PrivateRegressionConfig[];
  } catch (error) {
    if ((error as { code?: string }).code === 'MISSING_FILE') return [];
    throw error;
  }
}

/** Parse a YAML document that is not read from disk (used by `experiment run <file>`). */
export function parseYamlText(text: string, filename = '<yaml>'): YamlObject {
  return parseYaml(text, filename);
}
