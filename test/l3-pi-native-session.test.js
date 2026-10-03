import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bindPiSession, PI_ENTRY, PI_VERSION } from '../dist/hosts/pi/index.js';
import { createSessionService } from '../dist/runtime/session/index.js';
import { fail } from '../dist/protocol/index.js';
import { harness, value } from './l2-runtime-support.test.js';
import { infrastructure, meter, writeJson } from './l3-pi-native-support.test.js';

export async function runNative() {
const live = process.argv.includes('--live'), memoryControl = process.argv.includes('--memory-control');
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
const i = await infrastructure(live), h = harness({ budget: { maxUsdMicros: null, maxInputTokens: 1000000, maxOutputTokens: 8192 } });
const trace = [], faults = [], errors = [], payloads = [], requests = [], receipts = [], toolCalls = [], toolResults = [];
const record = (type, data = {}) => trace.push({ index: trace.length, type, ...data });
let session, binding, effectId, executed = 0, deniedExecuted = 0, earlyReceipt = false, idleDuringEnd = false, continued = false;
let stepReturned = false;
const checks = {}, sessions = [];
const sourceHashes = ['src/hosts/pi/binding.ts', 'src/hosts/pi/types.ts', 'src/hosts/pi/usage.ts',
  'src/hosts/pi/entries.ts', 'src/hosts/pi/capabilities.ts', 'test/l3-pi-native-session.test.js',
  'test/l3-pi-native-support.test.js'].map(file => ({ file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
function extension(pi) {
  binding = value(bindPiSession(pi, { version: PI_VERSION, kernelSessionId: h.seed.sessionId,
    hostSessionId: sessionManager.getSessionId(), session: () => session, clock: h.ports.clock,
    prompt: async a => { effectId = a.effect.effectId;
      return 'KERNEL_SMOKE: Call evofence_smoke_echo exactly once with text "smoke-ok", then reply smoke-ok. Do not use other tools.'; },
    context: async () => ({ ok: true, value: [{ role: 'user', content: [{ type: 'text', text: 'EVOFENCE_NODE_CONTEXT: scope=smoke' }], timestamp: Date.now() }] }),
    toolGate: async (a, e) => { toolCalls.push({ effectId: a.effect.effectId, toolCallId: e.toolCallId, toolName: e.toolName, input: e.input });
      return e.toolName === 'evofence_smoke_denied' ? { ok: false, error: fail('EFK_AUTHORITY_DENIED', 'smoke grant denies tool') } : { ok: true, value: undefined }; },
    toolResult: async (a, e) => { toolResults.push({ effectId: a.effect.effectId, toolCallId: e.toolCallId, toolName: e.toolName, input: e.input, isError: e.isError }); },
    agentEnd: async () => { record('binding_agent_end_begin'); await new Promise(r => setTimeout(r, 10)); record('binding_agent_end_done'); },
    fault: e => { faults.push(e); record('binding_fault', { code: e.code }); } }));
  pi.on('session_start', (_, ctx) => record('extension_session_start', { sessionId: ctx.sessionManager.getSessionId(), file: ctx.sessionManager.getSessionFile() }));
  pi.on('agent_end', async () => {
    if (binding.state().activeEffectId === null) return;
    earlyReceipt ||= binding.receipt(effectId) !== null;
    idleDuringEnd ||= binding.state().idle;
    record('after_awaited_agent_end', { receiptPresent: binding.receipt(effectId) !== null, idle: binding.state().idle, stepReturned });
    const a = h.read();
    checks.journalNotSettledAtEnd = !a.events.some(e => e.type === 'receipt.applied');
  });
  pi.on('agent_before_settle', () => {
    if (live || continued || binding.state().activeEffectId === null) return;
    continued = true; record('boundary_continuation', { stepReturned, packetAttached: binding.state().attached });
    return { entries: [{ type: 'custom_message', customType: 'native-continuation', content: 'Continue and reply smoke-ok. No tools.', display: false }], continue: true };
  });
  pi.on('agent_settled', async () => {
    record('extension_settled', { nativeIdle: session.isIdle, bindingIdle: binding.state().idle, stepReturned });
    if (binding.state().activeEffectId !== null) {
      const prior = h.read().effects[effectId];
      const other = { ...prior, effectId: 'settled-reentry', idempotencyKey: 'settled-reentry' };
      checks.settledReentryRefused = (await binding.host.execute({ effect: other, grant: h.seed.grants[0] })).error?.code === 'EFK_HOST_REVISION_CONFLICT';
      await new Promise(r => setTimeout(r, 10));
      checks.waitsForAsyncSettledHook = !stepReturned;
    }
  });
  for (const name of ['evofence_smoke_echo', 'evofence_smoke_denied']) pi.registerTool({ name, label: name, description: 'Controlled smoke tool.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    execute: async (_id, args) => { name === 'evofence_smoke_echo' ? executed++ : deniedExecuted++;
      return { content: [{ type: 'text', text: args.text }], details: { smoke: true } }; } });
}
let sessionManager;
async function make(manager, attach, startReason) {
  sessionManager = manager;
  const resources = new i.sdk.DefaultResourceLoader({ cwd: i.cwd, agentDir: i.agentDir, settingsManager: i.settings,
    noExtensions: true, noThemes: true, extensionFactories: attach ? [extension] : [] });
  await resources.reload();
  const result = await i.sdk.createAgentSession({ cwd: i.cwd, agentDir: i.agentDir, modelRuntime: i.runtime,
    model: i.runtime.getModel('deepseek', 'deepseek-flash'), thinkingLevel: 'high', settingsManager: i.settings,
    resourceLoader: resources, sessionManager: manager, tools: attach ? ['read', 'evofence_smoke_echo', 'evofence_smoke_denied'] : ['read'],
    sessionStartEvent: { type: 'session_start', reason: startReason } });
  session = result.session; sessions.push(session);
  await session.bindExtensions({ mode: 'non_interactive', onError: e => errors.push({ event: e.event, message: 'native extension error' }) });
  session.subscribe(e => {
    if (!['agent_start', 'agent_end', 'agent_settled', 'message_end', 'tool_execution_start', 'tool_execution_end'].includes(e.type)) return;
    record('session_' + e.type, e.type === 'message_end' ? { role: e.message.role, stopReason: e.message.stopReason } : {});
    if (e.type === 'message_end' && e.message.role === 'assistant') receipts.push({ model: e.message.model, stopReason: e.message.stopReason, usage: e.message.usage });
  });
  return resources;
}
try {
  i.runtime.registerProvider('deepseek', { baseUrl: i.fixtureUrl });
  if (memoryControl) {
    await make(i.sdk.SessionManager.inMemory(i.cwd), true, 'startup');
    checks.nativeMemorySessionRefused = !binding.state().attached && faults[0]?.code === 'EFK_HOST_SESSION_MISMATCH';
    assert.equal(checks.nativeMemorySessionRefused, true, 'DoD1 rejects real native in-memory session');
  } else {
    // First create a genuine native host turn, then reopen that existing disk session for the kernel.
    const manager = i.sdk.SessionManager.create(i.cwd, path.join(i.privateDir, 'sessions'));
    await make(manager, false, 'startup');
    session.agent.streamFunction = ((native) => (m, c, o) => native(m, c, { ...o, maxTokens: 2048, maxRetries: 0 }))(session.agent.streamFunction);
    await session.prompt('HOST_BOOTSTRAP: Reply smoke-ok. No tools.'); await session.waitForIdle();
    const saved = manager.getSessionFile(), hostId = manager.getSessionId(), beforeMessages = session.messages.length;
    assert(fs.existsSync(saved)); record('existing_host_session', { sessionId: hostId, file: saved, messages: beforeMessages, grade: 'native-fixture' });
    session.dispose();
    if (live) i.runtime.registerProvider('deepseek', { baseUrl: i.model.baseUrl });
    const resources = await make(i.sdk.SessionManager.open(saved), true, 'resume');
    receipts.length = 0; // Bootstrap is a separate native-fixture host turn, not kernel/provider usage.
    const originalSession = session, originalManager = session.sessionManager;
    checks.existingPersistentSession = sessionManager.getSessionId() === hostId && session.messages.length === beforeMessages;
    checks.hostResourcesLoaded = resources.getSkills().skills.some(s => s.name === 'host-fixture') && session.getActiveToolNames().includes('read');
    const observed = meter(session, live, requests, payloads, output ? output + '.usage.json' : undefined);
    const service = createSessionService({ ...h.ports, host: binding.host }); value(service.open(h.seed));
    value(await service.step(h.seed.sessionId).then(r => { stepReturned = true; record('kernel_step_returned'); return r; }));
    await observed();
    const state = value(service.read(h.seed.sessionId)), receipt = Object.values(state.receipts)[0];
    checks.kernelReceiptApplied = receipt.status === 'completed' && state.nodeStates[0].state === 'verifying'
      && state.events.filter(e => e.type === 'receipt.applied').length === 1 && !state.events.some(e => e.type === 'decision.recorded');
    checks.realSessionUnchanged = session === originalSession && session.sessionManager === originalManager && sessionManager.getSessionId() === hostId;
    checks.contextAndResources = payloads.length > 0 && payloads.every(p => p.hostContextPreserved && p.hostSkillPreserved && p.nodeContextInjected);
    checks.toolResultObserved = executed === 1 && toolResults.some(t => t.toolName === 'evofence_smoke_echo')
      && toolCalls.some(c => toolResults.some(r => r.toolCallId === c.toolCallId && r.effectId === c.effectId));
    checks.noEarlySettlement = !earlyReceipt && !idleDuringEnd;
    assert.equal(checks.noEarlySettlement, true, 'DoD2 no receipt before native continuation/settlement');
    checks.continuation = live ? null : continued && requests.length === 3;
    checks.blockedToolNeverExecutes = live ? null : deniedExecuted === 0 && toolCalls.some(c => c.toolName === 'evofence_smoke_denied');
    checks.usageComplete = requests.length >= 2 && requests.every(r => r.status === 'settled') && receipt.usage[0].complete;
    checks.rawMatchesSdk = requests.every((r, n) => { const raw = r.usage, sdk = receipts[n].usage;
      return raw.prompt_tokens === sdk.input + sdk.cacheRead && raw.completion_tokens === sdk.output && raw.total_tokens === sdk.totalTokens; });
    checks.receiptAfterSettlement = trace.findIndex(e => e.type === 'kernel_step_returned') > trace.findIndex(e => e.type === 'session_agent_settled');
    const report = { receipt, events: state.events, nodeStates: state.nodeStates, budget: state.budget,
      policyAndStores: 'explicit in-memory kernel ports; no evaluator invoked', fakeHostExecutions: h.fake.stats().invocations };
    checks.noFakeHostExecution = report.fakeHostExecutions === 0;
    record('kernel_snapshot', { effectId: receipt.effectId, nativeSessionId: hostId, status: receipt.status, appliedReceipts: 1 });
    const oldBinding = binding; oldBinding.unload(); session.dispose();
    await make(i.sdk.SessionManager.open(saved), true, 'resume');
    const replay = value(await binding.host.execute({ effect: state.effects[receipt.effectId], grant: h.seed.grants[0] }));
    checks.diskRestore = sessionManager.getSessionId() === hostId && replay.receiptId === receipt.receiptId
      && sessionManager.getEntries().some(e => e.customType === PI_ENTRY && e.data.kind === 'receipt');
    const ordinaryBefore = payloads.length;
    // Removed handlers do not inject node context into ordinary work on the still-owned host.
    binding.unload();
    if (!live) {
      const observeOrdinary = meter(session, false, requests, payloads);
      await session.prompt('ORDINARY_HOST: Reply smoke-ok. No tools.'); await observeOrdinary();
      checks.unloadRetainsHost = !payloads[ordinaryBefore].nodeContextInjected && session.isIdle;
      session.dispose();
      const prior = state.effects[receipt.effectId];
      const abortedEffect = { ...prior, effectId: 'native-abort', idempotencyKey: 'native-abort', payload: { ...prior.payload, context: null } };
      const outcome = await abortInSession(i.sdk.SessionManager.open(saved), abortedEffect, h.seed.grants[0]);
      checks.abortNativeAck = outcome.cancel.status === 'cancelled' && outcome.cancel.targets[0].confirmation === 'native-ack';
      checks.abortUnknownSpend = outcome.receipt.status === 'unknown' && outcome.receipt.usage[0].estimatedUsdMicros === null;
      await new Promise(r => setTimeout(r, 20)); checks.abortDisconnected = i.disconnected();
    } else { checks.unloadRetainsHost = null; checks.abortNativeAck = null; checks.abortUnknownSpend = null; checks.abortDisconnected = null; }
    if (output) writeJson(output + '.kernel.json', report);
  }
  checks.extensionErrorsEmpty = errors.length === 0;
  for (const [name, result] of Object.entries(checks)) if (result !== null) assert.equal(result, true, name);
} finally {
  for (const s of sessions) s.dispose(); await i.close();
  const data = { recordedAt: new Date().toISOString(), pid: process.pid, piVersion: PI_VERSION,
    grade: live ? 'provider-live' : 'native-fixture', memoryControl, checks, trace, requests, payloads, receipts, toolCalls, toolResults, faults, errors, sourceHashes,
    privateRuntime: i.privateDir, paidRequests: live ? requests.length : 0,
    estimatedUsd: live ? requests.every(r => r.status === 'settled') ? requests.reduce((sum, r) => sum + r.estimatedUsd, 0) : null : 0,
    pricingSource: 'https://api-docs.deepseek.com/quick_start/pricing/', costBasis: 'catalog/official peak USD reference; no provider invoice',
    limitations: ['Controlled host resources, not user TUI/all third-party extensions', 'Native disk reopen, not crash recovery',
      'Native fixture abort, not provider abort billing', 'No delegation, activation, task verdict or capability uplift'] };
  if (output) writeJson(output, data);
  console.log(JSON.stringify({ piVersion: PI_VERSION, pid: process.pid, checks, paidRequests: data.paidRequests, estimatedUsd: data.estimatedUsd }));
}

async function abortInSession(manager, effect, grant) {
  let nativeSession, cancellationBinding;
  const resources = new i.sdk.DefaultResourceLoader({ cwd: i.cwd, agentDir: i.agentDir, settingsManager: i.settings,
    noExtensions: true, noThemes: true, extensionFactories: [pi => {
      cancellationBinding = value(bindPiSession(pi, { version: PI_VERSION, kernelSessionId: h.seed.sessionId,
        hostSessionId: manager.getSessionId(), session: () => nativeSession, clock: h.ports.clock,
        prompt: async () => 'HOLD_FOR_ABORT', context: async () => ({ ok: true, value: [] }),
        toolGate: async () => ({ ok: true, value: undefined }), toolResult: async () => {}, fault: e => faults.push(e) }));
    }] });
  // Host owns creation/resume; the binding only receives its existing native session getter.
  await resources.reload();
  const r = await i.sdk.createAgentSession({ cwd: i.cwd, agentDir: i.agentDir, modelRuntime: i.runtime,
    model: i.runtime.getModel('deepseek', 'deepseek-flash'), thinkingLevel: 'high', sessionManager: manager,
    settingsManager: i.settings, resourceLoader: resources, tools: ['read'], sessionStartEvent: { type: 'session_start', reason: 'resume' } });
  nativeSession = r.session; sessions.push(nativeSession);
  await nativeSession.bindExtensions({ mode: 'non_interactive', onError: e => errors.push({ event: e.event }) });
  const abortObserved = meter(nativeSession, false, requests, payloads);
  const work = cancellationBinding.host.execute({ effect, grant }); await i.holdStarted;
  const cancel = value(await cancellationBinding.host.cancel({ sessionId: h.seed.sessionId, targetIds: [effect.effectId] }));
  const receipt = value(await work); await abortObserved();
  record('native_abort_ack', { status: cancel.status, receipt: receipt.status, usage: receipt.usage });
  cancellationBinding.unload(); return { cancel, receipt };
}
}
if (process.argv.includes('--probe')) await runNative();
