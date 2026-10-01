/**
 * The 58 frozen error codes, their retry class, and the one error envelope.
 *
 * Transcribed once from `ERRORS.md` (l1-freeze.2). `test/protocol/schema-drift.test.ts` re-parses
 * that file and the `ErrorCode` enum in `SCHEMAS.md` and fails on any divergence. `RETRY_POLICY` is
 * keyed by `ErrorCode`, so adding a code without a retry class does not compile.
 *
 * There is exactly one envelope. A caller that needs a business outcome returns a typed result
 * (see `codec.ts`); it does not invent a second error shape.
 */
import type { Decoded } from './types.js';

/** Retry classes, derived from the frozen `ErrorEnvelope.retry` enum. */
export type RetryPolicy = Decoded<'ErrorEnvelope'>['retry'];

/** Every wire error code. Derived from the table below, never re-listed. */
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Code list, in `ERRORS.md` order. */
export const ERROR_CODES = [
  'EFK_SCHEMA_INVALID',
  'EFK_PROTOCOL_UNSUPPORTED',
  'EFK_LEGACY_NOT_EXECUTABLE',
  'EFK_SOURCE_PIN_DRIFT',
  'EFK_REVISION_CONFLICT',
  'EFK_GRAPH_REFERENCE_INVALID',
  'EFK_GRAPH_DEPENDENCY_CYCLE',
  'EFK_GRAPH_INPUT_STALE',
  'EFK_GRAPH_JOIN_INCOMPLETE',
  'EFK_GRAPH_AUTHORITY_ESCALATION',
  'EFK_GRAPH_RESOURCE_CONFLICT',
  'EFK_GRAPH_BOUND_INVALID',
  'EFK_GRAPH_NON_TERMINATING',
  'EFK_GRAPH_TERMINAL_REQUIRED',
  'EFK_GRAPH_EVIDENCE_REMOVAL',
  'EFK_GRAPH_ACTIVE_NODE_MUTATION',
  'EFK_GRAPH_NO_MATCHING_ROUTE',
  'EFK_INVARIANT_VIOLATION',
  'EFK_CAPABILITY_UNSUPPORTED',
  'EFK_CAPABILITY_EVIDENCE_INSUFFICIENT',
  'EFK_DEGRADATION_APPROVAL_REQUIRED',
  'EFK_AUTHORITY_DENIED',
  'EFK_GRANT_EXPIRED',
  'EFK_GRANT_REVOKED',
  'EFK_CLAIM_CONFLICT',
  'EFK_LEASE_STALE',
  'EFK_IDEMPOTENCY_COLLISION',
  'EFK_BUDGET_NOT_AUTHORIZED',
  'EFK_BUDGET_EXHAUSTED',
  'EFK_BUDGET_ENVELOPE_INCONSISTENT',
  'EFK_USAGE_INCOMPLETE',
  'EFK_USAGE_CONFLICT',
  'EFK_ARTIFACT_DIGEST_MISMATCH',
  'EFK_ARTIFACT_BINDING_MISMATCH',
  'EFK_ARTIFACT_UNAVAILABLE',
  'EFK_HOST_SESSION_MISMATCH',
  'EFK_HOST_EXECUTION_FAILED',
  'EFK_HOST_REVISION_CONFLICT',
  'EFK_HOST_BOARD_AUTHORITY_CONFLICT',
  'EFK_HOST_DELIVERY_UNCONFIRMED',
  'EFK_CANCEL_UNCONFIRMED',
  'EFK_RECEIPT_STALE',
  'EFK_RECOVERY_SEQUENCE_GAP',
  'EFK_RECOVERY_SCHEMA_MISMATCH',
  'EFK_EFFECT_UNKNOWN',
  'EFK_EFFECT_NON_IDEMPOTENT_RETRY',
  'EFK_EVALUATION_INSUFFICIENT',
  'EFK_EVALUATION_DATA_DEGRADED',
  'EFK_EVALUATION_PROTOCOL_MISMATCH',
  'EFK_DECISION_AUTHORITY_DENIED',
  'EFK_ASSET_QUALIFICATION_INVALID',
  'EFK_ASSET_SCOPE_DENIED',
  'EFK_ASSET_REVOKED',
  'EFK_ASSET_EXPIRED',
  'EFK_ACTIVATION_NOT_SETTLED',
  'EFK_ACTIVATION_UNCONFIRMED',
  'EFK_PRIVACY_VIOLATION',
  'EFK_HUMAN_APPROVAL_MISSING',
] as const;

/**
 * Retry class per code. `never` means the same request must not be retried as-is;
 * `after-refresh` re-reads state and issues a new commandId/expectedRevision;
 * `after-authorization` needs a new real grant; `after-reconcile` requires establishing what
 * actually happened first. The last two are not blanket permission to replay.
 */
