/**
 * One session's journal state and the single transaction that advances it.
 *
 * `commitBatch` is the only function that mutates a `SessionRecord`. It validates the *whole*
 * transaction — protocol, request identity, CAS, epoch, event identity, effect/receipt identity and
 * the invariant that every effect shares the transaction with its own `effect.intended` event —
 * before it mutates anything. That ordering is what makes journal and outbox atomic: a rejected
 * batch leaves revision, events and content maps exactly as they were (`CONTRACTS.md` §5.4).
 *
 * Effects and receipts are committed content referenced by events (`EventPayload.objectRef` /
 * `effectId`); a journal that references content the store does not hold is a gap and is refused,
 * not guessed around.
 */
import type { AppendOutcome, Effect, Event, EventDraft, ExportedSession, ProtocolEnvelope, Receipt, StoreResult } from './contracts.js';
import { storeFail, storeOk } from './contracts.js';
import { canonical, identityDigest, type DigestPort } from './identity.js';
import { projectOutbox } from './outbox.js';
import { replay } from './projection.js';

export interface SessionRecord {
  readonly sessionId: string;
  epoch: number;
  readonly protocol: ProtocolEnvelope;
  revision: number;
  lastSequence: number;
  readonly events: Event[];
  readonly effects: Map<string, Effect>;
  readonly receipts: Map<string, Receipt>;
  /** `idempotencyKey -> effectId`: one delivery identity may not be bound to two different effects. */
  readonly idempotency: Map<string, string>;
  readonly eventIds: Set<string>;
  readonly requestIndex: Map<string, { readonly digest: string; readonly outcome: AppendOutcome }>;
}

export function newSessionRecord(sessionId: string, epoch: number, protocol: ProtocolEnvelope): SessionRecord {
  return {
    sessionId,
    epoch,
    protocol,
    revision: 0,
    lastSequence: -1,
    events: [],
    effects: new Map(),
    receipts: new Map(),
    idempotency: new Map(),
    eventIds: new Set(),
    requestIndex: new Map(),
  };
}

/** Rebuild a session record from an exported journal; the same reducer that replay uses validates it. */
export function reviveSession(exported: ExportedSession): StoreResult<SessionRecord> {
  const replayed = replay(exported.events);
  if (!replayed.ok) return replayed;
  const record: SessionRecord = {
    ...newSessionRecord(exported.sessionId, replayed.value.epoch, exported.protocol),
    revision: replayed.value.revision,
    lastSequence: replayed.value.lastSequence ?? -1,
    events: [...exported.events],
    effects: new Map(exported.effects.map((effect) => [effect.effectId, effect])),
    receipts: new Map(exported.receipts.map((receipt) => [receipt.receiptId, receipt])),
  };
  for (const event of record.events) record.eventIds.add(event.eventId);
  for (const effect of record.effects.values()) record.idempotency.set(effect.idempotencyKey, effect.effectId);
  const outbox = projectOutbox(record.events, record.effects, record.receipts);
  if (!outbox.ok) return outbox;
  return storeOk(record);
}

/**
 * Validate and stage the effect content of a transaction. Nothing is mutated here; the additions are
 * applied by `commitBatch` only after every check has passed.
 */
function planEffects(
  session: SessionRecord,
  drafts: readonly EventDraft[],
  effects: readonly Effect[],
): StoreResult<{ readonly additions: readonly Effect[]; readonly ids: readonly string[] }> {
  const intended = new Map<string, number>();
  for (const draft of drafts) {
    if (draft.type !== 'effect.intended') continue;
    const effectId = draft.payload.effectId;
    if (effectId === null) {
      return storeFail('EFK_SCHEMA_INVALID', `effect.intended ${draft.eventId} carries no effectId`);
    }
    intended.set(effectId, (intended.get(effectId) ?? 0) + 1);
  }

  const additions: Effect[] = [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const effect of effects) {
    if (seen.has(effect.effectId) || session.effects.has(effect.effectId)) {
      return storeFail('EFK_IDEMPOTENCY_COLLISION', `effect ${effect.effectId} is already committed`, [effect.effectId]);
    }
    if (intended.get(effect.effectId) !== 1) {
      return storeFail('EFK_INVARIANT_VIOLATION', `effect ${effect.effectId} lacks exactly one effect.intended event in this transaction`, [effect.effectId]);
    }
    const owner = session.idempotency.get(effect.idempotencyKey);
    if (owner !== undefined && owner !== effect.effectId) {
      return storeFail('EFK_IDEMPOTENCY_COLLISION', `idempotencyKey ${effect.idempotencyKey} is already bound to effect ${owner}`, [effect.effectId]);
    }
    seen.add(effect.effectId);
    additions.push(effect);
    ids.push(effect.effectId);
  }
  for (const effectId of intended.keys()) {
    if (!seen.has(effectId)) {
      return storeFail('EFK_INVARIANT_VIOLATION', `effect.intended ${effectId} has no effect content in this transaction`, [effectId]);
    }
  }
  return storeOk({ additions, ids });
}

