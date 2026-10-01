import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as scheduler from '../dist/kernel/scheduler/index.js';
import {
  bindingFor, branchFacts, compiled, factsOf, independentSpec, joinSpec,
  plainSpec, roundInput, soloWriterSpec,
} from './l2-scheduler-fixtures.mjs';

const dispatched = (round) => round.decisions.filter((d) => d.verdict === 'dispatch').map((d) => d.nodeId);
const reportOf = (input, round) => scheduler.progress({
  graph: input.graph, facts: input.facts, state: round.state, now: input.now, round,
});

test('B1 — resource-free claims without live leases are explicit stalls', () => {
  const first = scheduler.dispatchRound(roundInput(plainSpec(), { maxConcurrentAgents: 3 }));
  for (const now of [1000, 10_000_000]) {
    const input = roundInput(plainSpec(), { state: first.state, now });
    const round = scheduler.dispatchRound(input);
    const report = reportOf(input, round);
    assert.equal(report.status, 'stalled');
    assert.equal(report.stalls.length, 3);
    for (const stall of report.stalls) {
      assert.equal(stall.reason, 'claim-without-lease');
      assert.deepEqual(stall.blockedBy, [stall.nodeId]);
      assert.match(stall.detail, /no live lease/);
    }
  }
  const input = roundInput(plainSpec(), { maxConcurrentAgents: 3 });
  assert.equal(reportOf(input, scheduler.dispatchRound(input)).status, 'stalled');
});

test('B1 — a lease from another epoch is not a claim liveness signal', () => {
  const first = scheduler.dispatchRound(roundInput(soloWriterSpec()));
  const state = {
    ...first.state,
    claims: first.state.claims.map((c) => ({ ...c, binding: { ...c.binding, epoch: 2 } })),
  };
  const input = roundInput(soloWriterSpec(), { state, now: 1050 });
  const report = reportOf(input, scheduler.dispatchRound(input));
  assert.equal(report.status, 'stalled');
  assert.equal(report.stalls[0].reason, 'claim-without-lease');
});

test('M1 — reclaim preserves any matching live lease and the identical state', () => {
  assert.equal(typeof scheduler.reclaimExpiredClaims, 'function');
  const first = scheduler.dispatchRound(roundInput(soloWriterSpec()));
  const extra = scheduler.grantLease(first.state.leases, {
    resourceId: 'other', ownerClaimId: 'nW1-a1', epoch: 1,
    mode: 'exclusive', maxHolders: 1, ttlMs: 500,
  }, 1000);
  const state = { ...first.state, leases: extra.table };
  const result = scheduler.reclaimExpiredClaims(state, 1100);
  assert.equal(result.verdict, 'unchanged');
  assert.equal(result.state, state);
  assert.deepEqual(result.reclaimed, []);
  assert.deepEqual(result.retained, state.claims);
  const pair = scheduler.dispatchRound(roundInput(independentSpec()));
  const mixed = { ...pair.state, leases: {
    ...pair.state.leases,
    grants: pair.state.leases.grants.map((grant) => grant.ownerClaimId === 'nB-a1'
      ? { ...grant, expiresAt: 1500 } : grant),
  } };
  const partial = scheduler.reclaimExpiredClaims(mixed, 1100);
  assert.deepEqual(partial.reclaimed.map((c) => c.claimId), ['nA-a1']);
  assert.deepEqual(partial.retained.map((c) => c.claimId), ['nB-a1']);
  assert.equal(partial.state.leases, mixed.leases);
});

test('M1 — reclaim expires dead claims, preserves lease history and enables a new attempt', () => {
  assert.equal(typeof scheduler.reclaimExpiredClaims, 'function');
  const first = scheduler.dispatchRound(roundInput(soloWriterSpec()));
  const receipt = {
    receiptId: 'old', lease: first.decisions[0].leases[0], binding: bindingFor('nW1'),
  };
  const reclaimed = scheduler.reclaimExpiredClaims(first.state, 1100);
  assert.equal(reclaimed.verdict, 'reclaimed');
  assert.deepEqual(reclaimed.reclaimed.map((c) => c.claimId), ['nW1-a1']);
  assert.deepEqual(reclaimed.retained, []);
  assert.equal(reclaimed.state.revision, first.state.revision + 1);
  assert.equal(reclaimed.state.leases, first.state.leases);
  assert.equal(first.state.claims.length, 1);
  assert.equal(scheduler.reclaimExpiredClaims(reclaimed.state, 1100).state, reclaimed.state);
  const next = scheduler.dispatchRound(roundInput(soloWriterSpec(), {
    state: reclaimed.state, budget: first.budget, now: 1100,
    bindingFor: (id) => bindingFor(id, { attemptOrdinal: 2 }),
  }));
  assert.deepEqual(dispatched(next), ['nW1']);
  assert.equal(next.state.claims[0].binding.attemptOrdinal, 2);
  assert.equal(next.budget.reservations.length, 2); // Unknown usage is still reserved.
  const stale = scheduler.applyLeaseReceipt(next.state, receipt, 1100);
  assert.equal(stale.verdict, 'stale');
  assert.equal(stale.state, next.state);
});

