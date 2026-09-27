/**
 * Payload access for the audit views.
 *
 * `events.payload_json` is a raw TEXT column (`docs/refactor-inventory.md` §10.5 item 25), so a
 * tampered ledger can hold a scalar, an array or `null` where an object is expected. 0.3.0 read
 * those payloads with optional chaining and let `undefined` decide the verdict
 * (`src/lib/audit.js:31-...`), and three `spec-f1` cases lock that behaviour.
 *
 * {@link payloadOf} reproduces it exactly: a non-object payload reads as an empty object, so
 * `payloadOf(event).x` is `undefined` for `null`, a string, a number and an array — the same
 * result optional chaining produced — while never throwing a `TypeError`. Values stay
 * `any`-typed on purpose: the shape is unknowable at this boundary, and the defensive checks
 * that consume them (not the compiler) are what makes the audit fail closed.
 */

import type { LedgerEvent } from '../../types/ledger.js';
import type { AuditEvidence, AuditEvidenceCheck, AuditObjective } from '../../types/report.js';

/** Object view of one event payload; non-object payloads read as `{}`. */
export type PayloadView = Record<string, any>;

/** `event.payload ?? {}` with the 0.3.0 optional-chaining semantics for any JSON value. */
export function payloadOf(event: LedgerEvent | null | undefined): PayloadView {
  const payload: unknown = event?.payload;
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as PayloadView)
    : {};
}

/**
 * `auditObjective(accepted, proposalEvent, runStartedEvent)` (`src/lib/audit.js:250-262`).
 *
 * Objective metadata may only come from the run's historical `contract_snapshot`; `direction`
 * stays `null` when the snapshot lacks it rather than defaulting to `maximize`.
 */
export function auditObjective(
  accepted: LedgerEvent | null,
  proposalEvent: LedgerEvent | null,
  runStartedEvent: LedgerEvent | null,
): AuditObjective | null {
  if (!accepted) return null;
  const contractObjective = payloadOf(runStartedEvent).contract_snapshot?.objective;
  if (!contractObjective || typeof contractObjective !== 'object') return null;
  const expectedEffect = payloadOf(proposalEvent).proposal?.expected_effect;
  return {
    metric: typeof contractObjective.name === 'string'
      ? contractObjective.name
      : (typeof expectedEffect?.primary_metric === 'string' ? expectedEffect.primary_metric : null),
    direction: typeof contractObjective.direction === 'string' ? contractObjective.direction : null,
    score: payloadOf(accepted).objective_score ?? null,
    improvement: payloadOf(accepted).improvement ?? null,
  };
}

/**
 * `auditEvidence(evidenceEvent)` (`src/lib/audit.js:264-276`).
 *
 * Only the public/hard-invariant checks are mirrored: the audit view must never expose the
 * hidden oracle. `null` means "no evidence found", not "evidence passed".
 */
export function auditEvidence(evidenceEvent: LedgerEvent | null): AuditEvidence | null {
  const evidence = payloadOf(evidenceEvent).evidence;
  if (!evidence || typeof evidence !== 'object') return null;
  const publicChecks: any[] = Array.isArray(evidence.public) ? evidence.public : [];
  const checks: AuditEvidenceCheck[] = publicChecks.map((item) => ({
    id: item?.id ?? null,
    kind: item?.kind ?? null,
    result: item?.result ?? null,
  }));
  return {
    all_public_passed: evidence.all_public_passed === true,
    all_private_within_tolerance: evidence.all_private_within_tolerance === true,
    checks,
  };
}
