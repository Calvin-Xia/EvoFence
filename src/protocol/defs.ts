/**
 * The JSON Schema keyword subset that `SCHEMAS.md` §1 `$defs` actually uses.
 *
 * `src/protocol/objects/*.ts` are the field tables transcribed once from
 * `docs/evofence-harness-kernel/spec/contracts/SCHEMAS.md` (`l1-freeze.2`, schemaVersion 1.1.0,
 * JSON Schema draft 2020-12). Those tables must satisfy `DefsSchema`, and `codec.ts` implements
 * exactly `ASSERTION_KEYWORDS`.
 *
 * Two machine checks keep that honest (`test/protocol/schema-drift.test.ts`):
 *   1. every object/field/type in the tables equals the `$defs` block re-parsed from SCHEMAS.md;
 *   2. the keyword set used by `$defs` equals `ASSERTION_KEYWORDS ∪ ANNOTATION_KEYWORDS`, so a new
 *      keyword in the frozen document fails the test instead of being silently ignored.
 */

/** One schema node. Every keyword present in the frozen `$defs` appears here; there is no index signature. */
export interface Def {
  readonly $ref?: string;
  readonly type?: 'object' | 'string' | 'integer' | 'boolean' | 'array' | 'null';
  readonly const?: string | number | boolean;
  readonly enum?: readonly (string | number | boolean)[];
  readonly properties?: Readonly<Record<string, Def>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: false | Def;
  readonly propertyNames?: Def;
  readonly items?: Def;
  readonly minItems?: number;
  readonly uniqueItems?: boolean;
  readonly minLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly anyOf?: readonly Def[];
  readonly allOf?: readonly Def[];
  readonly if?: Def;
  readonly then?: Def;
  readonly not?: Def;
  readonly description?: string;
  readonly 'x-source'?: string;
  readonly 'x-mapping'?: string;
}

/** A whole `$defs` map: definition name -> schema node. */
export type DefsSchema = Readonly<Record<string, Def>>;

/** Keywords `codec.ts` validates. Anything here must have an implementation branch. */
export const ASSERTION_KEYWORDS = [
  '$ref',
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames',
  'items',
  'minItems',
  'uniqueItems',
  'minLength',
  'pattern',
  'minimum',
  'maximum',
  'anyOf',
  'allOf',
  'if',
  'then',
  'not',
] as const;

/** Keywords carried for provenance only; the codec ignores them. */
export const ANNOTATION_KEYWORDS = ['description', 'x-source', 'x-mapping'] as const;
