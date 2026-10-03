import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, storeFail } from '../dist/kernel/store/index.js';
import { createMemoryEventStore } from '../dist/storage/index.js';
import { createRevocationService } from '../dist/evaluation/revocation/index.js';
import { revocationFixture, unwrap, denied } from './l4-revocation-fixtures.test.js';

async function dispatchedFixture() {
  const f = await revocationFixture(); await f.activate(await f.promote(1));
  const candidate = await f.promote(2), apply = f.ports.journal.applyReceipt;
  f.ports.journal.applyReceipt = () => storeFail('EFK_REVISION_CONFLICT', 'receipt fault');
  denied(await f.service.activate({ promotionId: candidate.promotionId, effect: f.effect(candidate) }), 'EFK_REVISION_CONFLICT');
  f.ports.journal.applyReceipt = apply;
  return { ...f, candidate };
}

test('cp3 ordinary host task completes during pending revocation and after exact recovery', async () => {
  const f = await dispatchedFixture(), record = unwrap(await f.revocation.monitor(f.request()));
  const before = unwrap(await f.ordinary()); assert.equal(before.receipt.status, 'completed'); assert.deepEqual(before.view.versions, []);
  unwrap(await f.revocation.recover(record.requestId));
  const after = unwrap(await f.ordinary()); assert.equal(after.receipt.status, 'completed'); assert.equal(after.view.versions[0].asset.revision, 1);
});

test('cp3 ordinary task does not wait for a stalled cancellation in the learning queue', async () => {
  const f = await dispatchedFixture(), record = unwrap(await f.revocation.monitor(f.request()));
  let release, entered;
  const paused = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const original = f.ports.host.cancel;
  f.ports.host.cancel = async request => { entered(); await paused; return original(request); };
  const recovery = f.revocation.recover(record.requestId); await started;
  const ordinary = unwrap(await f.ordinary()); assert.equal(ordinary.receipt.status, 'completed'); assert.deepEqual(ordinary.view.versions, []);
  release(); assert.equal(unwrap(await recovery).status, 'complete');
});

test('cp3 loss of learning journal or artifacts returns an empty learning view while ordinary host task runs', async () => {
  const f = await revocationFixture(); await f.activate(await f.promote(1));
  const exportSession = f.ports.journal.exportSession;
  f.ports.journal.exportSession = () => storeFail('EFK_ARTIFACT_UNAVAILABLE', 'learning journal unavailable');
  const noJournal = unwrap(await f.ordinary()); assert.equal(noJournal.view.evolutionError.code, 'EFK_ARTIFACT_UNAVAILABLE');
  assert.deepEqual(noJournal.view.versions, []); assert.equal(noJournal.receipt.status, 'completed');
  f.ports.journal.exportSession = exportSession;
  const get = f.artifacts.get; f.artifacts.get = () => storeFail('EFK_ARTIFACT_UNAVAILABLE', 'learning bytes unavailable');
  const noBytes = unwrap(await f.ordinary()); assert.deepEqual(noBytes.view.versions, []); assert.equal(noBytes.receipt.status, 'completed');
  f.artifacts.get = get; assert.equal(f.revocation.ordinaryView(f.context).versions.length, 1);
});

test('cp3 cancel failure is retained; restart reconciles without issuing another cancellation or activation', async () => {
  const f = await dispatchedFixture(), record = unwrap(await f.revocation.monitor(f.request()));
  f.ports.host.cancel = async () => { f.calls.cancel++; return storeFail('EFK_CANCEL_UNCONFIRMED', 'cancel transport failed'); };
  const pending = unwrap(await f.revocation.recover(record.requestId));
  assert.equal(pending.status, 'pending'); assert.equal(pending.error.code, 'EFK_CANCEL_UNCONFIRMED');
  assert.equal(pending.cancellations[0].status, 'requested');
  assert.equal(unwrap(await f.ordinary()).receipt.status, 'completed');
  const journal = createMemoryEventStore({ digest: f.registryPorts.digest });
  unwrap(journal.restoreSession(unwrap(f.ports.journal.exportSession(f.ports.sessionId))));
  const restarted = createRevocationService({ ...f.revocationPorts, promotion: { ...f.ports, journal } });
  assert.equal(unwrap(await restarted.recover(record.requestId)).status, 'complete');
  assert.equal(f.calls.cancel, 1); assert.equal(f.calls.reconcile, 1); assert.equal(f.calls.execute, 3);
  assert.equal(restarted.ordinaryView(f.context).versions[0].asset.revision, 1);
});

