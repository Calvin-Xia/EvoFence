import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapterUsageMonitor, parseAdapterUsage } from '../src/lib/adapter.js';

test('Codex usage sums completed turns without double-counting breakdown fields', () => {
  const stdout = [
    { type: 'thread.started', thread_id: 'fixture' },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 5 } },
    { type: 'turn.completed', usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 8, reasoning_output_tokens: 3 } },
  ].map((event) => JSON.stringify(event)).join('\n');

  assert.deepEqual(parseAdapterUsage('codex', stdout), {
    tokens_total: 168,
    tokens_complete: true,
    token_source: 'codex-cli-turn.completed',
    reported_cost: null,
    cost_complete: false,
    cost_currency: null,
    cost_source: null,
  });
});

test('Codex usage stays unavailable when a completed turn omits usage or output is truncated', () => {
  const missingUsage = JSON.stringify({ type: 'turn.completed' });
  assert.equal(parseAdapterUsage('codex', missingUsage).tokens_total, null);
  assert.equal(parseAdapterUsage('codex', missingUsage).tokens_complete, false);

  const completeTurn = JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 4 } });
  const truncated = parseAdapterUsage('codex', completeTurn, { outputLimited: true });
  assert.equal(truncated.tokens_total, null);
  assert.equal(truncated.tokens_complete, false);

  const malformed = parseAdapterUsage('codex', `${completeTurn}\nnot-json`);
  assert.equal(malformed.tokens_total, null);
  assert.equal(malformed.tokens_complete, false);
});

test('Codex token monitor triggers at a completed-turn boundary and reports its overshoot', () => {
  const monitor = createAdapterUsageMonitor('codex', 100);
  assert.equal(monitor.push(`${JSON.stringify({ type: 'turn.started' })}\n`), null);
  assert.equal(monitor.push(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 30, output_tokens: 20 } })}\n`), null);
  assert.equal(monitor.push([
    { type: 'turn.completed', usage: { input_tokens: 40, output_tokens: 25 } },
    { type: 'turn.started' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n'), 'TOKEN_BUDGET_REACHED');
  assert.deepEqual(monitor.snapshot(), {
    tokens_total: 115,
    tokens_complete: true,
    token_source: 'codex-cli-turn.completed',
  });
});

test('token monitor keeps consuming events after the first budget stop', () => {
  const monitor = createAdapterUsageMonitor('codex', 100);
  const events = [
    { type: 'turn.completed', usage: { input_tokens: 60, output_tokens: 40 } },
    { type: 'turn.completed', usage: { input_tokens: 4, output_tokens: 5 } },
  ];
  assert.equal(monitor.push(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`), 'TOKEN_BUDGET_REACHED');
  assert.equal(monitor.push(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 2 } })}\n`), 'TOKEN_BUDGET_REACHED');
  assert.deepEqual(monitor.snapshot(), {
    tokens_total: 112,
    tokens_complete: true,
    token_source: 'codex-cli-turn.completed',
  });
});

test('malformed telemetry after a budget stop keeps the first reason and invalidates totals', () => {
  const monitor = createAdapterUsageMonitor('codex', 100);
  assert.equal(monitor.push(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 60, output_tokens: 40 } })}\nnot-json\n`), 'TOKEN_BUDGET_REACHED');
  assert.deepEqual(monitor.snapshot(), {
    tokens_total: null,
    tokens_complete: false,
    token_source: 'codex-cli-turn.completed',
  });
});

test('token monitor flushes a final JSON event without a trailing newline', () => {
  const monitor = createAdapterUsageMonitor('codex', 100);
  assert.equal(monitor.push(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 60, output_tokens: 40 } })), null);
  assert.equal(monitor.finish(), 'TOKEN_BUDGET_REACHED');
  assert.deepEqual(monitor.snapshot(), {
    tokens_total: 100,
    tokens_complete: true,
    token_source: 'codex-cli-turn.completed',
  });
});

test('usage monitor stops on malformed or missing completed-turn usage', () => {
  const malformed = createAdapterUsageMonitor('codex', 100);
  assert.equal(malformed.push('not-json\n'), 'TOKEN_USAGE_UNAVAILABLE');
  assert.equal(malformed.snapshot().tokens_complete, false);

  const missing = createAdapterUsageMonitor('opencode', 100);
  assert.equal(missing.push(`${JSON.stringify({ type: 'step_finish', part: {} })}\n`), 'TOKEN_USAGE_UNAVAILABLE');
  assert.equal(missing.snapshot().tokens_total, null);
});

test('OpenCode token monitor includes reasoning in component totals', () => {
  const monitor = createAdapterUsageMonitor('opencode', 100);
  const event = {
    type: 'step_finish',
    part: { tokens: { input: 20, output: 30, reasoning: 60, cache: { read: 0, write: 0 } } },
  };
  assert.equal(monitor.push(`${JSON.stringify(event)}\n`), 'TOKEN_BUDGET_REACHED');
  assert.deepEqual(monitor.snapshot(), {
    tokens_total: 110,
    tokens_complete: true,
    token_source: 'opencode-cli-step_finish',
  });
});

test('OpenCode usage sums completed steps and preserves its reported cost without claiming a currency', () => {
  const stdout = [
    { type: 'step_finish', part: { tokens: { total: 12 }, cost: 0.001 } },
    { type: 'text', part: { tokens: { total: 900 }, cost: 9 } },
    { type: 'step_finish', part: { tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } }, cost: 0.002 } },
  ].map((event) => JSON.stringify(event)).join('\n');

  const usage = parseAdapterUsage('opencode', stdout);
  assert.equal(usage.tokens_total, 32);
  assert.equal(usage.tokens_complete, true);
  assert.equal(usage.token_source, 'opencode-cli-step_finish');
  assert.ok(Math.abs(usage.reported_cost - 0.003) < Number.EPSILON * 8);
  assert.equal(usage.cost_complete, true);
  assert.equal(usage.cost_currency, null);
  assert.equal(usage.cost_source, 'opencode-cli-step_finish');
});

test('OpenCode usage does not expose partial token or cost totals', () => {
  const stdout = [
    { type: 'step_finish', part: { tokens: { total: 10 }, cost: 0.01 } },
    { type: 'step_finish', part: { tokens: { input: 4, output: 2 } } },
  ].map((event) => JSON.stringify(event)).join('\n');

  const usage = parseAdapterUsage('opencode', stdout);
  assert.equal(usage.tokens_total, null);
  assert.equal(usage.tokens_complete, false);
  assert.equal(usage.reported_cost, null);
  assert.equal(usage.cost_complete, false);
});

test('OpenCode component totals stay unavailable when reasoning usage is absent', () => {
  const stdout = JSON.stringify({
    type: 'step_finish',
    part: { tokens: { input: 10, output: 5, cache: { read: 2, write: 1 } } },
  });
  const usage = parseAdapterUsage('opencode', stdout);
  assert.equal(usage.tokens_total, null);
  assert.equal(usage.tokens_complete, false);
});
