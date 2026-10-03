/** Thin application service. Construction is inert; all outside capabilities are parameter ports. */
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import { openBudgetLedger } from '../../kernel/policy/index.js';
import { project } from './project.js';
import { commit, event, idFor, putObject } from './journal.js';
import { planReceipt, notExecutedReceipt } from './receipts.js';
import { stepSession } from './dispatch.js';
import { pauseSession, resumeSession, cancelSession } from './controls.js';
import { evaluateSession } from './evaluation.js';
import type { ReceiptOutcome } from '../../kernel/store/index.js';
import type { RuntimeState, SessionPorts, SessionSeed, SessionService, StoreResult, ReconcileReport } from './types.js';

export function createSessionService(ports: SessionPorts): SessionService {
  const seeds = new Map<string, SessionSeed>();
  function seedOf(sessionId: string): StoreResult<SessionSeed> {
    const seed = seeds.get(sessionId);
    return seed === undefined ? storeFail('EFK_SCHEMA_INVALID', 'session has no registered seed', [sessionId]) : storeOk(seed);
  }
  function read(sessionId: string): StoreResult<RuntimeState> {
    const seed = seedOf(sessionId);
    if (!seed.ok) return seed;
    const exported = ports.store.exportSession(sessionId);
    if (!exported.ok) return exported;
    const graphPin = exported.value.events.find(e => e.type === 'graph.accepted');
    const seedPin = exported.value.events.find(e => e.type === 'budget.changed');
    if ((graphPin !== undefined && graphPin.payload.objectRef!.digest !== ports.digest.digest(canonical(seed.value.graph.spec)))
      || (seedPin !== undefined && seedPin.payload.objectRef!.digest !== ports.digest.digest(canonical(seedSnapshot(seed.value))))) {
      return storeFail('EFK_SOURCE_PIN_DRIFT', 'session seed differs from its committed graph/policy/operation snapshot', [sessionId]);
    }
    return project(exported.value, seed.value);
  }
  function receive(sessionId: string, input: unknown): StoreResult<ReceiptOutcome> {
    const state = read(sessionId);
    if (!state.ok) return state;
    const seed = seedOf(sessionId);
    if (!seed.ok) return seed;
    const batch = planReceipt(ports, seed.value, state.value, input, ports.clock.now());
    if (!batch.ok) return batch;
    if (batch.value.disposition === 'duplicate') return storeOk({ disposition: 'duplicate', revision: state.value.revision,
      effectId: batch.value.receipt.effectId, receiptId: batch.value.receipt.receiptId });
    // The same reducer owns metering judgement before commit and during replay. Incomplete usage
    // retains its reservation; conflicting evidence cannot advance the attempt/outbox. Actual
    // overspend is committed and exposed rather than hidden by refusing its measurement.
    const preview = project({ sessionId, epoch: state.value.epoch, protocol: state.value.protocol,
      revision: state.value.revision + 1, effects: Object.values(state.value.effects),
      receipts: [...Object.values(state.value.receipts), ...batch.value.receipts],
      events: [...state.value.events, ...batch.value.events.map((e, i) => ({ ...e,
        revision: state.value.revision + 1, sequence: (state.value.lastSequence ?? -1) + 1 + i }))] }, seed.value);
    if (!preview.ok) return preview;
    const conflict = preview.value.usageIssues.slice(state.value.usageIssues.length)
      .find(e => e.code !== 'EFK_USAGE_INCOMPLETE' && e.code !== 'EFK_BUDGET_EXHAUSTED');
    if (conflict !== undefined) return { ok: false, error: conflict };
    const committed = commit(ports, state.value, { commandId: batch.value.events[0].causedBy,
      expectedRevision: state.value.revision }, batch.value);
    return committed.ok ? storeOk({ disposition: batch.value.disposition, revision: committed.value.revision,
      effectId: batch.value.receipt.effectId, receiptId: batch.value.receipt.receiptId }) : committed;
  }
  async function reconcile(sessionId: string): Promise<StoreResult<ReconcileReport>> {
    const readState = read(sessionId);
    if (!readState.ok) return readState;
    const targetIds = readState.value.unknownEffectIds;
    const response = await ports.host.reconcile({ sessionId, targetIds });
    if (!response.ok) return response;
    const resolved: string[] = [], notExecuted: string[] = [];
    for (const outcome of response.value) {
      // Real host reconciliation boundary: an unrelated verdict cannot settle another effect.
      if (!targetIds.includes(outcome.effectId)) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'reconcile returned an unrequested effect', [outcome.effectId]);
      if (outcome.verdict === 'unknown') continue;
      if (outcome.error !== null) return { ok: false, error: outcome.error };
      if (outcome.verdict === 'resolved' && (outcome.receipt === null || outcome.receipt.effectId !== outcome.effectId || outcome.receipt.status === 'unknown')) {
        return storeFail('EFK_EFFECT_UNKNOWN', 'resolved reconciliation has no matching actual receipt', [outcome.effectId]);
      }
      const effect = readState.value.effects[outcome.effectId];
      const receipt = outcome.verdict === 'not-executed'
        ? notExecutedReceipt(ports, effect, 'host-reconcile-not-executed') : outcome.receipt!;
      const applied = receive(sessionId, receipt);
      if (!applied.ok) return applied;
      if (applied.value.disposition !== 'archived') (outcome.verdict === 'not-executed' ? notExecuted : resolved).push(outcome.effectId);
    }
    const current = read(sessionId);
    if (!current.ok) return current;
    return storeOk({ sessionId, resolved, notExecuted, unknown: current.value.unknownEffectIds });
  }
  const service: SessionService = {
    create(request) {
      const budget = openBudgetLedger(request.policy, request.reservePerRequest);
      if (!budget.ok) return budget;
      if (request.graphRef.graphId !== request.graph.graphId || request.graphRef.revision !== request.graph.revision
        || request.graphRef.digest !== ports.digest.digest(canonical(request.graph.spec))) {
        return storeFail('EFK_SOURCE_PIN_DRIFT', 'graph seed does not match its pinned reference');
      }
      const created = ports.store.createSession(request);
      if (!created.ok) return created;
      seeds.set(request.sessionId, request);
      const state = read(request.sessionId);
      if (!state.ok) return state;
      if (state.value.events.length === 0) {
        const ref = putObject(ports, state.value, idFor(ports, 'graph', request.graphRef), 'GraphSpec', request.graph.spec, null);
        if (!ref.ok) return ref;
        const commandId = idFor(ports, 'create', request.sessionId);
        const seedRef = putObject(ports, state.value, idFor(ports, 'seed', request.sessionId), 'SessionSeed', seedSnapshot(request), null);
        if (!seedRef.ok) return seedRef;
        const accepted = commit(ports, state.value, { commandId, expectedRevision: 0 },
          { events: [event(state.value, commandId, 'graph', 'graph.accepted', { objectRef: ref.value }),
            event(state.value, commandId, 'seed', 'budget.changed', { objectRef: seedRef.value })], effects: [], receipts: [] });
        if (!accepted.ok) return accepted;
      }
      return created;
    },
    open(seed) {
      seeds.set(seed.sessionId, seed);
      return read(seed.sessionId);
    },
    read, receive, reconcile,
    async step(sessionId) {
      const seed = seedOf(sessionId);
      return seed.ok ? stepSession(ports, seed.value, service) : seed;
    },
    pause(sessionId, request) {
      const state = read(sessionId);
      return state.ok ? pauseSession(ports, state.value, request) : state;
    },
    resume(sessionId, request) {
      const state = read(sessionId), seed = seedOf(sessionId);
      if (!state.ok) return state;
      return seed.ok ? resumeSession(ports, seed.value, state.value, request) : seed;
    },
    async cancel(sessionId, request) {
      const state = read(sessionId), seed = seedOf(sessionId);
      if (!state.ok) return state;
      return seed.ok ? cancelSession(ports, seed.value, service, state.value, request) : seed;
    },
    async evaluate(sessionId, effectId) {
      const state = read(sessionId), seed = seedOf(sessionId);
      if (!state.ok) return state;
      return seed.ok ? evaluateSession(ports, seed.value, state.value, effectId) : seed;
    },
    async observe(sessionId) {
      const state = read(sessionId);
      if (!state.ok) return state;
      const observed = await ports.host.observe(sessionId);
      if (!observed.ok) return observed;
      const commandId = idFor(ports, 'observe', [sessionId, state.value.revision]);
      const ref = putObject(ports, state.value, commandId, 'HostObservation', observed.value, null,
        { actorId: 'host', kind: 'host-adapter', identityRef: null });
      if (!ref.ok) return ref;
      const committed = commit(ports, state.value, { commandId, expectedRevision: state.value.revision },
        { events: [event(state.value, commandId, 'observed', 'host.observed', { objectRef: ref.value })], effects: [], receipts: [] });
      return committed.ok ? observed : committed;
    },
    close: sessionId => ports.store.exportSession(sessionId),
  };
  return service;
}

function seedSnapshot(seed: SessionSeed): unknown {
  return { graphRef: seed.graphRef, policy: seed.policy, reservePerRequest: seed.reservePerRequest,
    operations: seed.operations, grants: seed.grants };
}
