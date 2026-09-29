// Fix batch R2 · review F3 — the split between the gate domain's judgement entry points and the
// exec domain's production accounting, and the single implementation of the money primitives.
//
// WHY THIS FILE EXISTS: the six `evaluate*Gate` entry points and the three `verdict*` mappings in
// `src/lib/gate/**` have no production caller — the shipped decisions are taken in
// `src/lib/exec/budget.ts` (`recordTokenUsage` / `recordCostUsage`) and in
// `src/lib/exec/runner-budgeted.ts` (the pre-invocation allowance check). Before this file,
// `test/contract-policy.test.js` locked only the unwired reference implementation, so a green
// suite read as "fail-closed is enforced" while the running code was untested at these points.
//
// This file locks the PRODUCTION side and asserts both sides agree, so:
//   - `contract-policy.test.js` = the reference implementation (marked "unwired" there),
//   - this file                = the run path + the agreement between the two.
//
// Imports come from `dist/**` (ADR-0004).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as adapterArgs from '../dist/lib/exec/adapter-args.js';
import * as execBudget from '../dist/lib/exec/budget.js';
import { recordCostUsage, recordTokenUsage } from '../dist/lib/exec/budget.js';
import * as gateBudget from '../dist/lib/gate/budget.js';
import * as gateIndex from '../dist/lib/gate/index.js';
import { evaluateBudgetGate } from '../dist/lib/gate/index.js';
import { runBudgetedAdapter } from '../dist/lib/exec/runner-budgeted.js';

const USD_LIMIT_MICROS = 1_000_000;

/** A ledger stub that records `append(event_type, run_id, payload)` verbatim. */
function collectingLedger() {
  const events = [];
  return { events, append: (event_type, run_id, payload) => events.push({ event_type, run_id, payload }) };
}

function budgetLimits(overrides = {}) {
  return {
    max_iterations: 20,
    max_wall_clock_ms: 3_600_000,
    max_failed_candidates: 5,
    max_consecutive_no_improvement: 3,
    max_tokens: null,
    max_usd: null,
    ...overrides,
  };
}

/** A complete `BudgetGateInput` — the gate refuses to judge a partial one. */
function gateInput(overrides = {}) {
  return {
    limits: budgetLimits(),
    observed_tokens: null,
    observed_usd_micros: null,
    cost_total_unknown: false,
    deadline_at: Date.now() + 60_000,
    failed_candidates: 0,
    consecutive_no_improvement: 0,
    can_terminate_process_tree: true,
    ...overrides,
  };
}

function tokenResult(tokens_total) {
  return {
    code: 0,
    timed_out: false,
    tree_termination_failed: false,
    budget_stop_reason: null,
    reported_usage: { tokens_total, tokens_complete: tokens_total !== null },
  };
}

function costResult(reported_cost) {
  return {
    code: 0,
    timed_out: false,
    tree_termination_failed: false,
    budget_stop_reason: null,
    cost_budget_reached: false,
    reported_usage: { cost_complete: true, cost_currency: 'USD', reported_cost, cost_source: 'adapter' },
  };
}

/** Minimal `RunContext` for the pre-invocation guard; the adapter runner is a tripwire. */
function budgetedCtx({ tokenLimit = null, costLimitMicros = null, observedTokens = 0, observedCostMicros = 0 }) {
  const ledger = collectingLedger();
  let launches = 0;
  return {
    ledger,
    launches: () => launches,
    ctx: {
      ledger,
      runId: 'run-guard',
      adapter: 'pi',
      config: {},
      tokenLimit,
      costLimitMicros,
      state: { observedTokens, observedCostMicros, costTotalUnknown: false },
      outcome: {},
      adapterRunner: async () => {
        launches += 1;
        throw new Error('PROCEEDED-TO-ADAPTER');
      },
    },
  };
}

const budgetedOptions = {
  iteration: 1,
  phase: 'proposal',
  worktree: '/nonexistent-worktree',
  timeoutMs: 1000,
  contract: {},
  allowUnisolatedAgent: true,
};

/* ------------------------------------------------------------------ *
 * F3.1 — one implementation of the money/budget primitives
 * ------------------------------------------------------------------ */

