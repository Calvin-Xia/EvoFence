/**
 * Config-domain contracts.
 *
 * DERIVED FROM (all shapes read off the 0.3.0 implementation, never designed here):
 *   - `.evofence/config.yaml`  -> `loadConfig` (`src/lib/runner.js:17-31`) + the template
 *     in `src/lib/init.js:10-26`; accessors `adapterCommand`/`adapterModel`/`adapterAgent`
 *     (`src/lib/adapter.js:577-585`). Ref: `docs/refactor-inventory.md` §5.3.
 *   - `.evofence/contract.yaml` -> `validateContract` (`src/lib/contract.js:21-61`).
 *     Ref: `docs/refactor-inventory.md` §5.2.
 *   - `private/holdout.yaml`   -> `loadPrivateHoldout` (`src/lib/contract.js:84-103`). §5.4.
 *   - experiment manifest      -> `commandExperiment` (`src/cli.js:383-397`). §5.5.
 *   - the v2 validation envelope is the only NEW shape here: no 0.3.0 equivalent exists,
 *     it is the reporting contract the L2 config refactor must satisfy.
 *
 * FAIL-CLOSED NOTE: the types below describe the *validated* shape. `validateContract`
 * hard-fails on almost every missing field, so optionality here mirrors the source's own
 * exceptions exactly and nothing more:
 *   - only `evidence.per_command_timeout_ms` (?? 120000) and `evidence.max_output_bytes`
 *     (?? 1048576) have code defaults in `src/lib/contract.js:43,45`;
 *   - `acceptance.require_proposal` / `require_claims` / `capabilities.*` are read but not
 *     validated (`docs/refactor-inventory.md` §5.2 "dead keys" table);
 *   - do NOT turn any required field optional here to "be safe": that is how the fail-closed
 *     contract silently becomes fail-open.
 */

import type { JsonValue } from './shared.js';

/** Adapter entry in `.evofence/config.yaml` under `adapters.<name>`. */
export interface AdapterConfig {
  /** Non-empty string when present. Absent -> the accessor falls back to the adapter name. */
  command?: string;
  model?: string | null;
  /** `adapters.pi.agent` is rejected by `INVALID_CONFIG` (`src/lib/runner.js:28`). */
  agent?: string | null;
}

/** `.evofence/config.yaml` after `loadConfig` validation. */
export interface EvoFenceConfig {
  version: 1;
  /** Individually optional: the loader reads `config.adapters?.[name]` per adapter. */
  adapters?: {
    codex?: AdapterConfig;
    opencode?: AdapterConfig;
    claude?: AdapterConfig;
    pi?: AdapterConfig;
  };
}

export type ObjectiveDirection = 'maximize' | 'minimize';

/** `A4` is deliberately absent: `validateContract` rejects it. */
export type AuthorityCeiling = 'A0' | 'A1' | 'A2' | 'A3';

export interface HardInvariantConfig {
  id: string;
  command: string;
}

export interface ObjectiveConfig {
  name: string;
  /** Empty string means "no objective command"; `requireEvidenceConfigured` then rejects runs requiring improvement. */
  command: string;
  direction: ObjectiveDirection;
  min_delta: number;
}

export interface EvidenceCommandConfig {
  public_commands: string[];
  /** Code default 120000 (`src/lib/contract.js:43`). Bounds: 100 .. 86_400_000. */
  per_command_timeout_ms?: number;
  /** Code default 1048576 (`src/lib/contract.js:45`). Bounds: 1024 .. 100_000_000. */
  max_output_bytes?: number;
}

export interface AcceptanceConfig {
  /** Template-only key with zero code references in 0.3.0 (dead key). */
  require_proposal?: boolean;
  /** Template-only key with zero code references in 0.3.0 (dead key). */
  require_claims?: boolean;
  /** Read by `requireEvidenceConfigured` (`src/lib/policy.js:159`). */
  require_objective_improvement?: boolean;
  /** Must be literally `true`; `validateContract` rejects anything else. */
  require_rollback_point: true;
  /** Private-regression tolerance. Default 0 in the template, not in code. */
  hidden_regression_tolerance: number;
}

/**
 * One `capabilities.<name>` entry.
 *
 * `assessCapabilities` (`src/lib/policy.js:148`) accepts exactly three allow-forms:
 * `true`, `'allow'`, or `{ mode: 'allow' }`. The config validator accepts those forms and their
 * explicit denials (`false`, `'deny'`, or `{ mode: 'deny' }`). `authority_ceiling` is a reserved
 * enum-valued member of the same open object; absent keys still deny at runtime.
 */
export type CapabilitySetting =
  | boolean
  | 'allow'
  | 'deny'
  | AuthorityCeiling
  | { mode: 'allow' | 'deny'; [key: string]: unknown }
  | undefined;

