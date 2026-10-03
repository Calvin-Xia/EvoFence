/**
 * `l2_scheduler` — cp1: frontier, claim CAS, fencing and the two caps.
 *
 * The two DoD ① statements are exercised here: "同一资源不存在两个有效 writer" by racing two nodes
 * for the single integration writer, and "过期 lease 回包不改状态" by applying the *same* receipt
 * before and after the lease deadline. `assert.equal(next.state, state)` is the evidence — the stale
 * path returns the identical value, so no caller can observe a partial write.
 *
 * Negative controls are recorded in the lane report: dropping the capacity check in `grantLease`
 * turns "at most one live writer" red, and dropping the liveness match in `applyLeaseReceipt` turns
 * the expired-receipt test red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLeaseReceipt,
  claimNode,
  dispatchRound,
  emptyState,
  emptyLeaseTable,
  grantLease,
  liveGrants,
  releaseUnderLease,
  toLeaseRef,
} from '../dist/kernel/scheduler/index.js';
import {
  bindingFor,
  independentSpec,
  roundInput,
  writerContentionSpec,
} from './l2-scheduler-fixtures.mjs';

const dispatched = (round) => round.decisions.filter((entry) => entry.verdict === 'dispatch').map((entry) => entry.nodeId);

test('cp1 lease — an exclusive resource has at most one live writer', () => {
  const round = dispatchRound(roundInput(writerContentionSpec(), { now: 1000, leaseTtlMs: 100 }));

  assert.deepEqual(dispatched(round), ['nW1']);
  const loser = round.decisions.find((entry) => entry.nodeId === 'nW2');
  assert.equal(loser.verdict, 'defer');
  assert.equal(loser.reasons[0].code, 'writer-held');

  const live = liveGrants(round.state.leases, 1000);
  assert.deepEqual(
    live.map((grant) => [grant.resourceId, grant.ownerClaimId, grant.fencingToken, grant.expiresAt]),
    [['integrationWriter', 'nW1-a1', 1, 1100]],
  );
  // One claim, one lease, one owner id: the claim owns the lease it was granted under.
  assert.equal(round.state.claims.length, 1);
  assert.equal(round.state.claims[0].claimId, live[0].ownerClaimId);
});

test('cp1 claim — the CAS gate refuses a stale revision and a second claim', () => {
  const state = emptyState();
  const first = claimNode(state, bindingFor('nA'), 1000, 0);
  assert.equal(first.error, null);
  assert.equal(first.claim.claimId, 'nA-a1');
  assert.equal(first.state.revision, 1);

  const staleRevision = claimNode(first.state, bindingFor('nA'), 1000, 0);
  assert.equal(staleRevision.error.code, 'EFK_REVISION_CONFLICT');
  assert.equal(staleRevision.state, first.state);

  const duplicate = claimNode(first.state, bindingFor('nA'), 1000, 1);
  assert.equal(duplicate.error.code, 'EFK_CLAIM_CONFLICT');
  assert.equal(duplicate.claim, null);
  assert.equal(duplicate.state, first.state);
});

test('cp1 lease — an expired receipt changes nothing', () => {
  const round = dispatchRound(roundInput(writerContentionSpec(), { now: 1000, leaseTtlMs: 100 }));
  const receipt = {
    receiptId: 'r-1',
    lease: toLeaseRef(liveGrants(round.state.leases, 1000)[0]),
    binding: bindingFor('nW1'),
  };

  const inTime = applyLeaseReceipt(round.state, receipt, 1050);
  assert.equal(inTime.verdict, 'applied');
  assert.equal(inTime.state.claims.length, 0);
  assert.deepEqual(liveGrants(inTime.state.leases, 1050), []);

  const late = applyLeaseReceipt(round.state, receipt, 1200);
  assert.equal(late.verdict, 'stale');
  assert.equal(late.error.code, 'EFK_RECEIPT_STALE');
  assert.equal(late.state, round.state);
  assert.equal(late.state.revision, round.state.revision);
  assert.equal(late.state.claims.length, 1);
});

test('cp1 lease — a superseded fencing token and a bumped epoch are stale too', () => {
  const round = dispatchRound(roundInput(writerContentionSpec(), { now: 1000, leaseTtlMs: 100 }));
  const lease = toLeaseRef(liveGrants(round.state.leases, 1000)[0]);

  const bumpedEpoch = applyLeaseReceipt(
    round.state,
    { receiptId: 'r-2', lease: { ...lease, epoch: 2 }, binding: bindingFor('nW1', { epoch: 2 }) },
    1050,
  );
  assert.equal(bumpedEpoch.verdict, 'stale');

  const otherAttempt = applyLeaseReceipt(
    round.state,
    { receiptId: 'r-3', lease, binding: bindingFor('nW1', { attemptOrdinal: 2 }) },
    1050,
  );
  assert.equal(otherAttempt.verdict, 'stale');

  const otherFencing = applyLeaseReceipt(
    round.state,
    { receiptId: 'r-4', lease: { ...lease, fencingToken: 99 }, binding: bindingFor('nW1') },
    1050,
  );
  assert.equal(otherFencing.verdict, 'stale');
  assert.equal(otherFencing.state, round.state);
});

test('cp1 lease — a release is confirmed only by the live lease', () => {
  const round = dispatchRound(roundInput(writerContentionSpec(), { now: 1000, leaseTtlMs: 100 }));
  const lease = toLeaseRef(liveGrants(round.state.leases, 1000)[0]);

  const expired = releaseUnderLease(round.state.leases, lease, 1200);
  assert.equal(expired.error.code, 'EFK_CANCEL_UNCONFIRMED');
  assert.equal(expired.table, round.state.leases);

  const confirmed = releaseUnderLease(round.state.leases, lease, 1050);
  assert.equal(confirmed.error, null);
  assert.deepEqual(liveGrants(confirmed.table, 1050), []);
});

test('cp1 lease — capacity zero means the resource cannot be handed out', () => {
  const refused = grantLease(
    emptyLeaseTable(),
    { resourceId: 'workspaceRead', ownerClaimId: 'c-1', epoch: 1, mode: 'shared', maxHolders: 0, ttlMs: 100 },
    1000,
  );
  assert.equal(refused.grant, null);
  assert.equal(refused.verdict, 'capacity');
  assert.equal(refused.error, null);
  assert.equal(refused.table.grants.length, 0);
});

test('cp1 frontier — the concurrency and depth caps defer instead of being exceeded', () => {
  const capped = dispatchRound(roundInput(independentSpec(), { maxConcurrentAgents: 1 }));
  assert.deepEqual(
    capped.decisions.map((entry) => entry.verdict),
    ['dispatch', 'defer'],
  );
  assert.equal(capped.decisions[1].reasons[0].code, 'concurrency-limit');

  const deep = dispatchRound(roundInput(independentSpec(), { depth: 3, maxDepth: 3 }));
  assert.equal(deep.decisions.length, 2);
  assert.equal(
    deep.decisions.every((entry) => entry.verdict === 'defer' && entry.reasons[0].code === 'depth-limit'),
    true,
  );
  assert.equal(deep.state.claims.length, 0);
});
