/** One lease-aware classification shared by progress, dispatch and explicit reclamation. */
import type { Instant } from '../../protocol/index.js';
import { compareClaims } from './claim.js';
import type { Claim, FrontierEntry, LeaseTable, SchedulerState } from './types.js';

export type ClaimActivity = 'live' | 'lease-expired' | 'claim-without-lease';

/** Owner identity alone is insufficient: the lease must also belong to this attempt's epoch. */
export function classifyClaim(claim: Claim, table: LeaseTable, now: Instant): ClaimActivity {
  const owned = table.grants.filter(
    (grant) => grant.ownerClaimId === claim.claimId && grant.epoch === claim.binding.epoch,
  );
  if (owned.some((grant) => grant.expiresAt > now)) return 'live';
  return owned.length === 0 ? 'claim-without-lease' : 'lease-expired';
}

/** Count only live claims on this graph's unsettled execution frontier, never historical rows. */
export function liveAttemptClaims(
  frontier: readonly FrontierEntry[], state: SchedulerState, now: Instant,
): readonly Claim[] {
  const nodes = new Set(frontier.filter((entry) =>
    entry.disposition === 'dispatchable' || entry.disposition === 'claimed' || entry.disposition === 'active',
  ).map((entry) => entry.nodeId));
  return state.claims.filter((claim) =>
    nodes.has(claim.binding.nodeId) && classifyClaim(claim, state.leases, now) === 'live',
  ).sort(compareClaims);
}

export interface ReclaimTransition {
  readonly verdict: 'reclaimed' | 'unchanged';
  readonly state: SchedulerState;
  readonly reclaimed: readonly Claim[];
  readonly retained: readonly Claim[];
}

/**
 * Explicitly retire claims with no live lease, including claims that never owned a lease.
 * Any matching live lease retains its claim. Expired grants and fencing history are untouched.
 * This pure transition needs the caller's store CAS; it neither reconciles unknown external
 * effects nor releases unknown usage reservations. Retry still needs journal approval and a new
 * attempt binding. On a no-op the state is the identical input value.
 */
export function reclaimExpiredClaims(state: SchedulerState, now: Instant): ReclaimTransition {
  const reclaimed = state.claims.filter((claim) => classifyClaim(claim, state.leases, now) !== 'live')
    .sort(compareClaims);
  const retained = state.claims.filter((claim) => classifyClaim(claim, state.leases, now) === 'live')
    .sort(compareClaims);
  if (reclaimed.length === 0) return { verdict: 'unchanged', state, reclaimed, retained };
  return {
    verdict: 'reclaimed', state: { ...state, revision: state.revision + 1, claims: retained }, reclaimed, retained,
  };
}
