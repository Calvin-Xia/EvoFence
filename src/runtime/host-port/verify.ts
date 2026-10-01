/**
 * The contract verification entry points — what must be true before the kernel may call a host.
 *
 * Three checks live here, each on a **real boundary**, so none is a redundant re-assertion of a
 * caller's own check (brief §1.6):
 *
 *   - `verifyEffect` decodes an `Effect` arriving from outside (argv/YAML/another process) and
 *     binds the four associations DoD ① names: **epoch** (`binding.epoch` vs the grant's epoch),
 *     **idempotency** (`idempotencyKey`), **authority** (`authorityRef` → a live scoped grant) and
 *     **budget** (`reservationRef` for a billable kind). Its output is the read-only
 *     `AuthorizedEffect` that `execute` accepts.
 *   - `verifyReceipt` classifies an arriving receipt as `current` or `archived`: a receipt whose
 *     epoch/attempt moved on is kept as evidence but never applied (`EFK_RECEIPT_STALE`).
 *   - `verifyBoardAuthority` is A15: a native board owner that has no matching kernel claim is
 *     `EFK_HOST_BOARD_AUTHORITY_CONFLICT`, because the board projects the journal and does not
 *     own a second claim.
 */
import { decode, fail } from '../../protocol/index.js';
import { grantIsLive } from './grant.js';
import {
  err,
  ok,
  type AuthorizedEffect,
  type BoardOwner,
  type CapabilityRequirement,
  type DelegationGrant,
  type Effect,
  type EffectKind,
  type HostObservation,
  type HostResult,
  type Instant,
  type Receipt,
} from './types.js';

/** Effects that spend a budgeted resource and therefore need a reservation before dispatch. */
const BILLABLE: readonly EffectKind[] = ['host.agent', 'host.tool', 'host.delegate'];

/** What the caller knows when verifying an effect: the live grants and the current instant. */
export interface VerifyContext {
  readonly grants: readonly DelegationGrant[];
  readonly now: Instant;
}

/**
 * Decode and bind an effect. `input` is intentionally `unknown`: the schema gate is the only place
 * fields are trusted, and a missing `binding.epoch` or `idempotencyKey` can never reach the host.
 */
export function verifyEffect(
  input: unknown,
  context: VerifyContext,
  demands: readonly CapabilityRequirement[] = [],
): HostResult<AuthorizedEffect> {
  const decoded = decode('Effect', input);
  if (!decoded.ok) return err(decoded.error);
  // `decode` already validated `binding`/`payload`; the cast only restores their field types.
  const effect = decoded.value as Effect;

  const grant = context.grants.find((candidate) => candidate.grantId === effect.authorityRef);
  if (grant === undefined) {
    return err(fail('EFK_AUTHORITY_DENIED', `authorityRef ${effect.authorityRef} is not a known grant`, [effect.effectId]));
  }
  if (!grantIsLive(grant, context.now)) {
    return err(
      grant.revoked
        ? fail('EFK_GRANT_REVOKED', `grant ${grant.grantId} is revoked`, [effect.effectId, grant.grantId])
        : fail('EFK_GRANT_EXPIRED', `grant ${grant.grantId} expired before ${context.now}`, [effect.effectId, grant.grantId]),
    );
  }
  if (effect.binding.epoch < grant.issuedEpoch) {
    return err(fail('EFK_AUTHORITY_DENIED', `effect epoch ${effect.binding.epoch} precedes grant epoch ${grant.issuedEpoch}`, [effect.effectId]));
  }
  if (BILLABLE.includes(effect.kind) && effect.reservationRef === null) {
    return err(fail('EFK_BUDGET_NOT_AUTHORIZED', `${effect.kind} is billable and needs a reservationRef`, [effect.effectId]));
  }
  if (effect.kind === 'host.activate' && effect.leases.length === 0) {
    return err(fail('EFK_AUTHORITY_DENIED', 'host.activate needs a lease before it may mutate a snapshot', [effect.effectId]));
  }
  return ok({ effect, grant, demands });
}

/** Where a receipt stands relative to the effect it claims to answer. */
export interface ReceiptDisposition {
  readonly disposition: 'current' | 'archived';
  readonly reason: string | null;
  readonly receipt: Receipt;
}

/**
 * Classify a receipt. A `current` receipt still does not prove success — that is the caller's
 * judgement; this only decides whether the receipt may be applied to the current attempt.
 */
export function verifyReceipt(input: unknown, effect: Effect): HostResult<ReceiptDisposition> {
  const decoded = decode('Receipt', input);
  if (!decoded.ok) return err(decoded.error);
  const receipt = decoded.value as Receipt;
  if (receipt.effectId !== effect.effectId) {
    return err(
      fail('EFK_ARTIFACT_BINDING_MISMATCH', `receipt ${receipt.receiptId} answers effect ${receipt.effectId}, not ${effect.effectId}`, [receipt.receiptId]),
    );
  }
  const sameBinding =
    receipt.binding.epoch === effect.binding.epoch &&
    receipt.binding.attemptId === effect.binding.attemptId &&
    receipt.binding.attemptOrdinal === effect.binding.attemptOrdinal;
  if (!sameBinding) {
    return ok({ disposition: 'archived', reason: 'epoch/attempt moved on; evidence kept, nothing applied', receipt });
  }
  return ok({ disposition: 'current', reason: null, receipt });
}

/**
 * A15: every native board owner must be the kernel's own claim. Returns the owners that are not.
 * An attempt with an unmapped or mismatched owner must not advance (the caller keeps its claim).
 */
export function verifyBoardAuthority(observation: HostObservation, claims: readonly BoardOwner[]): HostResult<readonly BoardOwner[]> {
  const unmapped = observation.boardOwners.filter((owner) => {
    const claim = claims.find((candidate) => candidate.nodeId === owner.nodeId && candidate.attemptId === owner.attemptId);
    return claim === undefined || claim.ownerClaimId !== owner.ownerClaimId;
  });
  if (unmapped.length > 0) {
    const refs = unmapped.map((owner) => owner.attemptId);
    return err(fail('EFK_HOST_BOARD_AUTHORITY_CONFLICT', `${observation.host} board owns attempts with no matching kernel claim`, refs));
  }
  return ok(unmapped);
}