test('M1 — reclaim also retires claims that never held a lease', () => {
  assert.equal(typeof scheduler.reclaimExpiredClaims, 'function');
  const first = scheduler.dispatchRound(roundInput(plainSpec()));
  const reclaimed = scheduler.reclaimExpiredClaims(first.state, 1000);
  assert.equal(reclaimed.reclaimed.length, 2);
  assert.equal(reclaimed.state.claims.length, 0);
});

test('M1 m3 — dead claims release concurrency before explicit reclamation', () => {
  const first = scheduler.dispatchRound(roundInput(independentSpec(), { maxConcurrentAgents: 1 }));
  for (const state of [first.state, { ...first.state, leases: scheduler.emptyLeaseTable() }]) {
    const input = roundInput(independentSpec(), { state, now: 1100, maxConcurrentAgents: 1 });
    const later = scheduler.dispatchRound(input);
    assert.deepEqual(dispatched(later), ['nB']);
    assert.equal(reportOf(input, later).status, 'dispatchable');
    assert.equal(reportOf(input, later).stalls[0].nodeId, 'nA');
  }
  const input = roundInput(independentSpec(), { state: first.state, now: 1050, maxConcurrentAgents: 1 });
  const blocked = scheduler.dispatchRound(input);
  assert.deepEqual(dispatched(blocked), []);
  assert.equal(blocked.decisions[0].reasons[0].code, 'concurrency-limit');
  assert.equal(reportOf(input, blocked).status, 'dispatchable');
});

test('m1 — runtime capacity contention is a typed non-error and expires normally', () => {
  const request = {
    resourceId: 'R', ownerClaimId: 'one', epoch: 1,
    mode: 'exclusive', maxHolders: 1, ttlMs: 100,
  };
  const held = scheduler.grantLease(scheduler.emptyLeaseTable(), request, 1000);
  const blocked = scheduler.grantLease(held.table, { ...request, ownerClaimId: 'two' }, 1050);
  assert.equal(blocked.verdict, 'capacity');
  assert.equal(blocked.error, null);
  assert.equal(blocked.grant, null);
  assert.equal(blocked.table, held.table);
  assert.match(blocked.detail, /1 live holder.*maxHolders is 1/);
  assert.equal(scheduler.grantLease(held.table, { ...request, ownerClaimId: 'two' }, 1100).verdict, 'granted');
});

test('m2 — claim uniqueness is the session node ordinal epoch tuple', () => {
  const first = scheduler.claimNode(scheduler.emptyState(), bindingFor('nA'), 1000, 0);
  for (const overrides of [{ attemptOrdinal: 2 }, { epoch: 2 }, { sessionId: 's-2' }]) {
    const next = scheduler.claimNode(first.state, bindingFor('nA', overrides), 1000, 1);
    assert.equal(next.error, null);
    assert.equal(next.state.claims.length, 2);
  }
  const duplicate = scheduler.claimNode(first.state, bindingFor('nA', { attemptId: 'alias' }), 1000, 1);
  assert.equal(duplicate.error.code, 'EFK_CLAIM_CONFLICT');
  assert.equal(duplicate.state, first.state);
});

test('m3 — settled and removed claims consume no concurrency', () => {
  const first = scheduler.dispatchRound(roundInput(independentSpec(), { maxConcurrentAgents: 1 }));
  const removed = scheduler.claimFor(bindingFor('removed'), 1000);
  const extra = scheduler.grantLease(first.state.leases, {
    resourceId: 'gone', ownerClaimId: removed.claimId, epoch: 1,
    mode: 'exclusive', maxHolders: 1, ttlMs: 100,
  }, 1000);
  const input = roundInput(independentSpec(), {
    state: scheduler.recordClaim({ ...first.state, leases: extra.table }, removed),
    facts: factsOf({ states: { nA: 'succeeded' } }), maxConcurrentAgents: 1,
  });
  const round = scheduler.dispatchRound(input);
  assert.deepEqual(dispatched(round), ['nB']);
  assert.equal(reportOf(input, round).status, 'dispatchable');
});

test('m3 — an active journal state without a live claim requires reconciliation', () => {
  const input = roundInput(soloWriterSpec(), { facts: factsOf({ states: { nW1: 'running' } }) });
  const round = scheduler.dispatchRound(input);
  assert.deepEqual(round.decisions, []);
  const report = reportOf(input, round);
  assert.equal(report.status, 'stalled');
  assert.equal(report.stalls[0].reason, 'reconcile-required');
});

