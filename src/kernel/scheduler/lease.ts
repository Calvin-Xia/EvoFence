/**
 * The lease table: the one place that can create or retire a writer.
 *
 * Two invariants of `CONTRACTS.md §5` live here and nowhere else:
 *
 *   1. **At most one valid holder of an exclusive resource** (`maxHolders`, from the graph-level
 *      `ResourcePolicy`). Capacity is judged against *live* grants at the injected instant, so a
 *      lease that ran out cannot keep a writer slot, and capacity 0 means the resource is unusable.
 *   2. **A stale lease cannot change state.** `applyLeaseReceipt` releases a claim only when the
 *      receipt names a grant that is still live and matches the attempt exactly; otherwise it
 *      returns the *same* state value and an `EFK_RECEIPT_STALE` archive notice. Nothing about an
 *      expired epoch, a superseded token or an old attempt is allowed to write.
 *
 * `fencingToken` is monotonic and never reused, so a token that lost its lease can never be
 * confused with the next grant on the same resource. Expiry is not a mutation: `now` is injected
 * and liveness is a filter, which keeps every function here replayable (`I07`).
 */
import { asInstant, fail } from '../../protocol/index.js';
import type { ErrorEnvelope, Instant } from '../../protocol/index.js';
import type {
  Binding,
  Claim,
  LeaseGrant,
  LeaseRef,
  LeaseTable,
  ResourceMode,
  SchedulerState,
} from './types.js';

export interface LeaseRequest {
  readonly resourceId: string;
  readonly ownerClaimId: string;
  readonly epoch: number;
  readonly mode: ResourceMode;
  /** `ResourcePolicy.maxHolders`: 1 for exclusive, the quota for shared, 0 for unusable. */
  readonly maxHolders: number;
  readonly ttlMs: number;
}

export interface LeaseTransition {
  readonly table: LeaseTable;
  /** The grant that was created, or `null` when the resource was already at capacity. */
  readonly grant: LeaseGrant | null;
  readonly error: ErrorEnvelope | null;
}

export interface ReleaseTransition {
  readonly table: LeaseTable;
  readonly error: ErrorEnvelope | null;
}

export interface LeaseReceipt {
  readonly receiptId: string;
  /** The lease the work was performed under. */
  readonly lease: LeaseRef;
  /** The attempt that produced the receipt. */
  readonly binding: Binding;
}

export type ReceiptVerdict = 'applied' | 'stale';

export interface ReceiptTransition {
  /** On `stale` this is the *same value* that was passed in — that is the whole point. */
  readonly state: SchedulerState;
  readonly verdict: ReceiptVerdict;
  readonly error: ErrorEnvelope | null;
}

export function emptyLeaseTable(): LeaseTable {
  return { grants: [], nextFencingToken: 1 };
}

/** The grants whose `expiresAt` is still ahead of the injected instant. */
export function liveGrants(table: LeaseTable, now: Instant): readonly LeaseGrant[] {
  return table.grants.filter((grant) => grant.expiresAt > now);
}

/** Take one writer/reader slot on a resource, or refuse because the resource is at capacity. */
export function grantLease(table: LeaseTable, request: LeaseRequest, now: Instant): LeaseTransition {
  const holders = liveGrants(table, now).filter((grant) => grant.resourceId === request.resourceId);
  if (holders.length >= request.maxHolders) {
    return {
      table,
      grant: null,
      error: fail(
        'EFK_GRAPH_RESOURCE_CONFLICT',
        `resource ${request.resourceId} has ${holders.length} live holder(s); maxHolders is ${request.maxHolders}`,
        [request.resourceId],
      ),
    };
  }
  const grant: LeaseGrant = {
    resourceId: request.resourceId,
    ownerClaimId: request.ownerClaimId,
    epoch: request.epoch,
    fencingToken: table.nextFencingToken,
    mode: request.mode,
    expiresAt: asInstant(now + request.ttlMs),
  };
  return {
    table: { grants: [...table.grants, grant], nextFencingToken: table.nextFencingToken + 1 },
    grant,
    error: null,
  };
}

