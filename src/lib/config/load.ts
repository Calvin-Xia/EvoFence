/**
 * File loading for the v2 config documents.
 *
 * DOMAIN: config (L2 io domain, node `l2_config`).
 *
 * Mirrors the safety envelope of `loadYamlFile` (`src/lib/contract.js`): a policy file must be
 * a regular file, not a symlink (`UNSAFE_POLICY_FILE`), and must resolve inside the repository
 * root (`PATH_ESCAPE`); a missing file returns `null` (the caller decides whether absence is
 * tolerable — `status` tolerates it, the run path does not). Parsing uses `uniqueKeys: true`
 * and `schema: 'core'`, so a duplicate YAML key is `INVALID_YAML` rather than a silently
 * last-wins value.
 *
 * All reads are synchronous on purpose: `status`/`init` are short-lived CLI paths, and keeping
 * one sync implementation lets the same validator run from the async `buildStatus`,
 * the sync `emptyStatus`, and `initializeRepository` without a second async copy to drift.
 */
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import type {
  AdapterConfig,
  ConfigDocumentKind,
  ConfigValidationReport,
  EvoFenceConfig,
  EvoFenceContract,
} from '../../types/index.js';
import { ADAPTER_NAMES } from '../../types/index.js';
import { EvoFenceError, invariant } from '../errors.js';
import { assertInside } from '../fs.js';
import { CONTRACT_DEFAULTS } from './schema.js';
import { normalizedDocument, assertValidReport, validateDocument } from './validate.js';

/** Repository-relative location of every policy document this domain loads. */
export const POLICY_FILES: Record<Exclude<ConfigDocumentKind, 'experiment'>, string> = {
  contract: path.join('.evofence', 'contract.yaml'),
  config: path.join('.evofence', 'config.yaml'),
  holdout: path.join('.evofence', 'private', 'holdout.yaml'),
};

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Parse policy YAML text with duplicate-key detection (`INVALID_YAML` on malformed input). */
export function parsePolicyYaml(text: string, file: string): unknown {
  const document = parseDocument(text, { uniqueKeys: true, schema: 'core' });
  if (document.errors.length) {
    throw new EvoFenceError('INVALID_YAML', `${file}: ${document.errors.map((error) => error.message).join('; ')}`);
  }
  return document.toJS();
}

/**
 * Read a policy file under `root`. Returns `null` when it does not exist; throws
 * `UNSAFE_POLICY_FILE` / `PATH_ESCAPE` when it is a symlink or escapes the root.
 */
