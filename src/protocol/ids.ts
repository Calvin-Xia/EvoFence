/**
 * Branded identity types.
 *
 * The wire form of every id is a plain string (`SCHEMAS.md` `$defs.Id`: `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`).
 * The brands below exist only so the type checker refuses to pass an `attemptId` where a `nodeId`
 * is expected. They are erased at runtime.
 *
 * Validation lives in exactly one place: `decode('Id', value)` / `decode('Digest', value)` in
 * `codec.ts`, driven by the `pattern` in the frozen field table. There is deliberately no second
 * regex here — a duplicated pattern is a duplicated invariant, and the two copies drift.
 */

declare const BRAND: unique symbol;

/** Nominal wrapper: `Brand<'attemptId'>` is not assignable to `Brand<'nodeId'>`. */
export type Brand<Name extends string, T = string> = T & { readonly [BRAND]: Name };

/** A schema `$defs.Id` value. */
export type Id<Name extends string = 'Id'> = Brand<Name>;

/** A schema `$defs.Digest` value (`sha256:<64 hex>`). */
export type Digest = Brand<'Digest'>;

/** A schema `$defs.ModelId` value (`<provider>/<model>`). */
export type ModelId = Brand<'ModelId'>;

/** A schema `$defs.Instant` value: UTC epoch milliseconds. */
export type Instant = Brand<'Instant', number>;

/**
 * Attach an identity brand. This is a pure cast: the caller is asserting that the value came from
 * `decode(...)` or from a source that already validated it.
 */
export function brand<Name extends string>(value: string): Brand<Name>;
export function brand<Name extends string>(value: string | number): Brand<Name, string | number>;
export function brand<Name extends string>(value: string | number): Brand<Name, string | number> {
  return value as Brand<Name, string | number>;
}

/** Attach the `Digest` brand to an already-validated `sha256:` value. */
export function asDigest(value: string): Digest {
  return value as Digest;
}

/** Attach the `Instant` brand to an already-validated epoch-millisecond value. */
export function asInstant(milliseconds: number): Instant {
  return milliseconds as Instant;
}
