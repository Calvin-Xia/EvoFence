import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bindPiSession } from '../dist/hosts/pi/index.js';
import { bindPiDelegation, attachPiDelegation } from '../dist/hosts/pi/delegation.js';
import { bindPiChildExecutor } from '../dist/hosts/pi/delegation-executor.js';
import { bindPiSharedRequests } from '../dist/hosts/pi/delegation-budget.js';
import { PI_DELEGATION_ENTRY } from '../dist/hosts/pi/delegation-records.js';
import { mapPiUsage } from '../dist/hosts/pi/usage.js';
import { delegationFixture, value } from './l3-pi-delegation-fixtures.test.js';
import { infrastructure } from './l3-pi-native-support.test.js';

test('native-fixture Pi 0.99.2 child execution, parent pool, SDK abort/shutdown and disk restore', { timeout: 30000 }, async () => {
  const i = await infrastructure(false); // Explicit false: placeholder auth, no stored credential read or vendor HTTP.
  const f = delegationFixture(), sessions = [], files = new Map(), wire = [], trace = [];
  let creates = 0, restores = 0, ordinaryOwner = 'ordinary-parent', parentApi;
  const raw = { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220,
    prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 4 } };
  const record = (type, data = {}) => trace.push({ type, ...data });
  const poolFile = path.join(i.privateDir, 'parent-request-pool.json');
  function persistPool() { fs.writeFileSync(poolFile, JSON.stringify(f.state())); }
  async function make(manager, spec, resume = false) {
    let session, bound, executor;
    const id = manager.getSessionId(), observers = [];
    const resources = new i.sdk.DefaultResourceLoader({ cwd: i.cwd, agentDir: i.agentDir, settingsManager: i.settings,
      noExtensions: true, noThemes: true, extensionFactories: [api => {
        const sessionOptions = { version: '0.99.2', kernelSessionId: 'kernel-1', hostSessionId: id,
          session: () => session, clock: f.options.clock,
          prompt: async a => {
            assert(spec); assert.equal(a.grant.grantId, spec.grant.grantId);
            assert.deepEqual(a.effect.binding.graph, spec.graphRef);
            return `HOST_BOOTSTRAP ${a.effect.effectId.includes('hold') ? 'HOLD_FOR_ABORT' : 'CHILD_GRAPH_OK'}`;
          },
          context: async () => ({ ok: true, value: [{ role: 'user', content: [{ type: 'text', text: 'FINITE_CHILD_CONTEXT safe' }], timestamp: 1 }] }),
          toolGate: async () => ({ ok: false, error: { code: 'EFK_AUTHORITY_DENIED', message: 'child has no tool capability', refs: [], visibility: 'internal', retry: 'never' } }),
          toolResult: async () => {}, fault: error => record('binding-fault', { code: error.code }),
          agentEnd: async () => { await new Promise(r => setTimeout(r, 5)); record('awaited-child-end', { sessionId: id }); },
          usageEvidence: (_rid, message) => message.stopReason === 'stop' ? { source: 'synthetic', raw, evidenceRefs: [] }
            : { source: 'unknown', raw: null, evidenceRefs: [] },
        };
        if (spec) { executor = value(bindPiChildExecutor(api, spec, sessionOptions)); bound = executor.binding; }
        else { parentApi = api; bound = value(bindPiSession(api, sessionOptions)); }
      }] });
    await resources.reload();
    const result = await i.sdk.createAgentSession({ cwd: i.cwd, agentDir: i.agentDir, modelRuntime: i.runtime,
      model: i.runtime.getModel('deepseek', 'deepseek-flash'), thinkingLevel: 'high', tools: [],
      settingsManager: i.settings, resourceLoader: resources, sessionManager: manager,
      sessionStartEvent: { type: 'session_start', reason: resume ? 'resume' : 'startup' } });
    session = result.session; sessions.push(session);
    let ordinal = 0, requestId = null;
    const native = session.agent.streamFunction;
    session.agent.streamFunction = (model, context, options) => native(model, context, { ...options,
      maxTokens: 128, maxRetries: 0, timeoutMs: 10000,
      fetch: async (url, init) => {
        const payload = JSON.parse(init.body);
        assert.equal(new URL(url).origin, new URL(i.fixtureUrl).origin);
        assert.equal(payload.model, 'deepseek-flash'); assert.equal(payload.reasoning_effort, 'high');
        assert.equal(payload.max_tokens, 128);
        const owner = spec?.invocationId ?? ordinaryOwner, policy = spec?.grant.budget ?? f.policy;
        const meter = spec?.requests ?? f.requests;
        requestId = `native:${id}:request:${++ordinal}`;
        value(meter.beforeRequest(requestId, owner, policy, { inputTokens: 10000, outputTokens: 128, usdMicros: 100 }));
        persistPool(); record('provider-dispatch', { requestId, owner, sessionId: id });
        const row = { requestId, owner, status: 'reserved', usage: null }; wire.push(row);
        let response;
        try { response = await fetch(url, init); }
        catch (error) { row.status = 'unknown'; throw error; }
        const observe = response.clone().text().then(text => {
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ') || line.slice(6).trim() === '[DONE]') continue;
            const data = JSON.parse(line.slice(6)); if (data.usage) row.usage = data.usage;
          }
          assert.deepEqual(row.usage, raw); row.status = 'settled';
        }); observers.push(observe); return response;
      } });
    session.subscribe(event => {
      if (event.type === 'message_end' && event.message.role === 'assistant' && requestId !== null) {
        const message = event.message;
        if (message.stopReason === 'stop') {
          assert.equal(message.usage.input + message.usage.cacheRead, 200); assert.equal(message.usage.output, 20);
        }
        const evidence = message.stopReason === 'stop' ? { source: 'synthetic', raw, evidenceRefs: [] } : undefined;
        const row = value(mapPiUsage(requestId, message, evidence));
        const result = (spec?.requests ?? f.requests).record(row);
        assert(message.stopReason === 'stop' ? result.ok : !result.ok); persistPool();
        record('native-usage', { requestId, complete: row.complete, stopReason: message.stopReason });
      }
      if (event.type === 'agent_settled') record('native-settled', { sessionId: id });
    });
    await session.bindExtensions({ mode: 'non_interactive', onError: error => { throw new Error(error.message); } });
    const host = executor?.host ?? bound.host;
    return { sessionId: id, host: { ...host, async execute(a) {
      const result = await host.execute(a); await Promise.all(observers); return result;
    } }, bound, session, manager, dispose() { bound.unload(); session.dispose(); } };
  }
  try {
    i.runtime.registerProvider('deepseek', { baseUrl: i.fixtureUrl });
    const parentManager = i.sdk.SessionManager.create(i.cwd, path.join(i.privateDir, 'sessions'));
    const parent = await make(parentManager, null);
    await parent.session.prompt('HOST_BOOTSTRAP parent ordinary turn'); await parent.session.waitForIdle();
    assert(fs.existsSync(parentManager.getSessionFile()));
    const parentId = parent.sessionId;
    const options = { ...f.options, parentSessionId: parentId, manager: parentManager, parent: parent.host,
      append: (name, data) => parentManager.appendCustomEntry(name, data),
      async create(spec) {
        creates++; assert.deepEqual(spec.model, f.options.model); assert.equal(spec.grant.remainingDepth, 0);
        const manager = i.sdk.SessionManager.create(i.cwd, path.join(i.privateDir, 'children'));
        const child = await make(manager, spec); assert.notEqual(child.sessionId, parentId);
        if (creates === 1) {
          const before = wire.length;
          child.session.setThinkingLevel('off');
          const control = f.plan(authorized('normal')).effects[0];
          assert.equal((await child.host.execute({ effect: control, grant: spec.grant })).error.code, 'EFK_SOURCE_PIN_DRIFT');
          assert.equal(wire.length, before); child.session.setThinkingLevel('high');
          record('native-model-drift-rejected', { childId: child.sessionId });
        }
        files.set(child.sessionId, manager.getSessionFile()); record('native-child-created', { parentId, childId: child.sessionId });
        return { ok: true, value: child };
      },
      async restore(spec, childId) {
        restores++; const manager = i.sdk.SessionManager.open(files.get(childId));
        assert.equal(manager.getSessionId(), childId); return { ok: true, value: await make(manager, spec, true) };
      } };
    const binding = value(bindPiDelegation(options));
    function authorized(id) { const a = f.authorized(id); a.effect.binding.hostSessionId = parentId; return a; }
    const completed = value(await binding.host.execute(authorized('normal')));
    assert.equal(completed.status, 'completed'); assert.equal(completed.usage[0].source, 'synthetic');
    assert.equal(f.state().ledger.requestCount, 2); assert.equal(f.state().ledger.settlements.length, 2);
    assert.equal(parent.session.sessionId, parentId); assert.equal(parent.session.isIdle, true);
    const persisted = parentManager.getEntries().filter(e => e.customType === PI_DELEGATION_ENTRY);
    assert.equal(persisted.at(-1).data.childSessionId !== parentId, true);
    const checkpoint = f.state().ledger.requestCount;
    const parentFile = parentManager.getSessionFile();
    const reopenedManager = i.sdk.SessionManager.open(parentFile);
    let diskState = JSON.parse(fs.readFileSync(poolFile, 'utf8'));
    const diskPool = bindPiSharedRequests(() => diskState, next => { diskState = next; });
    const replay = value(bindPiDelegation({ ...options, manager: reopenedManager, requests: diskPool,
      append: (name, data) => reopenedManager.appendCustomEntry(name, data) }));
    assert.deepEqual(value(await replay.host.execute(authorized('normal'))), completed);
    assert.equal(creates, 1); assert.equal(diskState.ledger.requestCount, checkpoint);
    // Reopen a real disk prefix that lacks the final parent receipt: child native entries settle it.
    const prefixFile = path.join(i.privateDir, 'parent-before-receipt.jsonl');
    const lines = fs.readFileSync(parentFile, 'utf8').trim().split('\n');
    const terminalLine = lines.findIndex(line => { const e = JSON.parse(line); return e.customType === PI_DELEGATION_ENTRY && e.data.phase === 'receipt'; });
    fs.writeFileSync(prefixFile, lines.slice(0, terminalLine).join('\n') + '\n');
    const interruptedManager = i.sdk.SessionManager.open(prefixFile);
    const recovering = value(bindPiDelegation({ ...options, manager: interruptedManager,
      append: (name, data) => interruptedManager.appendCustomEntry(name, data) }));
    assert.equal((await recovering.host.execute(authorized('normal'))).error.code, 'EFK_EFFECT_NON_IDEMPOTENT_RETRY');
    const recovered = value(await recovering.host.reconcile({ sessionId: 'kernel-1', targetIds: ['normal'] }))[0];
    assert.equal(recovered.verdict, 'resolved'); assert.deepEqual(recovered.receipt, completed);
    assert.equal(creates, 1); assert.equal(restores, 1); assert.equal(f.state().ledger.requestCount, checkpoint);
    const hold = binding.host.execute(authorized('hold')); await i.holdStarted;
    const aborted = value(await binding.host.cancel({ sessionId: 'kernel-1', targetIds: ['hold'] }));
    assert.equal(aborted.targets[0].confirmation, 'native-ack');
    const unknown = value(await hold); assert.equal(unknown.status, 'unknown'); assert.equal(unknown.usage[0].estimatedUsdMicros, null);
    assert.equal(f.state().ledger.reservations.length, 1); assert.equal(i.disconnected(), true);
    // A second owned child is closed via the same explicit parent shutdown lifecycle hook.
    const lifecycle = value(attachPiDelegation(parentApi, options));
    const secondHold = lifecycle.host.execute(authorized('hold-shutdown'));
    while (!wire.some(row => row.owner.endsWith(':hold-shutdown'))) await new Promise(r => setTimeout(r, 5));
    await parent.session.reload(); // Real SDK emits awaited session_shutdown(reason=reload).
    record('native-parent-reload-shutdown', { parentId });
    assert.equal(value(await secondHold).status, 'unknown'); assert.equal(f.state().ledger.reservations.length, 2);
    assert.equal(parent.session.isIdle, true); assert.equal(parent.session.sessionId, parentId);
    const evidence = { lane: 'l3-pi-deleg', piVersion: '0.99.2', grade: 'native-fixture', providerLiveRequests: 0,
      localHttpRequests: wire.length, creates, restores, trace, requests: wire, completedReceipt: completed,
      abortedReceipt: unknown, pool: f.state(), persistentReopen: true, prefixRecovery: true,
      credentialRead: false, costUsd: 0,
      limitations: ['No native team board', 'No vendor cancellation/billing or invoice proof', 'Disk prefix/reopen is not process-kill testing',
        'Kernel plan and persistent pool are explicit injected ports; no second scheduler/decision is created'] };
    const output = process.env.EVOFENCE_PI_DELEGATION_EVIDENCE;
    if (output) fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
    assert.equal(wire.length, 4);
  } finally {
    for (const session of sessions) session.dispose();
    await i.close();
    fs.rmSync(i.privateDir, { recursive: true }); // Only this test's mkdtemp directory.
  }
});