test('cp3 unknown actual outcome stays pending even after a native cancel acknowledgement', async () => {
  const f = await dispatchedFixture(), record = unwrap(await f.revocation.monitor(f.request())); f.receipts.clear();
  const pending = unwrap(await f.revocation.recover(record.requestId));
  assert.equal(pending.status, 'pending'); assert.equal(pending.error.code, 'EFK_ACTIVATION_UNCONFIRMED');
  assert.equal(pending.cancellations[0].status, 'observed'); assert.equal(f.calls.execute, 2);
  assert.equal(unwrap(await f.ordinary()).receipt.status, 'completed');
  f.actualReceipt(f.effect(f.candidate), 'active');
  assert.equal(unwrap(await f.revocation.recover(record.requestId)).status, 'complete');
  assert.equal(f.calls.cancel, 1); assert.equal(f.calls.execute, 3);
});

test('cp3 restart after rollback intention failure uses the same effect and exact target', async () => {
  const f = await revocationFixture(); const safe = await f.activate(await f.promote(1)); await f.activate(await f.promote(2));
  const record = unwrap(await f.revocation.monitor(f.request())), dispatch = f.ports.journal.dispatchEffect;
  f.ports.journal.dispatchEffect = () => storeFail('EFK_REVISION_CONFLICT', 'rollback dispatch fault');
  assert.equal(unwrap(await f.revocation.recover(record.requestId)).status, 'pending');
  f.ports.journal.dispatchEffect = dispatch;
  const restarted = createRevocationService(f.revocationPorts);
  assert.equal(unwrap(await restarted.recover(record.requestId)).status, 'complete');
  assert.deepEqual(f.pointer().snapshot, safe.activation.newSnapshot); assert.equal(f.calls.execute, 3);
  assert.equal(unwrap(f.ports.journal.exportSession(f.ports.sessionId)).effects.length, 3);
});

test('cp3 rollback actual receipt saved before final projection CAS can recover without executing twice', async () => {
  const f = await revocationFixture(); const safe = await f.activate(await f.promote(1)); await f.activate(await f.promote(2));
  const record = unwrap(await f.revocation.monitor(f.request())), append = f.ports.journal.append;
  let failOnce = true;
  f.ports.journal.append = request => {
    if (failOnce && request.events.some(e => String(e.causedBy).startsWith('settle:restore:'))) {
      failOnce = false; return storeFail('EFK_REVISION_CONFLICT', 'rollback final CAS fault');
    }
    return append(request);
  };
  assert.equal(unwrap(await f.revocation.recover(record.requestId)).status, 'pending');
  f.ports.journal.append = append;
  assert.equal(unwrap(await createRevocationService(f.revocationPorts).recover(record.requestId)).status, 'complete');
  assert.equal(f.calls.execute, 3); assert.deepEqual(f.pointer().snapshot, safe.activation.newSnapshot);
});

test('cp3 concurrent recovery has one cancellation; neither writer blindly resends activation', async () => {
  const f = await dispatchedFixture(), record = unwrap(await f.revocation.monitor(f.request()));
  const results = await Promise.all([f.revocation.recover(record.requestId), createRevocationService(f.revocationPorts).recover(record.requestId)]);
  for (const result of results) if (!result.ok) assert.equal(result.error.code, 'EFK_REVISION_CONFLICT');
  assert.equal(f.calls.cancel, 1);
  const latest = unwrap(f.revocation.inspect())[0];
  if (latest.status !== 'complete') unwrap(await f.revocation.recover(record.requestId));
  assert.equal(unwrap(f.revocation.inspect())[0].status, 'complete'); assert.equal(f.calls.execute, 3);
});

test('cp3 learning exception is visible to caller but does not poison ordinary tasks or queue', async () => {
  const f = await revocationFixture(), policy = f.revocationPorts.policy;
  f.revocationPorts.policy = () => { throw new Error('injected policy implementation failure'); };
  await assert.rejects(f.revocation.monitor(f.request()), /injected policy implementation failure/);
  assert.equal(unwrap(await f.ordinary()).receipt.status, 'completed');
  f.revocationPorts.policy = policy;
  assert.equal(unwrap(await f.revocation.monitor(f.request())).status, 'complete');
});

test('cp3 recovery replay after completed rollback is byte stable and does no host calls', async () => {
  const f = await revocationFixture(); await f.activate(await f.promote(1)); await f.activate(await f.promote(2));
  const record = unwrap(await f.revocation.monitor(f.request())); const complete = unwrap(await f.revocation.recover(record.requestId));
  const before = canonical(unwrap(f.ports.journal.exportSession(f.ports.sessionId))), calls = { ...f.calls };
  assert.deepEqual(unwrap(await createRevocationService(f.revocationPorts).recover(record.requestId)), complete);
  assert.equal(canonical(unwrap(f.ports.journal.exportSession(f.ports.sessionId))), before); assert.deepEqual(f.calls, calls);
});

