/** Pure identities and the one application CAS write path. */
import { DEFS, decode } from '../../protocol/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { Decoded } from '../../protocol/index.js';
import type { ArtifactRef, Binding, CommandOutcome, EventDraft, PlannedBatch, RuntimeState, SessionCommand, SessionPorts, StoreResult } from './types.js';

export const KERNEL_ACTOR = { actorId: 'kernel', kind: 'kernel', identityRef: null } as const;
export function idFor(ports: Pick<SessionPorts, 'digest'>, tag: string, value: unknown): string {
  // 128-bit content identity leaves room for a host's receipt/reconciliation suffixes in Id.
  // The store still compares full content digests and refuses an identity collision.
  return `${tag}:${ports.digest.digest(canonical(value)).slice(7, 39)}`;
}
export function event(state: RuntimeState, commandId: string, suffix: string, type: EventDraft['type'],
  payload: Partial<EventDraft['payload']> = {}, epoch = state.epoch): EventDraft {
  return { protocol: state.protocol, eventId: `event:r${state.revision + 1}:${suffix}`, sessionId: state.sessionId, epoch,
    causedBy: commandId, type, visibility: 'internal', payload: {
      binding: null, objectRef: null, before: null, after: null, effectId: null, decisionId: null,
      changedIds: [], error: null, ...payload,
    } };
}
export function transition(state: RuntimeState, commandId: string, suffix: string, binding: Binding,
  before: EventDraft['payload']['before'], after: EventDraft['payload']['after'], extra: Partial<EventDraft['payload']> = {}): EventDraft {
  return event(state, commandId, suffix, 'node.transition', { binding, before, after, changedIds: [binding.nodeId], ...extra });
}
export function putObject(ports: SessionPorts, state: RuntimeState, id: string, name: string, value: unknown,
  binding: Binding | null, producer: Decoded<'ActorRef'> = KERNEL_ACTOR): StoreResult<ArtifactRef> {
  const bytes = canonical(value);
  const ref: ArtifactRef = { protocol: state.protocol, id, digest: ports.digest.digest(bytes), producer, binding,
    schema: { name, version: state.protocol.schemaVersion,
      digest: ports.digest.digest(canonical(name in DEFS ? DEFS[name as keyof typeof DEFS] : { name, version: 1 })) },
    location: `journal:${state.sessionId}:${id}`, visibility: 'internal', expiresAt: null, partition: 'not-evaluation' };
  const stored = ports.artifacts.put(ref, bytes);
  return stored.ok ? storeOk(ref) : stored;
}
export function commit(ports: SessionPorts, state: RuntimeState, command: SessionCommand, batch: PlannedBatch, epoch = state.epoch): StoreResult<CommandOutcome> {
  // Audit G06: the write path had no wire-codec gate, so a draft that violated the frozen `Event`
  // schema — for example duplicate `changedIds`, which `uniqueItems: true` forbids — was persisted
  // and only an external reader noticed. `sequence` and `revision` are store-assigned, so they are
  // supplied as placeholders and the rest of the draft is validated as it will be written.
  for (const draft of batch.events) {
    const decoded = decode('Event', { ...draft, sequence: 0, revision: Math.max(1, state.revision + 1) });
    if (!decoded.ok) {
      return storeFail('EFK_SCHEMA_INVALID', `journal event ${draft.eventId} violates the Event schema: ${decoded.error.message}`);
    }
  }
  const committed = ports.store.append({ sessionId: state.sessionId, requestId: command.commandId,
    expectedRevision: command.expectedRevision, epoch, ...batch });
  return committed.ok ? storeOk({ sessionId: committed.value.sessionId, revision: committed.value.revision,
    eventIds: committed.value.eventIds, effectIds: committed.value.effectIds }) : committed;
}
/** Command identity is journal evidence, so restart does not depend on a volatile request cache. */
export function priorCommand(ports: SessionPorts, state: RuntimeState, request: SessionCommand, content: unknown): StoreResult<CommandOutcome | null> {
  const previous = state.events.filter(e => e.causedBy === request.commandId);
  if (previous.length === 0) return storeOk(null);
  if (previous[0].payload.objectRef?.digest !== ports.digest.digest(canonical(content))) {
    return storeFail('EFK_IDEMPOTENCY_COLLISION', `command ${request.commandId} was committed with different content`, [request.commandId]);
  }
  return storeOk({ sessionId: state.sessionId, revision: previous[0].revision,
    eventIds: previous.map(e => e.eventId), effectIds: previous.filter(e => e.type === 'effect.intended').map(e => e.payload.effectId as string) });
}