export interface CapabilitiesConfig {
  /** Validated (A0-A3) but never read by any runtime decision in 0.3.0 ("half-dead key"). */
  authority_ceiling: AuthorityCeiling;
  /**
   * Dynamic lookup surface: `contract.capabilities[capability]` is indexed by whatever the
   * proposal requests, so no fixed key list may be declared here. `external_api` is the one
   * key the docs single out as a live gate (`docs/refactor-inventory.md` §5.2).
   */
  [capability: string]: CapabilitySetting;
}

export interface BudgetsConfig {
  max_iterations: number;
  max_wall_clock_ms: number;
  max_failed_candidates: number;
  max_consecutive_no_improvement: number;
  /** `null` = unbounded. Positive safe integer when set. */
  max_tokens: number | null;
  /** `null` = unbounded. Positive finite number when set. */
  max_usd: number | null;
}

/** `.evofence/contract.yaml` after `validateContract`. */
export interface EvoFenceContract {
  contract_version: 1;
  objective: ObjectiveConfig;
  hard_invariants: HardInvariantConfig[];
  /** Empty array means "every path is allowed" (`isAllowedPath` special-cases it). */
  allowed_evolution_surface: string[];
  /** Merged with the 19-entry `BUILTIN_PROTECTED` list in `src/lib/policy.js:3-22`. */
  protected_paths: string[];
  evidence: EvidenceCommandConfig;
  acceptance: AcceptanceConfig;
  capabilities: CapabilitiesConfig;
  budgets: BudgetsConfig;
  /** `validateContract` has no `additionalProperties: false` semantics; unknown keys pass through. */
  [key: string]: unknown;
}

/** One entry of `.evofence/private/holdout.yaml` (`regressions[]`). */
export interface PrivateRegressionConfig {
  id: string;
  command: string;
}

/** Parsed `experiment run <file>` manifest (`src/cli.js:383-397`). */
export interface ExperimentManifest {
  /** Required; resolved relative to the manifest's own directory. */
  goal_file: string;
  /** Defaults to `'codex'`; not validated here (`UNKNOWN_ADAPTER` fires downstream). */
  adapter?: string;
  /** Not validated here (`INVALID_BUDGET` fires downstream). */
  iterations?: number;
  max_wall_clock_ms?: number;
  /** Strict `=== true`; anything else counts as false. */
  allow_unisolated_agent?: boolean;
  /** Strict `=== true`; anything else counts as false. */
  allow_readable_holdout?: boolean;
  [key: string]: unknown;
}

/** The YAML documents the config domain can load. */
export type ConfigDocumentKind = 'config' | 'contract' | 'holdout' | 'experiment';

/**
 * Which validation rule rejected a field. Closed set: exactly the codes the config
 * loaders can throw today (`docs/refactor-inventory.md` §5.6) —
 * `MISSING_FILE`/`UNSAFE_POLICY_FILE`/`PATH_ESCAPE` from `loadYamlFile`,
 * `INVALID_YAML` from `parseYaml`, `UNSUPPORTED_CONTRACT`/`INVALID_CONTRACT` from
 * `validateContract`, `INVALID_CONFIG` from `loadConfig`, `INVALID_HOLDOUT` from
 * `loadPrivateHoldout`, `INVALID_EXPERIMENT` from `commandExperiment`.
 */
export type ConfigIssueCode =
  | 'MISSING_FILE'
  | 'UNSAFE_POLICY_FILE'
  | 'PATH_ESCAPE'
  | 'INVALID_YAML'
  | 'UNSUPPORTED_CONTRACT'
  | 'INVALID_CONTRACT'
  | 'INVALID_CONFIG'
  | 'INVALID_HOLDOUT'
  | 'INVALID_EXPERIMENT';

/** One rejected field, as reported by the v2 validator. */
export interface ConfigValidationIssue {
  /** Dotted field path, e.g. `acceptance.require_rollback_point`. */
  path: string;
  code: ConfigIssueCode;
  message: string;
}

/**
 * v2 validation envelope for every config document.
 *
 * This is the reporting contract the L2 config refactor must produce: a validator can no
 * longer throw away which fields it accepted, which it rejected and why, and which were
 * missing — the three lists together are the audit evidence for a fail-closed decision.
 * `valid` is `rejected_fields.length === 0 && missing_fields.length === 0`.
 */
export interface ConfigValidationResult {
  valid: boolean;
  /** Dotted paths of fields that passed validation. */
  accepted_fields: string[];
  /** Rejected fields with their error code and message. */
  rejected_fields: ConfigValidationIssue[];
  /** Dotted paths of required fields that were absent. */
  missing_fields: string[];
}

/** `ConfigValidationResult` plus the document it describes. */
export interface ConfigValidationReport extends ConfigValidationResult {
  document: ConfigDocumentKind;
  /** Absolute path of the validated file. */
  file: string;
  /** The raw parsed document, or `null` when parsing itself failed. */
  value: JsonValue | null;
}
