/**
 * v2 field schema for the four `.evofence` YAML documents.
 *
 * DOMAIN: config (L2 io domain, node `l2_config`).
 *
 * The schema is DATA, not logic: `fields.ts` walks it, `validate.ts` adds the per-document
 * value rules. Keeping it separate makes the two audit questions answerable by reading one
 * table — "which fields are required?" and "which fields have a code default?".
 *
 * FAIL-CLOSED BOUNDARY (`docs/refactor-inventory-review.md` F3, DoD 4)
 * ------------------------------------------------------------------
 * `CONTRACT_DEFAULTS` is the **complete** set of code-level fallbacks in the config surface:
 * exactly two, both copied from `src/lib/contract.js` (`per_command_timeout_ms ?? 120000`,
 * `max_output_bytes ?? 1_048_576`). Every other field of `contract.yaml` that 0.3.0 requires is
 * marked `required` here, so an absent field is reported as `missing_fields` instead of being
 * silently defaulted. Values in `templates/contract.yaml` are *template* values, not defaults:
 * they only exist after `evofence init` copies the file, and they never rescue an absent key.
 *
 * `capabilities` is the one open map (`open: true`): `assessCapabilities` indexes it by the
 * capability name a proposal requests (`src/lib/policy.js:148`), so an unknown key there is a
 * capability name, not a typo. `adapters` is closed: 0.3.0 only ever reads the four
 * `ADAPTER_NAMES`, so an unknown adapter key would be silently ignored — v2 rejects it.
 */
import type { ConfigDocumentKind } from '../../types/index.js';

export type FieldKind =
  | 'integer'
  | 'number'
  | 'string'
  | 'boolean'
  | 'enum'
  | 'stringArray'
  | 'invariantArray'
  | 'nullableInteger'
  | 'nullableNumber'
  | 'nullableString'
  | 'object'
  | 'any';

export interface FieldSpec {
  readonly kind: FieldKind;
  /** `true` = absent means `missing_fields` (unless `defaultValue` is set). */
  readonly required?: boolean;
  /** Allowed values for `kind: 'enum'`. */
  readonly values?: readonly string[];
  /** A code-level fallback. Only `CONTRACT_DEFAULTS` may declare one. */
  readonly defaultValue?: unknown;
  /** Known child keys for `kind: 'object'`. */
  readonly fields?: Readonly<Record<string, FieldSpec>>;
  /** `true` = a dynamic map; unknown child keys stay accepted. */
  readonly open?: boolean;
}

/** The only two code defaults in the config surface (`contract.js:44,46`). */
export const CONTRACT_DEFAULTS: Readonly<Record<string, number>> = Object.freeze({
  'evidence.per_command_timeout_ms': 120000,
  'evidence.max_output_bytes': 1_048_576,
});

/** `.evofence/contract.yaml` (`docs/refactor-inventory.md` §5.2). */
export const CONTRACT_SCHEMA: FieldSpec = {
  kind: 'object',
  fields: {
    contract_version: { kind: 'integer', required: true },
    objective: {
      kind: 'object',
      required: true,
      fields: {
        name: { kind: 'string', required: true },
        command: { kind: 'string', required: true },
        direction: { kind: 'enum', required: true, values: ['maximize', 'minimize'] },
        min_delta: { kind: 'number', required: true },
      },
    },
    hard_invariants: { kind: 'invariantArray', required: true },
    allowed_evolution_surface: { kind: 'stringArray', required: true },
    protected_paths: { kind: 'stringArray', required: true },
    evidence: {
      kind: 'object',
      required: true,
      fields: {
        public_commands: { kind: 'stringArray', required: true },
        per_command_timeout_ms: { kind: 'integer', defaultValue: CONTRACT_DEFAULTS['evidence.per_command_timeout_ms'] },
        max_output_bytes: { kind: 'integer', defaultValue: CONTRACT_DEFAULTS['evidence.max_output_bytes'] },
      },
    },
    acceptance: {
      kind: 'object',
      required: true,
      fields: {
        // Template-only / half-dead keys: allowed, but 0.3.0 never hard-requires them.
        require_proposal: { kind: 'boolean' },
        require_claims: { kind: 'boolean' },
        require_objective_improvement: { kind: 'boolean' },
        require_rollback_point: { kind: 'boolean', required: true },
        hidden_regression_tolerance: { kind: 'integer', required: true },
      },
    },
    capabilities: {
      kind: 'object',
      required: true,
      open: true,
      fields: {
        authority_ceiling: { kind: 'enum', required: true, values: ['A0', 'A1', 'A2', 'A3'] },
      },
    },
    budgets: {
      kind: 'object',
      required: true,
      fields: {
        max_iterations: { kind: 'integer', required: true },
        max_wall_clock_ms: { kind: 'integer', required: true },
        max_failed_candidates: { kind: 'integer', required: true },
        max_consecutive_no_improvement: { kind: 'integer', required: true },
        max_tokens: { kind: 'nullableInteger', required: true },
        max_usd: { kind: 'nullableNumber', required: true },
      },
    },
  },
};

/** One `adapters.<name>` entry. `agent` is rejected for `pi` by the value rules. */
function adapterSpec(): FieldSpec {
  return {
    kind: 'object',
    fields: {
      command: { kind: 'string' },
      model: { kind: 'nullableString' },
      agent: { kind: 'nullableString' },
    },
  };
}

/** `.evofence/config.yaml` (`docs/refactor-inventory.md` §5.3). */
export const CONFIG_SCHEMA: FieldSpec = {
  kind: 'object',
  fields: {
    version: { kind: 'integer', required: true },
    adapters: {
      kind: 'object',
      fields: {
        codex: adapterSpec(),
        opencode: adapterSpec(),
        claude: adapterSpec(),
        pi: adapterSpec(),
      },
    },
  },
};

/** `.evofence/private/holdout.yaml` (`docs/refactor-inventory.md` §5.4). */
export const HOLDOUT_SCHEMA: FieldSpec = {
  kind: 'object',
  fields: {
    regressions: { kind: 'invariantArray', required: true },
  },
};

/** `experiment run <file>` manifest (`docs/refactor-inventory.md` §5.5). */
export const EXPERIMENT_SCHEMA: FieldSpec = {
  kind: 'object',
  fields: {
    goal_file: { kind: 'string', required: true },
    adapter: { kind: 'string' },
    iterations: { kind: 'number' },
    max_wall_clock_ms: { kind: 'number' },
    allow_unisolated_agent: { kind: 'boolean' },
    allow_readable_holdout: { kind: 'boolean' },
  },
};

/** The schema for a document kind. */
export function documentSchema(kind: ConfigDocumentKind): FieldSpec {
  switch (kind) {
    case 'contract': return CONTRACT_SCHEMA;
    case 'config': return CONFIG_SCHEMA;
    case 'holdout': return HOLDOUT_SCHEMA;
    case 'experiment': return EXPERIMENT_SCHEMA;
  }
}

/** Dotted paths of every field the schema marks `required`. */
export function requiredFieldPaths(spec: FieldSpec = CONTRACT_SCHEMA, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, child] of Object.entries(spec.fields ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child.required && child.defaultValue === undefined) paths.push(path);
    paths.push(...requiredFieldPaths(child, path));
  }
  return paths;
}

/** Dotted paths of every field that declares a code default. */
export function defaultedFieldPaths(spec: FieldSpec = CONTRACT_SCHEMA, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, child] of Object.entries(spec.fields ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child.defaultValue !== undefined) paths.push(path);
    paths.push(...defaultedFieldPaths(child, path));
  }
  return paths;
}
