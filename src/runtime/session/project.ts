/** Journal-only reducer. It reads no clock/port and executes no effect. */
import { normalizeUsage, openBudgetLedger, releaseUnspent, reserve, settle, usageIdentity } from '../../kernel/policy/index.js';
import { asInstant, fail } from '../../protocol/index.js';
import { claimFor } from '../../kernel/scheduler/index.js';
import { emptyReplayState, intendedIds, projectOutbox, reconcileIds, replay, storeOk } from '../../kernel/store/index.js';
import type { ExportedSession, StoreResult } from '../../kernel/store/index.js';
import type { Binding, Effect, Event, RuntimeState, SessionSeed } from './types.js';
import type { NodeState } from '../../kernel/graph/index.js';

function index<T>(items: readonly T[], id: (item: T) => string): Record<string, T> {
  return Object.fromEntries([...items].sort((a, b) => id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0).map(item => [id(item), item]));
}
export function initialState(session: ExportedSession, seed: SessionSeed): StoreResult<RuntimeState> {
  const budget = openBudgetLedger(seed.policy, seed.reservePerRequest);
  if (!budget.ok) return budget;
  const first = session.events[0];
  const epoch = first === undefined ? session.epoch : first.type === 'session.epoch-changed' ? first.epoch - 1 : first.epoch;
  return storeOk({
    ...emptyReplayState(session.sessionId, epoch), protocol: session.protocol, cancellation: 'none',
    attempts: {}, effects: index(session.effects, e => e.effectId), receipts: index(session.receipts, r => r.receiptId),
    resourceModes: Object.fromEntries(seed.graph.spec.resourcePolicy.map(r => [r.resourceId, r.mode])),
    events: [], outbox: { entries: [], archivedReceiptIds: [] }, budget: budget.value, usageIssues: [],
    appliedInvocations: [], invocationEffects: {}, scheduler: { revision: 0, claims: [], leases: { grants: [], nextFencingToken: 1 } },
    intents: [], unknownEffectIds: [], staleEffectIds: [], archivedReceiptIds: [],
  });
}
/** Same initial state and event => byte-identical projection and intentions (DoD 1). */
export function reduce(state: RuntimeState, event: Event): StoreResult<RuntimeState> {
  const replayed = replay([event], state);
  if (!replayed.ok) return replayed;
  const events = [...state.events, event];
  const outbox = projectOutbox(events, new Map(Object.entries(state.effects)), new Map(Object.entries(state.receipts)));
  if (!outbox.ok) return outbox;
  let budget = state.budget;
  const usageIssues = [...state.usageIssues];
  const invocations = new Set(state.appliedInvocations);
  const invocationEffects = { ...state.invocationEffects };
  const attempts = { ...state.attempts };
  if (event.type === 'node.transition') {
    const binding = event.payload.binding as Binding;
    attempts[binding.nodeId] = Math.max(attempts[binding.nodeId] ?? 0, binding.attemptOrdinal);
  }
  if (event.type === 'effect.intended') {
    const effect = state.effects[event.payload.effectId as string];
    if (effect.reservationRef !== null) {
      const next = reserve(budget, { requestId: effect.reservationRef, role: 'worker', parentRequestId: null });
      if (next.error !== null) return { ok: false, error: next.error };
      budget = next.ledger;
    }
  }
  if (event.type === 'receipt.applied') {
    const receipt = state.receipts[event.payload.objectRef!.id];
    const effect = state.effects[receipt.effectId];
    // Evidence gate: not-executed proves unspent; cancellation alone does not.
    if (receipt.status === 'not-executed' && effect.reservationRef !== null) {
      const next = releaseUnspent(budget, { requestId: effect.reservationRef, confirmedUnspentMicros: budget.reservePerRequest });
      budget = next.ledger;
      if (next.error !== null) usageIssues.push(next.error);
    }
    // Policy settles by request identity. Repeated webhook/invocation never adds another charge;
    // incomplete telemetry can subsequently be completed, and conflicts remain explicit.
    const invocation = receipt.hostInvocationId;
    const invocationConflict = invocation !== null && invocationEffects[invocation] !== undefined && invocationEffects[invocation] !== receipt.effectId;
    if (invocationConflict) usageIssues.push(fail('EFK_USAGE_CONFLICT', 'host invocation was already associated with another effect', [invocation!]));
    else if (invocation !== null) invocationEffects[invocation] = receipt.effectId;
    for (const row of receipt.usage) {
      // Actual invocation identity, rather than callback count, owns consumption. A callback
      // cannot settle some other effect's reservation by changing requestId.
      if (invocationConflict || invocation === null || row.requestId !== effect.reservationRef) {
        usageIssues.push(fail('EFK_USAGE_CONFLICT', 'usage cannot be associated with this reserved invocation', [row.requestId]));
        continue;
      }
      const normalized = normalizeUsage(row);
      if (!normalized.ok) { usageIssues.push(normalized.error); continue; }
      const next = settle(budget, { ...normalized.value, digest: usageIdentity(row) });
      budget = next.ledger;
      if (next.error !== null) usageIssues.push(next.error);
      else if (receipt.hostInvocationId !== null) invocations.add(receipt.hostInvocationId);
    }
  }
  const intents: Effect[] = [];
  const staleEffectIds: string[] = [];
  for (const id of intendedIds(outbox.value)) {
    const effect = state.effects[id];
    if (effect.binding.epoch === replayed.value.epoch) intents.push(effect);
    else staleEffectIds.push(id);
  }
  const committedIds = new Set(outbox.value.entries.map(e => e.effectId));
  const unresolved = new Set(outbox.value.entries.filter(e => e.state !== 'resolved').map(e => e.effectId));
  const executionEffects = Object.values(state.effects).filter(e => committedIds.has(e.effectId) && e.reservationRef !== null);
  const allLeases = executionEffects.flatMap(e => e.leases);
  const active = executionEffects.filter(e => unresolved.has(e.effectId));
  const scheduler = {
    revision: replayed.value.revision,
    claims: active.map(e => claimFor(e.binding, asInstant(e.deadline))),
    leases: {
      grants: active.flatMap(e => e.leases.map(lease => ({ ...lease, expiresAt: asInstant(lease.expiresAt), mode: state.resourceModes[lease.resourceId] }))),
      nextFencingToken: Math.max(0, ...allLeases.map(l => l.fencingToken)) + 1,
    },
  };
  const unconfirmed = outbox.value.entries.some(e => e.state === 'unknown' && state.effects[e.effectId].kind === 'host.cancel');
  const cancellation = replayed.value.dispatchMode === 'cancelled' ? 'confirmed'
    : replayed.value.dispatchMode === 'cancelling' ? unconfirmed ? 'unconfirmed' : 'requested' : 'none';
  return storeOk({ ...state, ...replayed.value, events, outbox: outbox.value, budget, attempts,
    usageIssues, invocationEffects, appliedInvocations: [...invocations].sort(), intents, staleEffectIds, scheduler, cancellation,
    unknownEffectIds: reconcileIds(outbox.value), archivedReceiptIds: outbox.value.archivedReceiptIds });
}
export function project(session: ExportedSession, seed: SessionSeed): StoreResult<RuntimeState> {
  let state = initialState(session, seed);
  if (!state.ok) return state;
  for (const event of session.events) {
    state = reduce(state.value, event);
    if (!state.ok) return state;
  }
  return state;
}
export function currentAttemptOf(state: RuntimeState, nodeId: string): number { return state.attempts[nodeId] ?? 1; }
export function nodeStateOf(state: RuntimeState, nodeId: string, attempt: number): NodeState | null {
  return state.nodeStates.find(e => e.nodeId === nodeId && e.attemptOrdinal === attempt)?.state ?? null;
}
export function bindingFor(state: RuntimeState, seed: SessionSeed, nodeId: string, attempt = currentAttemptOf(state, nodeId)): Binding {
  return { sessionId: state.sessionId, hostSessionId: null, graph: seed.graphRef, nodeId,
    attemptId: `node${seed.graph.spec.nodes.findIndex(n => n.nodeId === nodeId)}:a${attempt}:e${state.epoch}`,
    attemptOrdinal: attempt, epoch: state.epoch, baseDigest: null };
}
