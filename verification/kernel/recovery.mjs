import assert from 'node:assert/strict';
import { harness, value, canonical, usage } from './harness.mjs';
import { graph, node, digest } from './fixtures.mjs';
import { planOnly } from './faults.mjs';
export async function crashBefore() {
  const h = harness('crash-before');
  h.start();
  const append = h.ports.store.append;
  h.ports.store.append = request => {
    if (request.effects.length !== 0) throw new Error('verification-crash-before-commit');
    return append(request);
  };
  await assert.rejects(h.step(), /verification-crash-before-commit/);
  const s = h.checkpoint('crash-before-intention-commit');
  assert.equal(s.intents.length, 0);
  assert.equal(s.budget.requestCount, 0);
  assert.equal(h.calls.execute, 0);
  h.restart();
  value(await h.step());
  assert.equal(h.calls.execute, 1);
  assert.equal(h.read().nodeStates[0].state, 'verifying');
  h.checkpoint('safe-restart-plans-once');
  return h.finish();
}
export async function crashAfter() {
  const h = harness('crash-after');
  h.start();
  const execute = h.ports.host.execute;
  let once = true;
  h.ports.host = { ...h.ports.host, execute: async authorized => {
    const receipt = await execute(authorized);
    if (once) { once = false; throw new Error('verification-crash-after-native-execution-before-ack'); }
    return receipt;
  } };
  await assert.rejects(h.step(), /verification-crash-after-native-execution-before-ack/);
  const effect = h.effect('work');
  const crashed = h.checkpoint('committed-claim-lost-ack');
  assert.deepEqual(crashed.unknownEffectIds, [effect.effectId]);
  assert.equal(crashed.nodeStates[0].state, 'leased');
  assert.equal(crashed.budget.reservations.length, 1);
  assert.equal(crashed.budget.settlements.length, 0);
  h.restart();
  value(await h.step());
  assert.equal(h.calls.execute, 1, 'unknown must never be resent on restart');
  const unresolved = value(await h.service.reconcile(h.seed.sessionId));
  assert.deepEqual(unresolved.unknown, [effect.effectId]);
  assert.equal(h.read().budget.reservations.length, 1);
  h.checkpoint('reconcile-without-evidence-stays-unknown');
  h.script.reconcile[effect.effectId] = 'completed';
  const resolved = value(await h.service.reconcile(h.seed.sessionId));
  assert.deepEqual(resolved.resolved, [effect.effectId]);
  assert.deepEqual(resolved.unknown, []);
  const after = h.checkpoint('actual-fake-host-receipt-reconciled');
  assert.equal(after.nodeStates[0].state, 'verifying');
  assert.equal(after.budget.reservations.length, 0);
  assert.equal(after.budget.settlements[0].micros, 37);
  assert.equal(h.calls.execute, 1);
  return h.finish();
}
export async function crashIntended() {
  const h = harness('crash-intended');
  h.start();
  const append = h.ports.store.append;
  h.ports.store.append = request => {
    const committed = append(request);
    if (request.effects.length !== 0 && committed.ok) throw new Error('verification-crash-after-commit-before-claim');
    return committed;
  };
  await assert.rejects(h.step(), /verification-crash-after-commit-before-claim/);
  const s = h.checkpoint('commit-done-dispatch-not-started');
  assert.equal(s.intents.length, 1);
  assert.equal(s.outbox.entries[0].state, 'intended');
  assert.equal(s.budget.reservations.length, 1);
  assert.equal(h.calls.execute, 0);
  h.restart();
  value(await h.step());
  assert.equal(h.calls.execute, 1);
  assert.equal(h.read().budget.requestCount, 1);
  h.checkpoint('unclaimed-intention-dispatched-once');
  return h.finish();
}
export async function epoch() {
  const h = harness('epoch', { automaticUsage: false });
  h.start();
  const execute = h.ports.host.execute;
  h.ports.host = { ...h.ports.host, execute: async a => { h.script.outcomes[a.effect.effectId] = 'unknown'; return execute(a); } };
  value(await h.step());
  const effect = h.effect('work');
  value(h.service.pause(h.seed.sessionId, { commandId: 'pause-for-recovery', expectedRevision: h.read().revision, reason: 'recovery' }));
  const manifestRef = { ...h.persisted('manifest', 'HostManifest', {}), digest: h.seed.graphRef.digest };
  value(h.service.resume(h.seed.sessionId, { commandId: 'resume-new-epoch', expectedRevision: h.read().revision, epoch: 2, manifestRef }));
  const before = h.checkpoint('resume-keeps-old-unknown');
  assert.equal(before.epoch, 2);
  const receipt = h.receipt(effect, { usage: [usage(effect.reservationRef)] });
  assert.equal(value(h.service.receive(h.seed.sessionId, receipt)).disposition, 'archived');
  const after = h.checkpoint('old-epoch-receipt-archived');
  assert.equal(canonical(after.nodeStates), canonical(before.nodeStates));
  assert.equal(canonical(after.budget), canonical(before.budget));
  assert.deepEqual(after.unknownEffectIds, before.unknownEffectIds);
  assert.deepEqual(after.archivedReceiptIds, [receipt.receiptId]);
  const revision = after.revision;
  assert.equal(value(h.service.receive(h.seed.sessionId, receipt)).disposition, 'duplicate');
  assert.equal(h.read().revision, revision);
  h.restart();
  value(await h.step());
  assert.equal(h.calls.execute, 1);
  h.checkpoint('old-epoch-no-reexecution-or-consumption');
  return h.finish();
}
export async function staleLease() {
  const h = harness('stale-lease', { spec: graph({ nodes: [node('work', { terminal: true,
    resources: { exclusive: ['writer'], shared: [] } })], resourcePolicy: [{ resourceId: 'writer', mode: 'exclusive', maxHolders: 1 }] }) });
  h.start();
  const { request } = planOnly(h);
  value(h.ports.store.append(request));
  h.checkpoint('intention-with-live-lease');
  const effect = h.effect('work');
  h.setNow(7000);
  h.recordError('expired-dispatch-lease', await h.step(), 'EFK_LEASE_STALE', { at: 7000, deadline: effect.deadline });
  assert.equal(h.calls.execute, 0);
  const late = h.receipt(effect, { usage: [usage(effect.reservationRef)] });
  assert.equal(value(h.service.receive(h.seed.sessionId, late)).disposition, 'archived');
  assert.equal(h.read().budget.settlements.length, 0);
  assert.equal(h.read().budget.reservations.length, 1);
  h.checkpoint('stale-lease-cannot-execute-or-settle');
  return h.finish();
}
export async function boundaryErrors() {
  const h = harness('boundary-errors');
  h.start();
  h.control.revokedEpoch = 1;
  h.recordError('revoked-root-at-scheduling', await h.step(), 'EFK_GRANT_REVOKED', { revokedEpoch: 1 });
  assert.equal(h.calls.execute, 0);
  assert.equal(h.effects().length, 0);
  h.control.revokedEpoch = 0;
  const malformed = { ...h.seed, sessionId: 'invalid', protocol: { namespace: 'evofence.runtime/1', schemaVersion: '9' }, epoch: 1 };
  h.recordError('unsupported-protocol', h.service.create(malformed), 'EFK_PROTOCOL_UNSUPPORTED', malformed.protocol);
  value(await h.step());
  h.control.forgedIssuer = true;
  h.recordError('forged-evaluator', await h.evaluate('work'), 'EFK_DECISION_AUTHORITY_DENIED', { issuer: 'forged-host' });
  assert.equal(h.read().nodeStates[0].state, 'verifying');
  h.control.forgedIssuer = false;
  const original = h.fake.receiptFor(h.effect('work').effectId);
  h.recordError('receipt-identity-changed', h.service.receive(h.seed.sessionId, { ...original, observability: ['different'] }),
    'EFK_IDEMPOTENCY_COLLISION', { receiptId: original.receiptId, observability: ['different'] });
  const exported = value(h.service.close(h.seed.sessionId));
  h.recordError('journal-sequence-gap', h.ports.snapshots.recover(h.seed.sessionId, exported.events.filter(e => e.sequence !== 1)),
    'EFK_RECOVERY_SEQUENCE_GAP', { removedSequence: 1 });
  h.control.boardOwners = [{ nodeId: 'work', attemptId: h.effect('work').binding.attemptId, ownerClaimId: 'shadow-owner' }];
  h.recordError('native-board-second-owner', await h.step(), 'EFK_HOST_BOARD_AUTHORITY_CONFLICT', h.control.boardOwners);
  h.control.boardOwners = [];
  const drifted = { ...h.seed, graphRef: { ...h.seed.graphRef, digest: digest.digest('different-seed') } };
  h.recordError('seed-source-pin-drift', h.service.create({ ...drifted, epoch: 1, protocol: exported.protocol }),
    'EFK_SOURCE_PIN_DRIFT', { digest: drifted.graphRef.digest });
  h.checkpoint('external-input-refusals-preserve-state');
  return h.finish();
}
