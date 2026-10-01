/** Lifecycle commands: journal identities survive restart; unconfirmed cancel stays unknown. */
import { asInstant, fail } from '../../protocol/index.js';
import { storeFail, storeOk } from '../../storage/index.js';
import { grantCovers } from '../host-port/index.js';
import { bindingFor, currentAttemptOf, nodeStateOf } from './project.js';
import { commit, event, idFor, priorCommand, putObject, transition } from './journal.js';
import { dispatchPending } from './dispatch.js';
import { notExecutedReceipt } from './receipts.js';
import type { CancelReport, CancelRequest, CommandOutcome, Effect, EventDraft, PauseRequest, Receipt,
  ResumeRequest, RuntimeState, SessionPorts, SessionSeed, SessionService, StoreResult } from './types.js';

export function pauseSession(ports: SessionPorts, state: RuntimeState, request: PauseRequest): StoreResult<CommandOutcome> {
  const content = { kind: 'session.pause', ...request };
  const prior = priorCommand(ports, state, request, content);
  if (!prior.ok || prior.value !== null) return prior as StoreResult<CommandOutcome>;
  if (state.dispatchMode === 'cancelling' || state.dispatchMode === 'cancelled') return storeFail('EFK_CANCEL_UNCONFIRMED', 'cannot pause a cancelling/cancelled session');
  const ref = putObject(ports, state, idFor(ports, 'command', request.commandId), 'SessionCommand', content, null);
  if (!ref.ok) return ref;
  return commit(ports, state, request, { events: [event(state, request.commandId, 'pause', 'session.paused', { objectRef: ref.value })], effects: [], receipts: [] });
}
export function resumeSession(ports: SessionPorts, seed: SessionSeed, state: RuntimeState, request: ResumeRequest): StoreResult<CommandOutcome> {
  const content = { kind: 'session.resume', ...request };
  const prior = priorCommand(ports, state, request, content);
  if (!prior.ok || prior.value !== null) return prior as StoreResult<CommandOutcome>;
  if (state.dispatchMode !== 'paused') return storeFail('EFK_REVISION_CONFLICT', 'resume requires a paused session');
  if (request.epoch <= state.epoch) return storeFail('EFK_REVISION_CONFLICT', 'resume epoch must advance');
  const admitted = ports.policy.resume(seed, state, request);
  if (!admitted.ok) return admitted;
  const ref = putObject(ports, state, idFor(ports, 'command', request.commandId), 'SessionCommand', content, null);
  if (!ref.ok) return ref;
  return commit(ports, state, request, { events: [
    event(state, request.commandId, 'epoch', 'session.epoch-changed', { objectRef: ref.value }, request.epoch),
    event(state, request.commandId, 'resume', 'session.resumed', { objectRef: request.manifestRef }, request.epoch),
  ], effects: [], receipts: [] }, request.epoch);
}
export async function cancelSession(ports: SessionPorts, seed: SessionSeed, service: SessionService,
  state: RuntimeState, request: CancelRequest): Promise<StoreResult<CancelReport>> {
  const content = { kind: 'session.cancel', ...request };
  const prior = priorCommand(ports, state, request, content);
  if (!prior.ok) return prior;
  if (prior.value === null) {
    const ref = putObject(ports, state, idFor(ports, 'command', request.commandId), 'SessionCommand', content, null);
    if (!ref.ok) return ref;
    const events = [event(state, request.commandId, 'cancel', 'session.cancel-requested', { objectRef: ref.value })];
    const effects: Effect[] = [], receipts: Receipt[] = [];
    const active: Effect[] = [];
    for (const entry of state.outbox.entries) {
      const effect = state.effects[entry.effectId];
      if (effect.reservationRef === null || entry.state === 'resolved') continue;
      if (entry.state === 'intended') {
        // Journal proof: no dispatch claim exists, so this effect spent nothing and needs no host call.
        const receipt = notExecutedReceipt(ports, effect, 'journal-unclaimed');
        const receiptRef = putObject(ports, state, receipt.receiptId, 'Receipt', receipt, effect.binding);
        if (!receiptRef.ok) return receiptRef;
        events.push(event(state, request.commandId, `unused:${receipts.length}`, 'receipt.applied',
          { binding: effect.binding, objectRef: receiptRef.value, effectId: effect.effectId }));
        events.push(transition(state, request.commandId, `stop:${receipts.length}`, effect.binding,
          nodeStateOf(state, effect.binding.nodeId, effect.binding.attemptOrdinal), 'cancelled'));
        receipts.push(receipt);
      } else active.push(effect);
    }
    for (const node of seed.graph.spec.nodes) {
      const slot = seed.graph.spec.nodes.indexOf(node);
      const attempt = currentAttemptOf(state, node.nodeId);
      const before = nodeStateOf(state, node.nodeId, attempt);
      if (before === null || before === 'pending' || before === 'ready' || before === 'waiting') {
        events.push(transition(state, request.commandId, `unstarted:${slot}`, bindingFor(state, seed, node.nodeId), before, 'cancelled'));
      } else if (before === 'running' || before === 'verifying' || (before === 'leased' && active.some(e => e.binding.nodeId === node.nodeId))) {
        const binding = bindingFor(state, seed, node.nodeId);
        events.push(transition(state, request.commandId, `cancelling:${slot}`, binding, before, 'cancelling'));
        if (!active.some(e => e.binding.nodeId === node.nodeId)) {
          events.push(transition(state, request.commandId, `settled-cancel:${slot}`, binding, 'cancelling', 'cancelled'));
        }
      }
    }
    if (active.length === 0) events.push(event(state, request.commandId, 'confirmed', 'session.cancel-confirmed'));
    else {
      const now = asInstant(ports.clock.now());
      const authorities = active.map(effect => ports.policy.inspect(seed, seed.graph.node(effect.binding.nodeId)!, effect.binding, now).authority);
      for (const authority of authorities) if (!authority.ok) return authority;
      const grant = seed.grants.find(g => authorities.every(a => a.ok && grantCovers(g, a.value.scope, now)));
      if (grant === undefined) return storeFail('EFK_AUTHORITY_DENIED', 'cancel has no live delegated authority');
      const binding = bindingFor(state, seed, active[0].binding.nodeId);
      const effectId = idFor(ports, 'cancel', request.commandId);
      const effect: Effect = { protocol: state.protocol, effectId, idempotencyKey: effectId, binding,
        authorityRef: grant.grantId, reservationRef: null, leases: [], inputRefs: [],
        deadline: now + ports.effectTtlMs, kind: 'host.cancel', payload: {
          context: null, toolName: null, argumentsRef: null, graphRef: null, targetIds: active.map(e => e.effectId),
          assetRef: null, previousSnapshot: null, deliveryGuarantee: 'none',
        } };
      events.push(event(state, request.commandId, 'intended', 'effect.intended', { binding, effectId }));
      effects.push(effect);
    }
    const committed = commit(ports, state, request, { events, effects, receipts });
    if (!committed.ok) return committed;
  }
  const dispatched = await dispatchPending(ports, seed, service, state.sessionId, true);
  if (!dispatched.ok) return dispatched;
  const read = service.read(state.sessionId);
  if (!read.ok) return read;
  const confirmed = read.value.cancellation === 'confirmed';
  return storeOk({ ...dispatched.value, status: confirmed ? 'cancelled' : 'unknown',
    error: confirmed ? null : fail('EFK_CANCEL_UNCONFIRMED', 'host cancellation is not confirmed', read.value.unknownEffectIds) });
}
