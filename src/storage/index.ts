/**
 * `evofence.storage` — the memory reference implementations of the storage ports.
 *
 * The single entry point for this directory. Callers import from here, not from a leaf module, so
 * the internal file split can move without breaking a consumer. Ports are injected (`DigestPort`);
 * importing this module constructs no port backend, runs no external I/O, and installs no default
 * backend or implicit singleton.
 */
export { createMemoryEventStore, type MemoryEventStore } from './memory-event-store.js';
export { createMemorySnapshotStore, type MemorySnapshotStore } from './memory-snapshot-store.js';
export { createMemoryArtifactStore } from './memory-artifact-store.js';
export { intendedIds, projectOutbox, reconcileIds } from '../kernel/store/outbox.js';
export { replay, verifyProjection, emptyReplayState } from '../kernel/store/projection.js';
export { canonical, identityDigest, type DigestPort } from '../kernel/store/identity.js';
export { storeFail, storeOk, type StoreErr, type StoreOk, type StoreResult } from '../kernel/store/contracts.js';
export type {
  AppendOutcome,
  AppendRequest,
  ArtifactRef,
  ArtifactStore,
  CreateSessionInput,
  DispatchClaim,
  DispatchInput,
  DispatchMode,
  Effect,
  Event,
  EventDraft,
  EventStore,
  ExportedSession,
  JournalProjection,
  NodeStateEntry,
  OutboxEntryProjection,
  OutboxProjection,
  ProtocolEnvelope,
  Receipt,
  ReceiptInput,
  ReceiptOutcome,
  Recovery,
  ReplayState,
  SessionHandle,
  SnapshotInput,
  SnapshotStore,
  StoredSnapshot,
} from '../kernel/store/contracts.js';