export const RETRY_POLICY: Readonly<Record<ErrorCode, RetryPolicy>> = {
  EFK_SCHEMA_INVALID: 'never',
  EFK_PROTOCOL_UNSUPPORTED: 'never',
  EFK_LEGACY_NOT_EXECUTABLE: 'never',
  EFK_SOURCE_PIN_DRIFT: 'after-authorization',
  EFK_REVISION_CONFLICT: 'after-refresh',
  EFK_GRAPH_REFERENCE_INVALID: 'never',
  EFK_GRAPH_DEPENDENCY_CYCLE: 'never',
  EFK_GRAPH_INPUT_STALE: 'after-refresh',
  EFK_GRAPH_JOIN_INCOMPLETE: 'after-refresh',
  EFK_GRAPH_AUTHORITY_ESCALATION: 'never',
  EFK_GRAPH_RESOURCE_CONFLICT: 'never',
  EFK_GRAPH_BOUND_INVALID: 'never',
  EFK_GRAPH_NON_TERMINATING: 'never',
  EFK_GRAPH_TERMINAL_REQUIRED: 'never',
  EFK_GRAPH_EVIDENCE_REMOVAL: 'never',
  EFK_GRAPH_ACTIVE_NODE_MUTATION: 'after-reconcile',
  EFK_GRAPH_NO_MATCHING_ROUTE: 'never',
  EFK_INVARIANT_VIOLATION: 'after-reconcile',
  EFK_CAPABILITY_UNSUPPORTED: 'never',
  EFK_CAPABILITY_EVIDENCE_INSUFFICIENT: 'after-refresh',
  EFK_DEGRADATION_APPROVAL_REQUIRED: 'after-authorization',
  EFK_AUTHORITY_DENIED: 'never',
  EFK_GRANT_EXPIRED: 'after-authorization',
  EFK_GRANT_REVOKED: 'after-authorization',
  EFK_CLAIM_CONFLICT: 'after-refresh',
  EFK_LEASE_STALE: 'after-reconcile',
  EFK_IDEMPOTENCY_COLLISION: 'never',
  EFK_BUDGET_NOT_AUTHORIZED: 'after-authorization',
  EFK_BUDGET_EXHAUSTED: 'after-authorization',
  EFK_BUDGET_ENVELOPE_INCONSISTENT: 'never',
  EFK_USAGE_INCOMPLETE: 'after-reconcile',
  EFK_USAGE_CONFLICT: 'after-reconcile',
  EFK_ARTIFACT_DIGEST_MISMATCH: 'never',
  EFK_ARTIFACT_BINDING_MISMATCH: 'never',
  EFK_ARTIFACT_UNAVAILABLE: 'after-refresh',
  EFK_HOST_SESSION_MISMATCH: 'after-reconcile',
  EFK_HOST_EXECUTION_FAILED: 'after-reconcile',
  EFK_HOST_REVISION_CONFLICT: 'after-refresh',
  EFK_HOST_BOARD_AUTHORITY_CONFLICT: 'after-reconcile',
  EFK_HOST_DELIVERY_UNCONFIRMED: 'after-reconcile',
  EFK_CANCEL_UNCONFIRMED: 'after-reconcile',
  EFK_RECEIPT_STALE: 'after-reconcile',
  EFK_RECOVERY_SEQUENCE_GAP: 'after-reconcile',
  EFK_RECOVERY_SCHEMA_MISMATCH: 'never',
  EFK_EFFECT_UNKNOWN: 'after-reconcile',
  EFK_EFFECT_NON_IDEMPOTENT_RETRY: 'after-authorization',
  EFK_EVALUATION_INSUFFICIENT: 'after-refresh',
  EFK_EVALUATION_DATA_DEGRADED: 'never',
  EFK_EVALUATION_PROTOCOL_MISMATCH: 'never',
  EFK_DECISION_AUTHORITY_DENIED: 'never',
  EFK_ASSET_QUALIFICATION_INVALID: 'never',
  EFK_ASSET_SCOPE_DENIED: 'never',
  EFK_ASSET_REVOKED: 'never',
  EFK_ASSET_EXPIRED: 'after-authorization',
  EFK_ACTIVATION_NOT_SETTLED: 'after-refresh',
  EFK_ACTIVATION_UNCONFIRMED: 'after-reconcile',
  EFK_PRIVACY_VIOLATION: 'never',
  EFK_HUMAN_APPROVAL_MISSING: 'after-authorization',
};

/** The frozen error envelope (`$defs.ErrorEnvelope`). */
export type ErrorEnvelope = Decoded<'ErrorEnvelope'>;

/** Build an envelope for `code`, taking the retry class from `RETRY_POLICY`. */
export function fail(
  code: ErrorCode,
  message: string,
  refs: readonly string[] = [],
  visibility: ErrorEnvelope['visibility'] = 'internal',
): ErrorEnvelope {
  return { code, message, retry: RETRY_POLICY[code], refs, visibility };
}
