import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMemoryEventStore } from '../dist/storage/index.js';
import { event } from '../dist/runtime/session/journal.js';
import { makeReviewFixture, runReviewCli } from './l5-cli-fixture.test.js';

const digest = { digest: bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
function rejectedRestore(exported, code) {
  const store = createMemoryEventStore({ digest });
  const result = store.restoreSession(exported);
  assert.equal(result.ok, false, 'external export must fail closed');
  assert.equal(result.error.code, code);
  assert.deepEqual(store.sessionIds(), [], 'rejection must publish no partial session');
}
function rejectedReview(bundle, code) {
  const child = runReviewCli(bundle, ['--json']);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.equal(child.stdout, '', 'invalid assets must never be rendered eligible/usable');
  assert.equal(JSON.parse(child.stderr).error.code, code);
}

test('PR21 A: forged registry transition order cannot render an eligible or usable asset', async () => {
  const { bundle } = await makeReviewFixture();
  const original = bundle.registry.history;
  for (const state of ['promoted', 'active']) {
    const history = [original[0], { ...original.at(-1), state,
      context: state === 'active' ? bundle.assetContext : null }].map((row, sequence) => ({ ...row, sequence }));
    rejectedReview({ ...bundle, registry: { ...bundle.registry, history } }, 'EFK_ASSET_QUALIFICATION_INVALID');
  }
});

test('PR21 A: null required decision evidence cannot render an eligible or usable asset', async () => {
  const { bundle } = await makeReviewFixture();
  for (const index of [1, 2]) {
    const history = bundle.registry.history.map((row, ordinal) => ordinal === index ? { ...row, evidenceRef: null } : row);
    rejectedReview({ ...bundle, registry: { ...bundle.registry, history } }, 'EFK_ASSET_QUALIFICATION_INVALID');
  }
});

test('PR21 C: duplicate effect IDs are rejected before map reconstruction', async () => {
  const { bundle } = await makeReviewFixture(), exported = bundle.session, first = exported.effects[0];
  for (const duplicate of [first, { ...first, authorityRef: 'substituted-authority' }]) {
    rejectedRestore({ ...exported, effects: [...exported.effects, duplicate] }, 'EFK_IDEMPOTENCY_COLLISION');
  }
});

test('PR21 C: duplicate effect idempotency keys are rejected before map reconstruction', async () => {
  const { bundle } = await makeReviewFixture(), exported = bundle.session;
  const effects = exported.effects.map((row, index) => index === 1 ? { ...row, idempotencyKey: exported.effects[0].idempotencyKey } : row);
  rejectedRestore({ ...exported, effects }, 'EFK_IDEMPOTENCY_COLLISION');
});

test('PR21 C: receipt and event identity collisions are rejected without replacing content', async () => {
  const { bundle } = await makeReviewFixture(), exported = bundle.session, receipt = exported.receipts[0];
  rejectedRestore({ ...exported, receipts: [...exported.receipts, { ...receipt, hostInvocationId: 'substituted' }] }, 'EFK_IDEMPOTENCY_COLLISION');
  const events = exported.events.map((row, index) => index === 1 ? { ...row, eventId: exported.events[0].eventId } : row);
  rejectedRestore({ ...exported, events }, 'EFK_IDEMPOTENCY_COLLISION');
});

test('PR21 C: malformed identity aliases are rejected by the frozen Id codec', async () => {
  const { bundle } = await makeReviewFixture(), exported = bundle.session;
  for (const key of ['effectId', 'idempotencyKey']) for (const suffix of [' ', '\n', '\r\n', '\u0301']) {
    const effects = exported.effects.map((row, index) => index === 0 ? { ...row, [key]: row[key] + suffix } : row);
    rejectedRestore({ ...exported, effects }, 'EFK_SCHEMA_INVALID');
  }
});

test('PR21 D: export restore and retry preserves the original duplicate outcome', async () => {
  const f = await makeReviewFixture(), state = f.read();
  const request = { sessionId: f.seed.sessionId, requestId: 'pr21-request', expectedRevision: state.revision,
    epoch: state.epoch, effects: [], receipts: [], events: [
      { ...event(state, 'different-causal-command', 'pause', 'session.paused', {}), causedBy: 'different-causal-command' }] };
  const committed = ok(f.store.append(request));
  const next = f.read();
  ok(f.store.append({ ...request, requestId: 'pr21-later', expectedRevision: next.revision,
    events: [event(next, 'pr21-later', 'resume', 'session.resumed', {})] }));
  const exported = JSON.parse(JSON.stringify(ok(f.store.exportSession(f.seed.sessionId))));
  const restored = createMemoryEventStore({ digest });
  ok(restored.restoreSession(exported));
  const before = ok(restored.exportSession(f.seed.sessionId));
  for (let retry = 0; retry < 2; retry++) assert.deepEqual(ok(restored.append(request)), { ...committed, disposition: 'duplicate' });
  assert.deepEqual(ok(restored.exportSession(f.seed.sessionId)), before);
  const changed = restored.append({ ...request, events: [{ ...request.events[0], causedBy: 'changed' }] });
  assert.equal(changed.ok, false); assert.equal(changed.error.code, 'EFK_IDEMPOTENCY_COLLISION');
});

test('PR21 D: original effect and receipt requests keep their duplicate outcomes after repeated restore', async () => {
  const { bundle } = await makeReviewFixture();
  const original = bundle.session;
  const selected = original.requests.filter(r => r.effects.length > 0 || r.receipts.length > 0);
  assert.ok(selected.some(r => r.effects.length > 0)); assert.ok(selected.some(r => r.receipts.length > 0));
  let exported = JSON.parse(JSON.stringify(original));
  for (let restart = 0; restart < 2; restart++) {
    const restored = createMemoryEventStore({ digest }); ok(restored.restoreSession(exported));
    for (const request of selected) assert.deepEqual(ok(restored.append(request)), {
      disposition: 'duplicate', sessionId: original.sessionId, revision: request.expectedRevision + 1,
      eventIds: request.events.map(e => e.eventId), effectIds: request.effects.map(e => e.effectId) });
    assert.deepEqual(ok(restored.exportSession(original.sessionId)), exported);
    exported = JSON.parse(JSON.stringify(ok(restored.exportSession(original.sessionId))));
  }
});

test('PR21 D: missing, forged, duplicated and incomplete request records fail closed', async () => {
  const { bundle } = await makeReviewFixture(), exported = bundle.session;
  const { requests, ...oldExport } = exported;
  rejectedRestore(oldExport, 'EFK_SCHEMA_INVALID');
  rejectedRestore({ ...exported, requests: null }, 'EFK_SCHEMA_INVALID');
  rejectedRestore({ ...exported, requests: [] }, 'EFK_INVARIANT_VIOLATION');
  rejectedRestore({ ...exported, requests: [...requests, requests[0]] }, 'EFK_IDEMPOTENCY_COLLISION');
  rejectedRestore({ ...exported, requests: requests.slice(1) }, 'EFK_REVISION_CONFLICT');
  const changed = requests.map((r, i) => i === 0 ? { ...r, events: r.events.map((e, n) => n === 0 ? { ...e, causedBy: 'forged-command' } : e) } : r);
  rejectedRestore({ ...exported, requests: changed }, 'EFK_INVARIANT_VIOLATION');
  rejectedRestore({ ...exported, requests: [{ ...requests[0], events: null }] }, 'EFK_SCHEMA_INVALID');
});

test('PR21 C: normal append rejects two effects sharing an idempotency key atomically', async () => {
  const f = await makeReviewFixture(), state = f.read();
  const effects = ['pr21-new-1', 'pr21-new-2'].map(effectId => ({ ...f.effects[0], effectId, idempotencyKey: 'pr21-shared-key' }));
  const before = ok(f.store.exportSession(f.seed.sessionId));
  const result = f.store.append({ sessionId: f.seed.sessionId, requestId: 'pr21-collision',
    expectedRevision: state.revision, epoch: state.epoch, effects, receipts: [], events: effects.map(e =>
      event(state, 'pr21-collision', e.effectId, 'effect.intended', { effectId: e.effectId, binding: e.binding })) });
  assert.equal(result.ok, false); assert.equal(result.error.code, 'EFK_IDEMPOTENCY_COLLISION');
  assert.deepEqual(ok(f.store.exportSession(f.seed.sessionId)), before);
});

test('PR21 D: an empty session export restores without losing its explicit epoch', () => {
  const original = createMemoryEventStore({ digest });
  ok(original.createSession({ sessionId: 'empty-pr21', epoch: 4, protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' } }));
  const exported = ok(original.exportSession('empty-pr21'));
  const restored = createMemoryEventStore({ digest });
  assert.equal(ok(restored.restoreSession(exported)).epoch, 4);
  assert.deepEqual(ok(restored.exportSession('empty-pr21')), exported);
});
