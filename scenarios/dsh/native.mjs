import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { config, evidence, runtimeDir, record, writeJson } from './io.mjs';
import { toolDefinitions } from './task-tools.mjs';
import { installMeter, recordNativeUsage, drain } from './meter.mjs';

export const policy = { poolId: 'dsh-scenario-pool', category: 'development', authorizationRef: null,
  maxRequests: config.maxRequests, maxInputTokens: config.maxInputTokens * config.maxRequests,
  maxOutputTokens: config.maxOutputTokens * config.maxRequests, maxUsdMicros: null,
  maxWallMs: 7200000, maxConcurrentRequests: 4, priceRef: null, missingUsagePolicy: 'retain-reservation' };
export const clock = { now: () => Date.now() };
export const roles = new Map();
export const sdk = {};
export let ctx;
export const handles = [];
const authorizedTurns = new Set();
let removeMeter;
export const user = text => sdk['dsh-llm'].createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
export async function setup(pause) {
  const require = createRequire(path.join(config.dshPackage, 'package.json'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(config.dshPackage, 'package.json'))).version, config.dshVersion);
  for (const name of ['cordis', 'dsh-agent', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-llm',
    'dsh-tools', 'dsh-agent-loop', 'dsh-session-persistence-jsonl', 'dsh-subagent', 'dsh-subagent-spawn-in-process',
    'dsh-subagent-fork-in-process', 'dsh-experimental-agent-team', 'dsh-llm-deepseek', 'dsh-credentials-local']) {
    sdk[name] = await import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)).href);
  }
  const savedModel = YAML.parse(fs.readFileSync(config.modelProfile, 'utf8')).find(row => row.id === 'agent-default-model').config;
  assert.deepEqual(savedModel, { provider: config.provider, model: config.model, reasoningEffort: config.thinking });
  writeJson(path.join(evidence, 'model-binding.json'), { source: config.modelProfile, savedModel, nativeVersion: config.dshVersion,
    entry: 'Embedded installed Cordis + native DSH agent-loop/TeamService/DeepSeekAdapter/JSONL persistence' });
  ctx = new sdk.cordis.Context();
  const mount = async (name, configuration = {}) => { const fiber = ctx.plugin(sdk[name].default ?? sdk[name], configuration); await fiber.await(); };
  for (const name of ['dsh-agent', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-llm', 'dsh-tools']) await mount(name);
  await mount('dsh-session-persistence-jsonl', { root: path.join(runtimeDir, 'sessions'), compression: 'none' });
  await mount('dsh-agent-loop', { agents: [], maxParallelToolCalls: 1 });
  await mount('dsh-subagent', { maxDepth: 2, maxActiveSubagents: 4 });
  await mount('dsh-subagent-spawn-in-process', { providerName: 'spawn' });
  await mount('dsh-subagent-fork-in-process', { providerName: 'fork' });
  await mount('dsh-experimental-agent-team', { maxMembers: 6, maxTasks: 8 });
  const credentialPath = path.join(os.homedir(), '.dsh/.credentials.yaml');
  const credentials = sdk['dsh-credentials-local'].parseCredentialsDocument(fs.readFileSync(credentialPath, 'utf8'), credentialPath);
  const apiKey = process.env.DEEPSEEK_API_KEY ?? credentials.refs.get('DEEPSEEK_API_KEY');
  assert.equal(typeof apiKey, 'string', 'Configured native provider credential missing');
  const native = sdk['dsh-llm-deepseek'];
  const connection = native.resolveAdapterOptions({ reasoningEffort: config.thinking, maxTokens: config.maxOutputTokens,
    retryPolicy: { mode: 'normal', maxRetries: 0 } });
  assert.equal(new URL(connection.baseURL).origin, 'https://api.deepseek.com');
  ctx.llm.registerAdapter([config.provider], new native.DeepSeekAdapter({ options: () => connection,
    resolveAuth: async () => ({ headers: { 'x-api-key': apiKey } }),
    resolveUserId: () => fs.readFileSync(path.join(os.homedir(), '.dsh/.anonymous-user-id'), 'utf8').trim(),
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }) }));
  ctx.systemPrompt.section({ name: 'host-context', order: 10, text: 'HOST_CONTEXT_DSH_SCENARIO. You are a coding agent in a real DSH persistent session. Read actual task files and use provided tools. No network, install, credentials, arbitrary shell or commits. Only the parent is a scratch integration writer. Workers submit full replacement proposals preserving unrelated source. All tool results are real; never invent evidence. Follow the role and stage instructions in each prompt. End after completing the requested tool work.' });
  const definitions = Object.fromEntries(['parent', 'logic', 'tests', 'verifier'].map(role => [role, toolDefinitions(role, pause)]));
  const names = new Set(Object.values(definitions).flat().map(t => t.name));
  for (const name of names) {
    const template = Object.values(definitions).flat().find(t => t.name === name);
    ctx.tools.register(sdk['dsh-tools'].defineTool({ ...template, execute: (args, execution) => {
      const role = roles.get(execution.agent.id), definition = definitions[role].find(t => t.name === name);
      return definition.execute(args, execution);
    } }));
  }
  ctx.on('tools/pre-execute', async (execution, next) => {
    const role = roles.get(execution.agent.id);
    const allowed = definitions[role].some(t => t.name === execution.name);
    record('tools-pre-execute', { sessionId: execution.agent.id, role, name: execution.name, callId: execution.callId, allowed });
    return allowed ? next() : { kind: 'deny', reason: 'Outside kernel-admitted role tool scope' };
  });
  ctx.on('tools/result', (execution, result) => record('tools-result', { sessionId: execution.agent.id,
    role: roles.get(execution.agent.id), name: execution.name, callId: execution.callId, isError: result.isError }));
  ctx.on('agent/created', ({ agent, source }) => {
    const member = ctx.agentTeams.tryMembership(agent);
    if (member?.role === 'teammate') roles.set(agent.id, member.name.startsWith('verifier') ? 'verifier' : member.name);
    else roles.set(agent.id, 'parent');
    record('agent-created', { sessionId: agent.id, source, role: roles.get(agent.id) ?? 'parent', nativeOptions: agent.options });
  });
  ctx.on('agent/status', ({ agent, status }) => record('agent-status', { sessionId: agent.id, status }));
  ctx.on('agent/disposed', ({ agent }) => record('agent-disposed', { sessionId: agent.id }));
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const last = messages.findLast(m => m.role === 'user');
    if (last?.source?.kind === 'subagent-settled' && !authorizedTurns.has(agent.id)) {
      record('background-notice-parked', { sessionId: agent.id }); return { kind: 'reject' };
    }
    return next();
  });
  ctx.on('session/event', (session, event) => {
    record('session-event', { sessionId: session.id, seq: event.seq, eventType: event.type });
    if (event.type === 'assistant/message' || event.type === 'assistant/attempt') recordNativeUsage(session.id, event);
  });
  removeMeter = installMeter(ctx, roles);
}
export const agentOptions = () => ({ provider: config.provider, model: config.model,
  reasoningEffort: sdk['dsh-llm'].ReasoningEffortId(config.thinking), maxTokens: config.maxOutputTokens });
export async function createParent(id) {
  roles.set(id, 'parent');
  const handle = await ctx.agents.create({ sessionId: sdk['dsh-session'].SessionId(id), meta: { cwd: config.scratch }, agentOptions: agentOptions() });
  handles.push(handle); return handle;
}
export async function turn(agent, prompt) {
  const seq = agent.session.seq; authorizedTurns.add(agent.id);
  try { agent.followup(user(prompt)); await agent.whenIdle(); await drain(); }
  finally { authorizedTurns.delete(agent.id); }
  const events = agent.session.snapshotEvents().filter(e => e.seq >= seq);
  const end = events.findLast(e => e.type === 'turn/end');
  record('turn-result', { sessionId: agent.id, fromSeq: seq, toSeq: agent.session.seq, reason: end?.data.reason });
  assert(end, 'Native turn must actually end');
  assert.notEqual(end.data.reason.kind, 'error', 'Native turn failed; inspect private session trace');
  await ctx.sessionPersistence.flush(); return events;
}
export async function cleanup() {
  await drain();
  for (const handle of handles.toReversed()) await handle.dispose();
  await ctx.fiber.dispose(); removeMeter();
}
