/**
 * l2_state_store — cp3: replay, crash recovery and duplicate/unknown submission verification.
 *
 * DoD 2 ("replay only rebuilds state; an unknown external effect goes to reconciliation and is not
 * resent") is exercised end to end here: a session is exported, restored into a fresh process image,
 * and the unknown effect must stay unknown instead of reappearing in `nextEffects`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createMemoryEventStore, createMemorySnapshotStore, replay } from '../dist/storage/index.js';

const PROTOCOL = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
const SESSION = 's1';
const digestPort = {
  digest: (bytes) => `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`,
};
const GRAPH = { graphId: 'g1', revision: 1, digest: digestPort.digest('graph-v1') };

function binding(over = {}) {
  return {
    sessionId: SESSION,
    hostSessionId: null,
    graph: GRAPH,
    nodeId: 'n1',
    attemptId: 'a1',
    attemptOrdinal: 1,
    epoch: 1,
    baseDigest: null,
    ...over,
  };
}
function payload(over = {}) {
  return {
    binding: null,
    objectRef: null,
    before: null,
    after: null,
    effectId: null,
    decisionId: null,
    changedIds: [],
    error: null,
    ...over,
  };
}
function draft(type, over = {}) {
  return {
    protocol: PROTOCOL,
    eventId: `${type}.${over.n ?? 1}`,
    sessionId: SESSION,
    epoch: 1,
    causedBy: 'cmd-1',
    type,
    payload: payload(),
    visibility: 'internal',
    ...over,
  };
}
function effect(effectId, over = {}) {
  return {
    protocol: PROTOCOL,
    effectId,
    idempotencyKey: `idem.${effectId}`,
    binding: binding(),
    authorityRef: 'grant-1',
    reservationRef: null,
    leases: [],
    inputRefs: [],
    deadline: 1000,
    kind: 'host.agent',
    payload: { context: null, toolName: null, argumentsRef: null, graphRef: null, targetIds: [], assetRef: null, previousSnapshot: null, deliveryGuarantee: 'none' },
    ...over,
  };
}
function receipt(receiptId, effectId, status, over = {}) {
  return {
    protocol: PROTOCOL,
    receiptId,
    effectId,
    hostInvocationId: null,
    binding: binding(),
    status,
    artifactRefs: [],
    usage: [],
    observability: [],
    error: null,
    ...over,
  };
}
function receiptRef(receiptId) {
  return {
    protocol: PROTOCOL,
    id: receiptId,
    digest: digestPort.digest(`receipt:${receiptId}`),
    producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null },
    binding: null,
    schema: { name: 'Receipt', version: '1.1.0', digest: digestPort.digest('schema') },
    location: `artifact://${receiptId}`,
    visibility: 'internal',
    expiresAt: null,
    partition: 'not-evaluation',
  };
}

const ok = (result, what) => {
  assert.equal(result.ok, true, `${what ?? 'call'} expected success, got ${JSON.stringify(result.error)}`);
  return result.value;
};
const err = (result, code, what) => {
  assert.equal(result.ok, false, `${what ?? 'call'} expected a typed rejection`);
  assert.equal(result.error.code, code);
  return result.error;
};

const append = (store, over) =>
  store.append({
    sessionId: SESSION,
    requestId: over.requestId,
    expectedRevision: over.expectedRevision,
    epoch: over.epoch ?? 1,
    events: over.events ?? [],
    effects: over.effects ?? [],
    receipts: over.receipts ?? [],
  });

/** A session with two nodes' transitions committed through the real append path. */
function transitionSession() {
  const store = createMemoryEventStore({ digest: digestPort });
  ok(store.createSession({ sessionId: SESSION, epoch: 1, protocol: PROTOCOL }));
  ok(
    append(store, {
      requestId: 'c1',
      expectedRevision: 0,
      events: [
        draft('node.transition', { eventId: 't1', payload: payload({ binding: binding(), before: 'pending', after: 'ready' }) }),
        draft('node.transition', { eventId: 't2', payload: payload({ binding: binding({ nodeId: 'n2', attemptId: 'a2' }), before: 'pending', after: 'ready' }) }),
      ],
    }),
  );
  ok(
    append(store, {
      requestId: 'c2',
      expectedRevision: 1,
      events: [draft('node.transition', { eventId: 't3', payload: payload({ binding: binding(), before: 'ready', after: 'leased' }) })],
    }),
  );
  return store;
}

