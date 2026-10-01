/**
 * A memory reference `EventStore`: one writer per session, a CAS revision, and an outbox that is a
 * projection of the same journal.
 *
 * The store never decides or executes anything. It validates a transaction and commits it, or it
 * refuses and commits nothing. Its only "extra" state beyond the journal is the content that events
 * reference (effects and receipts) and the request-identity index used to answer a repeated
 * submission with `duplicate` instead of a second commit.
 *
 * `nextEffects` returns only `intended` effects whose binding is still at the current epoch; once
 * `effect.dispatched` is committed the effect is `unknown` and `reconcileEffect` is the only way
 * forward. Effects intended at an earlier epoch surface as `staleEffectIds` instead of being handed
 * out as sendable. That is the store-side meaning of "an unknown external effect is reconciled, not
 * resent".
 */
import { decodeProtocolVersion, gateRuntimeVersion } from '../protocol/index.js';
import type {
  AppendOutcome,
  AppendRequest,
  CreateSessionInput,
  DispatchInput,
  Effect,
  EventDraft,
  EventPayload,
  EventStore,
  ExportedSession,
  JournalProjection,
  OutboxProjection,
  ReceiptInput,
  ReceiptOutcome,
  SessionHandle,
  StoreResult,
} from '../kernel/store/contracts.js';
import { storeFail, storeOk } from '../kernel/store/contracts.js';
import { canonical, type DigestPort } from '../kernel/store/identity.js';
import { intendedIds, projectOutbox, reconcileIds } from '../kernel/store/outbox.js';
import { replay } from '../kernel/store/projection.js';
import { commitBatch, newSessionRecord, reviveSession, type SessionRecord } from './store-session.js';

/** A fully-populated `EventPayload`; omitted members are the explicit nulls/empties the schema requires. */
function payloadOf(overrides: Partial<EventPayload>): EventPayload {
  return {
    binding: null,
    objectRef: null,
    before: null,
    after: null,
    effectId: null,
    decisionId: null,
    changedIds: [],
    error: null,
    ...overrides,
  };
}

export interface MemoryEventStore extends EventStore {
  restoreSession(exported: ExportedSession): StoreResult<SessionHandle>;
  sessionIds(): readonly string[];
}

