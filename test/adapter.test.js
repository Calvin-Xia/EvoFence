import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeCodeArgs, createAdapterUsageMonitor, parseAdapterUsage, runAgentAdapter } from '../src/lib/adapter.js';

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

test('usage monitor stops on malformed or missing completed-turn usage', () => {
  const malformed = createAdapterUsageMonitor('codex', 100);
  assert.equal(malformed.push('not-json\n'), 'TOKEN_USAGE_UNAVAILABLE');
  assert.equal(malformed.snapshot().tokens_complete, false);

  const missing = createAdapterUsageMonitor('opencode', 100);
  assert.equal(missing.push(`${JSON.stringify({ type: 'step_finish', part: {} })}\n`), 'TOKEN_USAGE_UNAVAILABLE');
  assert.equal(missing.snapshot().tokens_total, null);
});

test('OpenCode usage sums completed steps and preserves its reported cost without claiming a currency', () => {
  const stdout = [
    { type: 'step_finish', part: { tokens: { total: 12 }, cost: 0.001 } },
    { type: 'text', part: { tokens: { total: 900 }, cost: 9 } },
    { type: 'step_finish', part: { tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } }, cost: 0.002 } },
  ].map((event) => JSON.stringify(event)).join('\n');

  const usage = parseAdapterUsage('opencode', stdout);
  assert.equal(usage.tokens_total, 30);
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

test('Claude Code usage reads complete whole-tree token totals and CLI USD estimates', () => {
  const stdout = [
    { type: 'system', subtype: 'init', session_id: 'fixture' },
    { type: 'assistant', message: { id: 'main-turn', usage: { input_tokens: 100, output_tokens: 1 } } },
    {
      type: 'result',
      subtype: 'success',
      result: 'done',
      total_cost_usd: 0.025,
      usage: { input_tokens: 100, output_tokens: 40 },
      modelUsage: {
        opus: { inputTokens: 100, outputTokens: 40, cacheReadInputTokens: 10, cacheCreationInputTokens: 5, costUSD: 0.02 },
        haiku: { inputTokens: 20, outputTokens: 8, cacheReadInputTokens: 2, cacheCreationInputTokens: 1, costUSD: 0.005 },
      },
    },
  ].map((event) => JSON.stringify(event)).join('\n');

  assert.deepEqual(parseAdapterUsage('claude', stdout), {
    tokens_total: 186,
    tokens_complete: true,
    token_source: 'claude-cli-result.modelUsage',
    reported_cost: 0.025,
    cost_complete: true,
    cost_currency: 'USD',
    cost_source: 'claude-cli-result.total_cost_usd',
  });
});

test('Claude Code requires whole-tree result telemetry and rejects incomplete results', () => {
  const topLevelOnly = JSON.stringify({
    type: 'result',
    subtype: 'success',
    usage: { input_tokens: 10, output_tokens: 5 },
    total_cost_usd: 0.01,
  });
  const incomplete = parseAdapterUsage('claude', topLevelOnly);
  assert.equal(incomplete.tokens_total, null);
  assert.equal(incomplete.tokens_complete, false);
  assert.equal(incomplete.reported_cost, 0.01);
  assert.equal(incomplete.cost_complete, true);

  const crashed = JSON.stringify({
    type: 'result',
    subtype: 'error_during_execution',
    total_cost_usd: 0,
    modelUsage: { opus: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
  });
  assert.equal(parseAdapterUsage('claude', crashed).tokens_complete, false);
  assert.equal(parseAdapterUsage('claude', crashed).cost_complete, false);

  const truncated = parseAdapterUsage('claude', JSON.stringify({
    type: 'result', subtype: 'success', total_cost_usd: 0.01,
    modelUsage: { opus: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
  }), { outputLimited: true });
  assert.equal(truncated.tokens_complete, false);
  assert.equal(truncated.cost_complete, false);
});

test('Claude Code token monitor only evaluates its whole-tree final result', () => {
  const monitor = createAdapterUsageMonitor('claude', 100);
  assert.equal(monitor.push(`${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 999 } } })}\n`), null);
  const result = {
    type: 'result',
    subtype: 'success',
    modelUsage: { opus: { inputTokens: 70, outputTokens: 20, cacheReadInputTokens: 5, cacheCreationInputTokens: 6 } },
  };
  assert.equal(monitor.push(`${JSON.stringify(result)}\n`), 'TOKEN_BUDGET_REACHED');
  assert.deepEqual(monitor.snapshot(), {
    tokens_total: 101,
    tokens_complete: true,
    token_source: 'claude-cli-result.modelUsage',
  });

  const missing = createAdapterUsageMonitor('claude', 100);
  assert.equal(missing.push(`${JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: 20, output_tokens: 10 } })}\n`), 'TOKEN_USAGE_UNAVAILABLE');
});

test('Claude Code launch uses non-interactive streaming auto permissions and requires explicit isolation acceptance', async () => {
  const args = claudeCodeArgs({ model: 'sonnet', agent: 'evofence-agent' });
  assert.deepEqual(args.slice(0, 12), [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'auto', '--permission-prompts', 'none',
    '--model', 'sonnet', '--agent', 'evofence-agent',
  ]);
  assert.match(args.at(-1), /\.evofence-task\.md/);
  await assert.rejects(runAgentAdapter({
    name: 'claude', command: 'must-not-launch', cwd: process.cwd(), timeoutMs: 1000, maxOutputBytes: 1000,
  }), { code: 'CLAUDE_SANDBOX_REQUIRED' });
});
