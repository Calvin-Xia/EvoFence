/**
 * Claim creation and the CAS gate behind `node.claim`.
 *
 * `CONTRACTS.md §5.1`: "同一节点同一 attempt 最多有一个有效 claim". The claim is the unique writer
 * identity for one attempt — its leases hang off `claimId`, so two claims on the same attempt would
 * be two writers even before any resource is considered. The store's unique key is
 * `(sessionId, nodeId, attemptOrdinal, epoch)`, all four carried by the `Binding`, which is why
 * `claimId` is the attempt id and not a third identity to keep in sync (`SCHEMAS.md §3`).
 *
 * Two entry points, deliberately split:
 *
 *   - `claimNode` is the CAS gate. It checks `expectedRevision` and the attempt uniqueness key and
 *     returns `EFK_REVISION_CONFLICT` / `EFK_CLAIM_CONFLICT` instead of writing. `INTERFACES.md §4`
 *     fixes the losing side of a claim race: it stays `ready` and is rescheduled, so refusing is a
 *     normal answer, not an error state.
 *   - `recordClaim` is the low-level pure insert used by the dispatch round. Consumers of injected
 *     state must handle multiple attempts of a node; `findClaim` selects one deterministically.
 */
import { fail } from '../../protocol/index.js';
import type { ErrorEnvelope, Instant } from '../../protocol/index.js';
import type { Binding, Claim, SchedulerState } from './types.js';

export interface ClaimTransition {
  readonly state: SchedulerState;
  readonly claim: Claim | null;
  readonly error: ErrorEnvelope | null;
}

/** The attempt identity doubles as the claim identity; see the module note. */
export function claimIdFor(binding: Binding): string {
  return binding.attemptId;
}

export function claimFor(binding: Binding, claimedAt: Instant): Claim {
  return { claimId: claimIdFor(binding), binding, claimedAt };
}

export function findClaim(claims: readonly Claim[], nodeId: string): Claim | undefined {
  return [...claims].sort(compareClaims).find((claim) => claim.binding.nodeId === nodeId);
}

/** Stable attempt order, independent of store row order and the host locale. */
export function compareClaims(left: Claim, right: Claim): number {
  const key = (claim: Claim) => JSON.stringify([
    claim.binding.sessionId, claim.binding.nodeId, claim.binding.attemptOrdinal,
    claim.binding.epoch, claim.binding.attemptId, claim.claimId, claim.claimedAt, claim.binding,
  ]);
  const a = key(left);
  const b = key(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function sameAttempt(left: Binding, right: Binding): boolean {
  return left.sessionId === right.sessionId && left.nodeId === right.nodeId &&
    left.attemptOrdinal === right.attemptOrdinal && left.epoch === right.epoch;
}

/** Pure insert. Does not check the uniqueness key — the caller computed the frontier from this state. */
export function recordClaim(state: SchedulerState, claim: Claim): SchedulerState {
  return { ...state, revision: state.revision + 1, claims: [...state.claims, claim] };
}

/** The CAS gate for `node.claim`: revision match first, then one claim per node attempt. */
export function claimNode(
  state: SchedulerState,
  binding: Binding,
  now: Instant,
  expectedRevision: number,
): ClaimTransition {
  if (state.revision !== expectedRevision) {
    return {
      state,
      claim: null,
      error: fail('EFK_REVISION_CONFLICT', `expected revision ${expectedRevision}, journal is at ${state.revision}`, [
        binding.nodeId,
      ]),
    };
  }
  const existing = state.claims.find((claim) => sameAttempt(claim.binding, binding));
  if (existing !== undefined) {
    return {
      state,
      claim: null,
      error: fail(
        'EFK_CLAIM_CONFLICT',
        `node ${binding.nodeId} already has claim ${existing.claimId}; the loser stays ready and is rescheduled`,
        [binding.nodeId],
      ),
    };
  }
  const claim = claimFor(binding, now);
  return { state: recordClaim(state, claim), claim, error: null };
}