test('cp3 replay rebuilds node state and dispatch mode from the journal only', () => {
  const store = transitionSession();
  ok(append(store, { requestId: 'c3', expectedRevision: 2, events: [draft('session.paused', { eventId: 'p1' })] }));
  const projection = ok(store.replay(SESSION));
  assert.equal(projection.revision, 3);
  assert.equal(projection.epoch, 1);
  assert.equal(projection.lastSequence, 3);
  assert.equal(projection.dispatchMode, 'paused');
  assert.deepEqual(
    projection.nodeStates.map((entry) => ({ ...entry })),
    [
      { nodeId: 'n1', attemptOrdinal: 1, epoch: 1, state: 'leased', sinceSequence: 2 },
      { nodeId: 'n2', attemptOrdinal: 1, epoch: 1, state: 'ready', sinceSequence: 1 },
    ],
  );
});

test('cp1 replay refuses a sequence gap instead of patching it', () => {
  const events = ok(transitionSession().exportSession(SESSION)).events;
  const gapped = [events[0], { ...events[1], sequence: 7 }, events[2]];
  err(replay(gapped), 'EFK_RECOVERY_SEQUENCE_GAP');
  err(replay([{ ...events[0], sequence: 3 }]), 'EFK_RECOVERY_SEQUENCE_GAP');
});

test('cp1 replay refuses a broken node transition chain', () => {
  const events = ok(transitionSession().exportSession(SESSION)).events;
  const broken = [events[0], events[1], { ...events[2], payload: { ...events[2].payload, before: 'cancelled' } }];
  err(replay(broken), 'EFK_INVARIANT_VIOLATION');
});

test('cp3 restoreSession rebuilds a journal and refuses a gapped export', () => {
  const events = ok(transitionSession().exportSession(SESSION)).events;
  const exported = ok(transitionSession().exportSession(SESSION));
  const restored = createMemoryEventStore({ digest: digestPort });
  ok(restored.restoreSession(exported), 'restoreSession');
  assert.deepEqual(ok(restored.replay(SESSION)), ok(transitionSession().replay(SESSION)));

  const broken = createMemoryEventStore({ digest: digestPort });
  err(broken.restoreSession({ ...exported, events: [{ ...events[0] }, { ...events[2], sequence: 5 }] }), 'EFK_RECOVERY_SEQUENCE_GAP');
});

test('cp3 snapshot save version-gates, load version-gates, and both verify the digest', () => {
  const snapshots = createMemorySnapshotStore({ digest: digestPort });
  const events = ok(transitionSession().exportSession(SESSION)).events;
  const projection = ok(replay(events));
  ok(snapshots.save({ sessionId: SESSION, revision: 2, epoch: 1, sequence: 1, schemaVersion: '1.1.0', projection }));
  err(snapshots.save({ sessionId: SESSION, revision: 2, epoch: 1, sequence: 1, schemaVersion: '2.0.0', projection }), 'EFK_PROTOCOL_UNSUPPORTED');

  const foreign = { sessionId: 'sx', revision: 1, epoch: 1, sequence: 0, schemaVersion: '2.0.0', projection, digest: 'sha256:' + '0'.repeat(64) };
  snapshots.seed(foreign);
  err(snapshots.load('sx'), 'EFK_RECOVERY_SCHEMA_MISMATCH');

  snapshots.seed({ ...foreign, sessionId: 'sy', schemaVersion: '1.1.0' });
  err(snapshots.load('sy'), 'EFK_ARTIFACT_DIGEST_MISMATCH');
});

test('cp3 recover continues from a verified snapshot and refuses what the journal contradicts', () => {
  const snapshots = createMemorySnapshotStore({ digest: digestPort });
  const events = ok(transitionSession().exportSession(SESSION)).events;
  const prefix = ok(replay(events.filter((event) => event.sequence <= 1)));
  ok(snapshots.save({ sessionId: SESSION, revision: 2, epoch: 1, sequence: 1, schemaVersion: '1.1.0', projection: prefix }));
  const recovery = ok(snapshots.recover(SESSION, events));
  assert.equal(recovery.usedSnapshot, true);
  assert.equal(recovery.replayedFrom, 2);
  assert.deepEqual(recovery.projection, ok(replay(events)));

  const beyond = createMemorySnapshotStore({ digest: digestPort });
  ok(beyond.save({ sessionId: SESSION, revision: 9, epoch: 1, sequence: 5, schemaVersion: '1.1.0', projection: { ...prefix, lastSequence: 5 } }));
  err(beyond.recover(SESSION, events), 'EFK_RECOVERY_SEQUENCE_GAP');
});

