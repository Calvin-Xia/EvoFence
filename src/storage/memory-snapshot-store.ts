/**
 * A memory reference `SnapshotStore` for versioned projections.
 *
 * A snapshot is a cached projection plus the journal position it covers and the schemaVersion that
 * wrote it. It is only ever a shortcut, never a second truth source: `recover` recomputes the prefix
 * from the journal and refuses a snapshot that does not match it. That is S25 / invariant 9 — a
 * schema, epoch or sequence gap cannot be papered over with a cached projection.
 *
 * `save` version-gates the schemaVersion it is asked to persist. `load` version-gates what it finds,
 * so a snapshot written by a different codec reports `EFK_RECOVERY_SCHEMA_MISMATCH` instead of being
 * silently reused.
 */
import { isSupportedSchemaVersion } from '../protocol/index.js';
import type { Event, Recovery, SnapshotInput, SnapshotStore, StoreResult, StoredSnapshot } from '../kernel/store/contracts.js';
import { storeFail, storeOk } from '../kernel/store/contracts.js';
import { identityDigest, type DigestPort } from '../kernel/store/identity.js';
import { replay, verifyProjection } from '../kernel/store/projection.js';

function bodyOf(snapshot: StoredSnapshot | SnapshotInput): SnapshotInput {
  return {
    sessionId: snapshot.sessionId,
    revision: snapshot.revision,
    epoch: snapshot.epoch,
    sequence: snapshot.sequence,
    schemaVersion: snapshot.schemaVersion,
    projection: snapshot.projection,
  };
}

export interface MemorySnapshotStore extends SnapshotStore {
  /** Install a snapshot directly, as a store written by an earlier process/codec would. */
  seed(snapshot: StoredSnapshot): void;
}

export function createMemorySnapshotStore(options: { readonly digest: DigestPort }): MemorySnapshotStore {
  const { digest } = options;
  const snapshots = new Map<string, StoredSnapshot>();

  const loadOne = (sessionId: string): StoreResult<StoredSnapshot | null> => {
    const snapshot = snapshots.get(sessionId);
    if (snapshot === undefined) return storeOk(null);
    if (!isSupportedSchemaVersion(snapshot.schemaVersion)) {
      return storeFail('EFK_RECOVERY_SCHEMA_MISMATCH', `snapshot for ${sessionId} was written by schemaVersion ${snapshot.schemaVersion}`, [sessionId]);
    }
    if (identityDigest(digest, bodyOf(snapshot)) !== snapshot.digest) {
      return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', `snapshot for ${sessionId} does not match its digest`, [sessionId]);
    }
    return storeOk(snapshot);
  };

  const recoverOne = (sessionId: string, events: readonly Event[]): StoreResult<Recovery> => {
    const loaded = loadOne(sessionId);
    if (!loaded.ok) return loaded;
    const full = replay(events);
    if (!full.ok) return full;
    const snapshot = loaded.value;
    if (snapshot === null) {
      return storeOk({ projection: full.value, usedSnapshot: false, replayedFrom: 0 });
    }
    if (snapshot.sessionId !== sessionId) {
      return storeFail('EFK_INVARIANT_VIOLATION', `snapshot ${snapshot.sessionId} cannot recover session ${sessionId}`, [sessionId]);
    }
    const lastSequence = full.value.lastSequence ?? -1;
    if (snapshot.sequence > lastSequence) {
      return storeFail('EFK_RECOVERY_SEQUENCE_GAP', `snapshot for ${sessionId} covers sequence ${snapshot.sequence}, journal ends at ${lastSequence}`, [sessionId]);
    }
    if ((snapshot.projection.lastSequence ?? -1) !== snapshot.sequence) {
      return storeFail('EFK_RECOVERY_SEQUENCE_GAP', `snapshot for ${sessionId} claims sequence ${snapshot.sequence} but its projection ends at ${snapshot.projection.lastSequence}`, [sessionId]);
    }
    const prefix = events.filter((event) => event.sequence <= snapshot.sequence);
    const verified = verifyProjection(snapshot.projection, prefix);
    if (!verified.ok) return verified;
    const tail = events.filter((event) => event.sequence > snapshot.sequence);
    const merged = replay(tail, snapshot.projection);
    if (!merged.ok) return merged;
    return storeOk({ projection: merged.value, usedSnapshot: true, replayedFrom: snapshot.sequence + 1 });
  };

  return {
    save(input: SnapshotInput): StoreResult<StoredSnapshot> {
      if (!isSupportedSchemaVersion(input.schemaVersion)) {
        return storeFail('EFK_PROTOCOL_UNSUPPORTED', `snapshot for ${input.sessionId} uses schemaVersion ${input.schemaVersion}`, [input.sessionId]);
      }
      if (input.projection.sessionId !== input.sessionId) {
        return storeFail('EFK_INVARIANT_VIOLATION', `projection for ${input.projection.sessionId} cannot cover session ${input.sessionId}`, [input.sessionId]);
      }
      const snapshot: StoredSnapshot = { ...bodyOf(input), digest: identityDigest(digest, bodyOf(input)) };
      snapshots.set(input.sessionId, snapshot);
      return storeOk(snapshot);
    },

    load(sessionId: string): StoreResult<StoredSnapshot | null> {
      return loadOne(sessionId);
    },

    recover(sessionId: string, events: readonly Event[]): StoreResult<Recovery> {
      return recoverOne(sessionId, events);
    },

    seed(snapshot: StoredSnapshot): void {
      snapshots.set(snapshot.sessionId, snapshot);
    },
  };
}
