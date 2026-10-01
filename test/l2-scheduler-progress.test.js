/**
 * `l2_scheduler` — cp3: fan-in completeness, cancellations, deadlock surfacing and fairness.
 *
 * DoD ② has two halves and both are decided here:
 *
 *   - "失败/取消分支不被遗漏": a join's branch report and the `missing` list keep a failed *and* a
 *     cancelled branch, in `requiredBranches` order. The listed negative control filters `missing`
 *     down to failed branches and turns that assertion red.
 *   - "不会等待已终止 worker 形成死锁": a wait whose blocker terminated with no declared cover is
 *     reported as `blocked-by-terminated-worker` while the graph is `stalled` — never softened into
 *     an open-ended wait, and never counted as in-flight work when its lease has expired. The
 *     negative control replaces that classification with `waiting-on-live-upstream`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dispatchRound,
  emptyState,
  joinGate,
  orderFrontier,
  progress,
} from '../dist/kernel/scheduler/index.js';
import {
  branchFacts,
  compiled,
  factsOf,
  joinSpec,
  plainSpec,
  roundInput,
  soloWriterSpec,
  uncoveredUpstreamSpec,
} from './l2-scheduler-fixtures.mjs';

const dispatched = (round) => round.decisions.filter((entry) => entry.verdict === 'dispatch').map((entry) => entry.nodeId);

const entry = (nodeId) => ({
  nodeId,
  kind: 'agent',
  state: 'pending',
  disposition: 'dispatchable',
  readiness: { state: 'ready' },
  claim: null,
});

function outstandingJoinFacts() {
  return factsOf({
    states: { nA: 'succeeded', nB: 'failed', nC: 'cancelled', nJ: 'pending' },
    branches: { nA: branchFacts('succeeded'), nB: branchFacts('failed'), nC: branchFacts('cancelled') },
  });
}

test('cp3 fan-in — an incomplete required fan-in is not ready, and no branch is filtered', () => {
  const spec = joinSpec();
  const graph = compiled(spec);
  const facts = outstandingJoinFacts();
  const round = dispatchRound(roundInput(spec, { facts }));

  assert.deepEqual(dispatched(round), []);
  const join = round.frontier.find((node) => node.nodeId === 'nJ');
  assert.equal(join.disposition, 'waiting');

  const gate = joinGate(graph, facts, 'nJ');
  assert.equal(gate.status, 'waiting');
  assert.deepEqual(gate.requiredBranches, ['nA', 'nB', 'nC']);
  assert.deepEqual(gate.missing, ['nB', 'nC']);
  assert.deepEqual(
    gate.branchReport.map((branch) => [branch.nodeId, branch.state]),
    [
      ['nA', 'succeeded'],
      ['nB', 'failed'],
      ['nC', 'cancelled'],
    ],
  );
});

test('cp3 fan-in — a completely succeeded fan-in releases the join', () => {
  const spec = joinSpec();
  const facts = factsOf({
    states: { nA: 'succeeded', nB: 'succeeded', nC: 'succeeded', nJ: 'pending' },
    branches: { nA: branchFacts('succeeded'), nB: branchFacts('succeeded'), nC: branchFacts('succeeded') },
  });

  assert.equal(joinGate(compiled(spec), facts, 'nJ').status, 'verifying');
  assert.deepEqual(dispatched(dispatchRound(roundInput(spec, { facts }))), ['nJ']);
});

test('cp3 deadlock — a wait on a terminated, uncovered upstream is reported, not hidden', () => {
  const spec = uncoveredUpstreamSpec();
  const graph = compiled(spec);
  const facts = factsOf({ states: { nWork: 'failed', nD: 'pending' } });
  const round = dispatchRound(roundInput(spec, { facts }));
  const report = progress({ graph, facts, state: round.state, now: 1000, round });

  assert.deepEqual(dispatched(round), []);
  assert.equal(report.status, 'stalled');
  assert.deepEqual(report.deferred, []);

  const consumer = report.stalls.find((stall) => stall.nodeId === 'nD');
  assert.equal(consumer.reason, 'blocked-by-terminated-worker');
  assert.deepEqual(consumer.blockedBy, ['nWork']);
  // The terminated worker itself stays in the report instead of vanishing behind its consumer.
  const worker = report.stalls.find((stall) => stall.nodeId === 'nWork');
  assert.equal(worker.reason, 'awaiting-new-attempt');
});

test('cp3 deadlock — a covered terminated upstream is a declared repair wait, not a dead end', () => {
  const spec = uncoveredUpstreamSpec({ cover: true });
  const graph = compiled(spec);
  const facts = factsOf({ states: { nWork: 'failed', nD: 'pending', nZ: 'succeeded' } });
  const round = dispatchRound(roundInput(spec, { facts }));
  const report = progress({ graph, facts, state: round.state, now: 1000, round });

  assert.equal(report.status, 'stalled');
  const consumer = report.stalls.find((stall) => stall.nodeId === 'nD');
  assert.equal(consumer.reason, 'waiting-on-repair');
  assert.deepEqual(consumer.blockedBy, ['nWork']);
});

test('cp3 deadlock — an expired lease is surfaced and stops counting as in-flight work', () => {
  const spec = soloWriterSpec();
  const graph = compiled(spec);
  const first = dispatchRound(roundInput(spec, { now: 1000, leaseTtlMs: 100 }));
  assert.deepEqual(dispatched(first), ['nW1']);

  const facts = factsOf({ states: { nW1: 'leased' } });
  const later = dispatchRound(roundInput(spec, { facts, state: first.state, now: 2000, leaseTtlMs: 100 }));
  assert.deepEqual(later.decisions, []);

  const report = progress({ graph, facts, state: later.state, now: 2000, round: later });
  assert.equal(report.status, 'stalled');
  assert.equal(report.stalls[0].nodeId, 'nW1');
  assert.equal(report.stalls[0].reason, 'lease-expired');
});

test('cp3 cancel — a cancelled branch keeps its slot in the join report', () => {
  const facts = outstandingJoinFacts();
  const gate = joinGate(compiled(joinSpec()), facts, 'nJ');
  const cancelled = gate.branchReport.find((branch) => branch.nodeId === 'nC');

  assert.equal(cancelled.state, 'cancelled');
  assert.equal(gate.missing.includes('nC'), true);
});

test('cp3 fairness — the most-starved node is ordered first', () => {
  const entries = [entry('nFirst'), entry('nX'), entry('nY')];
  const ordered = orderFrontier(
    entries,
    { deferStreak: { nY: 1 }, dispatches: { nFirst: 1 } },
    ['nFirst', 'nX', 'nY'],
  );

  assert.deepEqual(
    ordered.map((node) => node.nodeId),
    ['nY', 'nX', 'nFirst'],
  );
});

test('cp3 fairness — the round advances the streaks the next round orders by', () => {
  const spec = plainSpec();
  const first = dispatchRound(roundInput(spec, { maxConcurrentAgents: 2 }));
  assert.deepEqual(dispatched(first), ['nFirst', 'nX']);
  assert.equal(first.fairness.deferStreak.nY, 1);
  assert.equal(first.fairness.dispatches.nFirst, 1);

  const second = dispatchRound(roundInput(spec, { fairness: first.fairness, maxConcurrentAgents: 2 }));
  assert.equal(second.decisions[0].nodeId, 'nY');
  assert.equal(second.decisions[0].verdict, 'dispatch');
});

test('cp3 completion — a fully settled graph reports complete with no stalls', () => {
  const spec = plainSpec();
  const facts = factsOf({ states: { nFirst: 'succeeded', nX: 'succeeded', nY: 'succeeded' } });
  const round = dispatchRound(roundInput(spec, { facts, state: emptyState() }));
  const report = progress({ graph: compiled(spec), facts, state: round.state, now: 1000, round });

  assert.equal(report.status, 'complete');
  assert.deepEqual(report.frontier, []);
  assert.deepEqual(report.stalls, []);
});
