/**
 * `evofence.kernel.policy` — authorization, capability negotiation, usage completeness and the
 * shared budget pool. One policy decision, one budget ledger, one error vocabulary (`EFK_*`).
 *
 * Everything here is a pure function over decoded protocol objects with injected time and digests.
 * It performs no I/O, opens no backend and reads no clock; the wire contract itself is owned by
 * `../../protocol/index.js`.
 */
export type { EffectiveAuthority, AuthorityNodeRequest, AuthorityRequest } from './authority.js';
export { deriveAuthority, intersectScopes, scopeViolations, weakerTrustDomain } from './authority.js';

export type { ApprovalBinding, NegotiationInput } from './negotiate.js';
export { negotiate, satisfiesRequirement } from './negotiate.js';

export type { NormalizedUsage, UsageCompleteness } from './usage.js';
export { normalizeUsage, usageCompleteness, usageIdentity } from './usage.js';

export type {
  BudgetLedger,
  BudgetSnapshot,
  BudgetTransition,
  EvaluationEnvelope,
  PriceTable,
  ReleaseInput,
  Reservation,
  ReservationRequest,
  Settlement,
  SettlementInput,
} from './budget.js';
export {
  EVALUATION_ENVELOPES,
  MICRO_USD_PER_USD,
  RESERVE_PER_REQUEST_MICROS,
  budgetSnapshot,
  checkEnvelope,
  openBudgetLedger,
  releaseUnspent,
  reserve,
  settle,
  worstCaseRequestMicros,
} from './budget.js';

export type { PolicyDecision, RiskInput, RiskPolicy } from './risk.js';
export { decide } from './risk.js';

export type { PolicyResult, RequestRole, TrustDomain } from './types.js';

export type {
  ArtifactRef,
  BudgetPolicy,
  CapabilityObservation,
  DegradationOption,
  EvidenceRef,
  Grant,
  GuaranteeGap,
  GuaranteeRequirement,
  HostManifest,
  NegotiationResult,
  ProtocolVersion,
  Scope,
  TaskContract,
  Usage,
} from './wire.js';
