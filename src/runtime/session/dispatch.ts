/** A claimed effect is never sent twice, even when the subsequent host call throws. */
import { grantCovers, verifyBoardAuthority, verifyEffect } from '../host-port/index.js';
import { asInstant } from '../../protocol/index.js';
import { storeFail, storeOk } from '../../storage/index.js';
import { readArtifact, type ArtifactRef as ConsumerArtifact } from '../../storage/artifacts/index.js';
import { bindingFor } from './project.js';
import { dispatchAdmission, planRound } from './plans.js';
import { commit, idFor } from './journal.js';
import type { Admission, Effect, RuntimeState, SessionPorts, SessionSeed, SessionService, StepReport, StoreResult } from './types.js';

export async function dispatchPending(ports: SessionPorts, seed: SessionSeed, service: SessionService,
  sessionId: string, controlOnly = false): Promise<StoreResult<StepReport>> {
  const attempted: string[] = [], applied: string[] = [], archived: string[] = [];
  const pending = ports.store.nextEffects(sessionId);
  if (!pending.ok) return pending;
  for (const effect of pending.value) {
    const read = service.read(sessionId);
    if (!read.ok) return read;
    const state = read.value;
    if (effect.kind !== 'host.cancel' && (controlOnly || state.dispatchMode !== 'active')) continue;
    const now = asInstant(ports.clock.now());
    // Dispatch-time lease/deadline gate is distinct from scheduling-time reservation.
    if (effect.deadline <= now || effect.leases.some(l => l.epoch !== state.epoch || l.expiresAt <= now)) {
      return storeFail('EFK_LEASE_STALE', 'dispatch deadline or lease expired; no host call', [effect.effectId]);
    }
    const admission = ports.policy.inspect(seed, seed.graph.node(effect.binding.nodeId)!, effect.binding, now);
    if (effect.kind !== 'host.cancel') {
      // This effect already owns a reservation; exhaustion of additional slots cannot revoke it.
      if (!state.budget.reservations.some(r => r.requestId === effect.reservationRef)) {
        return storeFail('EFK_BUDGET_NOT_AUTHORIZED', 'committed effect has no outstanding reservation', [effect.effectId]);
      }
      const decision = dispatchAdmission(state, admission, effect.reservationRef);
      if (decision.error !== null) return { ok: false, error: decision.error };
    } else if (!admission.authority.ok) return admission.authority;
    const authorized = verifyEffect(effect, { grants: seed.grants, now });
    if (!authorized.ok) return authorized;
    if (admission.authority.ok && !grantCovers(authorized.value.grant, admission.authority.value.scope, now)) {
      return storeFail('EFK_AUTHORITY_DENIED', 'effect delegation does not cover effective authority', [effect.effectId]);
    }
    for (const ref of effect.inputRefs) {
      const readable = readArtifact(ref as ConsumerArtifact, 'author', now, ports.artifacts);
      if (!readable.ok) return readable;
    }
    const claimId = idFor(ports, 'dispatch', [effect.effectId, state.epoch]);
    const claimed = ports.store.dispatchEffect(sessionId, { expectedRevision: state.revision, epoch: state.epoch, effectId: effect.effectId, claimId });
    if (!claimed.ok) return claimed;
    // No catch: an unexpected port failure remains visible, while the committed claim recovers as unknown.
    attempted.push(effect.effectId);
    const executed = await ports.host.execute(authorized.value);
    if (!executed.ok) return executed;
    const received = service.receive(sessionId, executed.value);
    if (!received.ok) return received;
    if (received.value.disposition === 'applied') applied.push(received.value.receiptId);
    if (received.value.disposition === 'archived') archived.push(received.value.receiptId);
  }
  const final = service.read(sessionId);
  if (!final.ok) return final;
  return storeOk({ sessionId, revision: final.value.revision, dispatchAttempted: attempted,
    appliedReceipts: applied, archivedReceipts: archived, unknownEffectIds: final.value.unknownEffectIds });
}
export async function stepSession(ports: SessionPorts, seed: SessionSeed, service: SessionService): Promise<StoreResult<StepReport>> {
  const observed = await service.observe(seed.sessionId);
  if (!observed.ok) return observed;
  const read = service.read(seed.sessionId);
  if (!read.ok) return read;
  const state = read.value;
  const claims = state.scheduler.claims.map(c => ({ nodeId: c.binding.nodeId, attemptId: c.binding.attemptId, ownerClaimId: c.claimId }));
  const board = verifyBoardAuthority(observed.value, claims);
  if (!board.ok) return board;
  const now = asInstant(ports.clock.now());
  const admissions: Record<string, Admission> = {};
  for (const node of seed.graph.spec.nodes) admissions[node.nodeId] = ports.policy.inspect(seed, node, bindingFor(state, seed, node.nodeId), now);
  const commandId = idFor(ports, 'round', [seed.sessionId, state.revision]);
  const batch = planRound(state, seed, { ...ports, now }, admissions, commandId);
  if (!batch.ok) return batch;
  if (batch.value.events.length > 0) {
    const written = commit(ports, state, { commandId, expectedRevision: state.revision }, batch.value);
    if (!written.ok) return written;
  }
  return dispatchPending(ports, seed, service, seed.sessionId);
}
