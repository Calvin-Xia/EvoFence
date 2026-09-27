/**
 * The ledger-read contracts and payload primitives every view module consumes.
 *
 * DOMAIN: report/status views (L2 node `l2_report`).
 *
 * WHY THIS MODULE EXISTS: `report` and `status` read the ledger through two different surfaces,
 * and before this node each declared its own copy. Declaring them once here is the "unified
 * view contract": both views depend on an INTERFACE, never on the ledger implementation
 * (`src/lib/ledger.ts`) and never on the exec domain. That keeps the view layer a pure consumer
 * of "execution results + a ledger read interface" (DoD 5) and makes `npm run dep:check` the only
 * thing that has to prove it.
 */
import type {
  GenerationRecord,
  JsonValue,
  LedgerEvent,
  LedgerSnapshot,
  RecentRunSummary,
} from '../../types/index.js';

/**
 * Read surface `buildEvolutionReport` needs: ONE transactional snapshot.
 *
 * spec-f2 locks this deliberately — the report must not call `verify()`/`events()`/
 * `generations()` separately, because those three reads would describe different ledger states.
 */
export interface SnapshotLedger {
  readSnapshot(): LedgerSnapshot;
}

/** Read surface `buildStatus` needs: the 0.3.0 read-only accessors. */
export interface StatusLedger {
  verify(): { valid: boolean };
  activeGeneration(): GenerationRecord | null;
  events(): LedgerEvent[];
  recentRuns(limit: number): RecentRunSummary[];
}

/** Narrow a JSON payload to its object form. Scalars, arrays and `null` collapse to `null`. */
export function payloadObject(payload: JsonValue | undefined): Record<string, JsonValue> | null {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload : null;
}

/** The positive-integer `iteration` an event belongs to, or `null`. */
export function iterationOf(payload: JsonValue | undefined): number | null {
  const iteration = payloadObject(payload)?.iteration;
  return Number.isInteger(iteration) && (iteration as number) > 0 ? (iteration as number) : null;
}

/** A finite number, or `null`. Keeps `0` (a legitimate score/delta) and rejects `NaN`/`Infinity`. */
export function finiteNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `true`/`false`/finite number, else `null`. Used for `private_regressions` counts-or-flags. */
export function booleanOrFiniteNumber(value: JsonValue | undefined): boolean | number | null {
  if (typeof value === 'boolean') return value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `payload.risk.band` when the risk gate attached a `RiskAssessment`. */
export function riskBandOf(risk: JsonValue | undefined): string | null {
  const band = payloadObject(risk)?.band;
  return typeof band === 'string' ? band : null;
}

/** `payload.failure.code`, else `payload.failure.reason`, else `null`. */
export function failureCodeOf(failure: JsonValue | undefined): string | null {
  const record = payloadObject(failure);
  if (!record) return null;
  if (typeof record.code === 'string') return record.code;
  if (typeof record.reason === 'string') return record.reason;
  return null;
}
