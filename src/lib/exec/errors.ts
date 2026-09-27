/**
 * Exec domain · typed re-export of the shared error primitives.
 *
 * `src/lib/errors.js` is a shared leaf that L2 domains must not edit, and its inferred
 * declaration types `details` as `undefined` (the 0.3.0 default parameter). The budget and git
 * paths need to attach structured `details` to `EvoFenceError`, so the constructor is widened
 * here. Runtime identity is preserved: `new EvoFenceError(...)` is still the real class and
 * `instanceof` against the original still holds.
 */
import { EvoFenceError as RawEvoFenceError, invariant as rawInvariant } from '../errors.js';

/** The shape callers rely on after catching an EvoFence error. */
export interface EvoFenceErrorLike extends Error {
  code: string;
  details?: unknown;
}

export const EvoFenceError = RawEvoFenceError as unknown as new (code: string, message: string, details?: unknown) => EvoFenceErrorLike;

export const invariant = rawInvariant as unknown as (condition: unknown, code: string, message: string, details?: unknown) => void;