test('negative control: a forged cached projection is refused (verify is not a tautology)', () => {
  const snapshots = createMemorySnapshotStore({ digest: digestPort });
  const events = ok(transitionSession().exportSession(SESSION)).events;
  const prefix = ok(replay(events.filter((event) => event.sequence <= 1)));
  const forged = {
    ...prefix,
    nodeStates: prefix.nodeStates.map((entry) => (entry.nodeId === 'n1' ? { ...entry, state: 'succeeded' } : entry)),
  };
  ok(snapshots.save({ sessionId: SESSION, revision: 2, epoch: 1, sequence: 1, schemaVersion: '1.1.0', projection: forged }));
  err(snapshots.recover(SESSION, events), 'EFK_INVARIANT_VIOLATION');
});

test('cp3 a restart keeps a dispatched effect unknown and does not re-emit it', () => {
  const original = createMemoryEventStore({ digest: digestPort });
  ok(original.createSession({ sessionId: SESSION, epoch: 1, protocol: PROTOCOL }));
  ok(
    append(original, {
      requestId: 'c1',
      expectedRevision: 0,
      events: [draft('effect.intended', { eventId: 'i1', payload: payload({ effectId: 'fx1' }) })],
      effects: [effect('fx1')],
    }),
  );
  ok(original.dispatchEffect(SESSION, { expectedRevision: 1, epoch: 1, effectId: 'fx1', claimId: 'claim-1' }));

  const restored = createMemoryEventStore({ digest: digestPort });
  ok(restored.restoreSession(ok(original.exportSession(SESSION))), 'restoreSession');
  assert.deepEqual(ok(restored.replay(SESSION)), ok(original.replay(SESSION)));
  assert.deepEqual(ok(restored.nextEffects(SESSION)), [], 'a claimed effect must not be re-sent after restart');
  assert.deepEqual(ok(restored.replay(SESSION)).unknownEffectIds, ['fx1']);
});

test('DoD2 an unknown effect is reconciled, never resent', () => {
  const store = createMemoryEventStore({ digest: digestPort });
  ok(store.createSession({ sessionId: SESSION, epoch: 1, protocol: PROTOCOL }));
  ok(
    append(store, {
      requestId: 'c1',
      expectedRevision: 0,
      events: [draft('effect.intended', { eventId: 'i1', payload: payload({ effectId: 'fx1' }) })],
      effects: [effect('fx1')],
    }),
  );
  ok(store.dispatchEffect(SESSION, { expectedRevision: 1, epoch: 1, effectId: 'fx1', claimId: 'claim-1' }));
  ok(
    store.applyReceipt(SESSION, {
      expectedRevision: 2,
      epoch: 1,
      receipt: receipt('r0', 'fx1', 'unknown'),
      objectRef: receiptRef('r0'),
    }),
  );
  assert.deepEqual(ok(store.nextEffects(SESSION)), [], 'unknown must not return to the send queue');

  err(
    store.reconcileEffect(SESSION, { expectedRevision: 3, epoch: 1, receipt: receipt('r1', 'fx1', 'unknown', { observability: ['x'] }), objectRef: receiptRef('r1') }),
    'EFK_EFFECT_UNKNOWN',
  );
  err(
    store.reconcileEffect(SESSION, { expectedRevision: 3, epoch: 1, receipt: receipt('r2', 'fx1', 'completed'), objectRef: receiptRef('r2') }),
    'EFK_EFFECT_UNKNOWN',
  );

  const applied = ok(
    store.reconcileEffect(SESSION, {
      expectedRevision: 3,
      epoch: 1,
      receipt: receipt('r1', 'fx1', 'completed', { observability: ['native-ack'] }),
      objectRef: receiptRef('r1'),
    }),
  );
  assert.equal(applied.disposition, 'applied');
  assert.deepEqual(ok(store.replay(SESSION)).unknownEffectIds, []);
  const duplicate = ok(
    store.reconcileEffect(SESSION, {
      expectedRevision: 4,
      epoch: 1,
      receipt: receipt('r1', 'fx1', 'completed', { observability: ['native-ack'] }),
      objectRef: receiptRef('r1'),
    }),
  );
  assert.equal(duplicate.disposition, 'duplicate');
});

