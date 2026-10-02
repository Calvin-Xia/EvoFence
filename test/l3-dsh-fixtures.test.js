// Native Cordis/AgentLoop/ToolRuntime/projections. Only the LLM and persistence are fixtures.
import assert from 'node:assert/strict';
import { loadNative, inspectInstallation } from '../scripts/probes/dsh-probe-support.mjs';
import * as plugin from '../integrations/deepseek-harness/index.js';
import { harness, value } from './l2-runtime-support.test.js';
import { fail } from '../dist/protocol/index.js';
import { createMemoryEventStore, createMemoryArtifactStore } from '../dist/storage/index.js';

export { value };
export const usage = { inputTokens: 100, outputTokens: 22, cacheReadTokens: 20, cacheWriteTokens: 5,
  reasoningTokens: 4, totalTokens: 147 };
export async function deadline(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('native fixture deadline')), 8000); })]); }
  finally { clearTimeout(timer); }
}
export async function fixture(options = {}) {
  const installation = inspectInstallation();
  assert.equal(installation.version, '0.2.0-rc.2', 'native version admission');
  const sdk = await loadNative();
  const { Context } = sdk.cordis, llm = sdk['dsh-llm'];
  const { SessionPersistence, SessionPersistenceRevision } = sdk['dsh-session-persistence'];
  const ctx = new Context(), rows = new Map(), requests = [], observations = [], handles = [];
  const mode = { value: 'reply' }, executed = { echo: 0, denied: 0, failure: 0 };
  let holdStarted, releaseHold;
  class MemoryPersistence extends SessionPersistence {
    constructor(context) {
      super(context);
      context.on('session/event', (session, event) => {
        const row = rows.get(session.id);
        if (row?.owned) { assert.equal(event.seq, row.events.length); row.events.push(structuredClone(event)); }
      });
      context.on('session/flush', () => {});
    }
    async create(header) {
      assert(!rows.has(header.id));
      rows.set(header.id, { header: structuredClone(header), events: [], owned: false });
      return this.open(header.id, 'write');
    }
    async open(id, access, opts = {}) {
      opts.signal?.throwIfAborted();
      const row = rows.get(id);
      assert(row, 'memory native session exists');
      if (access === 'write') { assert.equal(row.owned, false); row.owned = true; }
      let closed = false;
      const live = () => assert.equal(closed, false);
      const handle = { id, access, header: structuredClone(row.header), inheritedEventCount: 0,
        read: async (offset = 0, length) => { live(); return { eventState: 'detached', events: structuredClone(row.events.slice(offset, length === undefined ? undefined : offset + length)) }; },
        append: async events => { live(); assert.equal(access, 'write'); for (const event of events) { assert.equal(event.seq, row.events.length); row.events.push(structuredClone(event)); } },
        flush: async () => live(), close: async () => { if (!closed && access === 'write') row.owned = false; closed = true; } };
      handle[Symbol.asyncDispose] = handle.close;
      return handle;
    }
    async flush() {}
    async stat(id) { const row = rows.get(id); return row && { header: row.header, eventCount: row.events.length, revision: SessionPersistenceRevision(`fixture:${id}:${row.events.length}`) }; }
    async list() { return Promise.all([...rows.keys()].map(id => this.stat(id))); }
  }
  class FixtureAdapter extends llm.LlmAdapter {
    providerRetryPolicy() { return llm.resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }); }
    async resolveModel(provider, model) { return { provider, id: model, name: 'L3 synthetic fixture', context: { contextWindow: 8192 }, inputModalities: ['text'] }; }
    async *stream(call) {
      assert(requests.length < 20, 'bounded fixture requests');
      requests.push({ sessionId: call.sessionId, model: call.model, provider: call.provider, maxTokens: call.maxTokens,
        tools: call.tools.map(t => t.name), hostContext: JSON.stringify(call.messages).includes('HOST_CONTEXT'),
        nodeContext: JSON.stringify(call.messages).includes('NODE_PACKET') });
      const selected = mode.value;
      if (selected === 'hold') {
        holdStarted?.();
        await new Promise(resolve => { releaseHold = resolve; call.signal.addEventListener('abort', resolve, { once: true }); });
        throw new llm.LlmError('synthetic abort', 'ABORTED');
      }
      if (selected === 'failure') throw new llm.LlmError('synthetic provider failure', 'FIXTURE_FAILURE');
      const emitTools = selected === 'tools' && !call.messages.some(m => m.role === 'tool');
      const emitContinue = selected === 'continue' && !call.messages.some(m => m.role === 'tool');
      if (emitTools || emitContinue) {
        const names = emitContinue ? ['evofence_continue'] : ['host_echo', 'host_denied', 'host_failure'];
        for (const [index, name] of names.entries()) {
          const id = llm.ToolCallId(`call:${requests.length}:${index}`), args = emitContinue ? '{}' : '{"text":"ok"}';
          yield { type: 'block-start', index, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index, id, name, argumentsDelta: args };
          yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } };
        }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: 'fixture-ok' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'fixture-ok' } };
      }
      if (selected !== 'no-usage') yield { type: 'usage', usage };
      yield { type: 'finish', reason: { kind: emitTools || emitContinue ? 'tool-calls' : 'stop' } };
    }
  }
  async function mount(plugin, config) { const fiber = ctx.plugin(plugin, config); await deadline(fiber.await()); return fiber; }
  for (const name of ['dsh-agent', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-llm', 'dsh-tools']) await mount(sdk[name].default, {});
  await mount(MemoryPersistence);
  await mount(sdk['dsh-agent-loop'].default, { agents: [], maxParallelToolCalls: 1 });
  if (options.team) {
    await mount(sdk['dsh-subagent'].default, { maxDepth: 2, maxActiveSubagents: 2 });
    await mount(sdk['dsh-subagent-spawn-in-process'], { providerName: 'spawn' });
    await mount(sdk['dsh-subagent-fork-in-process'], { providerName: 'fork' });
    await mount(sdk['dsh-experimental-agent-team'].default, { maxMembers: 2, maxTasks: 4 });
  }
  ctx.llm.registerAdapter(['offline-l3'], new FixtureAdapter());
  ctx.systemPrompt.section({ name: 'host-existing', order: 10, text: 'HOST_CONTEXT remains owned by the native host.' });
  for (const name of ['host_echo', 'host_denied', 'host_failure']) ctx.tools.register(sdk['dsh-tools'].defineTool({ name, description: name,
    parameters: { text: { type: 'string', required: true } }, output: { schema: { type: 'string' }, render: (_args, v) => [{ type: 'text', text: v }] },
    async execute(args) {
      if (name === 'host_denied') executed.denied++;
      else if (name === 'host_failure') { executed.failure++; throw new Error('controlled tool failure'); }
      else executed.echo++;
      return args.text;
    } }));
  ctx.on('tools/pre-execute', async (exec, next) => exec.name === 'host_denied' ? { kind: 'deny', reason: 'ordinary host policy' } : next());
  const h = options.harness ?? harness();
  const { z } = sdk.zod;
  const request = options.request ?? { ...h.seed, epoch: 1, protocol: h.read().protocol };
  const ports = options.request === undefined ? h.ports : { ...h.ports,
    store: createMemoryEventStore({ digest: h.ports.digest }), artifacts: createMemoryArtifactStore({ digest: h.ports.digest }) };
  if (options.request !== undefined) {
    for (const operation of Object.values(request.operations)) {
      for (const ref of operation.inputRefs) value(ports.artifacts.put(ref, value(h.artifacts.get(ref))));
    }
  }
  const composition = { version: installation.version, ports,
    helpers: { message: text => llm.createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
      defineTool: sdk['dsh-tools'].defineTool,
      projectionSchema: z.object({ hostSessionId: z.string(), lastSeq: z.number().int(), requests: z.number().int() }) },
    usageSource: 'synthetic', sessionFor: agent => agent.id === h.seed.sessionId ? request : null,
    allowTool: async (_effect, exec) => options.denyTool === exec.name ? { ok: false, error: fail('EFK_AUTHORITY_DENIED', 'explicit kernel request gate') } : { ok: true, value: undefined },
    onObservation: observation => { observations.push(observation); options.onObservation?.(observation); } };
  ctx.provide('evofenceRuntime', composition);
  // Intercept only the public event registration seam to reproduce a removed callback later.
  const removers = new Map();
  let binding;
  const mountedPlugin = { ...plugin, apply: owner => {
    const facade = {
      agents: owner.agents, tools: owner.tools, sessionProjections: owner.sessionProjections,
      evofenceRuntime: owner.evofenceRuntime, effect: (execute, label) => owner.effect(execute, label),
      on(name, callback) {
        const remove = owner.on(name, callback);
        removers.set(name, remove);
        return remove;
      },
    };
    binding = plugin.apply(facade);
  } };
  const fiber = await mount(mountedPlugin);
  const agentOptions = { provider: 'offline-l3', model: 'deterministic', maxTokens: 128 };
  const handle = await deadline(ctx.agents.create({ sessionId: sdk['dsh-session'].SessionId(h.seed.sessionId), agentOptions }));
  handles.push(handle);
  async function restore() {
    const before = handle.agent.session.snapshotEvents();
    await ctx.sessions.flush(handle.agent.session);
    await deadline(handle.dispose());
    const resumed = await deadline(ctx.agents.resume({ resumeSessionId: h.seed.sessionId, agentOptions }));
    handles.push(resumed);
    assert.deepEqual(resumed.agent.session.snapshotEvents().slice(0, before.length), before);
    return resumed.agent;
  }
  return { sdk, ctx, h, binding, fiber, handle, requests, rows, mode, executed, observations, removers, composition, restore,
    started: () => new Promise(resolve => { holdStarted = resolve; }),
    user: text => composition.helpers.message(text),
    async ordinary(agent = handle.agent, text = 'ordinary followup') { agent.followup(composition.helpers.message(text)); await deadline(agent.whenIdle()); },
    async close() {
      releaseHold?.();
      for (const owned of handles.reverse()) await deadline(owned.dispose());
      await deadline(fiber.dispose());
      await deadline(ctx.fiber.dispose());
    } };
}