for (const [name, change, code] of [
  ['capability missing', f => { f.settings.rule.authority.root.capabilities = ['asset.revoke', 'host.activate']; }, 'EFK_AUTHORITY_DENIED'],
  ['expired', f => f.setNow(1000), 'EFK_GRANT_EXPIRED'],
  ['revoked', f => { f.settings.rule.authority.revokedEpoch = 1; }, 'EFK_GRANT_REVOKED'],
]) test(`cp3 cancellation ${name} after monitoring cannot dispatch with stale authority`, async () => {
  const f = await dispatchedFixture(), record = unwrap(await f.revocation.monitor(f.request())); change(f);
  const pending = unwrap(await f.revocation.recover(record.requestId));
  assert.equal(pending.status, 'pending'); assert.equal(pending.error.code, code);
  assert.equal(pending.cancellations[0].status, 'needed'); assert.equal(f.calls.cancel, 0);
  assert.equal(unwrap(await f.ordinary()).receipt.status, 'completed');
});

test('cp3 private learning failure details never enter ordinary task feedback', async () => {
  const f = await revocationFixture();
  f.ports.journal.exportSession = () => storeFail('EFK_ARTIFACT_UNAVAILABLE', 'SECRET_FINAL_FEEDBACK', ['final-private-id']);
  const view = unwrap(await f.ordinary()).view;
  assert.equal(view.evolutionError.code, 'EFK_ARTIFACT_UNAVAILABLE');
  assert.ok(!canonical(view).includes('SECRET_FINAL_FEEDBACK')); assert.ok(!canonical(view).includes('final-private-id'));
  assert.deepEqual(view.evolutionError.refs, []);
});

test('cp3 actual not-executed reconciliation cancels promotion without a fabricated activation or redundant rollback', async () => {
  const f = await revocationFixture(); const safe = await f.activate(await f.promote(1)), candidate = await f.promote(2);
  const execute = f.ports.host.execute;
  f.ports.host.execute = async () => { f.calls.execute++; return storeFail('EFK_EFFECT_UNKNOWN', 'disconnect before host invocation'); };
  denied(await f.service.activate({ promotionId: candidate.promotionId, effect: f.effect(candidate) }), 'EFK_EFFECT_UNKNOWN');
  f.ports.host.execute = execute;
  f.ports.host.reconcile = async ({ targetIds }) => { f.calls.reconcile++; return { ok: true,
    value: targetIds.map(effectId => ({ effectId, verdict: 'not-executed', receipt: null, error: null })) }; };
  const record = unwrap(await f.revocation.monitor(f.request()));
  const complete = unwrap(await f.revocation.recover(record.requestId));
  assert.equal(complete.status, 'complete'); assert.equal(complete.cancellations[0].status, 'settled');
  assert.equal(f.artifacts.get(complete.cancellations[0].reconciliationRef).ok, true);
  const stopped = f.state().promotions.find(r => r.promotionId === candidate.promotionId);
  assert.equal(stopped.status, 'failed'); assert.equal(stopped.activation, null); assert.equal(stopped.activationRef, null);
  assert.equal(unwrap(f.ports.journal.outbox(f.ports.sessionId)).entries.at(-1).resolvedStatus, 'not-executed');
  assert.deepEqual(f.pointer().snapshot, safe.activation.newSnapshot); assert.equal(f.calls.execute, 2);
  assert.equal(f.state().promotions.filter(r => r.mode === 'rollback').length, 0);
});

test('cp3 contradictory no-execution outcome cannot erase a real activation receipt', async () => {
  const f = await dispatchedFixture(), record = unwrap(await f.revocation.monitor(f.request()));
  f.ports.host.reconcile = async ({ targetIds }) => ({ ok: true, value: targetIds.map(effectId => ({
    effectId, verdict: 'not-executed', receipt: f.receipts.get(effectId), error: null })) });
  const pending = unwrap(await f.revocation.recover(record.requestId));
  assert.equal(pending.status, 'pending'); assert.equal(pending.error.code, 'EFK_ARTIFACT_BINDING_MISMATCH');
  assert.equal(f.state().promotions.find(r => r.promotionId === f.candidate.promotionId).status, 'pending');
  assert.equal(f.calls.execute, 2); assert.equal(f.artifacts.get(pending.cancellations[0].reconciliationRef).ok, true);
});

test('cp3 construction calls no injected port, clock, policy, store or host', async () => {
  const f = await revocationFixture();
  const forbid = new Proxy({}, { get() { return () => { throw new Error('constructor I/O'); }; } });
  assert.doesNotThrow(() => createRevocationService({ promotion: { ...f.ports, journal: forbid, host: forbid, clock: forbid,
    policy: forbid, registry: { ...f.registryPorts, artifacts: forbid, digest: forbid } }, monitorIssuer: f.revocationPorts.monitorIssuer,
    signalInventory: forbid.call, verifySignal: forbid.call, policy: forbid.call, restoreEffect: forbid.call }));
});
