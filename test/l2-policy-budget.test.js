/**
 * The shared budget pool. One ledger per `BudgetPolicy.poolId`; reservations, settlements and
 * cancellations are pure transitions. The four negative controls are the cap, the repeated
 * requestId, the retained reservation and the proven-unspent release.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVALUATION_ENVELOPES,
  budgetSnapshot,
  checkEnvelope,
  openBudgetLedger,
  releaseUnspent,
  reserve,
  settle,
  worstCaseRequestMicros,
} from '../dist/kernel/policy/index.js';
import * as fixtures from './l2-policy-fixtures.js';

const open = (policy, reservePerRequest = 9547) => {
  const result = openBudgetLedger(policy, reservePerRequest);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.value;
};
const reserveOk = (ledger, requestId, role = 'worker', parentRequestId = null) => {
  const result = reserve(ledger, { requestId, role, parentRequestId });
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.ledger;
};

test('the frozen evaluation envelopes are exactly requestCap x 9547', () => {
  assert.deepEqual(
    EVALUATION_ENVELOPES.map((envelope) => [envelope.tier, envelope.requestCap, envelope.usdCap]),
    [
      ['S1', 20, 190940],
      ['S2', 40, 381880],
      ['S3', 80, 763760],
    ],
  );
  for (const envelope of EVALUATION_ENVELOPES) assert.equal(checkEnvelope(envelope), null);
});

// Negative control: the pre-R4 approximate caps under-reserve and must be refused.
test('the obsolete approximate caps are rejected', () => {
  for (const [requestCap, usdCap] of [
    [20, 190900],
    [40, 381900],
    [80, 763800],
  ]) {
    const error = checkEnvelope({ requestCap, usdCap });
    assert.equal(error.code, 'EFK_BUDGET_ENVELOPE_INCONSISTENT');
  }
});

test('the per-request worst case rounds up to whole micro-USD', () => {
  assert.equal(worstCaseRequestMicros(1, 0, { inputMicrosPerMillionTokens: 1_200_000, outputMicrosPerMillionTokens: 0 }), 2);
  assert.equal(worstCaseRequestMicros(1, 0, { inputMicrosPerMillionTokens: 1_000_000, outputMicrosPerMillionTokens: 0 }), 1);
});

test('an unauthorized or self-inconsistent budget is refused at open', () => {
  assert.equal(openBudgetLedger(fixtures.budgetPolicy({ category: 'controlled-experiment', authorizationRef: null }), 9547).error.code, 'EFK_BUDGET_NOT_AUTHORIZED');
  assert.equal(openBudgetLedger(fixtures.budgetPolicy({ category: 'probe', maxUsdMicros: null }), 9547).error.code, 'EFK_BUDGET_NOT_AUTHORIZED');
  assert.equal(openBudgetLedger(fixtures.budgetPolicy({ priceRef: null }), 9547).error.code, 'EFK_BUDGET_NOT_AUTHORIZED');
  assert.equal(openBudgetLedger(fixtures.budgetPolicy({ maxRequests: 21 }), 9547).error.code, 'EFK_BUDGET_ENVELOPE_INCONSISTENT');
});

test('planner, worker, reviewer, learning and evaluator all draw on the same pool', () => {
  let ledger = open(fixtures.budgetPolicy(), 9547);
  const roles = ['planner', 'worker', 'reviewer', 'learning', 'evaluator'];
  roles.forEach((role, index) => {
    ledger = reserveOk(ledger, `req-${index}`, role);
  });
  const snapshot = budgetSnapshot(ledger);
  assert.equal(snapshot.requestCount, 5);
  assert.equal(snapshot.outstandingMicros, 5 * 9547);

  const extra = reserve(ledger, { requestId: 'req-learning-2', role: 'learning' });
  assert.equal(extra.error, null);
  assert.equal(budgetSnapshot(extra.ledger).requestCount, 6);
});

test('parent and child reservations share one ledger and cannot fork a budget', () => {
  let ledger = open(fixtures.budgetPolicy(), 9547);
  ledger = reserveOk(ledger, 'r-parent', 'planner');
  ledger = reserveOk(ledger, 'r-child', 'worker', 'r-parent');
  const snapshot = budgetSnapshot(ledger);
  assert.equal(snapshot.outstandingMicros, 2 * 9547);
  assert.equal(snapshot.remainingMicros, 190940 - 2 * 9547);
});

// Negative control for "concurrent reservations do not copy budget".
test('a repeated reservation for the same requestId does not copy budget', () => {
  let ledger = open(fixtures.budgetPolicy(), 9547);
  ledger = reserveOk(ledger, 'r1', 'worker', 'r-parent');
  const once = budgetSnapshot(ledger);
  const again = reserve(ledger, { requestId: 'r1', role: 'worker', parentRequestId: 'r-other' });
  assert.equal(again.error, null);
  const twice = budgetSnapshot(again.ledger);
  assert.deepEqual(twice, once);
  assert.equal(again.ledger.requestCount, 1);
  assert.equal(twice.outstandingCount, 1);
});

test('twenty reservations fill S1 and the twenty-first is exhausted', () => {
  let ledger = open(fixtures.budgetPolicy(), 9547);
  for (let index = 0; index < 20; index += 1) ledger = reserveOk(ledger, `req-${index}`, 'worker', 'req-parent');
  const snapshot = budgetSnapshot(ledger);
  assert.equal(snapshot.outstandingMicros, 190940);
  assert.equal(snapshot.remainingMicros, 0);
  assert.equal(snapshot.exhausted, true);
  assert.equal(reserve(ledger, { requestId: 'req-21', role: 'worker' }).error.code, 'EFK_BUDGET_EXHAUSTED');
});

test('the concurrency cap limits outstanding reservations independently of the dollar cap', () => {
  let ledger = open(fixtures.budgetPolicy({ maxConcurrentRequests: 2, maxRequests: 4 }), 9547);
  ledger = reserveOk(ledger, 'r1');
  ledger = reserveOk(ledger, 'r2');
  assert.equal(reserve(ledger, { requestId: 'r3', role: 'worker' }).error.code, 'EFK_BUDGET_EXHAUSTED');
});

// Negative control for "missing telemetry is not zero".
test('incomplete usage retains the reservation; complete usage settles it', () => {
  let ledger = open(fixtures.budgetPolicy(), 9547);
  ledger = reserveOk(ledger, 'r1');
  const incomplete = settle(ledger, { requestId: 'r1', micros: 0, complete: false, digest: 'u1' });
  assert.equal(incomplete.error.code, 'EFK_USAGE_INCOMPLETE');
  assert.equal(budgetSnapshot(incomplete.ledger).outstandingMicros, 9547);
  assert.equal(budgetSnapshot(incomplete.ledger).settledMicros, 0);

  const settled = settle(incomplete.ledger, { requestId: 'r1', micros: 100, complete: true, digest: 'u1' });
  assert.equal(settled.error, null);
  assert.equal(budgetSnapshot(settled.ledger).settledMicros, 100);
  assert.equal(budgetSnapshot(settled.ledger).outstandingMicros, 0);
});

test('a re-delivered settlement is idempotent, and a different one conflicts', () => {
  let ledger = open(fixtures.budgetPolicy(), 9547);
  ledger = reserveOk(ledger, 'r1');
  ledger = settle(ledger, { requestId: 'r1', micros: 100, complete: true, digest: 'u1' }).ledger;
  const repeat = settle(ledger, { requestId: 'r1', micros: 100, complete: true, digest: 'u1' });
  assert.equal(repeat.error, null);
  assert.deepEqual(repeat.ledger, ledger);
  assert.equal(settle(ledger, { requestId: 'r1', micros: 200, complete: true, digest: 'u2' }).error.code, 'EFK_USAGE_CONFLICT');
});

test('settling a request that was never reserved is an invariant violation', () => {
  const ledger = open(fixtures.budgetPolicy(), 9547);
  assert.equal(settle(ledger, { requestId: 'ghost', micros: 1, complete: true, digest: 'u' }).error.code, 'EFK_INVARIANT_VIOLATION');
});

test('cancellation releases only the proven-unspent part', () => {
  let ledger = open(fixtures.budgetPolicy(), 9547);
  ledger = reserveOk(ledger, 'r1');
  const partial = releaseUnspent(ledger, { requestId: 'r1', confirmedUnspentMicros: 9000 });
  assert.equal(partial.error, null);
  assert.equal(budgetSnapshot(partial.ledger).settledMicros, 547);
  assert.equal(budgetSnapshot(partial.ledger).outstandingMicros, 0);
});

test('an unconfirmed cancellation keeps the whole reservation', () => {
  let ledger = open(fixtures.budgetPolicy(), 9547);
  ledger = reserveOk(ledger, 'r1');
  const unconfirmed = releaseUnspent(ledger, { requestId: 'r1', confirmedUnspentMicros: null });
  assert.equal(unconfirmed.error.code, 'EFK_CANCEL_UNCONFIRMED');
  assert.equal(budgetSnapshot(unconfirmed.ledger).outstandingMicros, 9547);

  const full = releaseUnspent(ledger, { requestId: 'r1', confirmedUnspentMicros: 9547 });
  assert.equal(full.error, null);
  assert.equal(budgetSnapshot(full.ledger).settledMicros, 0);
});

test('actual usage above the reservation is recorded and reported as exhausted', () => {
  const policy = fixtures.budgetPolicy({ maxRequests: 1, maxConcurrentRequests: 1, maxUsdMicros: 9547 });
  let ledger = open(policy, 9547);
  ledger = reserveOk(ledger, 'r1');
  const over = settle(ledger, { requestId: 'r1', micros: 20000, complete: true, digest: 'u1' });
  assert.equal(over.error.code, 'EFK_BUDGET_EXHAUSTED');
  assert.equal(budgetSnapshot(over.ledger).settledMicros, 20000);
});
