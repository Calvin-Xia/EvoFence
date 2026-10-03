/**
 * The pure predicate AST (`INTERFACES.md §4`).
 *
 * Routing conditions are data, not code: a `Predicate` is `eq/neq/all/any/not/true` over an
 * explicit `path`, and it is evaluated against exactly one binding's outcome/reason and the
 * contract-declared immutable env. There is no `eval`, no function-call form, and no host-brand
 * lookup — `env.hasTool('X')` in `EXAMPLES.md` is shorthand for reading the boolean key
 * `env.hasTool` from a bound environment artifact, which is what `{op:'eq', path:'env.hasTool',
 * value:true}` compiles to.
 *
 * Two rules are load-bearing:
 *   - an unknown or missing path does **not** match (never coerced through `null` into success);
 *   - comparison is by original JSON type, with no JavaScript coercion.
 */
import { fail, type ErrorEnvelope } from '../../protocol/index.js';
import type { Predicate } from './types.js';

/** Roots a predicate may read. Anything else is unknown, not "false by luck". */
const ROOTS = new Set(['outcome', 'reason', 'self', 'decision', 'env']);

export interface PredicateEnv {
  readonly outcome: unknown;
  readonly reason: unknown;
  readonly self: Readonly<Record<string, unknown>>;
  readonly decision: Readonly<Record<string, unknown>>;
  readonly env: Readonly<Record<string, unknown>>;
}

function rootValue(root: string, env: PredicateEnv): unknown {
  switch (root) {
    case 'outcome':
      return env.outcome;
    case 'reason':
      return env.reason;
    case 'self':
      return env.self;
    case 'decision':
      return env.decision;
    case 'env':
      return env.env;
    default:
      return undefined;
  }
}

/**
 * Read `path` (`root(.key)*`) out of the binding. A path that leaves the declared roots, or names
 * a key that was never bound, is `{ ok: false }` — the caller treats it as "does not match".
 */
export function readPath(path: string, env: PredicateEnv): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  const parts = path.split('.');
  const root = parts[0];
  if (!ROOTS.has(root)) return { ok: false };
  let current: unknown = rootValue(root, env);
  for (const part of parts.slice(1)) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return { ok: false };
    const record = current as Record<string, unknown>;
    if (!Object.hasOwn(record, part)) return { ok: false };
    current = record[part];
  }
  return { ok: true, value: current };
}

/** Exact JSON-scalar equality: no coercion, and `null` only equals `null`. */
function scalarEquals(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === null && right === null;
  return left === right;
}

/** Evaluate a validated predicate AST for one binding. Missing paths never match. */
export function evalPredicate(predicate: Predicate, env: PredicateEnv): boolean {
  switch (predicate.op) {
    case 'true':
      return true;
    case 'eq': {
      const found = predicate.path === null ? { ok: false as const } : readPath(predicate.path, env);
      return found.ok && scalarEquals(found.value, predicate.value);
    }
    case 'neq': {
      const found = predicate.path === null ? { ok: false as const } : readPath(predicate.path, env);
      return found.ok && !scalarEquals(found.value, predicate.value);
    }
    case 'all':
      return predicate.children.every((child) => evalPredicate(child, env));
    case 'any':
      return predicate.children.some((child) => evalPredicate(child, env));
    case 'not':
      return predicate.children.length === 1 && !evalPredicate(predicate.children[0], env);
  }
}

/**
 * The predicate AST's shape gate (`INTERFACES.md §4`). The JSON schema cannot express these
 * `op`↔`path`/`children` couplings, so they are enforced when a graph is accepted.
 */
export function validatePredicate(predicate: Predicate, at: string): ErrorEnvelope | null {
  const refuse = (detail: string): ErrorEnvelope => fail('EFK_SCHEMA_INVALID', `${at}: ${detail}`);
  if (predicate.op === 'eq' || predicate.op === 'neq') {
    if (predicate.path === null) return refuse(`${predicate.op} needs a non-null path`);
    if (predicate.children.length !== 0) return refuse(`${predicate.op} takes zero children`);
    return null;
  }
  if (predicate.op === 'all' || predicate.op === 'any') {
    if (predicate.path !== null || predicate.value !== null) return refuse(`${predicate.op} takes null path/value`);
    if (predicate.children.length < 1) return refuse(`${predicate.op} needs at least one child`);
  } else if (predicate.op === 'not') {
    if (predicate.path !== null || predicate.value !== null) return refuse('not takes null path/value');
    if (predicate.children.length !== 1) return refuse('not takes exactly one child');
  } else {
    if (predicate.path !== null || predicate.value !== null) return refuse('true takes null path/value');
    if (predicate.children.length !== 0) return refuse('true takes zero children');
  }
  for (let index = 0; index < predicate.children.length; index += 1) {
    const failure = validatePredicate(predicate.children[index], `${at}.children[${index}]`);
    if (failure !== null) return failure;
  }
  return null;
}