/** Retire every grant of one claim — a receipt, a reclaim or a confirmed cancellation. */
export function releaseClaimLeases(table: LeaseTable, ownerClaimId: string): LeaseTable {
  return { ...table, grants: table.grants.filter((grant) => grant.ownerClaimId !== ownerClaimId) };
}

/**
 * Retire exactly the named lease, and only if it is still the live one.
 *
 * A cancellation that cannot prove it released the lease is not a release (`SEMANTICS.md §3.2`:
 * `cancelling` reaches `cancelled` only after every lease is released); the answer is
 * `EFK_CANCEL_UNCONFIRMED` and the unchanged table, never a silent drop.
 */
export function releaseUnderLease(table: LeaseTable, lease: LeaseRef, now: Instant): ReleaseTransition {
  const live = liveGrants(table, now);
  const match = live.find(
    (grant) =>
      grant.resourceId === lease.resourceId &&
      grant.ownerClaimId === lease.ownerClaimId &&
      grant.fencingToken === lease.fencingToken &&
      grant.epoch === lease.epoch,
  );
  if (match === undefined) {
    return {
      table,
      error: fail(
        'EFK_CANCEL_UNCONFIRMED',
        `lease ${lease.resourceId}#${lease.fencingToken} of ${lease.ownerClaimId} is not live; release not confirmed`,
        [lease.resourceId],
      ),
    };
  }
  return { table: releaseClaimLeases(table, lease.ownerClaimId), error: null };
}

/** The frozen wire shape of a grant. */
export function toLeaseRef(grant: LeaseGrant): LeaseRef {
  return {
    resourceId: grant.resourceId,
    ownerClaimId: grant.ownerClaimId,
    epoch: grant.epoch,
    fencingToken: grant.fencingToken,
    expiresAt: grant.expiresAt,
  };
}

function findClaim(claims: readonly Claim[], claimId: string): Claim | undefined {
  return claims.find((claim) => claim.claimId === claimId);
}

/**
 * Apply the receipt of lease-held work.
 *
 * "Applied" means the claim is retired and its leases released — the node's new state comes from
 * the journal, not from here. Everything else is a stale receipt: it is archived (the error is the
 * record) and the returned state is the *same value* that went in, so no caller can observe a
 * partial write. That covers expiry, a superseded fencing token, a bumped epoch and a receipt from
 * an older attempt with one rule instead of four special cases.
 */
export function applyLeaseReceipt(state: SchedulerState, receipt: LeaseReceipt, now: Instant): ReceiptTransition {
  const { lease } = receipt;
  const live = liveGrants(state.leases, now).find(
    (grant) =>
      grant.resourceId === lease.resourceId &&
      grant.ownerClaimId === lease.ownerClaimId &&
      grant.fencingToken === lease.fencingToken &&
      grant.epoch === lease.epoch,
  );
  const claim = findClaim(state.claims, lease.ownerClaimId);
  const matchesAttempt =
    claim !== undefined &&
    claim.binding.attemptId === receipt.binding.attemptId &&
    claim.binding.epoch === receipt.binding.epoch;

  if (live === undefined || !matchesAttempt) {
    return {
      state,
      verdict: 'stale',
      error: fail(
        'EFK_RECEIPT_STALE',
        `receipt ${receipt.receiptId} does not match a live lease of attempt ${receipt.binding.attemptId}; archived without applying`,
        [lease.resourceId],
      ),
    };
  }
  return {
    state: {
      revision: state.revision + 1,
      claims: state.claims.filter((entry) => entry.claimId !== lease.ownerClaimId),
      leases: releaseClaimLeases(state.leases, lease.ownerClaimId),
    },
    verdict: 'applied',
    error: null,
  };
}
