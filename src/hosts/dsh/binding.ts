/** Cordis registrations and the application-service binding are owned by this plugin scope. */
import { decode, fail } from '../../protocol/index.js';
import { createSessionService } from '../../runtime/session/index.js';
import { err, ok, type ArtifactRef, type HostResult } from '../../runtime/host-port/index.js';
import { emitObservation, healthy, stopEvolution, unexpected } from './health.js';
import { identity, nativeBoard } from './mapping.js';
import { createDshHost } from './port.js';
import { registerControls } from './controls.js';
import type { DshBinding, DshComposition, DshSession, DshStatus, NativeAgent, NativeContext } from './types.js';

export function createDshBinding(ctx: NativeContext, composition: DshComposition): DshBinding {
  if (composition.version !== '0.2.0-rc.2') throw new Error('DSH binding requires exact version 0.2.0-rc.2');
  const sessions = new Map<string, DshSession>();
  const attachErrors = new Map<string, ReturnType<typeof fail>>();
  const jobs = new Map<string, Promise<HostResult<unknown>>>();
  const disposers: (() => void)[] = [];
  let disposed = false;

  function session(id: string): HostResult<DshSession> {
    const found = sessions.get(id);
    if (found === undefined) return err(attachErrors.get(id) ?? fail('EFK_HOST_SESSION_MISMATCH', 'native session has no EvoFence binding', [id]));
    return ok(found);
  }
  function current(agent: NativeAgent): DshSession | undefined {
    const found = sessions.get(agent.id);
    return found?.agent === agent ? found : undefined;
  }
  function status(id: string): HostResult<DshStatus> {
    const found = session(id);
    if (!found.ok) return found;
    const s = found.value, read = s.runtime.read(s.request.sessionId);
    if (!read.ok) return read;
    return ok({ hostSessionId: s.agent.id, sessionId: read.value.sessionId,
      health: s.disposed ? 'disposed' : s.fault === null ? 'active' : 'degraded', error: s.fault, pauseError: s.pauseError,
      revision: read.value.revision, epoch: read.value.epoch, dispatchMode: read.value.dispatchMode,
      nodeStates: read.value.nodeStates, unknownEffectIds: read.value.unknownEffectIds,
      usageIssues: read.value.usageIssues.map(issue => issue.code) });
  }
  function attach(agent: NativeAgent, source: string): HostResult<DshStatus> {
    if (disposed) return err(fail('EFK_HOST_SESSION_MISMATCH', 'Cordis binding was uninstalled'));
    const prior = current(agent);
    if (prior !== undefined) return status(agent.id);
    let s: DshSession | undefined;
    try {
      const request = composition.sessionFor(agent);
      if (request === null) return err(fail('EFK_HOST_SESSION_MISMATCH', 'native session was not delegated to EvoFence', [agent.id]));
      // Native identity is an external boundary. The L2 binding may carry hostSessionId=null;
      // keep its immutable bytes and establish the mapping here, never rewrite the receipt.
      const valid = decode('Id', agent.id);
      if (!valid.ok) return valid;
      if (request.sessionId !== agent.id || agent.session.id !== agent.id || ctx.agents.get(agent.id) !== agent) {
        return err(fail('EFK_HOST_SESSION_MISMATCH', 'kernel seed must identify this exact live native session', [agent.id]));
      }
      let owned!: DshSession;
      const host = createDshHost(ctx, composition, () => owned);
      const runtime = createSessionService({ ...composition.ports, host });
      owned = { agent, request, host, runtime, observations: [], boardLinks: new Map(), receipts: new Map(),
        usages: new Map(), dispatched: new Map(), fault: null, pauseError: null, disposed: false,
        running: null, contextText: [], busy: false };
      s = owned;
      const opened = source === 'resume' ? runtime.open(request) : runtime.create(request);
      if (!opened.ok) { attachErrors.set(agent.id, opened.error); return opened; }
      sessions.set(agent.id, s);
      if (source === 'resume') {
        const state = runtime.read(request.sessionId);
        if (!state.ok) return state;
        if (state.value.dispatchMode === 'active') {
          const paused = runtime.pause(request.sessionId, { commandId: identity(composition, 'dsh-reopen', [agent.id, state.value.revision]),
            expectedRevision: state.value.revision, reason: 'native-reopen-needs-readmission' });
          if (!paused.ok) { stopEvolution(s, composition, paused.error); return paused; }
        }
      }
      emitObservation(s, composition, { type: `agent/${source}`, hostSessionId: agent.id, seq: null, callId: null, isError: null });
      return status(agent.id);
    } catch {
      const error = s === undefined ? fail('EFK_EFFECT_UNKNOWN', 'DSH session setup failed; ordinary session remains available', [agent.id])
        : unexpected(s, composition, 'attach');
      attachErrors.set(agent.id, error);
      return err(error);
    }
  }
  async function operation(id: string, work: (s: DshSession) => Promise<HostResult<unknown>>): Promise<HostResult<unknown>> {
    const found = session(id);
    if (!found.ok) return found;
    const s = found.value, health = healthy(s);
    if (!health.ok) return health;
    if (s.busy) return err(fail('EFK_REVISION_CONFLICT', 'another EvoFence operation owns this native session', [id]));
    s.busy = true;
    try {
      const result = await work(s);
      if (!result.ok) stopEvolution(s, composition, result.error);
      return result;
    } catch { return err(unexpected(s, composition, 'runtime-operation')); }
    finally { s.busy = false; }
  }
  const binding: DshBinding = {
    attach, session, status,
    step: id => operation(id, async s => {
      if (s.agent.status !== 'idle') return err(fail('EFK_REVISION_CONFLICT', 'ordinary native work is still running', [id]));
      return s.runtime.step(s.request.sessionId);
    }),
    pause(id, reason) {
      const found = session(id);
      if (!found.ok) return found;
      const s = found.value, state = s.runtime.read(s.request.sessionId);
      if (!state.ok) return state;
      return s.runtime.pause(s.request.sessionId, { commandId: identity(composition, 'dsh-user-pause', [id, state.value.revision, reason]),
        expectedRevision: state.value.revision, reason });
    },
    resume(id, manifestRef) {
      const found = session(id);
      if (!found.ok) return found;
      const s = found.value, health = healthy(s);
      if (!health.ok) return health;
      const state = s.runtime.read(s.request.sessionId);
      if (!state.ok) return state;
      return s.runtime.resume(s.request.sessionId, { commandId: identity(composition, 'dsh-user-resume', [id, state.value.revision]),
        expectedRevision: state.value.revision, epoch: state.value.epoch + 1, manifestRef });
    },
    evaluate: (id, effectId) => operation(id, s => s.runtime.evaluate(s.request.sessionId, effectId)),
    observe: id => operation(id, s => s.runtime.observe(s.request.sessionId)),
    reconcile: id => operation(id, s => s.runtime.reconcile(s.request.sessionId)),
    continue(id) {
      const found = session(id);
      if (!found.ok) return found;
      const s = found.value, health = healthy(s);
      if (!health.ok) return health;
      if (s.busy) return err(fail('EFK_REVISION_CONFLICT', 'EvoFence continuation already queued', [id]));
      s.busy = true;
      // A native tool returns before its current turn can become idle. Queue once, then reuse
      // that same agent; never await our own loop inside the tool implementation.
      const job = (async () => {
        try { await s.agent.whenIdle(); }
        catch { s.busy = false; return err(unexpected(s, composition, 'continue-idle')); }
        s.busy = false;
        return binding.step(id);
      })();
      jobs.set(id, job);
      return ok(undefined);
    },
    async settle(id) { return jobs.has(id) ? jobs.get(id)! : err(fail('EFK_EFFECT_UNKNOWN', 'no queued continuation', [id])); },
    projectBoard(id, link) {
      const found = session(id);
      if (!found.ok) return found;
      const s = found.value;
      s.boardLinks.set(link.taskId, link);
      const board = nativeBoard(s);
      if (!board.ok) { s.boardLinks.delete(link.taskId); stopEvolution(s, composition, board.error); return board; }
      return ok(undefined);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const s of sessions.values()) {
        stopEvolution(s, composition, fail('EFK_ACTIVATION_UNCONFIRMED', 'Cordis binding uninstalled; no unconfirmed promotion', [s.agent.id]));
        s.disposed = true;
      }
      for (const remove of disposers.reverse()) remove();
    },
  };
  disposers.push(ctx.on('agent/created', async ({ agent, source }) => { binding.attach(agent, source); }));
  disposers.push(ctx.on('agent/disposed', ({ agent }) => {
    const s = current(agent);
    if (s === undefined) return;
    stopEvolution(s, composition, fail('EFK_HOST_SESSION_MISMATCH', 'native agent disposed; explicit resume required', [agent.id]));
    s.disposed = true;
  }));
  disposers.push(ctx.on('agent/status', ({ agent, status: nativeStatus }) => {
    const s = current(agent);
    if (s !== undefined) emitObservation(s, composition, { type: `status/${nativeStatus}`, hostSessionId: agent.id, seq: null, callId: null, isError: null });
  }));
  disposers.push(ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next();
    const s = current(agent);
    if (s === undefined || s.running === null || decision.kind !== 'enter') return decision;
    s.running.preSteps++;
    // The frozen runtime has one reservation per effect. Subsequent loop requests need another
    // explicit effect; ordinary host turns are untouched by this single-invocation bound.
    if (s.running.preSteps > 1) { unexpected(s, composition, 'unreserved-continuation'); return { kind: 'reject' }; }
    if (!healthy(s).ok) return decision;
    try { return { ...decision, messages: [...decision.messages, ...s.contextText.map(composition.helpers.message)] }; }
    catch { unexpected(s, composition, 'context-hook'); return decision; }
  }));
  disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
    const s = exec.agent === undefined ? undefined : current(exec.agent);
    if (s === undefined || s.running === null) return next();
    s.running.toolGates.add(exec.callId);
    if (!healthy(s).ok) return { kind: 'deny', reason: 'EvoFence execution is unconfirmed' };
    try {
      const allowed = await composition.allowTool(s.running.effect, exec);
      return allowed.ok ? next() : { kind: 'deny', reason: allowed.error.code };
    } catch { unexpected(s, composition, 'tool-policy-hook'); return { kind: 'deny', reason: 'EvoFence tool policy failed' }; }
  }));
  disposers.push(ctx.on('tools/result', (exec, result) => {
    const s = exec.agent === undefined ? undefined : current(exec.agent);
    if (s === undefined) return;
    s.running?.toolResults.add(exec.callId);
    emitObservation(s, composition, { type: 'tools/result', hostSessionId: s.agent.id, seq: null, callId: exec.callId, isError: result.isError });
  }));
  disposers.push(ctx.on('session/event', (nativeSession, event) => {
    const s = sessions.get(nativeSession.id);
    if (s === undefined || s.agent.session !== nativeSession) return;
    s.running?.eventSeqs.add(event.seq);
    emitObservation(s, composition, { type: event.type, hostSessionId: s.agent.id, seq: event.seq, callId: null, isError: null });
  }));
  const schema = composition.helpers.projectionSchema;
  disposers.push(ctx.sessionProjections.register({ key: 'evofenceNative', stateVersion: 1, stateSchema: schema,
    init: header => ({ hostSessionId: header.id, lastSeq: -1, requests: 0 }),
    apply: (state, event) => ({ ...state, lastSeq: event.seq,
      requests: state.requests + (event.type === 'assistant/message' || event.type === 'assistant/attempt' ? 1 : 0) }),
    wire: { viewSchema: schema, view: state => state } }));
  disposers.push(...registerControls(ctx, composition.helpers, binding));
  ctx.effect(() => () => binding.dispose(), 'evofence native session binding');
  for (const agent of ctx.agents.list()) binding.attach(agent, 'existing');
  return binding;
}
