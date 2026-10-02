import { decode } from '../../protocol/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { Receipt, StoreResult } from '../../kernel/store/index.js';
import { qualification, revokeRevision, sameRevision } from '../../learning/assets/index.js';
import { load, prepareArtifact } from '../../learning/promotion/journal.js';
import { authorize } from '../../learning/promotion/rules.js';
import type { PromotionRecord } from '../../learning/promotion/index.js';
import { dependentClosure, invalidity } from './conditions.js';
import { loadSignals } from './signals.js';
import { records, requestDigest, save } from './journal.js';
import type { Cancellation, MonitorInput, RestorePlan, RevocationPorts, RevocationRecord } from './types.js';

export function begin(ports: RevocationPorts, input: MonitorInput): StoreResult<RevocationRecord | null> {
  const id = decode('Id', input.requestId); if (!id.ok) return id;
  const p = ports.promotion, at = p.clock.now();
  const loaded = load(p); if (!loaded.ok) return loaded;
  const existing = records(ports, loaded.value.journal); if (!existing.ok) return existing;
  const prior = existing.value.find(r => r.requestId === input.requestId);
  if (prior !== undefined) return prior.requestDigest === requestDigest(ports, input) ? storeOk(prior) :
    storeFail('EFK_IDEMPOTENCY_COLLISION', 'monitor request already binds different content');
  const signals = loadSignals(ports, input, at); if (!signals.ok) return signals;
  const policy = ports.policy(input.asset); if (!policy.ok) return policy;
  const context = { ...input.context, at };
  const invalid = invalidity(loaded.value.state.registry, input.asset, context, policy.value, signals.value); if (!invalid.ok) return invalid;
  if (invalid.value.length === 0) return storeOk(null);
  let registry = loaded.value.state.registry;
  const affected = dependentClosure(registry, input.asset);
  const evidence = prepareArtifact(p, { requestId: input.requestId, root: input.asset, at, context,
    reasons: invalid.value, affected, signalRefs: input.signalRefs }, 'RevocationEvidence', p.registry.issuers.revocation);
  const evidenceRef = { ...evidence.ref, visibility: 'private' as const };
  const retained = p.registry.artifacts.put(evidenceRef, evidence.bytes); if (!retained.ok) return retained;
  for (const asset of affected) {
    const allowed = authorize(p, input.ruleId, 'revoke', asset, context, false); if (!allowed.ok) return allowed;
    if (registry.history.filter(e => sameRevision(e.asset, asset) && e.state !== 'active').at(-1)!.state === 'revoked') continue;
    const revoked = revokeRevision(registry, { asset, evidenceRef, authorizationRef: allowed.value.authorizationRef, at }, p.registry);
    if (!revoked.ok) return revoked;
    registry = revoked.value;
  }
  const outbox = p.journal.outbox(p.sessionId); if (!outbox.ok) return outbox;
  const cancellations: Cancellation[] = [], cancelled: Receipt[] = [];
  const matches = (record: PromotionRecord): boolean => affected.some(a => sameRevision(a, record.asset));
  const promotions = loaded.value.state.promotions.map(record => {
    if (!matches(record) || !['promoted', 'pending'].includes(record.status)) return record;
    const intended = record.effect === null || outbox.value.entries.find(e => e.effectId === record.effect!.effectId)!.state === 'intended';
    cancellations.push({ promotionId: record.promotionId, effectId: record.effect === null ? null : record.effect.effectId,
      hostSessionId: record.context.hostSessionId, status: intended ? 'not-executed' : 'needed', outcomeRef: null, reconciliationRef: null });
    if (!intended) return record;
    const error = storeFail('EFK_ASSET_REVOKED', 'unfinished promotion cancelled by dependency revocation').error;
    if (record.effect !== null) {
      // The CAS still owns the unclaimed intention: this is kernel evidence, not a host activation receipt.
      cancelled.push({ protocol: loaded.value.journal.protocol, receiptId: `not-executed:${input.requestId}:${record.effect.effectId}`,
        effectId: record.effect.effectId, hostInvocationId: null, binding: record.effect.binding, status: 'not-executed',
        artifactRefs: [evidenceRef], usage: [], observability: ['journal-unclaimed-intention'], error });
    }
    return { ...record, status: 'failed' as const, error };
  });
  const restores: RestorePlan[] = [];
  for (const pointer of loaded.value.state.pointers) {
    const affectedActive = pointer.active !== null && affected.some(a => sameRevision(a, pointer.active!));
    const inFlight = cancellations.some(c => c.status === 'needed' &&
      promotions.find(r => r.promotionId === c.promotionId)!.previous.pointerId === pointer.pointerId);
    if (!affectedActive && !inFlight) continue;
    const candidates = promotions.filter(r => r.status === 'active' && r.activationDecisionRef !== null &&
      r.activation?.actualStatus === 'active' && r.activation.newSnapshot !== null &&
      r.previous.pointerId === pointer.pointerId && r.context.hostSessionId === pointer.hostSessionId &&
      canonical(r.context.scope) === canonical(pointer.scope));
    let target: PromotionRecord | null = null;
    for (const candidate of candidates) {
      const q = qualification(registry, candidate.asset, { ...context, hostSessionId: pointer.hostSessionId, scope: pointer.scope });
      if (!q.ok) return q;
      if (q.value.eligible) target = candidate;
    }
    restores.push({ pointerId: pointer.pointerId, targetPromotionId: target === null ? null : target.promotionId,
      targetSnapshot: target === null ? null : target.activation!.newSnapshot,
      rollbackId: `restore:${input.requestId}:${pointer.pointerId}` });
  }
  const pointers = loaded.value.state.pointers.map(pointer => pointer.promoted !== null &&
    affected.some(a => sameRevision(a, pointer.promoted!)) ? { ...pointer, version: pointer.version + 1,
      promoted: pointer.active !== null && !affected.some(a => sameRevision(a, pointer.active!)) ? pointer.active : null } : pointer);
  const record: RevocationRecord = { requestId: input.requestId, requestDigest: requestDigest(ports, input), at, root: input.asset,
    context, ruleId: input.ruleId, reasons: invalid.value, affected, evidenceRef, cancellations, restores,
    status: cancellations.every(c => c.status === 'not-executed') && restores.length === 0 ? 'complete' : 'pending', error: null };
  return save(ports, loaded.value.journal, record, { registry, promotions, pointers }, cancelled);
}
