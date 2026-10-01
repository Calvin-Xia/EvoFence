/**
 * Wire types derived from the frozen field table.
 *
 * Nothing here is hand-written per object: `Wire` maps a schema node to its TypeScript type and
 * `Decoded<K>` assembles an object type from the registry's `properties`/`required`. Adding a field
 * to `objects/*.ts` therefore changes the type surface mechanically — there is no second place to
 * keep in sync, and no way for a type to disagree with what `codec.ts` accepts.
 *
 * `readonly` is deliberate: these values are the decode output, and the wire contract's arrays are
 * order-bearing lists that callers must not mutate in place.
 */
import type { Def } from './defs.js';
import type { DEFS, DefName } from './objects/index.js';

/** The `properties` map of a definition, or `never` when the definition has none. */
type PropsOf<K extends DefName> = (typeof DEFS)[K] extends { properties: infer P } ? P : never;

/** The `required` list of a definition. */
type RequiredOf<K extends DefName> = (typeof DEFS)[K] extends { required: readonly (infer R extends string)[] }
  ? R
  : never;

/**
 * The TypeScript type of one schema node.
 *
 * Branch order mirrors the frozen document's own vocabulary: `$ref`, `const`, `enum`, `array`,
 * `object`+`additionalProperties`, the scalar `type`s, then `anyOf`. A node that matches nothing
 * here is `unknown` — `test/protocol/schema-drift.test.ts` asserts that the keyword set used by
 * `$defs` is exactly the set `codec.ts` implements, so an unhandled construct fails the suite
 * rather than silently degrading to `unknown`.
 */
export type Wire<S> = S extends { $ref: `#/$defs/${infer N}` }
  ? N extends DefName
    ? Wire<(typeof DEFS)[N]>
    : never
  : S extends { const: infer C }
    ? C
    : S extends { enum: readonly (infer E)[] }
      ? E
      : S extends { type: 'array'; items: infer I }
        ? readonly Wire<I>[]
        : S extends { type: 'object'; additionalProperties: infer AP }
          ? AP extends Def
            ? Readonly<Record<string, Wire<AP>>>
            : Readonly<Record<string, unknown>>
          : S extends { type: 'string' }
            ? string
            : S extends { type: 'integer' }
              ? number
              : S extends { type: 'boolean' }
                ? boolean
                : S extends { type: 'null' }
                  ? null
                  : S extends { anyOf: readonly (infer A)[] }
                    ? Wire<A>
                    : unknown;

type HasProps<K extends DefName> = (typeof DEFS)[K] extends { properties: object } ? true : false;

type ObjectOf<K extends DefName> = {
  readonly [F in keyof PropsOf<K> as F extends RequiredOf<K> ? F : never]: Wire<PropsOf<K>[F]>;
} & {
  readonly [F in keyof PropsOf<K> as F extends RequiredOf<K> ? never : F]?: Wire<PropsOf<K>[F]>;
};

/**
 * The decoded shape of definition `K`.
 *
 * Definitions with `properties` become object types with the frozen field names, where optional
 * fields are the ones outside the frozen `required` list (only `LoopSpec`'s four bounds today).
 * Scalar aliases (`Id`, `Digest`, `Count`, `NodeState`, `ErrorCode`, …) become their scalar type.
 */
export type Decoded<K extends DefName> = HasProps<K> extends true ? ObjectOf<K> : Wire<(typeof DEFS)[K]>;

/** Names of definitions that describe an object (the 63 protocol objects). */
export type ObjectName = { [K in DefName]: HasProps<K> extends true ? K : never }[DefName];

/** Names of definitions that describe a scalar alias. */
export type ScalarName = Exclude<DefName, ObjectName>;
