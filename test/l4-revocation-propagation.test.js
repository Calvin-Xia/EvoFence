import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, storeFail } from '../dist/kernel/store/index.js';
import { qualification } from '../dist/learning/assets/index.js';
import { createPromotionService } from '../dist/learning/promotion/index.js';
import { createRevocationService } from '../dist/evaluation/revocation/index.js';
import { revocationFixture, unwrap, denied } from './l4-revocation-fixtures.test.js';

test('DoD2 propagates through staged derivatives and restores the exact verified snapshot, skipping invalid previous', async () => {
  const f = await revocationFixture({ count: 5, dependencies: { 3: [2], 4: [3], 5: [2] }, staged: [4] });
  const safe = await f.activate(await f.promote(1));
  const badPrevious = await f.activate(await f.promote(2));
  const current = await f.activate(await f.promote(3));
  await f.promote(5);
  const before = f.state(), originalHistory = canonical(before.registry.history);
  const record = unwrap(await f.revocation.monitor(f.request()));
  assert.deepEqual(record.affected.map(a => a.revision), [2, 3, 4, 5]);
  for (const asset of record.affected) {
    const q = unwrap(qualification(f.state().registry, asset, f.context));
    assert.equal(q.eligible, false); assert.equal(q.usable, false); assert.equal(q.state, 'revoked');
  }
  assert.equal(canonical(f.state().registry.history.slice(0, before.registry.history.length)), originalHistory);
  assert.equal(f.state().registry.revisions.length, before.registry.revisions.length);
  assert.equal(f.state().promotions.find(p => p.asset.revision === 5).status, 'failed');
  assert.deepEqual(record.restores[0].targetSnapshot, safe.activation.newSnapshot);
  assert.notDeepEqual(record.restores[0].targetSnapshot, badPrevious.activation.newSnapshot);
  assert.deepEqual(f.pointer().snapshot, current.activation.newSnapshot);
  const evidence = JSON.parse(unwrap(f.artifacts.get(record.evidenceRef)));
  assert.deepEqual(evidence.affected, record.affected); assert.equal(evidence.signalRefs.length, 1);
  const recovered = unwrap(await f.revocation.recover(record.requestId));
  assert.equal(recovered.status, 'complete'); assert.equal(recovered.error, null);
  assert.deepEqual(f.pointer().snapshot, safe.activation.newSnapshot);
  assert.deepEqual(f.revocation.ordinaryView(f.context).versions.map(v => v.asset.revision), [1]);
  assert.equal(f.calls.execute, 4); assert.equal(f.calls.cancel, 0);
  for (const event of f.state().registry.history.filter(e => e.state === 'revoked')) assert.deepEqual(event.evidenceRef, record.evidenceRef);
  for (const ref of [...before.registry.revisions.flatMap(r => r.candidate.contentRefs), safe.activation.newSnapshot,
    badPrevious.activation.newSnapshot, current.activation.newSnapshot, record.evidenceRef]) assert.equal(f.artifacts.get(ref).ok, true);
});

test('cp2 cancels committed unclaimed intentions atomically and leaves no sendable staged residue', async () => {
  const f = await revocationFixture({ count: 3, dependencies: { 3: [2] } });
  await f.activate(await f.promote(1)); await f.activate(await f.promote(2));
  const derivative = await f.promote(3), dispatch = f.ports.journal.dispatchEffect;
  f.ports.journal.dispatchEffect = () => storeFail('EFK_REVISION_CONFLICT', 'dispatch failure');
  denied(await f.service.activate({ promotionId: derivative.promotionId, effect: f.effect(derivative) }), 'EFK_REVISION_CONFLICT');
  f.ports.journal.dispatchEffect = dispatch;
  const record = unwrap(await f.revocation.monitor(f.request()));
  assert.equal(record.cancellations[0].status, 'not-executed');
  const outbox = unwrap(f.ports.journal.outbox(f.ports.sessionId));
  assert.equal(outbox.entries.at(-1).state, 'resolved'); assert.equal(outbox.entries.at(-1).resolvedStatus, 'not-executed');
  assert.deepEqual(unwrap(f.ports.journal.nextEffects(f.ports.sessionId)), []);
  assert.equal(f.state().promotions.find(p => p.promotionId === derivative.promotionId).status, 'failed');
  const last = unwrap(f.ports.journal.exportSession(f.ports.sessionId));
  const transaction = last.events.filter(e => e.revision === last.revision);
  assert.equal(transaction.filter(e => e.type === 'asset.transition').length, 2);
  assert.equal(transaction.filter(e => e.type === 'receipt.applied').length, 1);
  assert.equal(last.receipts.at(-1).hostInvocationId, null);
  assert.deepEqual(last.receipts.at(-1).observability, ['journal-unclaimed-intention']);
  assert.equal(f.calls.execute, 2); assert.equal(f.calls.cancel, 0);
  unwrap(await f.revocation.recover(record.requestId)); assert.equal(f.pointer().active.revision, 1);
});

