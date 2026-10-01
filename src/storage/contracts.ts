/**
 * The storage port surface: what a store accepts, what it returns, and the typed results it uses.
 *
 * Every field name here is a frozen `SCHEMAS.md` name — this file renames nothing. Business
 * outcomes are `StoreResult`s built from the one `ErrorEnvelope` in `src/protocol`; the store never
 * throws for a reachable input and never invents a second error shape.
 *
 * On types: `Decoded<K>` from `src/protocol` derives wire types mechanically from the frozen field
 * table, and two of its consequences matter here. Ids and digests are decoded as plain strings (the
 * brands are compile-time-only on the raw `Id`/`Digest` aliases), and a nested object that is
 * referenced by `$ref` is widened by the `Wire` mapping, so the fields a consumer actually reads are
 * re-narrowed below. Nothing is re-declared: each narrowing points at the same frozen definition.
 *
 * Boundary: the store consumes values that `src/protocol`'s codec has already decoded — every port
 * signature takes `Decoded<K>`. The store does not re-decode them (the protocol layer documents
 * that callers decode once and then trust the result); what it does verify at its own persistence
 * boundary is identity, protocol version and journal continuity, not schema shape. Effect and
 * receipt content is additionally version-gated against the session's pinned protocol.
 *
 * Two store-internal concepts have no wire object on purpose (`SCHEMAS.md` §3): the dispatch claim
 * and the idempotency request index. Their whole lifetime is inside one `EventStore` CAS
 * transaction; only their ids cross a boundary.
 */
import { fail } from '../protocol/index.js';
import type { Decoded, ErrorCode, ErrorEnvelope } from '../protocol/index.js';

/** A committed journal event. */
export type Event = Omit<Decoded<'Event'>, 'payload'> & { readonly payload: EventPayload };
/** An event a caller submits to `append`. `sequence`/`revision` are assigned by the journal, never by a caller. */
export type EventDraft = Omit<Event, 'sequence' | 'revision'>;
/** The typed event payload, with its `$ref` members re-narrowed. */
export type EventPayload = Omit<Decoded<'EventPayload'>, 'binding' | 'objectRef'> & {
  readonly binding: Binding | null;
  readonly objectRef: ArtifactRef | null;
};
/** The attempt binding every effect and receipt carries. */
export type Binding = Decoded<'Binding'>;
/** A committed effect intention. */
export type Effect = Omit<Decoded<'Effect'>, 'binding' | 'leases' | 'inputRefs' | 'payload'> & {
  readonly binding: Binding;
  readonly leases: readonly Decoded<'LeaseRef'>[];
  readonly inputRefs: readonly ArtifactRef[];
  readonly payload: Decoded<'EffectPayload'>;
};
/** An execution receipt. */
export type Receipt = Omit<Decoded<'Receipt'>, 'binding' | 'artifactRefs' | 'usage'> & {
  readonly binding: Binding;
  readonly artifactRefs: readonly ArtifactRef[];
  readonly usage: readonly Decoded<'Usage'>[];
};
/** An immutable artifact reference. */
export type ArtifactRef = Decoded<'ArtifactRef'>;
/** A journal-derived node state entry. */
export type NodeStateEntry = Decoded<'NodeStateEntry'>;
/** The runtime protocol envelope. */
export type ProtocolEnvelope = Decoded<'ProtocolVersion'>;
/** Session dispatch mode, derived from session events. */
export type DispatchMode = 'active' | 'paused' | 'cancelling' | 'cancelled';

export type StoreOk<T> = { readonly ok: true; readonly value: T };
export type StoreErr = { readonly ok: false; readonly error: ErrorEnvelope };
export type StoreResult<T> = StoreOk<T> | StoreErr;

export function storeOk<T>(value: T): StoreOk<T> {
  return { ok: true, value };
}

export function storeFail(code: ErrorCode, message: string, refs: readonly string[] = []): StoreErr {
  return { ok: false, error: fail(code, message, refs) };
}

// --- EventStore -------------------------------------------------------------------------------

export interface CreateSessionInput {
  readonly sessionId: string;
  readonly epoch: number;
  /** Boundary input (argv/YAML/host): the protocol envelope is decoded and version-gated here. */
  readonly protocol: unknown;
}

export interface SessionHandle {
  readonly sessionId: string;
  readonly epoch: number;
  readonly schemaVersion: string;
}

export interface AppendRequest {
  readonly sessionId: string;
  /** Caller identity for idempotent submission: same id + same content is a replay, not a second commit. */
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly epoch: number;
  readonly events: readonly EventDraft[];
  readonly effects: readonly Effect[];
  readonly receipts: readonly Receipt[];
}

