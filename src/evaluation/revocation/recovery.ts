import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { deriveAuthority } from '../../kernel/policy/index.js';
import { sameRevision } from '../../learning/assets/index.js';
import { createPromotionService } from '../../learning/promotion/index.js';
import { load, prepareArtifact } from '../../learning/promotion/journal.js';
import { findRecord, updateRecord as update } from './journal.js';
import { settleCancellation } from './cancellation.js';
import type { RevocationPorts, RevocationRecord } from './types.js';

/** Dispatch ambiguity is reconciled, never retried. Each cancellation intention precedes host I/O. */
export async function recover(ports: RevocationPorts, requestId: string): Promise<StoreResult<RevocationRecord>> {
  const found = findRecord(ports, requestId); if (!found.ok) return found;
  let record = found.value;
  if (record.status === 'complete') return storeOk(record);
  const p = ports.promotion, service = createPromotionService(p);
  const fail = (error: RevocationRecord['error']): StoreResult<RevocationRecord> => update(ports, record, { ...record, error });
  for (const cancellation of record.cancellations) {
    if (['not-executed', 'settled'].includes(cancellation.status)) continue;
    if (cancellation.status === 'needed') {
      const state = load(p); if (!state.ok) return state;
      const target = state.value.state.promotions.find(r => r.promotionId === cancellation.promotionId)!;
      const rule = p.policy.rule(record.ruleId); if (!rule.ok) return rule;
      if (rule.value === null || rule.value.ruleId !== record.ruleId || rule.value.hostSessionId !== target.context.hostSessionId ||
        !rule.value.assets.some(a => sameRevision(a, target.asset))) {
        return fail(storeFail('EFK_AUTHORITY_DENIED', 'cancel rule does not bind the derived asset and host session').error);
      }
      // Cancellation has its own live host.cancel capability; stale revoke authority cannot authorize it.
      const authority = deriveAuthority({ ...rule.value.authority, now: p.clock.now(), node: {
        ...rule.value.authority.node, scope: target.context.scope, capabilities: ['host.cancel'] } });
      if (!authority.ok) return fail(authority.error);
      const next: RevocationRecord = { ...record, cancellations: record.cancellations.map(c => c.promotionId === cancellation.promotionId ?
        { ...c, status: 'requested' } : c) };
      const intention = update(ports, record, next); if (!intention.ok) return intention;
      record = next;
      const cancelled = await p.host.cancel({ sessionId: cancellation.hostSessionId, targetIds: [cancellation.effectId!] });
      if (!cancelled.ok) return fail(cancelled.error);
      const prepared = prepareArtifact(p, cancelled.value, 'CancelOutcome', p.hostIssuer);
      const ref = { ...prepared.ref, visibility: 'private' as const };
      const retained = p.registry.artifacts.put(ref, prepared.bytes); if (!retained.ok) return retained;
      const observedRecord: RevocationRecord = { ...record, cancellations: record.cancellations.map(c => c.promotionId === cancellation.promotionId ?
        { ...c, status: 'observed', outcomeRef: ref } : c) };
      const observed = update(ports, record, observedRecord); if (!observed.ok) return observed;
      record = observedRecord;
      // A cancel ack cannot establish whether activation had already mutated the host.
    }
    const currentCancellation = record.cancellations.find(c => c.promotionId === cancellation.promotionId)!;
    const settled = await settleCancellation(ports, record, currentCancellation); if (!settled.ok) return settled;
    record = settled.value;
    if (record.cancellations.find(c => c.promotionId === cancellation.promotionId)!.status !== 'settled') return settled;
  }
  for (const restore of record.restores) {
    if (restore.targetPromotionId === null) return fail(storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'no still-qualified verified snapshot for rollback').error);
    const loaded = load(p); if (!loaded.ok) return loaded;
    const pointer = loaded.value.state.pointers.find(x => x.pointerId === restore.pointerId)!;
    const verifiedTarget = loaded.value.state.promotions.find(r => r.promotionId === restore.targetPromotionId)!;
    const versions = service.activatedVersions({ ...record.context, hostSessionId: pointer.hostSessionId, scope: pointer.scope });
    if (versions.ok && versions.value.some(v => v.pointerId === pointer.pointerId && sameRevision(v.asset, verifiedTarget.asset) &&
      canonical(v.snapshot) === canonical(restore.targetSnapshot))) continue;
    let rollback = loaded.value.state.promotions.find(r => r.promotionId === restore.rollbackId);
    if (rollback === undefined) {
      const planned = await service.rollback({ requestId: restore.rollbackId, expected: pointer,
        targetPromotionId: restore.targetPromotionId, ruleId: record.ruleId,
        context: { ...record.context, hostSessionId: pointer.hostSessionId, scope: pointer.scope } });
      if (!planned.ok) return fail(planned.error);
      rollback = planned.value;
    }
    if (rollback.status === 'promoted') {
      const effect = ports.restoreEffect(rollback); if (!effect.ok) return fail(effect.error);
      const activated = await service.activate({ promotionId: rollback.promotionId, effect: effect.value });
      if (!activated.ok) return fail(activated.error);
      rollback = activated.value;
    } else if (rollback.status === 'pending') {
      const reconciled = await service.reconcile(rollback.promotionId); if (!reconciled.ok) return fail(reconciled.error);
      rollback = reconciled.value;
    }
    if (rollback.status !== 'active' || canonical(rollback.activation!.newSnapshot) !== canonical(restore.targetSnapshot)) {
      return fail(storeFail('EFK_ACTIVATION_UNCONFIRMED', 'restore did not confirm the exact verified snapshot').error);
    }
  }
  return update(ports, record, { ...record, status: 'complete', error: null });
}
