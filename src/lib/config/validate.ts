/**
 * v2 validators for the four `.evofence` YAML documents.
 *
 * DOMAIN: config (L2 io domain, node `l2_config`).
 *
 * Every rule below mirrors the 0.3.0 runtime checks it replaces, with two deliberate
 * differences that are the point of the v2 layer:
 *
 *   1. UNKNOWN KEYS ARE REJECTED. `validateContract` had no `additionalProperties: false`
 *      semantics, so a mistyped key (say `budget:` instead of `budgets:`) was silently
 *      ignored while its subtree failed closed elsewhere. v2 lists the offending path.
 *   2. NO NEW DEFAULTS. The only fallbacks that exist anywhere in this module are the two
 *      enumerated in `CONTRACT_DEFAULTS` (`evidence.per_command_timeout_ms`,
 *      `evidence.max_output_bytes`, both copied from `src/lib/contract.js:44,46`). An absent
 *      required field is reported in `missing_fields` — never filled in.
 *
 * RULE PARITY: `test/config.test.js` locks every required path against the 0.3.0 gate
 * validator (`src/lib/contract.js`) by deleting the path from a valid document and asserting
 * that both validators fail; and locks every defaulted path by asserting that both accept its
 * absence while this validator fills exactly the documented value.
 */
import {
  ADAPTER_NAMES,
  type ConfigDocumentKind,
  type ConfigIssueCode,
  type ConfigValidationIssue,
  type ConfigValidationReport,
  type JsonValue,
} from '../../types/index.js';
import { EvoFenceError } from '../errors.js';
import { walkShape } from './fields.js';
import { documentSchema } from './schema.js';

const INVALID_CONTRACT: ConfigIssueCode = 'INVALID_CONTRACT';
const INVALID_CONFIG: ConfigIssueCode = 'INVALID_CONFIG';
const INVALID_HOLDOUT: ConfigIssueCode = 'INVALID_HOLDOUT';
const INVALID_EXPERIMENT: ConfigIssueCode = 'INVALID_EXPERIMENT';

/** Default code per document kind, used when a report contains only missing fields. */
const DOCUMENT_CODES: Record<ConfigDocumentKind, ConfigIssueCode> = {
  contract: INVALID_CONTRACT,
  config: INVALID_CONFIG,
  holdout: INVALID_HOLDOUT,
  experiment: INVALID_EXPERIMENT,
};

type Issues = ConfigValidationIssue[];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** The six serialized capability-setting forms understood by the capability gate. */
function isCapabilitySetting(value: unknown): boolean {
  if (value === true || value === false || value === 'allow' || value === 'deny') return true;
  return isObject(value) && (value.mode === 'allow' || value.mode === 'deny');
}

/** Keep the 0.4.1 template's dead shell object readable until the cleanup node removes it. */
function isLegacyShellSetting(name: string, value: unknown): boolean {
  return name === 'shell' && isObject(value) && value.mode === 'evidence_commands_only';
}

/** Reject a present, non-object container; absent containers are the shape walk's job. */
function container(value: unknown, path: string, code: ConfigIssueCode, issues: Issues): Record<string, unknown> | null {
  if (value === undefined) return null;
  if (isObject(value)) return value;
  issues.push({ path, code, message: `${path} must be an object.` });
  return null;
}

/** Reject a present value that fails `ok`; absent values are the shape walk's job. */
function leaf(value: unknown, path: string, code: ConfigIssueCode, issues: Issues, ok: (value: unknown) => boolean, message: string): void {
  if (value === undefined) return;
  if (!ok(value)) issues.push({ path, code, message });
}

