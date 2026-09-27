/**
 * Gate domain entry — R1 path: `src/lib/contract.js` -> `src/lib/contract.ts`.
 *
 * The document loaders only: locate the policy file, refuse symlinks/escapes (`UNSAFE_POLICY_FILE`,
 * `PATH_ESCAPE`), parse YAML with duplicate-key rejection (`INVALID_YAML`) and hand the object to
 * the pure validators in `src/lib/gate/`. `validateContract` is re-exported from
 * `src/lib/gate/contract-document.js` so this module keeps its exact 0.3.0 export surface (R2):
 * `validateContract`, `loadYamlFile`, `loadContract`, `loadPrivateHoldout`, `parseYamlText`.
 *
 * R1 fix F1 follow-up (one implementation, one truth): `loadContract` and `loadPrivateHoldout`
 * are now thin delegates to the v2 config domain (`src/lib/config/`), which is the same validator
 * `init`/`status`/`run` use. `queries.ts` (`evidence run`) therefore can no longer accept a
 * policy file the run path rejects. The published export names, signatures and the fail-open
 * identity of an absent holdout (`[]`) are unchanged; `validateContract` (pure, in-memory) and
 * `loadYamlFile` (raw parse + safety envelope, still used by exec) stay as they were.
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
import {
  POLICY_FILES,
  assertValidReport,
  loadRequiredContractDocumentSync,
  normalizedDocument,
  validatePolicyFileSync,
} from './config/index.js';
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

/**
 * Load and validate `.evofence/contract.yaml` through the v2 config domain.
 *
 * Absent -> `MISSING_FILE` (the 0.3.0 identity); invalid -> the v2 report's code
 * (`INVALID_CONTRACT`, or `UNSUPPORTED_CONTRACT` for a present wrong `contract_version`).
 */
export async function loadContract(root: string): Promise<EvoFenceContract> {
  return loadRequiredContractDocumentSync(root);
}

/**
 * Load `.evofence/private/holdout.yaml` through the v2 config domain.
 *
 * A missing file is `[]` (fail-open, deliberate: no private oracle configured); a present but
 * malformed file is `INVALID_HOLDOUT` (fail-closed), including unknown top-level keys and unknown
 * entry keys.
 */
export async function loadPrivateHoldout(root: string): Promise<PrivateRegressionConfig[]> {
  const report = validatePolicyFileSync('holdout', root, POLICY_FILES.holdout);
  if (report === null) return [];
  assertValidReport(report);
  const { regressions } = normalizedDocument('holdout', report.value) as unknown as { regressions: PrivateRegressionConfig[] };
  return regressions;
}

/** Parse a YAML document that is not read from disk (used by `experiment run <file>`). */
export function parseYamlText(text: string, filename = '<yaml>'): YamlObject {
  return parseYaml(text, filename);
}
