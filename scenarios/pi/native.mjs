import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { bindPiSession } from '../../dist/hosts/pi/index.js';
import { bindPiChildExecutor } from '../../dist/hosts/pi/delegation-executor.js';
import { bindPiSharedRequests } from '../../dist/hosts/pi/delegation-budget.js';
import { mapPiUsage } from '../../dist/hosts/pi/usage.js';
import { openBudgetLedger } from '../../dist/kernel/policy/index.js';
import { config, evidence, root, runtimeDir, attempt, value, writeJson, record } from './io.mjs';
import { toolsFor } from './task-tools.mjs';

export const policy = { poolId: 'pi-scenario-pool', category: 'development', authorizationRef: null,
  maxRequests: config.maxRequests, maxInputTokens: config.maxInputTokens * config.maxRequests,
  maxOutputTokens: config.maxOutputTokens * config.maxRequests, maxUsdMicros: null,
  maxWallMs: 7200000, maxConcurrentRequests: 4, priceRef: null, missingUsagePolicy: 'retain-reservation' };
export const clock = { now: () => Date.now() };
let poolState;
export let pool, sdk;
let modelRuntime, settings, budget;
const sessions = [], observers = [];
const budgetFile = path.join(root, 'MODEL-BUDGET.json');
const saveBudget = () => writeJson(budgetFile, budget);
export const poolSnapshot = () => poolState;
export const budgetSnapshot = () => budget;
export async function setup() {
  assert.equal(JSON.parse(fs.readFileSync(path.join(config.piPackage, 'package.json'))).version, config.piVersion);
  const agentDir = path.join(runtimeDir, 'agent'); fs.mkdirSync(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir; process.env.PI_OFFLINE = '1'; process.env.PI_TELEMETRY = '0';
  sdk = await import(pathToFileURL(path.join(config.piPackage, 'dist/index.js')).href);
  const auth = await import(pathToFileURL(path.join(config.piPackage, 'dist/core/auth-storage.js')).href);
  const cached = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.pi/agent/models-store.json'))).deepseek.models.find(m => m.id === config.model);
  const fields = ['id', 'name', 'api', 'provider', 'baseUrl', 'reasoning', 'input', 'cost', 'contextWindow', 'maxTokens', 'compat', 'thinkingLevelMap', 'type'];
  const model = Object.fromEntries(fields.filter(k => cached[k] !== undefined).map(k => [k, cached[k]]));
  assert.equal(model.baseUrl, 'https://api.deepseek.com');
  assert.equal(model.cost.input, config.referencePricePerMillion.input);
  assert.equal(model.cost.output, config.referencePricePerMillion.output);
  assert.equal(model.cost.cacheRead, config.referencePricePerMillion.cacheRead);
  const modelsPath = path.join(agentDir, 'models-store.json'); writeJson(modelsPath, { deepseek: { models: [model] } });
  const credential = auth.readStoredCredential(config.provider, path.join(os.homedir(), '.pi/agent/auth.json'));
  assert.equal(credential?.type, 'api_key', 'authorized provider credential required');
  modelRuntime = await sdk.ModelRuntime.create({ credentials: auth.AuthStorage.inMemory({ deepseek: credential }),
    modelsPath: null, modelsStorePath: modelsPath, allowModelNetwork: false });
  settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false,
    provider: { maxRetries: 0, timeoutMs: 120000 } }, cacheWarming: 'off', packages: [], defaultProjectTrust: 'never' });
  const legacyFile = path.join(config.integration, 'docs/evofence-harness-kernel/execution/MODEL-BUDGET.json');
  if (fs.existsSync(budgetFile)) budget = JSON.parse(fs.readFileSync(budgetFile));
  else budget = { ...JSON.parse(fs.readFileSync(legacyFile)), scenarioRuns: [] };
  if (budget.scenarioRuns.some(r => r.id === 'l3-pi-scenario')) {
    record('scenario-process-resume', { existingRequests: budget.requests.filter(r => r.scenario === 'l3-pi-scenario').length });
  } else budget.scenarioRuns.push({ id: 'l3-pi-scenario', startedAt: new Date().toISOString(), limitUsd: null,
    legacyLimitApplies: false, authorization: 'L3-pi-scenario-brief + FROZEN v1 TASK-CONTRACT; user 2026-10-02',
    model: 'deepseek/deepseek-flash', thinking: 'high', referencePrice: config.referencePricePerMillion,
    priceBasis: config.priceBasis, maxRequests: config.maxRequests,
    plannedReferenceUpperUsd: config.maxRequests * (config.maxInputTokens * .3 + config.maxOutputTokens * 1.2) / 1e6 });
  saveBudget();
  const poolFile = path.join(root, 'evidence', 'request-pool.json');
  poolState = fs.existsSync(poolFile) ? JSON.parse(fs.readFileSync(poolFile))
    : { ledger: value(openBudgetLedger(policy, 1000000)), owners: [], usage: [] };
  pool = bindPiSharedRequests(() => poolState, next => { poolState = next; writeJson(poolFile, poolState); });
}
export async function makeSession(role, manager, spec, promptFor, pause, attach = true, resume = false) {
  let session, bound;
  const id = manager.getSessionId(), localObservers = [];
  const extension = api => {
    for (const tool of toolsFor(role, pause)) api.registerTool(tool);
    if (!attach) return;
    const options = { version: config.piVersion, kernelSessionId: 'pi-scenario', hostSessionId: id,
      session: () => session, clock, prompt: promptFor,
      context: async () => ({ ok: true, value: [{ role: 'user', content: [{ type: 'text', text: `Finite node context: ${role}; execute only its declared tools and ownership.` }], timestamp: Date.now() }] }),
      toolGate: async () => ({ ok: true, value: undefined }),
      toolResult: async (_a, e) => record('tool-result', { sessionId: id, role, toolName: e.toolName, callId: e.toolCallId, isError: e.isError }),
      fault: error => { record('binding-fault', { sessionId: id, code: error.code }); },
      agentEnd: async () => { await Promise.all(localObservers); },
    };
    bound = value(spec ? bindPiChildExecutor(api, spec, options) : bindPiSession(api, options));
  };
  const resources = new sdk.DefaultResourceLoader({ cwd: config.scratch, agentDir: path.join(runtimeDir, 'agent'),
    settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [extension], systemPrompt: 'You are a coding agent inside a real Pi native persistent session. HOST_CONTEXT_PI_SCENARIO. Work only on the bounded ledger show --limit task. Use provided tools to read real source and act. Never invent results. No network, package installation, arbitrary shell, or credential access. Full replacement proposals must preserve all unrelated existing code. Be concise after finishing your actual tool work.' });
  await resources.reload();
  ({ session } = await sdk.createAgentSession({ cwd: config.scratch, agentDir: path.join(runtimeDir, 'agent'), modelRuntime,
    model: modelRuntime.getModel(config.provider, config.model), thinkingLevel: config.thinking,
    settingsManager: settings, resourceLoader: resources, sessionManager: manager,
    tools: toolsFor(role, pause).map(t => t.name),
    sessionStartEvent: { type: 'session_start', reason: resume ? 'resume' : 'startup' } }));
  sessions.push(session);
  let ordinal = 0, currentRequest = null;
  const native = session.agent.streamFunction;
  session.agent.streamFunction = (m, c, o) => native(m, c, { ...o, maxTokens: config.maxOutputTokens,
    maxRetries: 0, timeoutMs: 120000, fetch: async (url, init) => {
      const payload = JSON.parse(init.body);
      assert.equal(new URL(url).origin, 'https://api.deepseek.com');
      assert.equal(payload.model, config.model); assert.equal(payload.reasoning_effort, 'high');
      assert.equal(payload.thinking.type, 'enabled'); assert.equal(payload.max_tokens, config.maxOutputTokens);
      // UTF-8 byte count is a conservative token ceiling at this real transport boundary.
      const bytes = Buffer.byteLength(init.body);
      if (bytes > config.maxRequestBytes) {
        record('transport-not-dispatched', { sessionId: id, role, requestBytes: bytes, ceiling: config.maxRequestBytes });
        throw new Error('transport input byte ceiling');
      }
      currentRequest = `scenario:${id}:${++ordinal}:${budget.requests.length + 1}`;
      const requestId = currentRequest, invocation = spec?.invocationId ?? `parent:${id}`;
      value((spec?.requests ?? pool).beforeRequest(requestId, invocation, spec?.grant.budget ?? policy,
        { inputTokens: config.maxRequestBytes, outputTokens: config.maxOutputTokens, usdMicros: 1000000 }));
      const row = { id: requestId, scenario: 'l3-pi-scenario', attempt, sessionId: id, role,
        provider: config.provider, model: config.model, thinking: config.thinking, status: 'reserved',
        dispatchedAt: new Date().toISOString(), requestBytes: bytes, payload: { model: payload.model,
          thinking: payload.thinking, reasoning_effort: payload.reasoning_effort, max_tokens: payload.max_tokens },
        httpStatus: null, usage: null, referenceUsd: null, invoiceUsd: null };
      budget.requests.push(row); saveBudget(); record('provider-dispatch', { requestId, sessionId: id, role });
      let response;
      try { response = await fetch(url, init); }
      catch (error) { row.status = 'unknown'; row.error = error.name; saveBudget(); throw error; }
      row.httpStatus = response.status; saveBudget();
      const observed = (async () => {
        const reader = response.clone().body.getReader(), decoder = new TextDecoder(); let pending = '';
        while (true) {
          const next = await reader.read(); pending += decoder.decode(next.value, { stream: !next.done });
          const lines = pending.split('\n'); pending = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ') || line.slice(6).trim() === '[DONE]') continue;
            const parsed = JSON.parse(line.slice(6)); if (parsed.usage) row.usage = parsed.usage;
          }
          if (next.done) break;
        }
        const u = row.usage, cached = u?.prompt_tokens_details?.cached_tokens;
        assert(Number.isSafeInteger(u?.prompt_tokens) && Number.isSafeInteger(u?.completion_tokens)
          && Number.isSafeInteger(cached) && cached >= 0 && cached <= u.prompt_tokens
          && u.total_tokens === u.prompt_tokens + u.completion_tokens, 'complete raw provider usage required');
        row.referenceUsd = ((u.prompt_tokens - cached) * .3 + cached * .006 + u.completion_tokens * 1.2) / 1e6;
        row.status = 'settled'; record('provider-settled', { requestId, tokens: u.total_tokens, referenceUsd: row.referenceUsd });
      })().catch(error => { row.status = 'unknown'; row.error = error.name; record('provider-usage-unknown', { requestId, error: error.name }); })
        .finally(() => { row.finishedAt = new Date().toISOString(); saveBudget(); });
      observers.push(observed); localObservers.push(observed); return response;
    } });
  session.subscribe(event => {
    if (['agent_start', 'agent_end', 'agent_settled', 'tool_execution_start', 'tool_execution_end'].includes(event.type)) {
      record('native-' + event.type, { sessionId: id, role, toolName: event.toolName, callId: event.toolCallId });
    }
    if (event.type === 'message_end' && event.message.role === 'assistant' && currentRequest !== null) {
      const usage = value(mapPiUsage(currentRequest, event.message));
      const settled = (spec?.requests ?? pool).record(usage);
      record('native-usage', { sessionId: id, requestId: currentRequest, stopReason: event.message.stopReason,
        complete: usage.complete, poolRecorded: settled.ok, usage });
    }
  });
  await session.bindExtensions({ mode: 'non_interactive', onError: e => { throw new Error(`native hook ${e.event}: ${e.message}`); } });
  record(resume ? 'session-reopened' : 'session-created', { sessionId: id, role, file: manager.getSessionFile(),
    messages: session.messages.length, parentId: spec?.parentSessionId ?? null, grade: 'provider-live' });
  const host = bound?.host;
  return { sessionId: id, session, manager, resources, bound,
    host: host === undefined ? null : { ...host, async execute(a) { const r = await host.execute(a); await Promise.all(localObservers); return r; } },
    async drain() { await Promise.all(localObservers); },
    dispose() { if (spec) bound.dispose(); else { bound?.unload(); session.dispose(); } } };
}
export async function cleanup() {
  await Promise.all(observers);
  for (const session of sessions) session.dispose();
}
