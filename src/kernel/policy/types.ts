/**
 * Shared vocabulary for the policy lane.
 *
 * These are internal decision types, not wire objects: every wire shape comes from
 * `src/protocol/**` and is only decoded there. Keeping the result envelope identical in shape to
 * `Validated<K>` matters — a policy answer is either a value or one frozen `ErrorEnvelope`, never a
 * thrown exception and never a second error vocabulary.
 */
import type { Decoded, ErrorEnvelope } from '../../protocol/index.js';

/** A policy answer: the value, or an `EFK_*` envelope. There is no third branch. */
export type PolicyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ErrorEnvelope };

/** `Scope.trustDomain`; `os-sandbox` is never inferred from hooks, worktrees or same-user. */
export type TrustDomain = Decoded<'Scope'>['trustDomain'];

/**
 * Every real or implicit model request, in the order a run makes them. All of them are charged to
 * the same parent pool; role is provenance for accounting, never a second budget.
 */
export type RequestRole =
  | 'planner'
  | 'worker'
  | 'reviewer'
  | 'learning'
  | 'evaluator'
  | 'repair'
  | 'compaction'
  | 'continuation';