test('the money/budget primitives are declared once: exec/budget re-exports gate/budget', () => {
  for (const name of ['parseNumericBudget', 'usdToMicros', 'usdFromMicros']) {
    assert.equal(typeof execBudget[name], 'function', `${name} must exist on the exec side`);
    assert.equal(execBudget[name], gateBudget[name], `${name} must be the same binding in both domains`);
  }
  assert.equal(execBudget.USD_MICROS, gateBudget.USD_MICROS);
  assert.equal(execBudget.USD_MICROS, 1_000_000);
  // The gate barrel is the domain's import surface, so it must expose the same bindings.
  for (const name of ['parseNumericBudget', 'usdToMicros', 'usdFromMicros', 'USD_MICROS']) {
    assert.equal(gateIndex[name], gateBudget[name], `${name} via the barrel`);
  }

  // Behaviour of the surviving implementation (previously asserted twice, once per copy).
  assert.equal(execBudget.usdToMicros(0.000001), 1);
  assert.equal(execBudget.usdToMicros(1.2345675), 1234567);
  assert.equal(execBudget.usdToMicros(1.2345675, 'ceil'), 1234568);
  assert.equal(execBudget.usdFromMicros(execBudget.usdToMicros(0.1 + 0.2)), 0.3);
  // The gate parameter is `unknown`, i.e. wider than the old exec `number`: a caller that passes
  // a non-number now reaches the same runtime refusal instead of being a compile-time error.
  assert.throws(() => execBudget.usdToMicros('1.5'), { code: 'INVALID_BUDGET' });
  assert.equal(execBudget.parseNumericBudget(undefined, 20, '--iterations'), 20);
  assert.throws(() => execBudget.parseNumericBudget(21, 20, '--iterations'), { code: 'BUDGET_ABOVE_POLICY' });

  // The remaining copy (`exec/adapter-args.ts`) is deliberately different: identical numbers,
  // Claude-specific message text that the adapter contract depends on.
  assert.equal(adapterArgs.usdToMicros(1.2345675), execBudget.usdToMicros(1.2345675));
  assert.throws(() => adapterArgs.usdToMicros(-1), /Claude USD budget must be a finite, non-negative number/);
  assert.throws(() => execBudget.usdToMicros(-1), /USD amounts must be finite and non-negative/);
});

/* ------------------------------------------------------------------ *
 * F3.3 — the production exhaustion path
 * ------------------------------------------------------------------ */

test('runner-budgeted refuses before launching the adapter once the remaining allowance is gone', async () => {
  // Tokens: `remaining < 1` means observed >= limit, so the boundary sits exactly at the limit.
  const atLimit = budgetedCtx({ tokenLimit: 100, observedTokens: 100 });
  await assert.rejects(runBudgetedAdapter(atLimit.ctx, budgetedOptions), { code: 'RESOURCE_EXHAUSTED' });
  assert.equal(atLimit.launches(), 0, 'the adapter must not be launched');
  assert.deepEqual(atLimit.ledger.events, [{
    event_type: 'budget.exhausted',
    run_id: 'run-guard',
    payload: { metric: 'tokens', phase: 'proposal', iteration: 1, limit: 100, observed_total: 100 },
  }]);

  const belowLimit = budgetedCtx({ tokenLimit: 100, observedTokens: 99 });
  await assert.rejects(runBudgetedAdapter(belowLimit.ctx, budgetedOptions), /PROCEEDED-TO-ADAPTER/);
  assert.equal(belowLimit.launches(), 1, 'one token below the limit must still reach the adapter');
  assert.equal(belowLimit.ledger.events.some((event) => event.event_type === 'budget.exhausted'), false);

  const usdAtLimit = budgetedCtx({ costLimitMicros: USD_LIMIT_MICROS, observedCostMicros: USD_LIMIT_MICROS });
  await assert.rejects(runBudgetedAdapter(usdAtLimit.ctx, budgetedOptions), { code: 'RESOURCE_EXHAUSTED' });
  assert.equal(usdAtLimit.launches(), 0);
  assert.deepEqual(usdAtLimit.ledger.events[0].payload, {
    metric: 'estimated_usd', phase: 'proposal', iteration: 1, limit_usd: 1, observed_total_usd: 1, over_limit_usd: 0,
  });

  const usdBelowLimit = budgetedCtx({ costLimitMicros: USD_LIMIT_MICROS, observedCostMicros: USD_LIMIT_MICROS - 1 });
  await assert.rejects(runBudgetedAdapter(usdBelowLimit.ctx, budgetedOptions), /PROCEEDED-TO-ADAPTER/);
  assert.equal(usdBelowLimit.launches(), 1);
});

test('the production token accounting refuses at the same threshold the budget gate judges', () => {
  const limit = 100;
  for (const observed of [0, 99, 100, 150]) {
    const ledger = collectingLedger();
    let execCode = null;
    try {
      recordTokenUsage(tokenResult(observed), { maxTokens: limit, totalTokens: 0, ledger, runId: 'run-token', phase: 'implementation', iteration: 1 });
    } catch (error) {
      execCode = error.code;
    }
    const gate = evaluateBudgetGate(gateInput({ limits: budgetLimits({ max_tokens: limit }), observed_tokens: observed }));
    const expected = observed >= limit;

    assert.equal(execCode === 'RESOURCE_EXHAUSTED', expected, `production decision at observed=${observed}`);
    assert.equal(gate.reason === 'TOKEN_BUDGET_REACHED', expected, `gate decision at observed=${observed}`);

    if (execCode !== null) {
      assert.equal(execCode, 'RESOURCE_EXHAUSTED');
      const exhausted = ledger.events.findLast((event) => event.event_type === 'budget.exhausted');
      assert.deepEqual([exhausted.payload.metric, exhausted.payload.limit, exhausted.payload.observed_total], ['tokens', limit, observed]);
      // The gate reports the same face of the same fact.
      assert.deepEqual([gate.exhausted, gate.metric, gate.limit, gate.observed], [true, 'tokens', limit, observed]);
    } else {
      assert.equal(gate.passed, true);
      assert.equal(ledger.events.some((event) => event.event_type === 'budget.exhausted'), false);
    }
  }
});

