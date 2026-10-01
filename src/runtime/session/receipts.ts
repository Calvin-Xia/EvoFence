/** The host-receipt boundary and its atomic state/outbox plan. */
import { decode } from '../../protocol/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import { verifyForConsumer, type ArtifactRef as ConsumerArtifact, type BindingExpectation } from '../../kernel/artifacts/index.js';
import { sameSchema } from '../../kernel/graph/index.js';
import type { SchemaRef } from '../../kernel/graph/index.js';
import { nodeStateOf, currentAttemptOf } from './project.js';
import { event, idFor, putObject, transition } from './journal.js';
import type { Effect, EventDraft, PlannedBatch, Receipt, RuntimeState, SessionPorts, SessionSeed, StoreResult } from './types.js';

export interface ReceiptPlan extends PlannedBatch { readonly disposition: 'applied' | 'archived' | 'duplicate'; readonly receipt: Receipt }
function receiptTransitions(state: RuntimeState, receipt: Receipt, commandId: string, prefix: string): EventDraft[] {
  const b = receipt.binding;
  let before = nodeStateOf(state, b.nodeId, b.attemptOrdinal);
  const events: EventDraft[] = [];
  const move = (after: NonNullable<typeof before>) => {
    if (before === after) return;
    events.push(transition(state, commandId, `${prefix}:state:${events.length}`, b, before, after));
    before = after;
  };
  // Host outcomes only reach verifying; only the registered evaluator can grant success.
  if (receipt.status === 'unknown') { move('unknown'); }
  else if (receipt.status === 'cancelled' || receipt.status === 'not-executed') {
    if (before !== 'pending' && before !== 'ready' && before !== 'cancelling') {
      if (before === 'unknown') move('verifying');
      move('cancelling');
    }
    move('cancelled');
  } else if (before === 'leased' || before === 'running' || before === 'unknown') {
    if (before === 'leased') move('running');
    move('verifying');
  }
  return events;
}

function appendReceipt(ports: SessionPorts, state: RuntimeState, receipt: Receipt, commandId: string,
  archived: boolean, suffix: string): StoreResult<EventDraft> {
  const ref = putObject(ports, state, receipt.receiptId, 'Receipt', receipt, receipt.binding,
    { actorId: 'host', kind: 'host-adapter', identityRef: null });
  if (!ref.ok) return ref;
  return storeOk(event(state, commandId, suffix, archived ? 'receipt.archived' : 'receipt.applied',
    { binding: receipt.binding, effectId: receipt.effectId, objectRef: ref.value }));
}
export function planReceipt(ports: SessionPorts, seed: SessionSeed, state: RuntimeState, input: unknown, now: number): StoreResult<ReceiptPlan> {
  const decoded = decode('Receipt', input);
  if (!decoded.ok) return decoded;
  const receipt = decoded.value as Receipt;
  const effect = state.effects[receipt.effectId];
  if (effect === undefined) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'receipt has no committed effect', [receipt.effectId]);
  const previous = state.receipts[receipt.receiptId];
  if (previous !== undefined) {
    if (canonical(previous) !== canonical(receipt)) return storeFail('EFK_IDEMPOTENCY_COLLISION', 'receipt identity has different bytes', [receipt.receiptId]);
    return storeOk({ disposition: 'duplicate', receipt, events: [], effects: [], receipts: [] });
  }
  const entry = state.outbox.entries.find(e => e.effectId === receipt.effectId)!;
  // Evidence gates: immutable binding/current epoch, attempt and lease fencing must still match.
  const stale = receipt.binding.epoch !== state.epoch || canonical(receipt.binding) !== canonical(effect.binding)
    || receipt.binding.attemptOrdinal !== currentAttemptOf(state, receipt.binding.nodeId)
    || (entry.state !== 'resolved' && effect.leases.some(l => l.expiresAt <= now || !state.scheduler.leases.grants.some(g =>
      g.resourceId === l.resourceId && g.ownerClaimId === l.ownerClaimId && g.epoch === l.epoch && g.fencingToken === l.fencingToken)));
  if (!stale && entry.state === 'intended') return storeFail('EFK_CLAIM_CONFLICT', 'receipt requires a committed dispatch claim', [receipt.effectId]);
  if (!stale && receipt.status !== 'unknown' && receipt.observability.length === 0) {
    return storeFail('EFK_EFFECT_UNKNOWN', 'a resolved receipt needs actual observability', [receipt.receiptId]);
  }
  if (!stale && effect.reservationRef !== null && (receipt.status === 'completed' || receipt.status === 'failed') && receipt.hostInvocationId === null) {
    return storeFail('EFK_EFFECT_UNKNOWN', 'billable execution has no host invocation identity', [receipt.receiptId]);
  }
  if (!stale && entry.state === 'resolved' && receipt.status !== entry.resolvedStatus) {
    return storeFail('EFK_USAGE_CONFLICT', 'resolved invocation has a conflicting terminal status', [receipt.receiptId]);
  }
  if (!stale) {
    // Receipt metadata is not artifact evidence. Resolve actual immutable bytes against the
    // producer's declared output schema before they can become scheduler/evaluator inputs.
    for (const ref of receipt.artifactRefs) {
      const expected = seed.graph.node(effect.binding.nodeId)!.outputSchemas.find(s => sameSchema(s, ref.schema as SchemaRef));
      if (expected === undefined) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'receipt output has no declared schema slot', [ref.id]);
      const admitted = verifyForConsumer({ role: 'evaluator', refs: [ref as ConsumerArtifact], at: now,
        expectation: { productKind: 'node-product', schema: expected, binding: effect.binding as unknown as BindingExpectation } }, ports.artifacts);
      if (!admitted.ok) return admitted;
    }
  }
  const commandId = idFor(ports, 'ack', receipt.receiptId);
  const recorded = appendReceipt(ports, state, receipt, commandId, stale, 'receipt');
  if (!recorded.ok) return recorded;
  const events = [recorded.value];
  const receipts = [receipt];
  if (!stale && entry.state !== 'resolved') {
    if (effect.kind === 'host.cancel') {
      if (receipt.status === 'cancelled') {
        for (const targetId of effect.payload.targetIds) {
          const target = state.effects[targetId];
          const targetReceipt: Receipt = { ...receipt, receiptId: idFor(ports, 'cancel-ack', [receipt.receiptId, targetId]),
            effectId: targetId, binding: target.binding, hostInvocationId: null, usage: [], artifactRefs: [] };
          const applied = appendReceipt(ports, state, targetReceipt, commandId, false, `target:${receipts.length}`);
          if (!applied.ok) return applied;
          events.push(applied.value, ...receiptTransitions(state, targetReceipt, commandId, `target:${receipts.length}`));
          receipts.push(targetReceipt);
        }
        events.push(event(state, commandId, 'cancelled', 'session.cancel-confirmed'));
      }
    } else events.push(...receiptTransitions(state, receipt, commandId, 'effect'));
  }
  return storeOk({ disposition: stale ? 'archived' : 'applied', receipt, events, effects: [], receipts });
}

/** Explicit not-executed evidence is normalized into a receipt; it is never re-dispatched. */
export function notExecutedReceipt(ports: SessionPorts, effect: Effect, evidence: string): Receipt {
  return { protocol: effect.protocol, receiptId: idFor(ports, 'not-executed', [effect.effectId, evidence]),
    effectId: effect.effectId, hostInvocationId: null, binding: effect.binding, status: 'not-executed',
    artifactRefs: [], usage: [], observability: [evidence], error: null };
}
