/**
 * l2_state_store — cp1/cp2: the port surface, the memory reference implementation, and the single
 * atomic journal+outbox transaction.
 *
 * DoD 1 ("duplicate, gap, out-of-order, version-incompatible and CAS races are all defined") is
 * exercised here at the transaction boundary; the recovery half (gap/replay) lives in
 * l2-store-recovery.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createMemoryEventStore } from '../dist/storage/index.js';

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

const ok = (result, what) => {
  assert.equal(result.ok, true, `${what ?? 'call'} expected success, got ${JSON.stringify(result.error)}`);
  return result.value;
};
const err = (result, code, what) => {
  assert.equal(result.ok, false, `${what ?? 'call'} expected a typed rejection`);
  assert.equal(result.error.code, code);
  return result.error;
};

function openStore() {
  const store = createMemoryEventStore({ digest: digestPort });
  ok(store.createSession({ sessionId: SESSION, epoch: 1, protocol: PROTOCOL }), 'createSession');
  return store;
}

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

test('cp1 createSession version-gates the protocol and is idempotent per epoch', () => {
  const store = createMemoryEventStore({ digest: digestPort });
  const handle = ok(store.createSession({ sessionId: SESSION, epoch: 1, protocol: PROTOCOL }));
  assert.equal(handle.schemaVersion, '1.1.0');
  ok(store.createSession({ sessionId: SESSION, epoch: 1, protocol: PROTOCOL }), 'idempotent reopen');
  err(store.createSession({ sessionId: SESSION, epoch: 2, protocol: PROTOCOL }), 'EFK_REVISION_CONFLICT');
  err(
    store.createSession({ sessionId: 's2', epoch: 1, protocol: { namespace: 'evofence.runtime/1', schemaVersion: '2.0.0' } }),
    'EFK_PROTOCOL_UNSUPPORTED',
  );
  err(
    store.createSession({ sessionId: 's3', epoch: 1, protocol: { namespace: 'evofence.runtime/9', schemaVersion: '1.1.0' } }),
    'EFK_PROTOCOL_UNSUPPORTED',
  );
});

test('cp1 append assigns contiguous sequence and exactly one revision per transaction', () => {
  const store = openStore();
  const first = ok(
    append(store, {
      requestId: 'c1',
      expectedRevision: 0,
      events: [
        draft('node.transition', { eventId: 't1', payload: payload({ binding: binding(), before: 'pending', after: 'ready' }) }),
        draft('node.transition', { eventId: 't2', payload: payload({ binding: binding(), before: 'ready', after: 'leased' }) }),
      ],
    }),
  );
  assert.equal(first.disposition, 'committed');
  assert.equal(first.revision, 1);

  const exported = ok(store.exportSession(SESSION));
  assert.equal(exported.revision, 1);
  assert.deepEqual(exported.events.map((event) => event.sequence), [0, 1]);
  assert.deepEqual(exported.events.map((event) => event.revision), [1, 1]);

  const second = ok(append(store, { requestId: 'c2', expectedRevision: 1, events: [draft('session.paused', { eventId: 'p1' })] }));
  assert.equal(second.revision, 2);
  assert.equal(ok(store.exportSession(SESSION)).events[2].sequence, 2);
});

test('cp1 out-of-order expectedRevision is refused and the journal is untouched', () => {
  const store = openStore();
  ok(append(store, { requestId: 'c1', expectedRevision: 0, events: [draft('session.paused', { eventId: 'p1' })] }));
  const strider = append(store, { requestId: 'c2', expectedRevision: 0, events: [draft('session.resumed', { eventId: 'r1' })] });
  err(strider, 'EFK_REVISION_CONFLICT');
  const exported = ok(store.exportSession(SESSION));
  assert.equal(exported.revision, 1);
  assert.equal(exported.events.length, 1);
});

test('cp1 a repeated request is a duplicate, not a second reduction', () => {
  const store = openStore();
  const events = [draft('session.paused', { eventId: 'p1' })];
  const first = ok(append(store, { requestId: 'c1', expectedRevision: 0, events }));
  const replay = append(store, { requestId: 'c1', expectedRevision: 0, events });
  assert.equal(replay.ok, true);
  assert.equal(replay.value.disposition, 'duplicate');
  assert.equal(replay.value.revision, first.revision);
  const exported = ok(store.exportSession(SESSION));
  assert.equal(exported.revision, 1);
  assert.equal(exported.events.length, 1);
});

test('cp1 reusing a request id with different content is an idempotency collision', () => {
  const store = openStore();
  ok(append(store, { requestId: 'c1', expectedRevision: 0, events: [draft('session.paused', { eventId: 'p1' })] }));
  const collision = append(store, { requestId: 'c1', expectedRevision: 0, events: [draft('session.resumed', { eventId: 'r1' })] });
  err(collision, 'EFK_IDEMPOTENCY_COLLISION');
});

test('cp1 a committed event id is immutable', () => {
  const store = openStore();
  ok(append(store, { requestId: 'c1', expectedRevision: 0, events: [draft('session.paused', { eventId: 'p1' })] }));
  ok(append(store, { requestId: 'c2', expectedRevision: 1, events: [draft('session.resumed', { eventId: 'r1' })] }));
  const reused = append(store, { requestId: 'c3', expectedRevision: 2, events: [draft('session.cancel-requested', { eventId: 'p1' })] });
  err(reused, 'EFK_IDEMPOTENCY_COLLISION');
});

test('cp1 an empty append and an unknown session are refused', () => {
  const store = openStore();
  err(append(store, { requestId: 'c1', expectedRevision: 0, events: [] }), 'EFK_SCHEMA_INVALID');
  err(
    store.append({ sessionId: 'ghost', requestId: 'c2', expectedRevision: 0, epoch: 1, events: [draft('session.paused', { eventId: 'p9' })], effects: [], receipts: [] }),
    'EFK_SCHEMA_INVALID',
  );
});

test('cp1 an event that carries a caller-assigned sequence is refused', () => {
  const store = openStore();
  const forged = { ...draft('session.paused', { eventId: 'p1' }), sequence: 7 };
  err(append(store, { requestId: 'c1', expectedRevision: 0, events: [forged] }), 'EFK_SCHEMA_INVALID');
});

test('cp2 effect and intention are committed in one transaction or not at all', () => {
  const store = openStore();
  // intention without content
  err(
    append(store, {
      requestId: 'c1',
      expectedRevision: 0,
      events: [draft('effect.intended', { eventId: 'i1', payload: payload({ effectId: 'fx1' }) })],
      effects: [],
    }),
    'EFK_INVARIANT_VIOLATION',
  );
  // content without intention
  err(
    append(store, { requestId: 'c2', expectedRevision: 0, events: [draft('session.paused', { eventId: 'p1' })], effects: [effect('fx1')] }),
    'EFK_INVARIANT_VIOLATION',
  );
  const exported = ok(store.exportSession(SESSION));
  assert.equal(exported.revision, 0, 'a rejected transaction must not advance the journal');
  assert.equal(exported.events.length, 0);
  assert.equal(exported.effects.length, 0);

  // the same intent, now atomic with its content, commits
  const committed = ok(
    append(store, {
      requestId: 'c3',
      expectedRevision: 0,
      events: [draft('effect.intended', { eventId: 'i1', payload: payload({ effectId: 'fx1', changedIds: ['fx1'] }) })],
      effects: [effect('fx1')],
    }),
  );
  assert.deepEqual(committed.effectIds, ['fx1']);
  assert.deepEqual(ok(store.nextEffects(SESSION)).map((candidate) => candidate.effectId), ['fx1']);
});

test('cp2 effect identity and idempotency key cannot be rebound', () => {
  const store = openStore();
  const intentOf = (effectId, eventId) => draft('effect.intended', { eventId, payload: payload({ effectId }) });
  ok(append(store, { requestId: 'c1', expectedRevision: 0, events: [intentOf('fx1', 'i1')], effects: [effect('fx1')] }));
  err(
    append(store, { requestId: 'c2', expectedRevision: 1, events: [intentOf('fx1', 'i2')], effects: [effect('fx1')] }),
    'EFK_IDEMPOTENCY_COLLISION',
  );
  err(
    append(store, {
      requestId: 'c3',
      expectedRevision: 1,
      events: [intentOf('fx2', 'i3')],
      effects: [effect('fx2', { idempotencyKey: 'idem.fx1' })],
    }),
    'EFK_IDEMPOTENCY_COLLISION',
  );
});

test('cp1 a stale epoch writer is refused', () => {
  const store = openStore();
  const stale = append(store, { requestId: 'c1', expectedRevision: 0, epoch: 0, events: [draft('session.paused', { eventId: 'p1', epoch: 0 })] });
  err(stale, 'EFK_REVISION_CONFLICT');
  const ahead = append(store, { requestId: 'c2', expectedRevision: 0, epoch: 2, events: [draft('session.paused', { eventId: 'p2', epoch: 2 })] });
  err(ahead, 'EFK_REVISION_CONFLICT');
});

test('cp1 a schemaVersion change is refused in place', () => {
  const store = openStore();
  const wrong = append(store, {
    requestId: 'c1',
    expectedRevision: 0,
    events: [draft('session.paused', { eventId: 'p1', protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.0.0' } })],
  });
  err(wrong, 'EFK_PROTOCOL_UNSUPPORTED');
});

test('cp1 a committed epoch change moves the session and gates writers from the old epoch', () => {
  const store = openStore();
  ok(append(store, { requestId: 'c1', expectedRevision: 0, epoch: 2, events: [draft('session.epoch-changed', { eventId: 'e1', epoch: 2 })] }));
  assert.equal(ok(store.exportSession(SESSION)).epoch, 2);
  err(
    append(store, { requestId: 'c2', expectedRevision: 1, epoch: 1, events: [draft('session.paused', { eventId: 'p1', epoch: 1 })] }),
    'EFK_REVISION_CONFLICT',
  );
  ok(append(store, { requestId: 'c3', expectedRevision: 1, epoch: 2, events: [draft('session.paused', { eventId: 'p2', epoch: 2 })] }));
  assert.equal(ok(store.replay(SESSION)).epoch, 2);
});

test('BLOCKER fix B2: a non-advancing epoch change is refused at commit, keeping the journal replayable', () => {
  const store = openStore();
  ok(append(store, { requestId: 'c1', expectedRevision: 0, events: [draft('session.paused', { eventId: 'p1' })] }));
  // (a) an epoch change that does not advance the epoch
  err(
    append(store, { requestId: 'c2', expectedRevision: 1, epoch: 1, events: [draft('session.epoch-changed', { eventId: 'e1', epoch: 1 })] }),
    'EFK_INVARIANT_VIOLATION',
  );
  // (a2) two epoch changes in one transaction
  err(
    append(store, {
      requestId: 'c3',
      expectedRevision: 1,
      epoch: 2,
      events: [draft('session.epoch-changed', { eventId: 'e2', epoch: 2 }), draft('session.epoch-changed', { eventId: 'e3', epoch: 2 })],
    }),
    'EFK_INVARIANT_VIOLATION',
  );
  // (f) an event carrying the new epoch before the epoch-change event
  err(
    append(store, {
      requestId: 'c4',
      expectedRevision: 1,
      epoch: 2,
      events: [
        draft('node.transition', { eventId: 't1', epoch: 2, payload: payload({ binding: binding({ epoch: 2 }), before: 'pending', after: 'ready' }) }),
        draft('session.epoch-changed', { eventId: 'e4', epoch: 2 }),
      ],
    }),
    'EFK_INVARIANT_VIOLATION',
  );
  // none of the refused batches moved the journal, and what is committed still replays
  assert.equal(ok(store.exportSession(SESSION)).revision, 1);
  ok(store.replay(SESSION));
  // control: a properly advancing epoch change is accepted and replays
  ok(append(store, { requestId: 'c5', expectedRevision: 1, epoch: 2, events: [draft('session.epoch-changed', { eventId: 'e5', epoch: 2 })] }));
  assert.equal(ok(store.replay(SESSION)).epoch, 2);
});

test('MINOR fix N1: effect content is version-gated against the pinned session protocol', () => {
  const store = openStore();
  err(
    append(store, {
      requestId: 'c1',
      expectedRevision: 0,
      events: [draft('effect.intended', { eventId: 'i1', payload: payload({ effectId: 'fx1' }) })],
      effects: [effect('fx1', { protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.0.0' } })],
    }),
    'EFK_PROTOCOL_UNSUPPORTED',
  );
  assert.equal(ok(store.exportSession(SESSION)).events.length, 0);
});

test('negative control: the CAS guard is not a no-op (two writers at revision 0)', () => {
  const store = openStore();
  ok(append(store, { requestId: 'w1', expectedRevision: 0, events: [draft('session.paused', { eventId: 'p1' })] }));
  err(append(store, { requestId: 'w2', expectedRevision: 0, events: [draft('session.resumed', { eventId: 'r1' })] }), 'EFK_REVISION_CONFLICT');
  const exported = ok(store.exportSession(SESSION));
  assert.equal(exported.revision, 1, 'if CAS were skipped the revision would be 2');
  assert.equal(exported.events.length, 1, 'if CAS were skipped the racing event would be in the journal');
});

test('negative control: the version gate is not a no-op', () => {
  const store = openStore();
  const result = append(store, {
    requestId: 'v1',
    expectedRevision: 0,
    events: [draft('session.paused', { eventId: 'p1', protocol: { namespace: 'evofence.runtime/1', schemaVersion: '9.9.9' } })],
  });
  err(result, 'EFK_PROTOCOL_UNSUPPORTED');
  assert.equal(ok(store.exportSession(SESSION)).events.length, 0);
});

test('negative control: duplicate detection actually suppresses the second reduction', () => {
  const store = openStore();
  const events = [draft('session.paused', { eventId: 'p1' })];
  ok(append(store, { requestId: 'c1', expectedRevision: 0, events }));
  const duplicate = append(store, { requestId: 'c1', expectedRevision: 0, events });
  assert.equal(ok(duplicate).disposition, 'duplicate');
  assert.equal(ok(store.exportSession(SESSION)).events.length, 1, 'if duplicates were re-applied there would be two events');
});