/** `hard_invariants[]` / `regressions[]`: `{ id, command }`, both non-empty, ids unique. */
function itemArray(value: unknown, path: string, code: ConfigIssueCode, issues: Issues, itemLabel: string, duplicateLabel: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path, code, message: `${path} must be a list.` });
    return;
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    if (!isObject(item)) {
      issues.push({ path: `${path}[${index}]`, code, message: `Each ${itemLabel} must be an object.` });
      return;
    }
    const id = item.id;
    if (typeof id !== 'string' || !id.trim()) {
      issues.push({ path: `${path}[${index}].id`, code, message: `Each ${itemLabel} requires an id.` });
    } else if (ids.has(id)) {
      issues.push({ path: `${path}[${index}].id`, code, message: `Duplicate ${duplicateLabel} id: ${id}.` });
    } else {
      ids.add(id);
    }
    if (typeof item.command !== 'string' || !item.command.trim()) {
      issues.push({ path: `${path}[${index}].command`, code, message: `${itemLabel} ${typeof id === 'string' ? id : index} requires a command.` });
    }
  });
}

function contractIssues(root: Record<string, unknown>): Issues {
  const issues: Issues = [];
  // Absent fields are the shape walk's job (`missing_fields`); only a PRESENT wrong version is
  // rejected here, so a missing `contract_version` keeps the `INVALID_CONTRACT` document code
  // the DoD asks for while a present-but-wrong one keeps its `UNSUPPORTED_CONTRACT` identity.
  if (root.contract_version !== undefined && root.contract_version !== 1) {
    issues.push({ path: 'contract_version', code: 'UNSUPPORTED_CONTRACT', message: 'contract_version must be 1.' });
  }

  const objective = container(root.objective, 'objective', INVALID_CONTRACT, issues);
  if (objective) {
    leaf(objective.name, 'objective.name', INVALID_CONTRACT, issues, (v) => typeof v === 'string' && v.trim().length > 0, 'objective.name is required.');
    leaf(objective.command, 'objective.command', INVALID_CONTRACT, issues, (v) => typeof v === 'string', 'objective.command must be a string.');
    leaf(objective.direction, 'objective.direction', INVALID_CONTRACT, issues, (v) => v === 'maximize' || v === 'minimize', 'objective.direction must be maximize or minimize.');
    leaf(objective.min_delta, 'objective.min_delta', INVALID_CONTRACT, issues, (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0, 'objective.min_delta must be a non-negative number.');
  }

  itemArray(root.hard_invariants, 'hard_invariants', INVALID_CONTRACT, issues, 'hard invariant', 'hard invariant');
  leaf(root.allowed_evolution_surface, 'allowed_evolution_surface', INVALID_CONTRACT, issues, isStringArray, 'allowed_evolution_surface must be a list of strings.');
  leaf(root.protected_paths, 'protected_paths', INVALID_CONTRACT, issues, isStringArray, 'protected_paths must be a list of strings.');

  const evidence = container(root.evidence, 'evidence', INVALID_CONTRACT, issues);
  if (evidence) {
    leaf(evidence.public_commands, 'evidence.public_commands', INVALID_CONTRACT, issues, isStringArray, 'evidence.public_commands must be a list of strings.');
    leaf(evidence.per_command_timeout_ms, 'evidence.per_command_timeout_ms', INVALID_CONTRACT, issues, (v) => Number.isInteger(v) && (v as number) >= 100 && (v as number) <= 86_400_000, 'evidence.per_command_timeout_ms must be between 100 and 86400000.');
    leaf(evidence.max_output_bytes, 'evidence.max_output_bytes', INVALID_CONTRACT, issues, (v) => Number.isInteger(v) && (v as number) >= 1024 && (v as number) <= 100_000_000, 'evidence.max_output_bytes must be between 1024 and 100000000.');
  }

  const acceptance = container(root.acceptance, 'acceptance', INVALID_CONTRACT, issues);
  if (acceptance) {
    // Optional "dead"/"half-dead" template keys (`docs/refactor-inventory.md` §5.2): accepted
    // when present, still type-checked, never required.
    for (const key of ['require_proposal', 'require_claims', 'require_objective_improvement']) {
      leaf(acceptance[key], `acceptance.${key}`, INVALID_CONTRACT, issues, (v) => typeof v === 'boolean', `acceptance.${key} must be a boolean.`);
    }
    leaf(acceptance.require_rollback_point, 'acceptance.require_rollback_point', INVALID_CONTRACT, issues, (v) => v === true, 'require_rollback_point must remain true.');
    leaf(acceptance.hidden_regression_tolerance, 'acceptance.hidden_regression_tolerance', INVALID_CONTRACT, issues, (v) => Number.isInteger(v) && (v as number) >= 0, 'acceptance.hidden_regression_tolerance must be a non-negative integer.');
  }

  const capabilities = container(root.capabilities, 'capabilities', INVALID_CONTRACT, issues);
  if (capabilities) {
    leaf(capabilities.authority_ceiling, 'capabilities.authority_ceiling', INVALID_CONTRACT, issues, (v) => v === 'A0' || v === 'A1' || v === 'A2' || v === 'A3', 'authority_ceiling must be A0, A1, A2, or A3. A4 cannot be automatically granted.');
    for (const [name, setting] of Object.entries(capabilities)) {
      if (name === 'authority_ceiling') continue;
      if (isLegacyShellSetting(name, setting)) continue;
      leaf(setting, `capabilities.${name}`, INVALID_CONTRACT, issues, isCapabilitySetting, `capabilities.${name} must be true, false, allow, deny, or an object with mode allow or deny.`);
    }
  }

  const budgets = container(root.budgets, 'budgets', INVALID_CONTRACT, issues);
  if (budgets) {
    for (const key of ['max_iterations', 'max_wall_clock_ms', 'max_failed_candidates', 'max_consecutive_no_improvement']) {
      leaf(budgets[key], `budgets.${key}`, INVALID_CONTRACT, issues, (v) => Number.isInteger(v) && (v as number) >= 1, `budgets.${key} must be a positive integer.`);
    }
    leaf(budgets.max_tokens, 'budgets.max_tokens', INVALID_CONTRACT, issues, (v) => v === null || (Number.isSafeInteger(v) && (v as number) > 0), 'budgets.max_tokens must be null or a positive safe integer.');
    leaf(budgets.max_usd, 'budgets.max_usd', INVALID_CONTRACT, issues, (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0), 'budgets.max_usd must be null or a positive number.');
  }

  return issues;
}

function configIssues(root: Record<string, unknown>): Issues {
  const issues: Issues = [];
  if (root.version !== undefined && root.version !== 1) {
    issues.push({ path: 'version', code: INVALID_CONFIG, message: 'config.version must be 1.' });
  }
  const adapters = container(root.adapters, 'adapters', INVALID_CONFIG, issues);
  if (adapters) {
    for (const name of ADAPTER_NAMES) {
      const entry = container(adapters[name], `adapters.${name}`, INVALID_CONFIG, issues);
      if (!entry) continue;
      leaf(entry.command, `adapters.${name}.command`, INVALID_CONFIG, issues, (v) => typeof v === 'string' && v.trim().length > 0, `adapters.${name}.command must be a non-empty string.`);
      leaf(entry.model, `adapters.${name}.model`, INVALID_CONFIG, issues, (v) => v === null || typeof v === 'string', `adapters.${name}.model must be a string or null.`);
      leaf(entry.agent, `adapters.${name}.agent`, INVALID_CONFIG, issues, (v) => v === null || typeof v === 'string', `adapters.${name}.agent must be a string or null.`);
      if (name === 'pi' && entry.agent !== undefined && entry.agent !== null) {
        issues.push({ path: 'adapters.pi.agent', code: INVALID_CONFIG, message: 'adapters.pi.agent is unsupported by Pi CLI.' });
      }
    }
  }
  return issues;
}

function documentIssues(kind: ConfigDocumentKind, normalized: Record<string, unknown>): Issues {
  switch (kind) {
    case 'contract': return contractIssues(normalized);
    case 'config': return configIssues(normalized);
    case 'holdout': return ((): Issues => {
      const issues: Issues = [];
      itemArray(normalized.regressions, 'regressions', INVALID_HOLDOUT, issues, 'private regression', 'private regression');
      return issues;
    })();
    case 'experiment': return ((): Issues => {
      const issues: Issues = [];
      leaf(normalized.goal_file, 'goal_file', INVALID_EXPERIMENT, issues, (v) => typeof v === 'string', 'goal_file must be a string.');
      if (normalized.adapter !== undefined && typeof normalized.adapter !== 'string') {
        issues.push({ path: 'adapter', code: INVALID_EXPERIMENT, message: 'adapter must be a string.' });
      }
      if (normalized.iterations !== undefined && typeof normalized.iterations !== 'number') {
        issues.push({ path: 'iterations', code: INVALID_EXPERIMENT, message: 'iterations must be a number.' });
      }
      if (normalized.max_wall_clock_ms !== undefined && typeof normalized.max_wall_clock_ms !== 'number') {
        issues.push({ path: 'max_wall_clock_ms', code: INVALID_EXPERIMENT, message: 'max_wall_clock_ms must be a number.' });
      }
      for (const key of ['allow_unisolated_agent', 'allow_readable_holdout']) {
        if (normalized[key] !== undefined && typeof normalized[key] !== 'boolean') {
          issues.push({ path: key, code: INVALID_EXPERIMENT, message: `${key} must be a boolean.` });
        }
      }
      return issues;
    })();
  }
}

/**
 * Validate a parsed document. Returns the v2 envelope: accepted / rejected / missing paths.
 * Absence of a defaulted field is NOT an error and the default is applied to
 * {@link normalizedDocument}.
 */
export function validateDocument(kind: ConfigDocumentKind, value: unknown, file: string): ConfigValidationReport {
  const code = DOCUMENT_CODES[kind];
  const rejected: Issues = [];

  if (!isObject(value)) {
    rejected.push({ path: '<document>', code, message: `${file} must contain a YAML object.` });
    return { document: kind, file, value: null, valid: false, accepted_fields: [], rejected_fields: rejected, missing_fields: [] };
  }

  const shape = walkShape(documentSchema(kind), value);
  for (const path of shape.unknown) {
    rejected.push({ path, code, message: `Unknown field: ${path}.` });
  }
  rejected.push(...documentIssues(kind, shape.normalized));

  const rejectedPaths = rejected.map((issue) => issue.path);
  const accepted = shape.present.filter((path) => !rejectedPaths.some((bad) => path === bad || path.startsWith(`${bad}.`)));

  return {
    document: kind,
    file,
    value: value as JsonValue,
    valid: rejected.length === 0 && shape.missing.length === 0,
    accepted_fields: [...new Set(accepted)],
    rejected_fields: rejected,
    missing_fields: [...new Set(shape.missing)],
  };
}

/** The parsed document with the declared code defaults filled in. */
export function normalizedDocument(kind: ConfigDocumentKind, value: unknown): Record<string, unknown> {
  return walkShape(documentSchema(kind), value).normalized;
}

/** One line listing every rejected and missing path, for `EvoFenceError.message`. */
export function formatProblems(report: ConfigValidationReport): string {
  const parts: string[] = [];
  if (report.rejected_fields.length) {
    parts.push(`rejected field(s): ${report.rejected_fields.map((issue) => `${issue.path} (${issue.message})`).join(', ')}`);
  }
  if (report.missing_fields.length) {
    parts.push(`missing field(s): ${report.missing_fields.join(', ')}`);
  }
  return `${report.file}: ${parts.join('; ')}`;
}

/**
 * Throw when the report is invalid. `UNSUPPORTED_CONTRACT` wins over the document default
 * code so a wrong `contract_version` keeps its own 0.3.0 exit identity; `details` carries the
 * full lists so `EVOFENCE_DEBUG=1` prints the machine-readable evidence.
 */
export function assertValidReport(report: ConfigValidationReport): void {
  if (report.valid) return;
  const unsupported = report.rejected_fields.find((issue) => issue.code === 'UNSUPPORTED_CONTRACT');
  const code = unsupported?.code ?? report.rejected_fields[0]?.code ?? DOCUMENT_CODES[report.document];
  throw new EvoFenceError(code, formatProblems(report), {
    document: report.document,
    file: report.file,
    rejected_fields: report.rejected_fields,
    missing_fields: report.missing_fields,
  });
}