test('the production USD accounting refuses at the same threshold the budget gate judges', () => {
  for (const usd of [0.5, 1, 1.25]) {
    const observedMicros = gateBudget.usdToMicros(usd, 'ceil');
    const ledger = collectingLedger();
    let execCode = null;
    try {
      recordCostUsage(costResult(usd), { maxUsdMicros: USD_LIMIT_MICROS, totalCostMicros: 0, ledger, runId: 'run-usd', phase: 'implementation', iteration: 1 });
    } catch (error) {
      execCode = error.code;
    }
    const gate = evaluateBudgetGate(gateInput({ limits: budgetLimits({ max_usd: 1 }), observed_usd_micros: observedMicros }));
    const expected = observedMicros >= USD_LIMIT_MICROS;

    assert.equal(execCode === 'RESOURCE_EXHAUSTED', expected, `production decision at usd=${usd}`);
    assert.equal(gate.reason === 'USD_LIMIT_REACHED', expected, `gate decision at usd=${usd}`);
    if (expected) {
      assert.equal(ledger.events.findLast((event) => event.event_type === 'budget.exhausted').payload.metric, 'estimated_usd');
      assert.deepEqual([gate.exhausted, gate.metric], [true, 'estimated_usd']);
    } else {
      assert.equal(gate.passed, true);
    }
  }
});

/* ------------------------------------------------------------------ *
 * F3.3 — the production usage-unavailable path
 * ------------------------------------------------------------------ */

test('the production accounting refuses unavailable usage, and the gate refuses the same inputs', () => {
  // Tokens: incomplete usage must never be treated as "within budget".
  const tokenLedger = collectingLedger();
  assert.throws(() => recordTokenUsage(
    tokenResult(null),
    { maxTokens: 100, totalTokens: 0, ledger: tokenLedger, runId: 'run-usage', phase: 'proposal', iteration: 1 },
  ), { code: 'TOKEN_USAGE_UNAVAILABLE' });
  const unavailable = tokenLedger.events.findLast((event) => event.event_type === 'budget.usage_unavailable');
  assert.deepEqual([unavailable.payload.metric, unavailable.payload.reason], ['tokens', 'usage_incomplete']);

  const tokenGate = evaluateBudgetGate(gateInput({ limits: budgetLimits({ max_tokens: 100 }), observed_tokens: null }));
  assert.deepEqual([tokenGate.passed, tokenGate.reason, tokenGate.missing], [false, 'GATE_INPUT_MISSING', ['observed_tokens']]);

  // USD: incomplete cost usage is the cost-side twin.
  const costLedger = collectingLedger();
  assert.throws(() => recordCostUsage(
    { code: 0, timed_out: false, tree_termination_failed: false, budget_stop_reason: null, cost_budget_reached: false, reported_usage: { cost_complete: false, cost_currency: null, reported_cost: null } },
    { maxUsdMicros: USD_LIMIT_MICROS, totalCostMicros: 0, ledger: costLedger, runId: 'run-usage', phase: 'proposal', iteration: 1 },
  ), { code: 'USD_USAGE_UNAVAILABLE' });
  assert.equal(costLedger.events.some((event) => event.event_type === 'budget.cost_usage_unavailable'), true);

  const costGate = evaluateBudgetGate(gateInput({ limits: budgetLimits({ max_usd: 1 }), observed_usd_micros: 0, cost_total_unknown: true }));
  assert.deepEqual([costGate.passed, costGate.reason], [false, 'USD_USAGE_UNAVAILABLE']);

  // The agreement must not be "both sides always refuse": with the dimension unbounded, neither
  // side may turn missing usage into a refusal.
  assert.equal(recordTokenUsage(tokenResult(null), { maxTokens: null, totalTokens: 7, ledger: collectingLedger(), runId: 'run-usage', phase: 'proposal', iteration: 1 }), 7);
  const unbounded = evaluateBudgetGate(gateInput({ limits: budgetLimits(), observed_tokens: null }));
  assert.deepEqual([unbounded.passed, unbounded.reason], [true, null]);
});
