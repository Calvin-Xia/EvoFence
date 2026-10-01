/**
 * The journal reducer: `replay(events)` rebuilds the derived read state from events alone.
 *
 * It is a pure function of its inputs — no clock, no host call, no write — which is what makes
 * "replay only rebuilds state" true by construction (`CONTRACTS.md` §5.10, S25). The reducer is the
 * authority on three things the journal must never fake:
 *
 *   - **continuity**: `sequence` starts at 0 and increments by one; a hole is a recovery gap and is
 *     refused (`EFK_RECOVERY_SEQUENCE_GAP`) rather than patched from a cached projection;
 *   - **transaction shape**: `revision` is monotone and steps by one per transaction;
 *   - **transition chaining**: a `node.transition`'s `before` must equal the previous `after` for
 *     the same `(nodeId, attemptOrdinal)`.
 *
 * `verifyProjection` is the anti-fake-recovery check: it recomputes and compares, so a snapshot that
 * merely claims a state cannot be used as if it had been recovered.
 */
import type { Event, NodeStateEntry, ReplayState, StoreResult } from './contracts.js';
import { storeFail, storeOk } from './contracts.js';
import { canonical } from './identity.js';

function stateKey(nodeId: string, attemptOrdinal: number): string {
  return `${nodeId}#${attemptOrdinal}`;
}

/** The derived state of a session with no committed events yet. */
export function emptyReplayState(sessionId: string, epoch: number): ReplayState {
  return { sessionId, revision: 0, epoch, lastSequence: null, dispatchMode: 'active', nodeStates: [] };
}

function compareState(a: NodeStateEntry, b: NodeStateEntry): number {
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
  return a.attemptOrdinal - b.attemptOrdinal;
}

function dispatchModeFor(event: Event, current: ReplayState['dispatchMode']): ReplayState['dispatchMode'] {
  switch (event.type) {
    case 'session.paused':
      return 'paused';
    case 'session.resumed':
      return 'active';
    case 'session.cancel-requested':
      return 'cancelling';
    case 'session.cancel-confirmed':
      return 'cancelled';
    default:
      return current;
  }
}

/**
 * Rebuild the derived state from `events`, optionally continuing from a verified `seed` (a snapshot
 * prefix). Only `events` after the seed may be passed; the seed's `lastSequence` is the continuity
 * anchor.
 */
export function replay(events: readonly Event[], seed?: ReplayState): StoreResult<ReplayState> {
  const first = events[0];
  const sessionId = seed?.sessionId ?? first?.sessionId;
  if (sessionId === undefined) {
    return storeFail('EFK_SCHEMA_INVALID', 'cannot replay an empty journal without a seed');
  }

  let revision = seed?.revision ?? 0;
  const baseline = first?.type === 'session.epoch-changed' ? first.epoch - 1 : first?.epoch;
  let epoch = seed?.epoch ?? baseline ?? 1;
  let lastSequence = seed?.lastSequence ?? -1;
  let dispatchMode: ReplayState['dispatchMode'] = seed?.dispatchMode ?? 'active';

  const states = new Map<string, NodeStateEntry>();
  if (seed !== undefined) {
    for (const entry of seed.nodeStates) states.set(stateKey(entry.nodeId, entry.attemptOrdinal), entry);
  }

  for (const event of events) {
    if (event.sessionId !== sessionId) {
      return storeFail('EFK_INVARIANT_VIOLATION', `event ${event.eventId} belongs to session ${event.sessionId}, not ${sessionId}`);
    }
    if (event.sequence !== lastSequence + 1) {
      return storeFail('EFK_RECOVERY_SEQUENCE_GAP', `journal expected sequence ${lastSequence + 1} but found ${event.sequence} at ${event.eventId}`, [sessionId]);
    }
    if (event.revision !== revision && event.revision !== revision + 1) {
      return storeFail('EFK_INVARIANT_VIOLATION', `event ${event.eventId} carries revision ${event.revision}, which is not ${revision} or ${revision + 1}`);
    }
    revision = event.revision;
    lastSequence = event.sequence;

    if (event.type === 'session.epoch-changed') {
      if (event.epoch <= epoch) {
        return storeFail('EFK_INVARIANT_VIOLATION', `session.epoch-changed ${event.eventId} moves epoch ${epoch} -> ${event.epoch}`);
      }
      epoch = event.epoch;
    } else if (event.epoch !== epoch) {
      return storeFail('EFK_INVARIANT_VIOLATION', `event ${event.eventId} carries epoch ${event.epoch} outside session epoch ${epoch}`);
    }

    if (event.type === 'node.transition') {
      const { binding, before, after } = event.payload;
      if (binding === null || after === null) {
        return storeFail('EFK_SCHEMA_INVALID', `node.transition ${event.eventId} requires a binding and an after state`);
      }
      const key = stateKey(binding.nodeId, binding.attemptOrdinal);
      const previous = states.get(key);
      if (previous !== undefined && before !== previous.state) {
        return storeFail('EFK_INVARIANT_VIOLATION', `transition ${event.eventId} claims before=${before} but ${key} is ${previous.state}`);
      }
      states.set(key, {
        nodeId: binding.nodeId,
        attemptOrdinal: binding.attemptOrdinal,
        epoch: event.epoch,
        state: after,
        sinceSequence: event.sequence,
      });
    }

    dispatchMode = dispatchModeFor(event, dispatchMode);
  }

  return storeOk({
    sessionId,
    revision,
    epoch,
    lastSequence: lastSequence === -1 ? null : lastSequence,
    dispatchMode,
    nodeStates: [...states.values()].sort(compareState),
  });
}

/**
 * Refuse a projection that does not match what the journal actually says. This is the check that
 * makes a cached snapshot unusable as a shortcut around a gap or a diverged history.
 */
export function verifyProjection(claimed: ReplayState, events: readonly Event[]): StoreResult<ReplayState> {
  const replayed = replay(events);
  if (!replayed.ok) return replayed;
  if (canonical(replayed.value) !== canonical(claimed)) {
    return storeFail('EFK_INVARIANT_VIOLATION', `cached projection for ${claimed.sessionId} does not match the journal`, [claimed.sessionId]);
  }
  return replayed;
}