export function readPolicyDocumentSync(root: string, relative: string): unknown | null {
  const file = path.join(root, relative);
  let info;
  try {
    info = lstatSync(file);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  invariant(info.isFile() && !info.isSymbolicLink(), 'UNSAFE_POLICY_FILE', `Policy file must be a regular file: ${file}`);
  assertInside(realpathSync(root), realpathSync(file));
  return parsePolicyYaml(readFileSync(file, 'utf8'), file);
}

/** Validate a policy file from disk; `null` when the file is absent. */
export function validatePolicyFileSync(kind: ConfigDocumentKind, root: string, relative: string): ConfigValidationReport | null {
  const value = readPolicyDocumentSync(root, relative);
  if (value === null) return null;
  return validateDocument(kind, value, path.join(root, relative));
}

/**
 * Load `.evofence/contract.yaml`. Absent -> `null`; invalid -> throws with the rejected and
 * missing field lists. The returned value has exactly the two `CONTRACT_DEFAULTS` applied.
 */
export function loadContractDocumentSync(root: string): EvoFenceContract | null {
  const report = validatePolicyFileSync('contract', root, POLICY_FILES.contract);
  if (report === null) return null;
  assertValidReport(report);
  return normalizedDocument('contract', report.value) as unknown as EvoFenceContract;
}

/** Load `.evofence/config.yaml`. Absent -> `null`; invalid -> throws (`INVALID_CONFIG`). */
export function loadConfigDocumentSync(root: string): EvoFenceConfig | null {
  const report = validatePolicyFileSync('config', root, POLICY_FILES.config);
  if (report === null) return null;
  assertValidReport(report);
  return normalizedDocument('config', report.value) as unknown as EvoFenceConfig;
}

/**
 * Required-file variant for the run path (`src/lib/runner.js` `loadConfig`): a missing file is
 * `MISSING_FILE`, exactly like the `loadYamlFile` it replaces.
 */
export function loadRequiredConfigDocumentSync(root: string): EvoFenceConfig {
  const loaded = loadConfigDocumentSync(root);
  if (loaded === null) throw new EvoFenceError('MISSING_FILE', `Required file not found: ${path.join(root, POLICY_FILES.config)}`);
  return loaded;
}

/**
 * Required-file variant of {@link loadContractDocumentSync}. The gate domain's `loadContract`
 * (`src/lib/contract.js`) is the current run-path loader; adopting this one is an L3 decision
 * because it additionally rejects unknown keys.
 */
export function loadRequiredContractDocumentSync(root: string): EvoFenceContract {
  const loaded = loadContractDocumentSync(root);
  if (loaded === null) throw new EvoFenceError('MISSING_FILE', `Required file not found: ${path.join(root, POLICY_FILES.contract)}`);
  return loaded;
}

/** Objective/budget facts `status` echoes so its output can be checked against the file. */
export interface ContractSummary {
  objective: { name: string; direction: string; min_delta: number };
  budgets: { max_iterations: number; max_wall_clock_ms: number; max_failed_candidates: number; max_consecutive_no_improvement: number };
  evidence: { public_commands: string[]; per_command_timeout_ms: number; max_output_bytes: number };
  hard_invariants: number;
  protected_paths: number;
}

/** Effective adapter view: `command` falls back to the adapter name (`adapterCommand`). */
export interface AdapterSummary {
  name: string;
  command: string;
  model: string | null;
  agent: string | null;
}

/** Validated config state as `status` reports it. */
export interface PolicySnapshot {
  contract: ContractSummary | null;
  adapters: AdapterSummary[];
  files: { contract: string | null; config: string | null };
}

function summarizeContract(contract: EvoFenceContract): ContractSummary {
  return {
    objective: {
      name: contract.objective.name,
      direction: contract.objective.direction,
      min_delta: contract.objective.min_delta,
    },
    budgets: {
      max_iterations: contract.budgets.max_iterations,
      max_wall_clock_ms: contract.budgets.max_wall_clock_ms,
      max_failed_candidates: contract.budgets.max_failed_candidates,
      max_consecutive_no_improvement: contract.budgets.max_consecutive_no_improvement,
    },
    evidence: {
      public_commands: [...contract.evidence.public_commands],
      per_command_timeout_ms: contract.evidence.per_command_timeout_ms ?? CONTRACT_DEFAULTS['evidence.per_command_timeout_ms'],
      max_output_bytes: contract.evidence.max_output_bytes ?? CONTRACT_DEFAULTS['evidence.max_output_bytes'],
    },
    hard_invariants: contract.hard_invariants.length,
    protected_paths: contract.protected_paths.length,
  };
}

function summarizeAdapters(config: EvoFenceConfig | null): AdapterSummary[] {
  return ADAPTER_NAMES.map((name) => {
    const entry = config?.adapters?.[name] as AdapterConfig | undefined;
    const command = typeof entry?.command === 'string' && entry.command.trim() ? entry.command : name;
    return { name, command, model: entry?.model ?? null, agent: entry?.agent ?? null };
  });
}

/**
 * Validate both repository policy files and return the snapshot `status` prints.
 *
 * Absent files are tolerated (a repository without `.evofence/` state still has a status);
 * when neither file exists this returns `null` and `status` omits the policy lines. An invalid
 * file always throws — that is the fail-closed edge this node exists to provide.
 */
export function inspectPolicySync(root: string): PolicySnapshot | null {
  const contract = loadContractDocumentSync(root);
  const config = loadConfigDocumentSync(root);
  if (contract === null && config === null) return null;
  return {
    contract: contract ? summarizeContract(contract) : null,
    adapters: summarizeAdapters(config),
    files: {
      contract: contract ? POLICY_FILES.contract.split(path.sep).join('/') : null,
      config: config ? POLICY_FILES.config.split(path.sep).join('/') : null,
    },
  };
}
