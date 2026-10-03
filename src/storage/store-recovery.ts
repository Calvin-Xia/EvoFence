/** Restore validates identities before maps and replays persisted commands through the real CAS path. */
import { decode, gateRuntimeVersion } from '../protocol/index.js';
import { canonical, type DigestPort } from '../kernel/store/identity.js';
import { storeFail, storeOk } from '../kernel/store/contracts.js';
import type { AppendRequest, ExportedSession, StoreResult } from '../kernel/store/contracts.js';
import { emptyReplayState, replay } from '../kernel/store/projection.js';
import { projectOutbox } from '../kernel/store/outbox.js';
import { commitBatch, newSessionRecord, type SessionRecord } from './store-session.js';
import { uniqueEffects, uniqueIdentities } from './store-identities.js';

function validRequest(request: AppendRequest): boolean {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) return false;
  const keys = ['sessionId', 'requestId', 'expectedRevision', 'epoch', 'events', 'effects', 'receipts'];
  return Object.keys(request).length === keys.length && keys.every(k => Object.hasOwn(request, k)) &&
    decode('Id', request.requestId).ok && Number.isSafeInteger(request.expectedRevision) && request.expectedRevision >= 0 &&
    Number.isSafeInteger(request.epoch) && request.epoch >= 1 &&
    [request.events, request.effects, request.receipts].every(rows => Array.isArray(rows) && rows.every(row =>
      row !== null && typeof row === 'object' && row.protocol !== null && typeof row.protocol === 'object')) &&
    request.events.every(row => row.payload !== null && typeof row.payload === 'object');
}

export function reviveSession(exported: ExportedSession, digest: DigestPort): StoreResult<SessionRecord> {
  // Missing command records cannot be silently migrated: old exports have lost request identities.
  if (!Array.isArray(exported.requests) || !Array.isArray(exported.events) ||
    !Array.isArray(exported.effects) || !Array.isArray(exported.receipts) ||
    !Number.isSafeInteger(exported.epoch) || exported.epoch < 1 ||
    !Number.isSafeInteger(exported.revision) || exported.revision < 0) {
    return storeFail('EFK_SCHEMA_INVALID', 'session export requires complete requests and journal metadata');
  }
  const id = decode('Id', exported.sessionId); if (!id.ok) return id;
  const protocol = decode('ProtocolVersion', exported.protocol); if (!protocol.ok) return protocol;
  if (gateRuntimeVersion(protocol.value) === 'unsupported') return storeFail('EFK_PROTOCOL_UNSUPPORTED', 'unsupported session export protocol');
  const effectIds = uniqueEffects(exported.effects); if (!effectIds.ok) return effectIds;
  const receiptIds = uniqueIdentities(exported.receipts, row => row.receiptId); if (!receiptIds.ok) return receiptIds;
  const eventIds = uniqueIdentities(exported.events, row => row.eventId); if (!eventIds.ok) return eventIds;
  if (!exported.requests.every(validRequest)) return storeFail('EFK_SCHEMA_INVALID', 'invalid exported request entry');
  const requestIds = uniqueIdentities(exported.requests, row => row.requestId); if (!requestIds.ok) return requestIds;

  const replayed = exported.events.length === 0 ? storeOk(emptyReplayState(exported.sessionId, exported.epoch)) : replay(exported.events);
  if (!replayed.ok) return replayed;
  if (replayed.value.sessionId !== exported.sessionId || replayed.value.epoch !== exported.epoch || replayed.value.revision !== exported.revision) {
    return storeFail('EFK_INVARIANT_VIOLATION', 'session export metadata differs from journal replay');
  }
  const record: SessionRecord = {
    ...newSessionRecord(exported.sessionId, exported.epoch, protocol.value),
    revision: replayed.value.revision, lastSequence: replayed.value.lastSequence ?? -1,
    events: [...exported.events],
    effects: new Map(exported.effects.map(effect => [effect.effectId, effect])),
    receipts: new Map(exported.receipts.map(receipt => [receipt.receiptId, receipt])),
  };
  for (const event of record.events) record.eventIds.add(event.eventId);
  for (const effect of record.effects.values()) record.idempotency.set(effect.idempotencyKey, effect.effectId);
  const outbox = projectOutbox(record.events, record.effects, record.receipts); if (!outbox.ok) return outbox;

  const first = exported.events[0];
  const initialEpoch = first === undefined ? exported.epoch : first.type === 'session.epoch-changed' ? first.epoch - 1 : first.epoch;
  const indexed = newSessionRecord(exported.sessionId, initialEpoch, protocol.value);
  for (const request of exported.requests) {
    if (request.sessionId !== exported.sessionId) return storeFail('EFK_INVARIANT_VIOLATION', 'request belongs to another session');
    const committed = commitBatch(digest, indexed, request.requestId, request.expectedRevision, request.epoch,
      request.events, request.effects, request.receipts);
    if (!committed.ok) return committed;
  }
  if (canonical(indexed.events) !== canonical(record.events) || indexed.epoch !== record.epoch || indexed.revision !== record.revision ||
    canonical(Object.fromEntries(indexed.effects)) !== canonical(Object.fromEntries(record.effects)) ||
    canonical(Object.fromEntries(indexed.receipts)) !== canonical(Object.fromEntries(record.receipts))) {
    return storeFail('EFK_INVARIANT_VIOLATION', 'persisted requests do not reproduce the exported journal and content');
  }
  for (const [requestId, entry] of indexed.requestIndex) record.requestIndex.set(requestId, entry);
  return storeOk(record);
}