export interface AppendOutcome {
  readonly disposition: 'committed' | 'duplicate';
  readonly sessionId: string;
  readonly revision: number;
  readonly eventIds: readonly string[];
  readonly effectIds: readonly string[];
}

export interface ReplayState {
  readonly sessionId: string;
  readonly revision: number;
  readonly epoch: number;
  readonly lastSequence: number | null;
  readonly dispatchMode: DispatchMode;
  readonly nodeStates: readonly NodeStateEntry[];
}

export interface JournalProjection extends ReplayState {
  /** Effects committed, unclaimed and dispatchable at the current epoch. Safe to send. */
  readonly pendingEffectIds: readonly string[];
  /** Effects claimed (or reported unknown) whose actual outcome must be reconciled, never resent. */
  readonly unknownEffectIds: readonly string[];
  /**
   * Effects intended at an earlier epoch. Their lease is stale, so they are not dispatchable until
   * they are re-authorized under the current epoch; they are surfaced rather than silently dropped.
   */
  readonly staleEffectIds: readonly string[];
}

export interface OutboxEntryProjection {
  readonly effectId: string;
  readonly state: 'intended' | 'dispatched' | 'unknown' | 'resolved';
  readonly resolvedStatus: Receipt['status'] | null;
}

export interface OutboxProjection {
  readonly entries: readonly OutboxEntryProjection[];
  /** Stale receipts kept as evidence without touching the current attempt. */
  readonly archivedReceiptIds: readonly string[];
}

export interface DispatchClaim {
  readonly claimId: string;
  readonly epoch: number;
  readonly fencingToken: number;
}

export interface DispatchInput {
  readonly expectedRevision: number;
  readonly epoch: number;
  readonly effectId: string;
  readonly claimId: string;
}

export interface ReceiptInput {
  readonly expectedRevision: number;
  readonly epoch: number;
  readonly receipt: Receipt;
  /** The committed artifact that carries the receipt content; its id is the receipt id. */
  readonly objectRef: ArtifactRef;
}

export interface ReceiptOutcome {
  readonly disposition: 'applied' | 'duplicate' | 'archived';
  readonly revision: number;
  readonly effectId: string;
  readonly receiptId: string;
}

export interface ExportedSession {
  readonly sessionId: string;
  readonly epoch: number;
  readonly protocol: ProtocolEnvelope;
  readonly revision: number;
  readonly events: readonly Event[];
  readonly effects: readonly Effect[];
  readonly receipts: readonly Receipt[];
}

export interface EventStore {
  createSession(input: CreateSessionInput): StoreResult<SessionHandle>;
  append(request: AppendRequest): StoreResult<AppendOutcome>;
  exportSession(sessionId: string): StoreResult<ExportedSession>;
  replay(sessionId: string): StoreResult<JournalProjection>;
  outbox(sessionId: string): StoreResult<OutboxProjection>;
  nextEffects(sessionId: string): StoreResult<readonly Effect[]>;
  dispatchEffect(sessionId: string, input: DispatchInput): StoreResult<AppendOutcome>;
  applyReceipt(sessionId: string, input: ReceiptInput): StoreResult<ReceiptOutcome>;
  reconcileEffect(sessionId: string, input: ReceiptInput): StoreResult<ReceiptOutcome>;
}

// --- SnapshotStore ----------------------------------------------------------------------------

export interface SnapshotInput {
  readonly sessionId: string;
  readonly revision: number;
  readonly epoch: number;
  /** Last journal sequence the projection covers. */
  readonly sequence: number;
  readonly schemaVersion: string;
  readonly projection: ReplayState;
}

export interface StoredSnapshot extends SnapshotInput {
  readonly digest: string;
}

export interface Recovery {
  readonly projection: ReplayState;
  readonly usedSnapshot: boolean;
  /** First journal sequence replayed (0, or `snapshot.sequence + 1` when a snapshot was used). */
  readonly replayedFrom: number;
}

export interface SnapshotStore {
  /** `save` stores a projection verbatim and version-gates it; `recover` is what checks it against the journal. */
  save(input: SnapshotInput): StoreResult<StoredSnapshot>;
  load(sessionId: string): StoreResult<StoredSnapshot | null>;
  recover(sessionId: string, events: readonly Event[]): StoreResult<Recovery>;
}

// --- ArtifactStore ----------------------------------------------------------------------------

export interface ArtifactStore {
  put(ref: ArtifactRef, bytes: string): StoreResult<{ readonly disposition: 'stored' | 'duplicate' }>;
  get(ref: ArtifactRef): StoreResult<string>;
  ids(): readonly string[];
}
