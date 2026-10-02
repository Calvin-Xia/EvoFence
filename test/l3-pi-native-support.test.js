// Explicit probe infrastructure only; importing this file never opens sessions or reads credentials.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export const packageRoot = process.env.EVOFENCE_PI_PACKAGE_ROOT ?? path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent');
export const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
export async function infrastructure(live) {
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(metadata.version, '0.99.2', 'native SDK must match approved pin');
  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evofence-pi-0992-'));
  const agentDir = path.join(privateDir, 'agent'), cwd = path.join(privateDir, 'host');
  fs.mkdirSync(agentDir); fs.mkdirSync(cwd);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = '1'; process.env.PI_TELEMETRY = '0';
  fs.writeFileSync(path.join(cwd, 'AGENTS.md'), 'EVOFENCE_HOST_CONTEXT: use only requested smoke tools.\n');
  const skill = path.join(agentDir, 'skills', 'host-fixture'); fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: host-fixture\ndescription: EVOFENCE_HOST_SKILL resource preservation marker.\n---\nControlled host skill.\n');
  const sdk = await import(pathToFileURL(path.join(packageRoot, 'dist/index.js')).href);
  const auth = await import(pathToFileURL(path.join(packageRoot, 'dist/core/auth-storage.js')).href);
  const catalog = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.pi/agent/models-store.json'), 'utf8'));
  const cached = catalog.deepseek.models.find(m => m.id === 'deepseek-flash');
  assert(cached, 'authorized model must exist in local catalog');
  const publicFields = ['id', 'name', 'api', 'provider', 'baseUrl', 'reasoning', 'input', 'cost', 'contextWindow', 'maxTokens', 'compat', 'thinkingLevelMap', 'type'];
  const model = Object.fromEntries(publicFields.filter(k => cached[k] !== undefined).map(k => [k, cached[k]]));
  assert.equal(model.baseUrl, 'https://api.deepseek.com');
  assert.deepEqual(model.cost, { input: .3, output: 1.2, cacheRead: .006, cacheWrite: 0 });
  const modelsStorePath = path.join(agentDir, 'models-store.json');
  writeJson(modelsStorePath, { deepseek: { models: [model] } });
  // Read only the selected credential into memory; never persist or log it.
  const credential = live ? auth.readStoredCredential('deepseek', path.join(os.homedir(), '.pi/agent/auth.json'))
    : { type: 'api_key', key: 'native-fixture-placeholder' };
  assert.equal(credential?.type, 'api_key', 'existing selected-provider authentication required');
  const runtime = await sdk.ModelRuntime.create({ credentials: auth.AuthStorage.inMemory({ deepseek: credential }),
    modelsPath: null, modelsStorePath, allowModelNetwork: false });
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0, timeoutMs: 30000 } },
    cacheWarming: 'off', packages: [], defaultProjectTrust: 'never' });
  let releaseHold; const holdStarted = new Promise(r => { releaseHold = r; });
  let disconnected = false, requestOrdinal = 0;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const p = JSON.parse(body), serialized = JSON.stringify(p.messages);
    if (serialized.includes('HOLD_FOR_ABORT')) { res.on('close', () => { disconnected = true; }); releaseHold(); return; }
    const bootstrap = serialized.includes('HOST_BOOTSTRAP') && !serialized.includes('KERNEL_SMOKE');
    const toolSeen = p.messages.some(m => m.role === 'tool');
    const delta = bootstrap || toolSeen ? { role: 'assistant', content: 'smoke-ok' }
      : { role: 'assistant', reasoning_content: 'Fixture reasoning.', tool_calls: [
        { index: 0, id: 'echo-1', type: 'function', function: { name: 'evofence_smoke_echo', arguments: '{"text":"smoke-ok"}' } },
        { index: 1, id: 'deny-1', type: 'function', function: { name: 'evofence_smoke_denied', arguments: '{"text":"denied"}' } },
      ] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (choices, usage) => ({ id: `native-${++requestOrdinal}`, object: 'chat.completion.chunk', created: 1, model: p.model, choices, ...(usage ? { usage } : {}) });
    for (const data of [chunk([{ index: 0, delta, finish_reason: null }]),
      chunk([{ index: 0, delta: {}, finish_reason: bootstrap || toolSeen ? 'stop' : 'tool_calls' }]),
      chunk([], { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220,
        prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 4 } })]) {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/v1`;
  return { sdk, runtime, settings, agentDir, cwd, privateDir, fixtureUrl, model, holdStarted,
    disconnected: () => disconnected,
    async close() { server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}

/** Observe transport usage without retaining prompts, reasoning, credentials or headers. */
export function meter(session, live, rows, payloads, output) {
  const native = session.agent.streamFunction, observers = [];
  session.agent.streamFunction = (model, context, options) => native(model, context, { ...options,
    maxTokens: 2048, maxRetries: 0, timeoutMs: 30000,
    fetch: async (url, init) => {
      const p = JSON.parse(init.body), origin = new URL(String(url)).origin;
      assert(live ? origin === 'https://api.deepseek.com' : origin.startsWith('http://127.0.0.1:'), 'unexpected provider origin');
      assert.equal(p.model, 'deepseek-flash');
      assert.equal(p.reasoning_effort, 'high'); assert.equal(p.thinking.type, 'enabled');
      assert.equal(p.max_tokens, 2048);
      if (live) { assert(rows.length < 2, 'maximum two paid requests'); assert(rows.every(r => r.status === 'settled'), 'stop paid path on unknown usage'); }
      const row = { id: `${live ? 'provider' : 'native'}-${rows.length + 1}`, status: 'reserved', reservedAt: new Date().toISOString(),
        referenceUpperUsd: live ? .3024576 : null, httpStatus: null, usage: null, estimatedUsd: null };
      rows.push(row); if (output) writeJson(output, rows);
      payloads.push({ requestId: row.id, model: p.model, origin, reasoningEffort: p.reasoning_effort,
        thinking: p.thinking, maxTokens: p.max_tokens,
        hostContextPreserved: JSON.stringify(p.messages).includes('EVOFENCE_HOST_CONTEXT'),
        hostSkillPreserved: JSON.stringify(p.messages).includes('EVOFENCE_HOST_SKILL'),
        nodeContextInjected: JSON.stringify(p.messages).includes('EVOFENCE_NODE_CONTEXT'),
        toolNames: p.tools.map(t => t.function.name) });
      let response;
      try { response = await fetch(url, init); }
      catch (error) { row.status = 'unknown'; if (output) writeJson(output, rows); throw error; }
      row.httpStatus = response.status;
      const observed = response.clone().text().then(text => {
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ') || line.slice(6).trim() === '[DONE]') continue;
          const data = JSON.parse(line.slice(6)); if (data.usage) row.usage = data.usage;
        }
        const u = row.usage, cached = u?.prompt_tokens_details?.cached_tokens;
        if (!Number.isInteger(u?.prompt_tokens) || !Number.isInteger(u?.completion_tokens) || !Number.isInteger(cached)
          || u.total_tokens !== u.prompt_tokens + u.completion_tokens || cached < 0 || cached > u.prompt_tokens) {
          row.status = 'unknown'; return;
        }
        row.status = 'settled'; row.estimatedUsd = live ? ((u.prompt_tokens - cached) * .3 + cached * .006 + u.completion_tokens * 1.2) / 1e6 : null;
      }).catch(() => { row.status = 'unknown'; }).finally(() => { if (output) writeJson(output, rows); });
      observers.push(observed); return response;
    } });
  return () => Promise.all(observers);
}
