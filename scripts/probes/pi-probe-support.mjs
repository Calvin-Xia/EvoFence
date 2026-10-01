import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const root = process.cwd();
export const packageRoot = process.env.EVOFENCE_PI_PACKAGE_ROOT ?? path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent');
export const privateRoot = path.join(root, '.graph/execution-private/pi-s01');
export const outputRoot = path.join(root, 'docs/evofence-harness-kernel/probes/pi');
export const pricingSource = 'https://mimo.mi.com/docs/en-US/price/pay-as-you-go';
export const thinkingSource = 'https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/deep-thinking';
export const price = { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 };
export const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
export async function loadSdk(live) {
  const agentDir = path.join(privateRoot, live ? 'live-agent' : 'offline-agent');
  fs.mkdirSync(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = '1';
  process.env.PI_TELEMETRY = '0';
  const pkg = readJson(path.join(packageRoot, 'package.json'));
  if (pkg.version !== '0.87.1') throw new Error('Re-probe required: Pi version changed');
  const originalCatalog = readJson(path.join(os.homedir(), '.pi/agent/models-store.json'));
  const cached = originalCatalog.xiaomi?.models?.find(m => m.id === 'mimo-v2.6-flash');
  if (!cached) throw new Error('Requested model missing from local catalog');
  const publicFields = ['id','name','api','provider','baseUrl','reasoning','input','cost','contextWindow','maxTokens','compat','thinkingLevelMap','samplingParams'];
  const model = Object.fromEntries(publicFields.filter(k => cached[k] !== undefined).map(k => [k,cached[k]]));
  // Only public model metadata is copied. Auth is never copied to disk.
  const modelsStorePath = path.join(agentDir, 'models-store.json');
  writeJson(modelsStorePath, { xiaomi: { models: [model], checkedAt: originalCatalog.xiaomi.checkedAt } });
  const sdk = await import(pathToFileURL(path.join(packageRoot, 'dist/index.js')).href);
  const authModule = await import(pathToFileURL(path.join(packageRoot, 'dist/core/auth-storage.js')).href);
  let credential = { type: 'api_key', key: 'offline-probe-not-a-real-key' };
  if (live) {
    credential = authModule.readStoredCredential('xiaomi', path.join(os.homedir(), '.pi/agent/auth.json'));
    if (credential?.type !== 'api_key' || !credential.key) throw new Error('Xiaomi API-key credential unavailable');
  }
  const credentials = authModule.AuthStorage.inMemory({ xiaomi: credential });
  const modelRuntime = await sdk.ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath, allowModelNetwork: false });
  const selectedModel = modelRuntime.getModel('xiaomi', 'mimo-v2.6-flash');
  if (!selectedModel) throw new Error('Pi runtime cannot resolve requested model');
  if (selectedModel.baseUrl !== 'https://api.xiaomimimo.com/v1') throw new Error('Unexpected billable provider endpoint');
  for (const [k,v] of Object.entries(price)) if (selectedModel.cost[k] !== v) throw new Error('Cached price differs from verified official USD reference');
  const pinFiles = ['package.json','dist/core/sdk.js','dist/core/agent-session.js','dist/core/model-runtime.js','dist/core/extensions/types.d.ts','node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js'];
  const pin = { version: pkg.version, providerModel: 'xiaomi/mimo-v2.6-flash', selectedModel, catalogSource: 'read-only local catalog; network refresh disabled',
    files: pinFiles.map(file => ({file,sha256:hash(fs.readFileSync(path.join(packageRoot,file)))})), pricingSource, price, thinkingSource };
  writeJson(path.join(outputRoot, 'VERSION-PIN.json'), pin);
  return { sdk, agentDir, modelRuntime, model: selectedModel, pin };
}

const budgetFile = path.join(root, 'docs/evofence-harness-kernel/execution/MODEL-BUDGET.json');
const reservationUsd = 0.16; // Full 1,048,576 input-token window + <=4,096 output tokens at verified USD rates.
export function reserveRequest(payload, requestId) {
  const budget = readJson(budgetFile);
  if (budget.providerModel !== 'xiaomi/mimo-v2.6-flash' || budget.reasoning !== 'high') throw new Error('Budget/model authorization mismatch');
  if (budget.unknownSpend) throw new Error('Prior unknown model spend must be reconciled before another paid probe');
  if (budget.requests.some(r => r.id === requestId)) throw new Error('Duplicate request reservation');
  const remaining = budget.limit - budget.settledUsd - budget.reservedUsd;
  if (remaining + 1e-9 < reservationUsd) throw new Error('Global model budget insufficient');
  if (payload.model !== 'mimo-v2.6-flash' || payload.thinking?.type !== 'enabled' || payload.reasoning_effort !== 'high') throw new Error('Unexpected model/thinking payload');
  if (!Number.isInteger(payload.max_completion_tokens) || payload.max_completion_tokens > 4096) throw new Error('Response bound missing');
  if (payload.web_search || payload.enable_search) throw new Error('Unbudgeted search disabled');
  budget.requests.push({ id: requestId, session: 'S01', host: 'pi', status: 'reserved', reservedUsd: reservationUsd, reservedAt: new Date().toISOString(),
    pricingSource, costBasis: 'Official USD reference calculated from provider token usage; not an invoice', maxOutputTokens: payload.max_completion_tokens,
    maxInputTokens: 1048576, reasoningRequested: 'high', reasoningEffortEmitted: payload.reasoning_effort,
    reasoningEffective: 'thinking.enabled verified; reasoning_effort=high emitted and accepted but API does not document its tier semantics' });
  budget.reservedUsd = Number((budget.reservedUsd + reservationUsd).toFixed(9));
  budget.status = 'Paid Pi probe reserved; no automatic retries or warming';
  writeJson(budgetFile, budget);
}
export function settleRequest(requestId, rawUsage, httpStatus) {
  const budget = readJson(budgetFile);
  const request = budget.requests.find(r => r.id === requestId);
  if (!request || request.status !== 'reserved') throw new Error('No live reservation to settle');
  const valid = Number.isInteger(rawUsage?.prompt_tokens) && Number.isInteger(rawUsage?.completion_tokens)
    && rawUsage.prompt_tokens > 0 && rawUsage.completion_tokens > 0 && Number.isInteger(rawUsage.total_tokens)
    && rawUsage.total_tokens === rawUsage.prompt_tokens + rawUsage.completion_tokens;
  if (!valid) {
    request.status = 'unknown'; request.httpStatus = httpStatus; budget.unknownSpend = true;
    budget.status = 'Missing complete provider usage; conservative reservation retained'; writeJson(budgetFile,budget); return;
  }
  const cached = rawUsage.prompt_tokens_details?.cached_tokens ?? 0;
  if (!Number.isInteger(cached) || cached < 0 || cached > rawUsage.prompt_tokens) throw new Error('Invalid cache accounting');
  const cost = ((rawUsage.prompt_tokens-cached)*price.input + cached*price.cacheRead + rawUsage.completion_tokens*price.output)/1e6;
  if (cost > request.reservedUsd + 1e-9) throw new Error('Provider cost exceeded request reservation');
  Object.assign(request,{status:'settled',httpStatus,usage:rawUsage,estimatedUsd:Number(cost.toFixed(9)),settledAt:new Date().toISOString()});
  budget.reservedUsd = Number((budget.reservedUsd-request.reservedUsd).toFixed(9));
  budget.settledUsd = Number((budget.settledUsd+cost).toFixed(9));
  budget.status = 'Settled using complete provider tokens and official USD reference; invoice not queried'; writeJson(budgetFile,budget);
}
