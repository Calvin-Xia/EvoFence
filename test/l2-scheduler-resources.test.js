/**
 * `l2_scheduler` — cp2: named resources, reader/writer clashes, and the budget linkage.
 *
 * Three claims are under test:
 *
 *   1. Two writers on disjoint scopes run together; two writers on one exclusive resource do not
 *      (the lease table, not a convention, is what serialises them).
 *   2. A shared resource is capped by `maxHolders`, and a lease granted under an older policy mode
 *      blocks a candidate that wants the new mode — the one clash a compiled graph cannot rule out,
 *      because a patch may change the mode while leases from the previous revision are still out.
 *   3. Dispatches reserve against **one** ledger and children hang off the same pool. The negative
 *      control recorded in the lane report reserves against the pristine input ledger each time,
 *      which drops `outstandingCount` to 1 and turns the first test red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { budgetSnapshot, reserve } from '../dist/kernel/policy/index.js';
import {
  dispatchRound,
  emptyLeaseTable,
  grantLease,
  liveGrants,
  settleDispatch,
} from '../dist/kernel/scheduler/index.js';
import { budgetLedger, independentSpec, roundInput, sharedQuotaSpec, writerContentionSpec } from './l2-scheduler-fixtures.mjs';

const dispatched = (round) => round.decisions.filter((entry) => entry.verdict === 'dispatch').map((entry) => entry.nodeId);

test('cp2 resources — independent writers run together on separate scopes', () => {
  const round = dispatchRound(roundInput(independentSpec(), { maxConcurrentAgents: 2 }));

  assert.deepEqual(dispatched(round), ['nA', 'nB']);
  assert.deepEqual(
    liveGrants(round.state.leases, 1000).map((grant) => [grant.resourceId, grant.ownerClaimId]),
    [
      ['scopeA', 'nA-a1'],
      ['scopeB', 'nB-a1'],
    ],
  );
  assert.equal(round.state.claims.length, 2);
});

test('cp2 resources — a shared resource is capped by its quota, not by exclusivity', () => {
  const round = dispatchRound(roundInput(sharedQuotaSpec(), { maxConcurrentAgents: 3 }));

  assert.deepEqual(dispatched(round), ['nR1', 'nR2']);
  assert.equal(round.decisions[2].verdict, 'defer');
  assert.equal(round.decisions[2].reasons[0].code, 'quota-full');
  assert.equal(liveGrants(round.state.leases, 1000).length, 2);
});

test('cp2 resources — a lease granted under the old policy mode blocks the new writer', () => {
  // The lease was handed out while `integrationWriter` was shared; the graph has since been
  // patched to make it exclusive. Check 7 validates the new spec, not the leases already out.
  const stale = grantLease(
    emptyLeaseTable(),
    {
      resourceId: 'integrationWriter',
      ownerClaimId: 'old-claim',
      epoch: 1,
      mode: 'shared',
      maxHolders: 4,
      ttlMs: 500,
    },
    1000,
  );
  assert.equal(stale.grant.mode, 'shared');

  const round = dispatchRound(
    roundInput(writerContentionSpec(), { state: { revision: 3, claims: [], leases: stale.table } }),
  );
  assert.deepEqual(dispatched(round), []);
  assert.equal(round.decisions[0].reasons[0].code, 'mode-conflict');
  assert.match(round.decisions[0].reasons[0].detail, /declared exclusive but held shared by old-claim/);
});

test('cp2 budget — two concurrent dispatches hold two reservations in one pool', () => {
  const ledger = budgetLedger();
  const round = dispatchRound(roundInput(independentSpec(), { budget: ledger, maxConcurrentAgents: 2 }));

  assert.deepEqual(round.state.claims.map((claim) => claim.claimId), ['nA-a1', 'nB-a1']);
  const snapshot = budgetSnapshot(round.budget);
  assert.equal(snapshot.outstandingCount, 2);
  assert.equal(snapshot.outstandingMicros, 2 * ledger.reservePerRequest);

  // A child request hangs off the parent reservation but is charged to the same pool.
  const child = reserve(round.budget, {
    requestId: 'nA-a1:review',
    role: 'reviewer',
    parentRequestId: round.decisions[0].reservationRef,
  });
  assert.equal(child.error, null);
  assert.equal(budgetSnapshot(child.ledger).outstandingCount, 3);
  assert.equal(budgetSnapshot(child.ledger).capMicros, ledger.capMicros);

  // The input ledger is untouched: the round returns a successor instead of mutating in place.
  assert.equal(budgetSnapshot(ledger).outstandingCount, 0);
});

test('cp2 budget — missing usage retains the reservation instead of settling at zero', () => {
  const round = dispatchRound(roundInput(independentSpec(), { maxConcurrentAgents: 1 }));
  const reservationRef = round.decisions[0].reservationRef;
  assert.equal(reservationRef, 'nA-a1');

  const missing = settleDispatch(round.budget, reservationRef, {
    micros: null,
    complete: false,
    digest: 'usage:none',
  });
  assert.equal(missing.error.code, 'EFK_USAGE_INCOMPLETE');
  assert.equal(missing.ledger, round.budget);
  assert.equal(budgetSnapshot(missing.ledger).outstandingCount, 1);

  const known = settleDispatch(round.budget, reservationRef, {
    micros: 321,
    complete: true,
    digest: 'usage:abc',
  });
  assert.equal(known.error, null);
  assert.equal(budgetSnapshot(known.ledger).outstandingCount, 0);
  assert.equal(budgetSnapshot(known.ledger).settledMicros, 321);
});

test('cp2 budget — a capped pool defers the second dispatch instead of over-reserving', () => {
  const ledger = budgetLedger({ maxRequests: 1, maxConcurrentRequests: 1 });
  const round = dispatchRound(roundInput(independentSpec(), { budget: ledger, maxConcurrentAgents: 2 }));

  assert.deepEqual(dispatched(round), ['nA']);
  assert.equal(round.decisions[1].verdict, 'defer');
  assert.equal(round.decisions[1].reasons[0].code, 'budget-exhausted');
  assert.equal(round.state.claims.length, 1);
  assert.equal(budgetSnapshot(round.budget).outstandingCount, 1);
});
