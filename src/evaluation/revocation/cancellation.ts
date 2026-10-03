import { storeFail } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { verifyReceipt } from '../../runtime/host-port/index.js';
import type { Receipt } from '../../runtime/host-port/index.js';
import { load, prepareArtifact } from '../../learning/promotion/journal.js';
import { retainReceipt, settle } from '../../learning/promotion/activation.js';
import { updateRecord } from './journal.js';
import type { Cancellation, RevocationPorts, RevocationRecord } from './types.js';

/** A real no-execution observation ends the promotion without fabricating an ActivationReceipt. */
export async function settleCancellation(ports: RevocationPorts, record: RevocationRecord,
  cancellation: Cancellation): Promise<StoreResult<RevocationRecord>> {
  const p = ports.promotion, loaded = load(p); if (!loaded.ok) return loaded;
  const target = loaded.value.state.promotions.find(r => r.promotionId === cancellation.promotionId)!;
  let reconciliationRef = cancellation.reconciliationRef;
  const complete = (): StoreResult<RevocationRecord> => updateRecord(ports, record, { ...record, error: null,
    cancellations: record.cancellations.map(c => c.promotionId === cancellation.promotionId ?
      { ...c, status: 'settled', reconciliationRef } : c) });
  const fail = (error: RevocationRecord['error']): StoreResult<RevocationRecord> => updateRecord(ports, record, { ...record, error,
    cancellations: record.cancellations.map(c => c.promotionId === cancellation.promotionId ? { ...c, reconciliationRef } : c) });
  if (target.status !== 'pending') return complete();
  const effect = target.effect!;
  let receipt = loaded.value.journal.receipts.filter(r => r.effectId === effect.effectId && r.status !== 'unknown').at(-1) as Receipt | undefined;
  if (receipt === undefined) {
    const queried = await p.host.reconcile({ sessionId: cancellation.hostSessionId, targetIds: [effect.effectId] });
    if (!queried.ok) return fail(queried.error);
    const prepared = prepareArtifact(p, queried.value, 'ReconcileOutcome', p.hostIssuer);
    reconciliationRef = { ...prepared.ref, visibility: 'private' };
    const retained = p.registry.artifacts.put(reconciliationRef, prepared.bytes); if (!retained.ok) return retained;
    const outcomes = queried.value.filter(o => o.effectId === effect.effectId);
    if (outcomes.length !== 1 || outcomes[0].verdict === 'unknown' ||
      (outcomes[0].verdict === 'resolved' && outcomes[0].receipt === null)) {
      return fail(storeFail('EFK_ACTIVATION_UNCONFIRMED', 'no unique actual cancellation outcome').error);
    }
    const outcome = outcomes[0];
    if (outcome.verdict === 'not-executed') {
      if (outcome.receipt !== null) {
        const verified = verifyReceipt(outcome.receipt, effect); if (!verified.ok) return fail(verified.error);
        if (verified.value.disposition !== 'current' || outcome.receipt.status !== 'not-executed') {
          return fail(storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'no-execution observation conflicts with its receipt').error);
        }
      }
      const error = storeFail('EFK_ASSET_REVOKED', 'promotion stopped after actual no-execution reconciliation').error;
      const unused: Receipt = { protocol: effect.protocol, receiptId: `no-execution:${record.requestId}:${effect.effectId}`,
        effectId: effect.effectId, hostInvocationId: null, binding: effect.binding, status: 'not-executed',
        artifactRefs: [reconciliationRef], usage: [], observability: ['host-reconciled-not-executed'], error };
      const current = load(p); if (!current.ok) return current;
      const next: RevocationRecord = { ...record, error: null, cancellations: record.cancellations.map(c =>
        c.promotionId === cancellation.promotionId ? { ...c, status: 'settled', reconciliationRef } : c) };
      return updateRecord(ports, record, next, { ...current.value.state, promotions: current.value.state.promotions.map(r =>
        r.promotionId === cancellation.promotionId ? { ...r, status: 'failed', error } : r) }, [unused], current.value.journal);
    }
    const retainedReceipt = retainReceipt(p, effect, outcome.receipt!); if (!retainedReceipt.ok) return fail(retainedReceipt.error);
    receipt = retainedReceipt.value;
  }
  const settled = settle(p, cancellation.promotionId, receipt);
  if (!settled.ok) {
    const current = load(p); if (!current.ok) return current;
    if (current.value.state.promotions.find(r => r.promotionId === cancellation.promotionId)!.status !== 'applied-unqualified') {
      return fail(settled.error);
    }
  }
  return complete();
}
