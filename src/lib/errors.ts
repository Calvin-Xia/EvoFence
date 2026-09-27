/**
 * The single error type and assertion helper for the whole control plane.
 *
 * Converted 1:1 from `src/lib/errors.js` (L2 io domain, node `l2_config`). Export surface is
 * unchanged (R2): `EvoFenceError` and `invariant` are still the only exports, and the runtime
 * shape of the error (`name`/`code`/`details`) is byte-for-byte the same, because callers such
 * as `cli.js` read `error.code` and `error.details` off it.
 */
export class EvoFenceError extends Error {
  /** Stable, machine-readable failure code (e.g. `INVALID_CONTRACT`). An open set. */
  readonly code: string;
  /** Optional structured context, only printed when `EVOFENCE_DEBUG` is set. */
  readonly details: unknown;

  constructor(code: string, message: string, details: unknown = undefined) {
    super(message);
    this.name = 'EvoFenceError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Fail-closed assertion used throughout the 0.3.0 sources.
 *
 * Deliberately *not* declared as a TS assertion function (`asserts condition`): callers pass
 * arbitrary expressions, not just identifiers, and no caller relies on narrowing. Keeping the
 * signature permissive keeps the JS -> TS migration behavior-identical.
 */
export function invariant(condition: unknown, code: string, message: string, details?: unknown): void {
  if (!condition) throw new EvoFenceError(code, message, details);
}