test('cp2 dispatched derivative is cancelled, reconciled as actually applied, then compensated', async () => {
  const f = await revocationFixture({ count: 3, dependencies: { 3: [2] } });
  const safe = await f.activate(await f.promote(1)); await f.activate(await f.promote(2));
  const derivative = await f.promote(3), apply = f.ports.journal.applyReceipt;
  f.ports.journal.applyReceipt = () => storeFail('EFK_REVISION_CONFLICT', 'receipt commit fault');
  denied(await f.service.activate({ promotionId: derivative.promotionId, effect: f.effect(derivative) }), 'EFK_REVISION_CONFLICT');
  f.ports.journal.applyReceipt = apply;
  const record = unwrap(await f.revocation.monitor(f.request()));
  assert.equal(record.cancellations[0].status, 'needed');
  const originalCancel = f.ports.host.cancel;
  f.ports.host.cancel = request => {
    assert.equal(unwrap(f.revocation.inspect())[0].cancellations[0].status, 'requested');
    assert.deepEqual(request.targetIds, [f.effect(derivative).effectId]);
    return originalCancel(request);
  };
  const recovered = unwrap(await f.revocation.recover(record.requestId));
  assert.equal(recovered.status, 'complete'); assert.equal(recovered.cancellations[0].status, 'settled');
  assert.equal(f.calls.cancel, 1); assert.equal(f.calls.reconcile, 1); assert.equal(f.calls.execute, 4);
  const applied = f.state().promotions.find(p => p.promotionId === derivative.promotionId);
  assert.equal(applied.status, 'applied-unqualified'); assert.equal(applied.activation.actualStatus, 'active');
  assert.deepEqual(f.pointer().snapshot, safe.activation.newSnapshot);
  assert.equal(f.artifacts.get(recovered.cancellations[0].outcomeRef).ok, true);
});

test('cp2 failed rollback retains actual current snapshot and revocation evidence', async () => {
  const f = await revocationFixture(); await f.activate(await f.promote(1));
  const current = await f.activate(await f.promote(2));
  const record = unwrap(await f.revocation.monitor(f.request())); f.settings.outcome = 'failed';
  const pending = unwrap(await f.revocation.recover(record.requestId));
  assert.equal(pending.status, 'pending'); assert.equal(pending.error.code, 'EFK_ACTIVATION_UNCONFIRMED');
  assert.deepEqual(f.pointer().snapshot, current.activation.newSnapshot);
  assert.equal(f.artifacts.get(record.evidenceRef).ok, true); assert.deepEqual(f.revocation.ordinaryView(f.context).versions, []);
});

test('cp2 no verified eligible snapshot stays pending without fabricating a fallback', async () => {
  const f = await revocationFixture(); const current = await f.activate(await f.promote(2));
  const record = unwrap(await f.revocation.monitor(f.request()));
  assert.equal(record.restores[0].targetPromotionId, null);
  const pending = unwrap(await f.revocation.recover(record.requestId));
  assert.equal(pending.status, 'pending'); assert.equal(pending.error.code, 'EFK_ASSET_QUALIFICATION_INVALID');
  assert.deepEqual(f.pointer().snapshot, current.activation.newSnapshot); assert.equal(f.calls.execute, 1);
});

test('cp2 rollback revalidates the recorded target after a subsequent revocation', async () => {
  const f = await revocationFixture(); const safe = await f.activate(await f.promote(1)); await f.activate(await f.promote(2));
  const record = unwrap(await f.revocation.monitor(f.request()));
  const evidenceRef = f.artifact('target later invalidated', 'RevocationEvidence', { producer: f.registryPorts.issuers.revocation });
  unwrap(await f.service.revoke({ asset: safe.asset, evidenceRef, authorizationRef: 'host-grant', at: 20 }, 'preauthorized', f.context));
  const pending = unwrap(await f.revocation.recover(record.requestId));
  assert.equal(pending.status, 'pending'); assert.equal(f.calls.execute, 2); assert.deepEqual(f.revocation.ordinaryView(f.context).versions, []);
});

test('cp2 CAS fault publishes no revoked projection and issues no host operation', async () => {
  const f = await revocationFixture(); await f.activate(await f.promote(2));
  const before = canonical(f.state()), append = f.ports.journal.append;
  f.ports.journal.append = () => storeFail('EFK_REVISION_CONFLICT', 'initial revocation CAS fault');
  denied(await f.revocation.monitor(f.request()), 'EFK_REVISION_CONFLICT');
  f.ports.journal.append = append;
  assert.equal(canonical(f.state()), before); assert.deepEqual(unwrap(f.revocation.inspect()), []);
  assert.equal(f.calls.execute, 1); assert.equal(f.calls.cancel, 0);
});

test('cp2 revocation replay is stable and changed-content identity is refused', async () => {
  const f = await revocationFixture(), input = f.request();
  const original = unwrap(await f.revocation.monitor(input));
  const revision = unwrap(f.ports.journal.exportSession(f.ports.sessionId)).revision;
  assert.deepEqual(unwrap(await f.revocation.monitor(input)), original);
  assert.equal(unwrap(f.ports.journal.exportSession(f.ports.sessionId)).revision, revision);
  denied(await f.revocation.monitor({ ...input, asset: f.revisions[0].candidate.asset }), 'EFK_IDEMPOTENCY_COLLISION');
});

test('cp2 promotion service cannot reactivate a cancelled derivative', async () => {
  const f = await revocationFixture(); const promotion = await f.promote(2);
  unwrap(await f.revocation.monitor(f.request()));
  assert.equal(unwrap(await createPromotionService(f.ports).reconcile(promotion.promotionId)).status, 'failed');
  denied(await f.service.activate({ promotionId: promotion.promotionId, effect: f.effect(promotion) }), 'EFK_REVISION_CONFLICT');
  assert.equal(f.calls.execute, 0);
});

test('cp2 service construction and same complete recovery do no external operations', async () => {
  const f = await revocationFixture(), before = { ...f.calls };
  createRevocationService(f.revocationPorts); assert.deepEqual(f.calls, before);
  const record = unwrap(await f.revocation.monitor(f.request()));
  assert.equal(record.status, 'complete');
  const revision = unwrap(f.ports.journal.exportSession(f.ports.sessionId)).revision;
  assert.deepEqual(unwrap(await f.revocation.recover(record.requestId)), record);
  assert.equal(unwrap(f.ports.journal.exportSession(f.ports.sessionId)).revision, revision);
});