test('m4 — multiple claims classify identically in either array order', () => {
  const first = scheduler.dispatchRound(roundInput(soloWriterSpec()));
  const newer = scheduler.claimFor(bindingFor('nW1', { attemptOrdinal: 2 }), 1100);
  const leased = scheduler.grantLease(first.state.leases, {
    resourceId: 'integrationWriter', ownerClaimId: newer.claimId, epoch: 1,
    mode: 'exclusive', maxHolders: 1, ttlMs: 100,
  }, 1100);
  for (const now of [1150, 1200]) {
    const reports = [
      [first.state.claims[0], newer], [newer, first.state.claims[0]],
    ].map((claims) => {
      const input = roundInput(soloWriterSpec(), { state: { ...first.state, claims, leases: leased.table }, now });
      return reportOf(input, scheduler.dispatchRound(input));
    });
    assert.deepEqual(reports[0], reports[1]);
    assert.equal(reports[0].status, now === 1150 ? 'dispatchable' : 'stalled');
    assert.equal(reports[0].stalls.length, now === 1150 ? 1 : 2);
  }
});

test('m5 — an unknown join branch requires reconciliation using branch evidence', () => {
  for (const nodeState of ['unknown', 'succeeded']) {
    const facts = factsOf({
      states: { nA: 'succeeded', nB: nodeState, nC: 'succeeded' },
      branches: { nA: branchFacts('succeeded'), nB: branchFacts('unknown'), nC: branchFacts('succeeded') },
    });
    const input = roundInput(joinSpec(), { facts });
    const report = reportOf(input, scheduler.dispatchRound(input));
    const join = report.stalls.find((s) => s.nodeId === 'nJ');
    assert.equal(report.status, 'stalled');
    assert.equal(join.reason, 'reconcile-required');
    assert.deepEqual(join.blockedBy, ['nB']);
  }
});

test('n1 — unknown resource nodes and missing policies fail closed', () => {
  const graph = compiled(soloWriterSpec());
  assert.throws(() => scheduler.declarationsOf(graph, 'absent'), (error) => {
    assert.equal(error.code, 'EFK_GRAPH_REFERENCE_INVALID');
    return true;
  });
  assert.throws(() => scheduler.declarationsOf({ ...graph, resourcePolicy: new Map() }, 'nW1'), (error) => {
    assert.equal(error.code, 'EFK_INVARIANT_VIOLATION');
    return true;
  });
  assert.deepEqual(scheduler.declarationsOf(compiled(plainSpec()), 'nFirst'), []);
});

test('n2 — capacity diagnostics have no unreachable fallback', () => {
  const source = readFileSync(new URL('../src/kernel/scheduler/dispatch.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /detail:\s*attempt\.[^\n]*\?\?/);
  const round = scheduler.dispatchRound(roundInput({
    ...soloWriterSpec(), nodes: [
      soloWriterSpec().nodes[0], { ...soloWriterSpec().nodes[0], nodeId: 'nW2' },
    ],
  }));
  assert.match(round.decisions[1].reasons[0].detail, /maxHolders is 1/);
});

test('n3 — missing branch facts are rejected while an explicit empty map is a gap', () => {
  const facts = factsOf();
  delete facts.branches;
  const graph = compiled(joinSpec());
  for (const action of [
    () => scheduler.joinGate(graph, facts, 'nJ'),
    () => scheduler.dispatchRound(roundInput(joinSpec(), { facts })),
  ]) {
    assert.throws(action, (error) => {
      assert.equal(error.code, 'EFK_INVARIANT_VIOLATION');
      assert.match(error.message, /branch facts/);
      return true;
    });
  }
  const gate = scheduler.joinGate(graph, factsOf(), 'nJ');
  assert.equal(gate.status, 'waiting');
  assert.deepEqual(gate.missing, ['nA', 'nB', 'nC']);
});

test('n4 — fairness prunes settled nodes and retains outstanding waiters', () => {
  const fairness = { deferStreak: { done: 8, waiting: 4 }, dispatches: { done: 7, waiting: 1 } };
  const next = scheduler.advanceFairness(fairness, [], [], ['waiting']);
  assert.deepEqual(next, { deferStreak: { waiting: 4 }, dispatches: { waiting: 1 } });
  assert.equal(fairness.dispatches.done, 7);
  const input = roundInput(plainSpec(), {
    fairness,
    facts: factsOf({ states: { nFirst: 'succeeded', nX: 'succeeded', nY: 'cancelled' } }),
  });
  assert.deepEqual(scheduler.dispatchRound(input).fairness, scheduler.emptyFairness());
});
