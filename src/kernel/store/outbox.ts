/**
 * The outbox as a pure projection of the journal.
 *
 * There is no second mutable outbox index that could drift from the journal. The delivery state of
 * every effect is re-derived from the committed events:
 *
 *   - `effect.intended`   -> the effect is `intended` and safe to send;
 *   - `effect.dispatched` -> it was claimed before the host call, so its outcome is now unknown
 *     until a receipt lands; it must never be sent again;
 *   - `receipt.applied`   -> resolved, or still `unknown` if the receipt itself says so;
 *   - `receipt.archived`  -> a stale receipt kept as evidence; it does not move the effect.
 *
 * That is exactly invariant 4/5/6: the intention and the claim are the same journal as the events,
 * a replayed journal reproduces the outbox, and an unknown effect is visible for reconciliation
 * instead of being retried.
 */
import type { Effect, Event, OutboxEntryProjection, OutboxProjection, Receipt, StoreResult } from './contracts.js';
import { storeFail, storeOk } from './contracts.js';

/** Derive the outbox from the journal plus the committed effect/receipt content it references. */
export function projectOutbox(
  events: readonly Event[],
  effects: ReadonlyMap<string, Effect>,
  receipts: ReadonlyMap<string, Receipt>,
): StoreResult<OutboxProjection> {
  const order: string[] = [];
  const entries = new Map<string, OutboxEntryProjection>();
  const archivedReceiptIds: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'effect.intended': {
        const effectId = event.payload.effectId;
        if (effectId === null) {
          return storeFail('EFK_SCHEMA_INVALID', `effect.intended ${event.eventId} carries no effectId`);
        }
        if (entries.has(effectId)) {
          return storeFail('EFK_INVARIANT_VIOLATION', `effect ${effectId} is intended twice in the journal`, [effectId]);
        }
        if (!effects.has(effectId)) {
          return storeFail('EFK_ARTIFACT_UNAVAILABLE', `effect ${effectId} content is referenced by ${event.eventId} but not committed`, [effectId]);
        }
        order.push(effectId);
        entries.set(effectId, { effectId, state: 'intended', resolvedStatus: null });
        break;
      }
      case 'effect.dispatched': {
        const effectId = event.payload.effectId;
        if (effectId === null) {
          return storeFail('EFK_SCHEMA_INVALID', `effect.dispatched ${event.eventId} carries no effectId`);
        }
        const current = entries.get(effectId);
        if (current === undefined) {
          return storeFail('EFK_INVARIANT_VIOLATION', `effect ${effectId} was dispatched without a committed intention`, [effectId]);
        }
        if (current.state !== 'intended') {
          return storeFail('EFK_INVARIANT_VIOLATION', `effect ${effectId} was dispatched while ${current.state}`, [effectId]);
        }
        entries.set(effectId, { effectId, state: 'dispatched', resolvedStatus: null });
        break;
      }
      case 'receipt.applied': {
        const { effectId, objectRef } = event.payload;
        if (effectId === null || objectRef === null) {
          return storeFail('EFK_SCHEMA_INVALID', `receipt.applied ${event.eventId} requires an effectId and an objectRef`);
        }
        if (!entries.has(effectId)) {
          return storeFail('EFK_INVARIANT_VIOLATION', `receipt for unknown effect ${effectId} in ${event.eventId}`, [effectId]);
        }
        const receipt = receipts.get(objectRef.id);
        if (receipt === undefined) {
          return storeFail('EFK_ARTIFACT_UNAVAILABLE', `receipt ${objectRef.id} content is referenced by ${event.eventId} but not committed`, [objectRef.id]);
        }
        entries.set(effectId, {
          effectId,
          state: receipt.status === 'unknown' ? 'unknown' : 'resolved',
          resolvedStatus: receipt.status === 'unknown' ? null : receipt.status,
        });
        break;
      }
      case 'receipt.archived': {
        const { objectRef } = event.payload;
        if (objectRef === null) {
          return storeFail('EFK_SCHEMA_INVALID', `receipt.archived ${event.eventId} requires an objectRef`);
        }
        archivedReceiptIds.push(objectRef.id);
        break;
      }
      default:
        break;
    }
  }

  return storeOk({ entries: order.map((effectId) => entries.get(effectId) as OutboxEntryProjection), archivedReceiptIds });
}

/** Effects committed but not yet claimed; the only set a dispatcher may send. */
export function intendedIds(projection: OutboxProjection): readonly string[] {
  return projection.entries.filter((entry) => entry.state === 'intended').map((entry) => entry.effectId);
}

/** Effects whose actual outcome is unknown (claimed, or reported unknown); they require reconcile. */
export function reconcileIds(projection: OutboxProjection): readonly string[] {
  return projection.entries.filter((entry) => entry.state === 'dispatched' || entry.state === 'unknown').map((entry) => entry.effectId);
}
