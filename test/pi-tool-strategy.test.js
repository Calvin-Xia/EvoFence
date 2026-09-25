import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPiToolStrategy, summarizePiToolStrategyTelemetry } from '../src/lib/pi-tool-strategy.js';
import { installPiToolStrategy } from '../src/lib/pi-tool-strategy-extension.js';

async function withTelemetry(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-pi-tool-strategy-'));
  const logPath = path.join(directory, 'strategy.ndjson');
  try {
    await callback({ directory, logPath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function fakePi(activeTools, { failSetActiveTools = false } = {}) {
  const handlers = new Map();
  const state = { activeTools: [...activeTools] };
  const pi = {
    on(eventName, handler) {
      handlers.set(eventName, handler);
      return () => handlers.delete(eventName);
    },
    getActiveTools() {
      return [...state.activeTools];
    },
    setActiveTools(toolNames) {
      if (failSetActiveTools) throw new Error('fixture API failure');
      state.activeTools = [...toolNames];
    },
  };
  return { pi, handlers, state };
}

test('proposal selects only active read-only tools and implementation orders the existing active set', () => {
  const proposal = createPiToolStrategy('proposal');
  const implementation = createPiToolStrategy('implementation');

  assert.deepEqual(
    proposal.orderActiveTools(['bash', 'write', 'edit', 'read', 'grep']),
    ['read', 'grep'],
  );
  assert.deepEqual(proposal.orderActiveTools(['powershell', 'ls', 'find', 'read']), ['read', 'find', 'ls']);
  assert.throws(() => proposal.orderActiveTools(['bash', 'write']), /No currently active proposal tools/);
  assert.deepEqual(
    implementation.orderActiveTools(['bash', 'write', 'read', 'edit']),
    ['read', 'edit', 'write', 'bash'],
  );
  assert.deepEqual(
    implementation.orderActiveTools(['custom_tool', 'bash', 'read']),
    ['read', 'bash', 'custom_tool'],
  );
  assert.throws(() => implementation.orderActiveTools(['read', 'read']), /duplicate/);
});

test('tool errors demote that tool, add recovery feedback, and block an identical retry once', async () => {
  await withTelemetry(async ({ logPath }) => {
    const { pi, handlers, state } = fakePi(['bash', 'write', 'read', 'edit']);
    installPiToolStrategy(pi, { phase: 'implementation', logPath });
    const prompt = { systemPromptOptions: { sections: {} } };
    await handlers.get('before_agent_start')(prompt);

    assert.deepEqual(state.activeTools, ['read', 'edit', 'write', 'bash']);
    assert.match(prompt.systemPromptOptions.sections.evofence_tool_strategy, /smallest approved edit/);
    assert.equal(new Set(state.activeTools).size, 4);

    const failedRead = {
      toolName: 'read',
      input: { path: 'missing.md' },
      content: [{ type: 'text', text: 'file not found' }],
      isError: true,
    };
    const result = await handlers.get('tool_result')(failedRead);
    assert.match(result.content.at(-1).text, /choose another currently available tool/);
    assert.deepEqual(state.activeTools, ['edit', 'write', 'bash', 'read']);

    const repeatedCall = { toolName: 'read', toolCallId: 'retry-1', input: { path: 'missing.md' } };
    const blocked = await handlers.get('tool_call')(repeatedCall);
    assert.equal(blocked.block, true);
    assert.match(blocked.reason, /exact tool call already failed/);
    assert.equal(await handlers.get('tool_call')({ ...repeatedCall, toolCallId: 'retry-2' }), undefined);

    await handlers.get('tool_result')({
      toolName: 'bash',
      input: { command: 'node --version' },
      content: [{ type: 'text', text: 'v22' }],
      isError: false,
    });
    assert.deepEqual(state.activeTools, ['read', 'edit', 'write', 'bash']);
    await handlers.get('agent_end')();

    const summary = summarizePiToolStrategyTelemetry(await readFile(logPath, 'utf8'), { phase: 'implementation' });
    assert.equal(summary.status, 'active');
    assert.equal(summary.tool_errors, 1);
    assert.equal(summary.repeated_call_blocks, 1);
    assert.equal(summary.tool_calls, 2);
    assert.equal(summary.tool_results, 2);
    assert.equal(summary.tool_order_updates, 3);
  });
});

test('successful recovery restores the phase-start order of unprioritized tools', async () => {
  await withTelemetry(async ({ logPath }) => {
    const originalTools = ['custom_a', 'custom_b', 'bash', 'read'];
    const { pi, handlers, state } = fakePi(originalTools);
    installPiToolStrategy(pi, { phase: 'implementation', logPath });
    await handlers.get('before_agent_start')({ systemPromptOptions: { sections: {} } });
    assert.deepEqual(state.activeTools, ['read', 'bash', 'custom_a', 'custom_b']);

    await handlers.get('tool_result')({
      toolName: 'custom_a',
      input: { value: 'bad' },
      content: [{ type: 'text', text: 'failed' }],
      isError: true,
    });
    assert.deepEqual(state.activeTools, ['read', 'bash', 'custom_b', 'custom_a']);

    await handlers.get('tool_result')({
      toolName: 'custom_b',
      input: { value: 'good' },
      content: [{ type: 'text', text: 'succeeded' }],
      isError: false,
    });
    assert.deepEqual(state.activeTools, ['read', 'bash', 'custom_a', 'custom_b']);
  });
});

test('Pi proposal extension activates only read-only tools from Pi’s current tool set', async () => {
  await withTelemetry(async ({ logPath }) => {
    const originalTools = ['bash', 'write', 'edit', 'read', 'grep', 'find', 'ls'];
    const { pi, handlers, state } = fakePi(originalTools);
    installPiToolStrategy(pi, { phase: 'proposal', logPath });
    await handlers.get('before_agent_start')({ systemPromptOptions: { sections: {} } });

    assert.deepEqual(state.activeTools, ['read', 'grep', 'find', 'ls']);
    assert.ok(state.activeTools.every((name) => originalTools.includes(name)));
    assert.equal(state.activeTools.some((name) => ['bash', 'powershell', 'edit', 'write'].includes(name)), false);
    await handlers.get('agent_end')();

    const summary = summarizePiToolStrategyTelemetry(await readFile(logPath, 'utf8'), { phase: 'proposal' });
    assert.equal(summary.status, 'active');
    assert.deepEqual(summary.initial_tool_order, state.activeTools);
  });
});

test('Pi extension fails open and restores its original tool order if a controller API call fails', async () => {
  await withTelemetry(async ({ logPath }) => {
    const originalTools = ['bash', 'write', 'read', 'edit'];
    const { pi, handlers, state } = fakePi(originalTools, { failSetActiveTools: true });
    installPiToolStrategy(pi, { phase: 'implementation', logPath });
    const prompt = { systemPromptOptions: { sections: {} } };

    await handlers.get('before_agent_start')(prompt);
    assert.deepEqual(state.activeTools, originalTools);
    assert.equal(prompt.systemPromptOptions.sections.evofence_tool_strategy, undefined);
    assert.equal(await handlers.get('tool_call')({
      toolName: 'bash',
      toolCallId: 'allowed-after-failure',
      input: { command: 'node --version' },
    }), undefined);
    await handlers.get('agent_end')();

    const summary = summarizePiToolStrategyTelemetry(await readFile(logPath, 'utf8'), { phase: 'implementation' });
    assert.equal(summary.status, 'degraded');
    assert.equal(summary.controller_errors, 1);
    assert.equal(summary.agent_finished, true);
  });
});

test('proposal strategy fails open when no active read-only tool is available', async () => {
  await withTelemetry(async ({ logPath }) => {
    const originalTools = ['bash', 'edit'];
    const { pi, handlers, state } = fakePi(originalTools);
    installPiToolStrategy(pi, { phase: 'proposal', logPath });
    await handlers.get('before_agent_start')({ systemPromptOptions: { sections: {} } });
    assert.deepEqual(state.activeTools, originalTools);
    assert.equal(await handlers.get('tool_call')({ toolName: 'bash', input: { command: 'pwd' } }), undefined);
    await handlers.get('agent_end')();

    const summary = summarizePiToolStrategyTelemetry(await readFile(logPath, 'utf8'), { phase: 'proposal' });
    assert.equal(summary.status, 'degraded');
    assert.equal(summary.controller_errors, 1);
    assert.equal(summary.agent_finished, true);
  });
});

test('strategy telemetry keeps tool names and outcomes while discarding arguments and output', () => {
  const records = [
    { schema_version: 1, phase: 'proposal', type: 'ready', initial_order: ['read'] },
    { schema_version: 1, phase: 'proposal', type: 'tool_call', tool_name: 'read', blocked_repeat: false, input: { path: 'private path' } },
    { schema_version: 1, phase: 'proposal', type: 'tool_result', tool_name: 'read', outcome: 'error', output: 'private output' },
    { schema_version: 1, phase: 'proposal', type: 'tool_order', order: ['read'] },
    { schema_version: 1, phase: 'proposal', type: 'agent_end' },
  ];
  const summary = summarizePiToolStrategyTelemetry(records.map((record) => JSON.stringify(record)).join('\n'), { phase: 'proposal' });

  assert.equal(summary.status, 'active');
  assert.equal(summary.tool_calls, 1);
  assert.equal(summary.tool_errors, 1);
  assert.equal(summary.tool_order_updates, 1);
  assert.equal(summary.final_tool_order.includes('read'), true);
  assert.doesNotMatch(JSON.stringify(summary), /private path|private output|input|output/);

  const withoutReady = summarizePiToolStrategyTelemetry(JSON.stringify({ schema_version: 1, phase: 'proposal', type: 'agent_end' }), { phase: 'proposal' });
  assert.equal(withoutReady.status, 'unavailable');
});