/** Stage receipt content; identical re-delivery is accepted, a new id must be referenced by an event. */
function planReceipts(
  session: SessionRecord,
  drafts: readonly EventDraft[],
  receipts: readonly Receipt[],
): StoreResult<readonly Receipt[]> {
  const referenced = new Set<string>();
  for (const draft of drafts) {
    if (draft.type !== 'receipt.applied' && draft.type !== 'receipt.archived') continue;
    const objectRef = draft.payload.objectRef;
    if (objectRef === null) {
      return storeFail('EFK_SCHEMA_INVALID', `${draft.type} ${draft.eventId} carries no objectRef`);
    }
    referenced.add(objectRef.id);
  }

  const additions: Receipt[] = [];
  for (const receipt of receipts) {
    const existing = session.receipts.get(receipt.receiptId);
    if (existing !== undefined) {
      if (canonical(existing) !== canonical(receipt)) {
        return storeFail('EFK_IDEMPOTENCY_COLLISION', `receipt ${receipt.receiptId} is already committed with different content`, [receipt.receiptId]);
      }
      continue;
    }
    if (!referenced.has(receipt.receiptId)) {
      return storeFail('EFK_INVARIANT_VIOLATION', `receipt ${receipt.receiptId} has no receipt event in this transaction`, [receipt.receiptId]);
    }
    additions.push(receipt);
  }
  for (const receiptId of referenced) {
    if (!receipts.some((receipt) => receipt.receiptId === receiptId)) {
      return storeFail('EFK_INVARIANT_VIOLATION', `receipt event references ${receiptId} but the content is not in this transaction`, [receiptId]);
    }
  }
  return storeOk(additions);
}

/**
 * Validate a transaction and, if it is valid, commit it: new events with journal-assigned
 * `sequence`/`revision`, the effect/receipt content they reference, and the request identity.
 */
export function commitBatch(
  digest: DigestPort,
  session: SessionRecord,
  requestId: string,
  expectedRevision: number,
  epoch: number,
  drafts: readonly EventDraft[],
  effects: readonly Effect[],
  receipts: readonly Receipt[],
): StoreResult<AppendOutcome> {
  if (drafts.length === 0) {
    return storeFail('EFK_SCHEMA_INVALID', 'an append must carry at least one event', [session.sessionId]);
  }
  for (const draft of drafts) {
    if (canonical(draft.protocol) !== canonical(session.protocol)) {
      return storeFail('EFK_PROTOCOL_UNSUPPORTED', `event ${draft.eventId} uses ${draft.protocol.schemaVersion}, session is pinned to ${session.protocol.schemaVersion}`, [session.sessionId]);
    }
  }

  const requestDigest = identityDigest(digest, { sessionId: session.sessionId, expectedRevision, epoch, drafts, effects, receipts });
  const previous = session.requestIndex.get(requestId);
  if (previous !== undefined) {
    if (previous.digest !== requestDigest) {
      return storeFail('EFK_IDEMPOTENCY_COLLISION', `request ${requestId} was already committed with different content`, [requestId]);
    }
    return storeOk({ ...previous.outcome, disposition: 'duplicate' });
  }
  if (expectedRevision !== session.revision) {
    return storeFail('EFK_REVISION_CONFLICT', `expected journal revision ${expectedRevision}, session is at ${session.revision}`, [session.sessionId]);
  }

  const epochChange = drafts.some((draft) => draft.type === 'session.epoch-changed');
  if (epoch !== session.epoch && !(epochChange && epoch === session.epoch + 1)) {
    return storeFail('EFK_REVISION_CONFLICT', `transaction epoch ${epoch} is not the current session epoch ${session.epoch}`, [session.sessionId]);
  }
  for (const draft of drafts) {
    if (draft.epoch !== epoch) {
      return storeFail('EFK_INVARIANT_VIOLATION', `event ${draft.eventId} carries epoch ${draft.epoch} outside transaction epoch ${epoch}`);
    }
  }

  const batchIds = new Set<string>();
  const nextEvents: Event[] = [];
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index];
    if (draft.sessionId !== session.sessionId) {
      return storeFail('EFK_INVARIANT_VIOLATION', `event ${draft.eventId} targets session ${draft.sessionId}, not ${session.sessionId}`);
    }
    const raw = draft as Record<string, unknown>;
    if (raw.sequence !== undefined || raw.revision !== undefined) {
      return storeFail('EFK_SCHEMA_INVALID', `event draft ${draft.eventId} must not carry sequence/revision; the journal assigns them`);
    }
    if (batchIds.has(draft.eventId) || session.eventIds.has(draft.eventId)) {
      return storeFail('EFK_IDEMPOTENCY_COLLISION', `event ${draft.eventId} is already committed`, [draft.eventId]);
    }
    batchIds.add(draft.eventId);
    nextEvents.push({
      protocol: draft.protocol,
      eventId: draft.eventId,
      sequence: session.lastSequence + 1 + index,
      sessionId: draft.sessionId,
      revision: session.revision + 1,
      epoch: draft.epoch,
      causedBy: draft.causedBy,
      type: draft.type,
      payload: draft.payload,
      visibility: draft.visibility,
    });
  }

  const plannedEffects = planEffects(session, drafts, effects);
  if (!plannedEffects.ok) return plannedEffects;
  const plannedReceipts = planReceipts(session, drafts, receipts);
  if (!plannedReceipts.ok) return plannedReceipts;

  for (const event of nextEvents) {
    session.events.push(event);
    session.eventIds.add(event.eventId);
  }
  session.lastSequence += nextEvents.length;
  session.revision += 1;
  if (epochChange) session.epoch = epoch;
  for (const effect of plannedEffects.value.additions) {
    session.effects.set(effect.effectId, effect);
    session.idempotency.set(effect.idempotencyKey, effect.effectId);
  }
  for (const receipt of plannedReceipts.value) session.receipts.set(receipt.receiptId, receipt);

  const outcome: AppendOutcome = {
    disposition: 'committed',
    sessionId: session.sessionId,
    revision: session.revision,
    eventIds: nextEvents.map((event) => event.eventId),
    effectIds: plannedEffects.value.ids,
  };
  session.requestIndex.set(requestId, { digest: requestDigest, outcome });
  return storeOk(outcome);
}
