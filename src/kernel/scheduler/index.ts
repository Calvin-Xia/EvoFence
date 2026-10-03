/**
 * `evofence.kernel.scheduler` — frontier, claims, leases and stall reporting (node `l2_scheduler`).
 *
 * The public entry point. Consumers import from here, not from the individual modules, so the file
 * layout can change without breaking the contract. Everything exported is pure: no I/O, no clock,
 * no ambient state (`OWNERSHIP.md` I01–I08). The instant, the budget ledger, the journal facts and
 * the attempt binding are all parameters.
 *
 * Reading order for the semantics this module implements:
 *   `spec/graph/SEMANTICS.md` §2.2 (resource readiness), §2.3 (attempt/epoch/lease separation),
 *   §3.1 (`repair`/`fallback` cover), §3.2 (resources are declarations, not edges), §5.2 (a late
 *   receipt changes nothing), §5.3 (fan-in never filters a branch);
 *   `spec/contracts/CONTRACTS.md` §5 items 1, 2, 3, 7 and 8;
 *   `spec/contracts/SCHEMAS.md` §3 (no wire object for a claim or a reservation).
 *
 * Frozen-field note: `Binding` and `LeaseRef` are the protocol layer's decoded shapes; a lease
 * grant adds exactly one scheduler-internal field (`mode`, the policy mode it was granted under) and
 * `toLeaseRef` is the only projection back to the wire.
 */
export type {
  Binding,
  Claim,
  DecisionCode,
  DecisionReason,
  DispatchDecision,
  DispatchInput,
  DispatchRound,
  FairnessState,
  FrontierDisposition,
  FrontierEntry,
  LeaseGrant,
  LeaseRef,
  LeaseTable,
  ProgressReport,
  ProgressStatus,
  ResourceConflict,
  ResourceDeclaration,
  ResourceMode,
  SchedulerState,
  StallEntry,
  StallReason,
} from './types.js';

export { claimFor, claimIdFor, claimNode, findClaim, recordClaim, type ClaimTransition } from './claim.js';
export { classifyClaim, liveAttemptClaims, reclaimExpiredClaims, type ClaimActivity, type ReclaimTransition }
  from './activity.js';
export {
  applyLeaseReceipt,
  emptyLeaseTable,
  grantLease,
  liveGrants,
  releaseClaimLeases,
  releaseUnderLease,
  toLeaseRef,
  type LeaseReceipt,
  type LeaseRequest,
  type LeaseTransition,
  type ReceiptTransition,
  type ReceiptVerdict,
  type ReleaseTransition,
} from './lease.js';
export { declarationsOf, independentOf, resourceConflicts } from './resources.js';
export { computeFrontier, dispatchableEntries } from './frontier.js';
export { advanceFairness, emptyFairness, orderFrontier } from './fairness.js';
export {
  DISPATCH_REQUEST_ROLE,
  dispatchRound,
  emptyState,
  settleDispatch,
  type UsageObservation,
} from './dispatch.js';
export { joinGate, type JoinGate } from './fanin.js';
export { progress, type ProgressInput } from './progress.js';
