import { decode } from '../../protocol/index.js';
import { readArtifact } from '../../kernel/artifacts/index.js';
import type { ArtifactRef } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { EventDraft, ExportedSession, Receipt, StoreResult } from '../../kernel/store/index.js';
import { prepareArtifact } from '../../learning/promotion/journal.js';
import type { PromotionState } from '../../learning/promotion/index.js';
import type { RevocationPorts, RevocationRecord } from './types.js';

export function records(ports: RevocationPorts, journal: ExportedSession): StoreResult<readonly RevocationRecord[]> {
  const latest = new Map<string, RevocationRecord>();
  for (const event of journal.events) {
    if (event.type !== 'asset.transition' || event.payload.objectRef?.schema.name !== 'RevocationRecord') continue;
    const bytes = readArtifact(event.payload.objectRef as ArtifactRef, 'evaluator', ports.promotion.clock.now(), ports.promotion.registry.artifacts);
    if (!bytes.ok) return bytes;
    // These private immutable objects are produced by save, not caller-supplied projections.
    const record = JSON.parse(bytes.value) as RevocationRecord;
    latest.set(record.requestId, record);
  }
  return storeOk([...latest.values()]);
}

/** Revocation, cancellation of unclaimed intentions, and evidence share the promotion journal CAS. */
export function save(ports: RevocationPorts, journal: ExportedSession, record: RevocationRecord,
  state: PromotionState | null = null, cancelled: readonly Receipt[] = []): StoreResult<RevocationRecord> {
  const p = ports.promotion, actor = p.registry.issuers.revocation;
  const objects = [{ value: record, name: 'RevocationRecord', id: undefined as string | undefined },
    ...(state === null ? [] : [{ value: state, name: 'PromotionState', id: undefined }]),
    ...cancelled.map(receipt => ({ value: receipt, name: 'Receipt', id: receipt.receiptId }))];
  const events: EventDraft[] = [];
  for (const object of objects) {
    const prepared = prepareArtifact(p, object.value, object.name, actor, object.id);
    const ref: ArtifactRef = { ...prepared.ref, visibility: 'private' };
    const put = p.registry.artifacts.put(ref, prepared.bytes); if (!put.ok) return put;
    const receipt = object.name === 'Receipt' ? object.value as Receipt : null;
    const event: EventDraft = { protocol: journal.protocol,
      eventId: `revocation:${journal.revision + 1}:${object.name}:${ref.digest.slice(7)}`, sessionId: p.sessionId,
      epoch: journal.epoch, causedBy: record.requestId, type: receipt === null ? 'asset.transition' : 'receipt.applied',
      payload: { binding: receipt === null ? null : receipt.binding, objectRef: ref, before: null, after: null,
        effectId: receipt === null ? null : receipt.effectId, decisionId: null, changedIds: [], error: null }, visibility: 'private' };
    const checked = decode('Event', { ...event, revision: journal.revision + 1, sequence: journal.events.length });
    if (!checked.ok) return checked;
    events.push(event);
  }
  for (const receipt of cancelled) { const checked = decode('Receipt', receipt); if (!checked.ok) return checked; }
  const appended = p.journal.append({ sessionId: p.sessionId, requestId: `revocation-cas:${journal.revision}:${record.requestId}`,
    expectedRevision: journal.revision, epoch: journal.epoch, events, effects: [], receipts: cancelled });
  return appended.ok ? storeOk(record) : appended;
}

export function findRecord(ports: RevocationPorts, requestId: string): StoreResult<RevocationRecord> {
  const journal = ports.promotion.journal.exportSession(ports.promotion.sessionId); if (!journal.ok) return journal;
  const loaded = records(ports, journal.value); if (!loaded.ok) return loaded;
  const record = loaded.value.find(r => r.requestId === requestId);
  return record === undefined ? storeFail('EFK_SCHEMA_INVALID', 'revocation request is not registered') : storeOk(record);
}
export function updateRecord(ports: RevocationPorts, expected: RevocationRecord, record: RevocationRecord,
  state: PromotionState | null = null, receipts: readonly Receipt[] = [], snapshot?: ExportedSession): StoreResult<RevocationRecord> {
  const journal = snapshot === undefined ? ports.promotion.journal.exportSession(ports.promotion.sessionId) : storeOk(snapshot);
  if (!journal.ok) return journal;
  const current = records(ports, journal.value); if (!current.ok) return current;
  if (canonical(current.value.find(r => r.requestId === record.requestId)) !== canonical(expected)) {
    return storeFail('EFK_REVISION_CONFLICT', 'revocation recovery moved during host operation');
  }
  return save(ports, journal.value, record, state, receipts);
}
export const requestDigest = (ports: RevocationPorts, input: unknown): string => ports.promotion.registry.digest.digest(canonical(input));
