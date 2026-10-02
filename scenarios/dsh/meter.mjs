import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config, root, evidence, record, writeJson, value, digest } from './io.mjs';
import { openBudgetLedger, reserve, settle } from '../../dist/kernel/policy/index.js';

const attribution = new AsyncLocalStorage();
const budgetFile = path.join(root, 'MODEL-BUDGET.json');
export const budget = fs.existsSync(budgetFile) ? JSON.parse(fs.readFileSync(budgetFile))
  : { requests: [], scenarioRuns: [{ id: 'l3-dsh-scenario', limitUsd: null, authorization: 'FROZEN v1 + L3 brief',
    model: `${config.provider}/${config.model}`, thinking: config.thinking, priceBasis: config.priceBasis }] };
const observations = [];
export const requestPolicy = { poolId: 'dsh-scenario-pool', category: 'development', authorizationRef: null,
  maxRequests: config.maxRequests, maxInputTokens: config.maxInputTokens * config.maxRequests,
  maxOutputTokens: config.maxOutputTokens * config.maxRequests, maxUsdMicros: null,
  maxWallMs: 7200000, maxConcurrentRequests: 4, priceRef: null, missingUsagePolicy: 'retain-reservation' };
const poolFile = path.join(evidence, 'request-pool.json');
export let requestPool = fs.existsSync(poolFile) ? JSON.parse(fs.readFileSync(poolFile)) : value(openBudgetLedger(requestPolicy, 1000000));
const save = () => writeJson(budgetFile, budget);
const savePool = () => writeJson(poolFile, requestPool);
export const drain = () => Promise.all(observations);
function completeRow(row, tokens, basis) {
  row.tokens = tokens;
  const p = config.referencePricePerMillion;
  row.referenceUsd = ((tokens.inputUncached + tokens.cacheWrite) * p.input + tokens.output * p.output + tokens.cacheRead * p.cacheRead) / 1e6;
  row.outcome = 'settled'; row.usageBasis = basis; row.endedAt = new Date().toISOString();
  const settled = settle(requestPool, { requestId: row.requestId, micros: Math.ceil(row.referenceUsd * 1e6), complete: true, digest: digest(JSON.stringify(tokens)) });
  assert.equal(settled.error, null); requestPool = settled.ledger; savePool();
  writeJson(path.join(evidence, `${row.requestId}.json`), row); save();
}
export function reconcileNativeReceipts() {
  for (const row of budget.requests.filter(r => r.tokens === null && r.nativeUsage !== null)) {
    const u = row.nativeUsage;
    assert(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'].every(k => Number.isSafeInteger(u[k])));
    row.reconciliation = { originalOutcome: row.outcome, source: 'Existing native assistant/message receipt', at: new Date().toISOString() };
    completeRow(row, { inputUncached: u.inputTokens, output: u.outputTokens, cacheRead: u.cacheReadTokens, cacheWrite: u.cacheWriteTokens, total: u.totalTokens }, 'host-normalized; original provider raw capture unknown');
    record('usage-reconciled', { requestId: row.requestId, nativeEventSeq: row.nativeEventSeq, originalOutcome: row.reconciliation.originalOutcome });
  }
}
export function installMeter(ctx, roles) {
  save(); savePool();
  ctx.on('llm/stream', async function* (options, next) {
    const identity = { sessionId: options.sessionId, role: roles.get(options.sessionId) };
    const iterator = next()[Symbol.asyncIterator]();
    for (;;) {
      const step = await attribution.run(identity, () => iterator.next());
      if (step.done) break;
      yield step.value;
    }
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).origin, 'https://api.deepseek.com', 'Only configured model API network is authorized');
    const identity = attribution.getStore();
    assert(identity, 'Every actual provider HTTP request needs native session attribution');
    assert(budget.requests.length < config.maxRequests, 'Scenario request stopping bound');
    const payload = JSON.parse(init.body);
    assert.equal(payload.model, config.model);
    const row = { requestId: `dsh-http-${budget.requests.length + 1}`, scenario: 'l3-dsh-scenario',
      sessionId: identity.sessionId, role: identity.role, provider: config.provider, model: payload.model,
      thinking: payload.thinking, reasoningEffort: payload.reasoning_effort ?? payload.output_config?.effort ?? null,
      maxTokens: payload.max_tokens, startedAt: new Date().toISOString(), outcome: 'dispatched',
      rawUsage: null, nativeUsage: null, tokens: null, referenceUsd: null, invoiceUsd: null };
    const reserved = reserve(requestPool, { requestId: row.requestId, role: 'worker', parentRequestId: identity.sessionId });
    assert.equal(reserved.error, null); requestPool = reserved.ledger; savePool();
    budget.requests.push(row); save(); record('provider-dispatch', { requestId: row.requestId, sessionId: row.sessionId, role: row.role });
    let response;
    try { response = await nativeFetch(url, init); }
    catch (error) { row.outcome = 'transport-error-usage-unknown'; row.errorName = error.name; row.endedAt = new Date().toISOString(); save(); throw error; }
    row.httpStatus = response.status; save();
    const usage = {}, frames = [], decoder = new TextDecoder(); let buffer = '';
    const tap = new TransformStream({ transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ') || line.trim() === 'data: [DONE]') continue;
        const frame = JSON.parse(line.slice(6)); const u = frame.message?.usage ?? frame.usage;
        if (u) { frames.push({ type: frame.type, usage: u }); Object.assign(usage, u); row.rawUsage = frames; }
        if (frame.type === 'message_stop') {
          assert(['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].every(k => Number.isSafeInteger(usage[k])));
          completeRow(row, { inputUncached: usage.input_tokens, output: usage.output_tokens,
            cacheRead: usage.cache_read_input_tokens, cacheWrite: usage.cache_creation_input_tokens,
            total: usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens }, 'provider-raw');
        }
      }
      controller.enqueue(chunk);
    } });
    return new Response(response.body.pipeThrough(tap), { status: response.status, headers: response.headers });
  };
  return () => { globalThis.fetch = nativeFetch; };
}
export function recordNativeUsage(sessionId, event) {
  const row = budget.requests.findLast(r => r.sessionId === sessionId && r.nativeUsage === null);
  if (row === undefined && event.data.usage === undefined) {
    record('native-attempt-no-http', { sessionId, seq: event.seq }); return;
  }
  assert(row, 'Unattributed native assistant receipt');
  row.nativeUsage = event.data.usage ?? null; row.nativeEventSeq = event.seq;
  writeJson(path.join(evidence, `${row.requestId}.json`), row); save();
}
export function summarize() {
  const complete = budget.requests.filter(r => r.tokens !== null);
  const totalTokens = complete.reduce((n, r) => n + r.tokens.total, 0);
  const row = { requests: budget.requests.length, totalTokens, referenceUsd: complete.reduce((n, r) => n + r.referenceUsd, 0),
    unknownUsageRequests: budget.requests.filter(r => r.tokens === null).map(r => r.requestId), invoiceUsd: null,
    costMeaning: '参考非账单', priceBasis: config.priceBasis, codexSubscriptionUsage: 'unknown' };
  writeJson(path.join(evidence, 'cost-summary.json'), row); return row;
}
