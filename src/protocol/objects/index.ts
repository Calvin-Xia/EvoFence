/**
 * The frozen definition table, merged from the six field-table groups.
 *
 * `DEFS` is the single runtime truth for the protocol layer: `codec.ts` validates against it and
 * `types.ts` derives every wire type from it. `test/protocol-schema-drift.test.js` re-parses
 * `SCHEMAS.md` and fails if this table diverges from `$defs` in any way.
 */
import type { DefsSchema } from '../defs.js';
import { ASSETS_DEFS } from './assets.js';
import { CORE_DEFS } from './core.js';
import { EVALUATION_DEFS } from './evaluation.js';
import { GRAPH_DEFS } from './graph.js';
import { POLICY_DEFS } from './policy.js';
import { RUNTIME_DEFS } from './runtime.js';

export const DEFS = {
  ...ASSETS_DEFS,
  ...CORE_DEFS,
  ...EVALUATION_DEFS,
  ...GRAPH_DEFS,
  ...POLICY_DEFS,
  ...RUNTIME_DEFS,
} as const satisfies DefsSchema;

/** Every definition name in the frozen schema: 63 objects plus 12 scalar aliases. */
export type DefName = keyof typeof DEFS;

export { ASSETS_DEFS, CORE_DEFS, EVALUATION_DEFS, GRAPH_DEFS, POLICY_DEFS, RUNTIME_DEFS };