test('DoD2 a stale-epoch receipt is archived and does not move the effect', () => {
  const store = createMemoryEventStore({ digest: digestPort });
  ok(store.createSession({ sessionId: SESSION, epoch: 1, protocol: PROTOCOL }));
  ok(
    append(store, {
      requestId: 'c1',
      expectedRevision: 0,
      events: [draft('effect.intended', { eventId: 'i1', payload: payload({ effectId: 'fx1' }) })],
      effects: [effect('fx1')],
    }),
  );
  ok(store.dispatchEffect(SESSION, { expectedRevision: 1, epoch: 1, effectId: 'fx1', claimId: 'claim-1' }));
  const archived = ok(
    store.applyReceipt(SESSION, {
      expectedRevision: 2,
      epoch: 1,
      receipt: receipt('r0', 'fx1', 'completed', { binding: binding({ epoch: 0 }), observability: ['late'] }),
      objectRef: receiptRef('r0'),
    }),
  );
  assert.equal(archived.disposition, 'archived');
  const outbox = ok(store.outbox(SESSION));
  assert.deepEqual(outbox.archivedReceiptIds, ['r0']);
  assert.equal(outbox.entries[0].state, 'dispatched', 'an archived receipt must not resolve the effect');
  assert.deepEqual(ok(store.replay(SESSION)).unknownEffectIds, ['fx1']);
});

test('DoD2 a receipt can only be applied once and only for a dispatched effect', () => {
  const store = createMemoryEventStore({ digest: digestPort });
  ok(store.createSession({ sessionId: SESSION, epoch: 1, protocol: PROTOCOL }));
  ok(
    append(store, {
      requestId: 'c1',
      expectedRevision: 0,
      events: [draft('effect.intended', { eventId: 'i1', payload: payload({ effectId: 'fx1' }) })],
      effects: [effect('fx1')],
    }),
  );
  err(
    store.applyReceipt(SESSION, { expectedRevision: 1, epoch: 1, receipt: receipt('r0', 'fx1', 'completed', { observability: ['a'] }), objectRef: receiptRef('r0') }),
    'EFK_CLAIM_CONFLICT',
    'a receipt for a never-dispatched effect must be refused',
  );
  ok(store.dispatchEffect(SESSION, { expectedRevision: 1, epoch: 1, effectId: 'fx1', claimId: 'claim-1' }));
  const first = ok(store.applyReceipt(SESSION, { expectedRevision: 2, epoch: 1, receipt: receipt('r0', 'fx1', 'completed', { observability: ['a'] }), objectRef: receiptRef('r0') }));
  assert.equal(first.disposition, 'applied');
  const again = ok(store.applyReceipt(SESSION, { expectedRevision: 3, epoch: 1, receipt: receipt('r0', 'fx1', 'completed', { observability: ['a'] }), objectRef: receiptRef('r0') }));
  assert.equal(again.disposition, 'duplicate');
  assert.equal(ok(store.exportSession(SESSION)).revision, 3, 'a duplicate delivery must not add a transaction');
});

test('DoD2 disputed receipts are refused: a second dispatch of one effect is a claim conflict', () => {
  const store = createMemoryEventStore({ digest: digestPort });
  ok(store.createSession({ sessionId: SESSION, epoch: 1, protocol: PROTOCOL }));
  ok(
    append(store, {
      requestId: 'c1',
      expectedRevision: 0,
      events: [draft('effect.intended', { eventId: 'i1', payload: payload({ effectId: 'fx1' }) })],
      effects: [effect('fx1')],
    }),
  );
  ok(store.dispatchEffect(SESSION, { expectedRevision: 1, epoch: 1, effectId: 'fx1', claimId: 'claim-1' }));
  err(store.dispatchEffect(SESSION, { expectedRevision: 2, epoch: 1, effectId: 'fx1', claimId: 'claim-2' }), 'EFK_CLAIM_CONFLICT');
});

test('negative control: replay has no execution side effect on the outbox', () => {
  const store = createMemoryEventStore({ digest: digestPort });
  ok(store.createSession({ sessionId: SESSION, epoch: 1, protocol: PROTOCOL }));
  ok(
    append(store, {
      requestId: 'c1',
      expectedRevision: 0,
      events: [draft('effect.intended', { eventId: 'i1', payload: payload({ effectId: 'fx1' }) })],
      effects: [effect('fx1')],
    }),
  );
  ok(store.replay(SESSION));
  ok(store.replay(SESSION));
  ok(store.replay(SESSION));
  assert.deepEqual(ok(store.nextEffects(SESSION)).map((candidate) => candidate.effectId), ['fx1'], 'replay must not consume or dispatch the intention');
});
