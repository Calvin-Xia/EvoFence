import { decode } from '../../protocol/index.js';
import { readArtifact } from '../../kernel/artifacts/index.js';
import type { ActorRef, ArtifactRef } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { EventDraft, ExportedSession, StoreResult } from '../../kernel/store/index.js';
import type { Effect } from '../../runtime/host-port/index.js';
import type { PromotionPorts, PromotionState } from './types.js';

/** Prepare immutable bytes for judgement without publishing them to the backing store. */
export function prepareArtifact(ports: PromotionPorts, value: unknown, name: string, producer: ActorRef,
  id?: string): { ref: ArtifactRef; bytes: string } {
  const bytes = canonical(value), digest = ports.registry.digest.digest(bytes);
  const ref: ArtifactRef = { protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' },
    id: id === undefined ? `promotion-artifact:${digest.slice(7)}` : id, digest, producer, binding: null,
    schema: { name, version: '1.1.0', digest: ports.registry.digest.digest(name) }, location: `promotion:${digest.slice(7)}`,
    visibility: name === 'PromotionState' || name === 'DecisionRecord' ? 'private' : 'internal',
    expiresAt: null, partition: 'not-evaluation' };
  return { ref, bytes };
}
export function publish(ports: PromotionPorts, value: unknown, name: string, producer: ActorRef,
  id?: string): StoreResult<ArtifactRef> {
  const { ref, bytes } = prepareArtifact(ports, value, name, producer, id);
  const saved = ports.registry.artifacts.put(ref, bytes);
  return saved.ok ? storeOk(ref) : saved;
}
export function readJSON(ref: ArtifactRef, at: number, ports: PromotionPorts): StoreResult<unknown> {
  const bytes = readArtifact(ref, 'evaluator', at, ports.registry.artifacts); if (!bytes.ok) return bytes;
  try { return storeOk(JSON.parse(bytes.value)); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return storeFail('EFK_SCHEMA_INVALID', 'promotion evidence is not JSON');
  }
}
export interface LoadedState { readonly state: PromotionState; readonly journal: ExportedSession }
export function load(ports: PromotionPorts): StoreResult<LoadedState> {
  const journal = ports.journal.exportSession(ports.sessionId); if (!journal.ok) return journal;
  const event = journal.value.events.filter(e => e.type === 'asset.transition' &&
    e.payload.objectRef?.schema.name === 'PromotionState').at(-1);
  if (event === undefined) return storeFail('EFK_SCHEMA_INVALID', 'promotion session has no initialized projection');
  const state = readJSON(event.payload.objectRef as ArtifactRef, ports.clock.now(), ports);
  // This private artifact is written only by commit; immutable bytes are checked by ArtifactStore.
  return state.ok ? storeOk({ state: state.value as PromotionState, journal: journal.value }) : state;
}
export function commit(ports: PromotionPorts, journal: ExportedSession, state: PromotionState,
  cause: string, effect: Effect | null = null): StoreResult<PromotionState> {
  const saved = publish(ports, state, 'PromotionState', ports.registry.issuers.promotion); if (!saved.ok) return saved;
  const payload = { binding: null, objectRef: saved.value, before: null, after: null, effectId: null,
    decisionId: null, changedIds: [], error: null };
  const draft: EventDraft = { protocol: journal.protocol, eventId: `promotion-state:${journal.revision + 1}:${saved.value.digest.slice(7)}`,
    sessionId: ports.sessionId, epoch: journal.epoch, causedBy: cause, type: 'asset.transition', payload, visibility: 'private' };
  const drafts: EventDraft[] = [draft];
  if (effect !== null) drafts.push({ ...draft, eventId: `intention:${effect.effectId}`, type: 'effect.intended',
    payload: { ...payload, objectRef: null, binding: effect.binding, effectId: effect.effectId } });
  for (const event of drafts) {
    const checked = decode('Event', { ...event, revision: journal.revision + 1, sequence: journal.events.length });
    if (!checked.ok) return checked;
  }
  const committed = ports.journal.append({ sessionId: ports.sessionId, requestId: draft.eventId,
    expectedRevision: journal.revision, epoch: journal.epoch, events: drafts, effects: effect === null ? [] : [effect], receipts: [] });
  return committed.ok ? storeOk(state) : committed;
}