export function createMemoryEventStore(options: { readonly digest: DigestPort }): MemoryEventStore {
  const { digest } = options;
  const sessions = new Map<string, SessionRecord>();

  const handleOf = (session: SessionRecord): SessionHandle => ({
    sessionId: session.sessionId,
    epoch: session.epoch,
    schemaVersion: session.protocol.schemaVersion,
  });

  const requireSession = (sessionId: string): StoreResult<SessionRecord> => {
    const session = sessions.get(sessionId);
    if (session === undefined) return storeFail('EFK_SCHEMA_INVALID', `unknown session ${sessionId}`, [sessionId]);
    return storeOk(session);
  };

  const project = (session: SessionRecord): StoreResult<OutboxProjection> =>
    projectOutbox(session.events, session.effects, session.receipts);

  const applyReceiptTo = (session: SessionRecord, input: ReceiptInput): StoreResult<ReceiptOutcome> => {
    const { receipt } = input;
    const effect = session.effects.get(receipt.effectId);
    if (effect === undefined) return storeFail('EFK_SCHEMA_INVALID', `receipt references unknown effect ${receipt.effectId}`, [receipt.effectId]);
    if (input.objectRef.id !== receipt.receiptId) {
      return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', `objectRef ${input.objectRef.id} does not carry receipt ${receipt.receiptId}`, [receipt.receiptId]);
    }
    const existing = session.receipts.get(receipt.receiptId);
    if (existing !== undefined) {
      if (canonical(existing) !== canonical(receipt)) {
        return storeFail('EFK_IDEMPOTENCY_COLLISION', `receipt ${receipt.receiptId} is already committed with different content`, [receipt.receiptId]);
      }
      return storeOk({ disposition: 'duplicate', revision: session.revision, effectId: receipt.effectId, receiptId: receipt.receiptId });
    }
    const projection = project(session);
    if (!projection.ok) return projection;
    const entry = projection.value.entries.find((candidate) => candidate.effectId === receipt.effectId);
    if (entry === undefined) return storeFail('EFK_SCHEMA_INVALID', `receipt references unknown effect ${receipt.effectId}`, [receipt.effectId]);
    if (entry.state !== 'dispatched' && entry.state !== 'unknown') {
      return storeFail('EFK_CLAIM_CONFLICT', `effect ${receipt.effectId} is ${entry.state}; a receipt requires a dispatched effect`, [receipt.effectId]);
    }
    const stale = receipt.binding.epoch !== input.epoch || canonical(receipt.binding) !== canonical(effect.binding);
    if (receipt.status !== 'unknown' && receipt.observability.length === 0) {
      return storeFail('EFK_EFFECT_UNKNOWN', `receipt ${receipt.receiptId} claims ${receipt.status} for effect ${receipt.effectId} without observability`, [receipt.effectId]);
    }
    const draft: EventDraft = {
      protocol: session.protocol,
      eventId: receipt.receiptId,
      sessionId: session.sessionId,
      epoch: input.epoch,
      causedBy: receipt.receiptId,
      type: stale ? 'receipt.archived' : 'receipt.applied',
      payload: payloadOf({ binding: effect.binding, objectRef: input.objectRef, effectId: receipt.effectId, changedIds: [receipt.effectId] }),
      visibility: 'internal',
    };
    const committed = commitBatch(digest, session, `receipt:${receipt.receiptId}`, input.expectedRevision, input.epoch, [draft], [], [receipt]);
    if (!committed.ok) return committed;
    return storeOk({
      disposition: stale ? 'archived' : 'applied',
      revision: committed.value.revision,
      effectId: receipt.effectId,
      receiptId: receipt.receiptId,
    });
  };

  const dispatchTo = (session: SessionRecord, input: DispatchInput): StoreResult<AppendOutcome> => {
    const projection = project(session);
    if (!projection.ok) return projection;
    const entry = projection.value.entries.find((candidate) => candidate.effectId === input.effectId);
    if (entry === undefined) return storeFail('EFK_SCHEMA_INVALID', `unknown effect ${input.effectId}`, [input.effectId]);
    if (entry.state !== 'intended') {
      return storeFail('EFK_CLAIM_CONFLICT', `effect ${input.effectId} is ${entry.state}; only an intended effect is dispatchable`, [input.effectId]);
    }
    const effect = session.effects.get(input.effectId) as Effect;
    if (effect.binding.epoch !== session.epoch) {
      return storeFail('EFK_LEASE_STALE', `effect ${input.effectId} was intended at epoch ${effect.binding.epoch}, session is at ${session.epoch}`, [input.effectId]);
    }
    const draft: EventDraft = {
      protocol: session.protocol,
      eventId: input.claimId,
      sessionId: session.sessionId,
      epoch: input.epoch,
      causedBy: input.claimId,
      type: 'effect.dispatched',
      payload: payloadOf({ binding: effect.binding, effectId: input.effectId, changedIds: [input.effectId] }),
      visibility: 'internal',
    };
    return commitBatch(digest, session, `dispatch:${input.claimId}`, input.expectedRevision, input.epoch, [draft], [], []);
  };

  const reconcileTo = (session: SessionRecord, input: ReceiptInput): StoreResult<ReceiptOutcome> => {
    const { receipt } = input;
    if (session.receipts.has(receipt.receiptId)) {
      return applyReceiptTo(session, input);
    }
    if (receipt.status === 'unknown' || receipt.observability.length === 0) {
      return storeFail('EFK_EFFECT_UNKNOWN', `effect ${receipt.effectId} still has no actual observability; it stays unknown`, [receipt.effectId]);
    }
    const projection = project(session);
    if (!projection.ok) return projection;
    const entry = projection.value.entries.find((candidate) => candidate.effectId === receipt.effectId);
    if (entry === undefined) return storeFail('EFK_SCHEMA_INVALID', `reconcile references unknown effect ${receipt.effectId}`, [receipt.effectId]);
    if (entry.state !== 'dispatched' && entry.state !== 'unknown') {
      return storeFail('EFK_CLAIM_CONFLICT', `effect ${receipt.effectId} is ${entry.state}; there is nothing to reconcile`, [receipt.effectId]);
    }
    return applyReceiptTo(session, input);
  };

  return {
    createSession(input: CreateSessionInput): StoreResult<SessionHandle> {
      const decoded = decodeProtocolVersion(input.protocol);
      if (!decoded.ok) return decoded;
      if (gateRuntimeVersion(decoded.value) === 'unsupported') {
        return storeFail('EFK_PROTOCOL_UNSUPPORTED', `unsupported protocol ${decoded.value.namespace}@${decoded.value.schemaVersion}`);
      }
      const existing = sessions.get(input.sessionId);
      if (existing !== undefined) {
        if (existing.epoch === input.epoch && canonical(existing.protocol) === canonical(decoded.value)) {
          return storeOk(handleOf(existing));
        }
        return storeFail('EFK_REVISION_CONFLICT', `session ${input.sessionId} already exists at epoch ${existing.epoch}`, [input.sessionId]);
      }
      const session = newSessionRecord(input.sessionId, input.epoch, decoded.value);
      sessions.set(input.sessionId, session);
      return storeOk(handleOf(session));
    },

    append(request: AppendRequest): StoreResult<AppendOutcome> {
      const found = requireSession(request.sessionId);
      if (!found.ok) return found;
      return commitBatch(digest, found.value, request.requestId, request.expectedRevision, request.epoch, request.events, request.effects, request.receipts);
    },

    exportSession(sessionId: string): StoreResult<ExportedSession> {
      const found = requireSession(sessionId);
      if (!found.ok) return found;
      const session = found.value;
      return storeOk({
        sessionId: session.sessionId,
        epoch: session.epoch,
        protocol: session.protocol,
        revision: session.revision,
        events: [...session.events],
        effects: [...session.effects.values()],
        receipts: [...session.receipts.values()],
      });
    },

    replay(sessionId: string): StoreResult<JournalProjection> {
      const found = requireSession(sessionId);
      if (!found.ok) return found;
      const session = found.value;
      const state = replay(session.events);
      if (!state.ok) return state;
      const projection = project(session);
      if (!projection.ok) return projection;
      const pendingEffectIds: string[] = [];
      const staleEffectIds: string[] = [];
      for (const effectId of intendedIds(projection.value)) {
        const effect = session.effects.get(effectId) as Effect;
        (effect.binding.epoch === state.value.epoch ? pendingEffectIds : staleEffectIds).push(effectId);
      }
      return storeOk({
        ...state.value,
        pendingEffectIds,
        unknownEffectIds: reconcileIds(projection.value),
        staleEffectIds,
      });
    },

    outbox(sessionId: string): StoreResult<OutboxProjection> {
      const found = requireSession(sessionId);
      if (!found.ok) return found;
      return project(found.value);
    },

    nextEffects(sessionId: string): StoreResult<readonly Effect[]> {
      const found = requireSession(sessionId);
      if (!found.ok) return found;
      const session = found.value;
      const projection = project(session);
      if (!projection.ok) return projection;
      const effects: Effect[] = [];
      for (const effectId of intendedIds(projection.value)) {
        const effect = session.effects.get(effectId) as Effect;
        if (effect.binding.epoch === session.epoch) effects.push(effect);
      }
      return storeOk(effects);
    },

    dispatchEffect(sessionId: string, input: DispatchInput): StoreResult<AppendOutcome> {
      const found = requireSession(sessionId);
      if (!found.ok) return found;
      return dispatchTo(found.value, input);
    },

    applyReceipt(sessionId: string, input: ReceiptInput): StoreResult<ReceiptOutcome> {
      const found = requireSession(sessionId);
      if (!found.ok) return found;
      return applyReceiptTo(found.value, input);
    },

    reconcileEffect(sessionId: string, input: ReceiptInput): StoreResult<ReceiptOutcome> {
      const found = requireSession(sessionId);
      if (!found.ok) return found;
      return reconcileTo(found.value, input);
    },

    restoreSession(exported: ExportedSession): StoreResult<SessionHandle> {
      if (sessions.has(exported.sessionId)) {
        return storeFail('EFK_REVISION_CONFLICT', `session ${exported.sessionId} is already open`, [exported.sessionId]);
      }
      const revived = reviveSession(exported);
      if (!revived.ok) return revived;
      sessions.set(exported.sessionId, revived.value);
      return storeOk(handleOf(revived.value));
    },

    sessionIds(): readonly string[] {
      return [...sessions.keys()];
    },
  };
}
