/**
 * `src/lib/config` — the v2 config surface for EvoFence.
 *
 * DOMAIN: config (L2 io domain, node `l2_config`). One entry point for the four YAML documents
 * (`docs/refactor-inventory.md` §5): `.evofence/contract.yaml`, `.evofence/config.yaml`,
 * `.evofence/private/holdout.yaml`, and the `experiment run` manifest.
 *
 * Layering: `schema.ts` (data) -> `fields.ts` (structural walk) -> `validate.ts` (value rules +
 * the `ConfigValidationReport` envelope) -> `load.ts` (safe file IO + `status` snapshot). This
 * module deliberately imports nothing from the exec or ledger domains (DoD 6): its only
 * in-tree dependencies are the shared leaves `../errors.js` / `../fs.js` and the read-only
 * `../../types/` layer.
 *
 * FAIL-CLOSED CONTRACT (DoD 4): exactly two code defaults exist in this whole subtree —
 * see `CONTRACT_DEFAULTS`. Every other required field is reported missing instead of filled.
 */
export {
  CONTRACT_DEFAULTS,
  CONTRACT_SCHEMA,
  CONFIG_SCHEMA,
  HOLDOUT_SCHEMA,
  EXPERIMENT_SCHEMA,
  documentSchema,
  defaultedFieldPaths,
  requiredFieldPaths,
  type FieldKind,
  type FieldSpec,
} from './schema.js';

export { walkShape, isPlainObject, type ShapeWalk } from './fields.js';

export {
  assertValidReport,
  formatProblems,
  normalizedDocument,
  validateDocument,
} from './validate.js';

export {
  POLICY_FILES,
  inspectPolicySync,
  loadConfigDocumentSync,
  loadContractDocumentSync,
  loadRequiredConfigDocumentSync,
  loadRequiredContractDocumentSync,
  parsePolicyYaml,
  readPolicyDocumentSync,
  validatePolicyFileSync,
  type AdapterSummary,
  type ContractSummary,
  type PolicySnapshot,
} from './load.js';
