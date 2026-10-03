import { decode } from '../../protocol/index.js';
import { readArtifact } from '../../kernel/artifacts/index.js';
import type { ArtifactRef } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { capabilityGapError, judgeRequirements, requiredCapabilities, scopeWithin, verifyEffect, verifyReceipt } from '../../runtime/host-port/index.js';
import type { AuthorizedEffect, Effect, Receipt } from '../../runtime/host-port/index.js';
import { qualification, sameRevision } from '../assets/index.js';
import type { ActivationReceipt } from '../assets/index.js';
import { decision, writeDecision } from './decisions.js';
import { commit, load, publish, readJSON } from './journal.js';
import { authorize, sessionReady } from './rules.js';
import type { PromotionPorts, PromotionRecord } from './types.js';

function effectFor(ports: PromotionPorts, record: PromotionRecord, effect: Effect): StoreResult<AuthorizedEffect> {
  const at = ports.clock.now(), context = { ...record.context, at };
  const rule = authorize(ports, record.ruleId, 'activate', record.asset, context, false); if (!rule.ok) return rule;
  if (rule.value.authorizationRef !== record.authorizationRef || effect.authorityRef !== record.authorizationRef ||
    effect.kind !== 'host.activate' || effect.binding.sessionId !== ports.sessionId || effect.binding.hostSessionId !== context.hostSessionId ||
    effect.binding.baseDigest !== context.baseDigest || effect.binding.nodeId !== rule.value.authority.node.nodeId ||
    canonical(effect.payload.assetRef) !== canonical(record.asset) ||
    canonical(effect.payload.previousSnapshot) !== canonical(record.previous.snapshot)) {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'activation effect differs from promotion/old snapshot/authority');
  }
  const grant = ports.policy.grant(effect.authorityRef); if (!grant.ok) return grant;
  const checked = verifyEffect(effect, { grants: grant.value === null ? [] : [grant.value], now: at }); if (!checked.ok) return checked;
  if (effect.deadline !== null && at >= effect.deadline) return storeFail('EFK_ACTIVATION_NOT_SETTLED', 'activation deadline elapsed before dispatch');
  if (!scopeWithin(context.scope, checked.value.grant.scope)) return storeFail('EFK_AUTHORITY_DENIED', 'activation scope exceeds host grant');
  const lease = ports.policy.verifyLease(checked.value.effect, at); if (!lease.ok) return lease;
  return checked;
}
/** Save actual host evidence before attempting the registry/pointer transaction. */
export function retainReceipt(ports: PromotionPorts, effect: Effect, input: Receipt): StoreResult<Receipt> {
  const checked = verifyReceipt(input, effect); if (!checked.ok) return checked;
  if (checked.value.disposition !== 'current') return storeFail('EFK_RECEIPT_STALE', 'activation receipt belongs to an older binding');
  if (input.status !== 'unknown' && input.hostInvocationId === null) return storeFail('EFK_ACTIVATION_UNCONFIRMED', 'actual activation cannot be correlated to a host invocation');
  const ref = publish(ports, checked.value.receipt, 'Receipt', ports.hostIssuer, input.receiptId); if (!ref.ok) return ref;
  const journal = ports.journal.exportSession(ports.sessionId); if (!journal.ok) return journal;
  const saved = ports.journal.applyReceipt(ports.sessionId, { expectedRevision: journal.value.revision,
    epoch: journal.value.epoch, receipt: checked.value.receipt, objectRef: ref.value });
  return saved.ok ? storeOk(checked.value.receipt) : saved;
}
export function settle(ports: PromotionPorts, promotionId: string, receipt: Receipt): StoreResult<PromotionRecord> {
  const loaded = load(ports); if (!loaded.ok) return loaded;
  const { state, journal } = loaded.value, record = state.promotions.find(p => p.promotionId === promotionId)!;
  if (record.status !== 'pending') {
    if (canonical(record.hostReceipt) !== canonical(receipt)) return storeFail('EFK_IDEMPOTENCY_COLLISION', 'settled activation already binds a different actual receipt');
    return record.status === 'applied-unqualified' ? { ok: false, error: record.error! } : storeOk(record);
  }
  const refs = receipt.artifactRefs.filter(r => r.schema.name === 'ActivationReceipt');
  if (refs.length !== 1) return storeFail('EFK_ACTIVATION_UNCONFIRMED', 'host receipt needs exactly one actual activation receipt');
  const ref = refs[0] as ArtifactRef;
  if (ref.schema.version !== '1.1.0' || canonical(ref.producer) !== canonical(ports.hostIssuer)) {
    return storeFail('EFK_DECISION_AUTHORITY_DENIED', 'activation receipt is not attributable to the registered host adapter');
  }
  const at = ports.clock.now(), content = readJSON(ref, at, ports); if (!content.ok) return content;
  const checked = decode('ActivationReceipt', content.value); if (!checked.ok) return checked;
  const a = checked.value as ActivationReceipt;
  if (!sameRevision(a.asset, record.asset) || a.hostSessionId !== record.context.hostSessionId ||
    canonical(a.scope) !== canonical(record.context.scope) || canonical(a.previousSnapshot) !== canonical(record.previous.snapshot) ||
    canonical(a.evaluationRef) !== canonical(record.evaluationRef) || a.authorizationRef !== record.authorizationRef ||
    (receipt.status === 'completed' ? a.actualStatus !== 'active' : receipt.status === 'failed' ? a.actualStatus !== 'failed' : a.actualStatus !== 'unknown') ||
    (a.actualStatus !== 'active' && a.newSnapshot !== null)) {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'host activation receipt differs from the committed transaction or actual outcome');
  }
  if (a.actualStatus === 'unknown') return storeFail('EFK_ACTIVATION_UNCONFIRMED', 'host activation is still unknown');
  let registry = state.registry, pointers = state.pointers;
  let qualificationError: PromotionRecord['error'] = null;
  let activationDecisionRef: ArtifactRef | null = null;
  if (a.actualStatus === 'active') {
    if (a.newSnapshot === null || (record.targetSnapshot !== null && canonical(a.newSnapshot) !== canonical(record.targetSnapshot))) {
      return storeFail('EFK_ACTIVATION_UNCONFIRMED', 'host has not confirmed the requested actual snapshot');
    }
    if (record.mode === 'promotion') {
      const planned = decision(ports, registry, 'activation', `activation:${promotionId}`, record.asset,
        record.evaluationRef, ref, record.ruleId, { ...record.context, at });
      if (planned.ok) { registry = planned.value.registry; activationDecisionRef = planned.value.ref; }
      else qualificationError = planned.error;
    } else {
      // Restore an already qualified snapshot, without granting a new registry qualification.
      const q = qualification(registry, record.asset, { ...record.context, at }); if (!q.ok) return q;
      if (!q.value.eligible) qualificationError = storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'restored snapshot is no longer qualified').error;
      const allowed = authorize(ports, record.ruleId, 'activate', record.asset, { ...record.context, at }, false);
      if (!allowed.ok) qualificationError = allowed.error;
      else if (allowed.value.authorizationRef !== a.authorizationRef) qualificationError = storeFail('EFK_AUTHORITY_DENIED', 'rollback authority changed').error;
      for (const snapshot of [a.previousSnapshot, a.newSnapshot]) {
        const bytes = readArtifact(snapshot, 'asset-staging', at, ports.registry.artifacts); if (!bytes.ok) return bytes;
      }
      if (qualificationError === null) {
        const decided = writeDecision(ports, registry, 'activation', `activation:${promotionId}`, record.asset, record.evaluationRef, ref);
        if (!decided.ok) return decided;
        activationDecisionRef = decided.value;
      }
    }
    pointers = pointers.map(p => p.pointerId === record.previous.pointerId ? { ...p, active: record.asset, snapshot: a.newSnapshot! } : p);
  } else {
    const retained = readArtifact(record.previous.snapshot, 'asset-staging', at, ports.registry.artifacts); if (!retained.ok) return retained;
  }
  // A revoked/expired grant or qualification cannot undo an already observed external mutation.
  // Retain its actual snapshot, refuse task use, and allow an authorized compensating rollback.
  const next: PromotionRecord = { ...record, status: qualificationError === null ? a.actualStatus : 'applied-unqualified',
    hostReceipt: receipt, activation: a, activationRef: ref, activationDecisionRef,
    error: qualificationError === null ? receipt.error : qualificationError };
  const committed = commit(ports, journal, { registry, pointers,
    promotions: state.promotions.map(p => p.promotionId === promotionId ? next : p) }, `settle:${promotionId}:${receipt.receiptId}`);
  return !committed.ok ? committed : qualificationError === null ? storeOk(next) : { ok: false, error: qualificationError };
}
export async function activate(ports: PromotionPorts, promotionId: string, effect: Effect): Promise<StoreResult<PromotionRecord>> {
  const loaded = load(ports); if (!loaded.ok) return loaded;
  const { state, journal } = loaded.value, record = state.promotions.find(p => p.promotionId === promotionId);
  if (record === undefined) return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'promotion is not registered');
  let resumeIntention = false;
  if (record.effect !== null) {
    if (canonical(record.effect) !== canonical(effect)) return storeFail('EFK_IDEMPOTENCY_COLLISION', 'activation effect changed on replay');
    if (record.status !== 'pending') return record.status === 'applied-unqualified' ? { ok: false, error: record.error! } : storeOk(record);
    const outbox = ports.journal.outbox(ports.sessionId); if (!outbox.ok) return outbox;
    resumeIntention = outbox.value.entries.find(e => e.effectId === effect.effectId)!.state === 'intended';
    if (!resumeIntention) return storeFail('EFK_ACTIVATION_UNCONFIRMED', 'activation was dispatched; reconcile without resending');
  }
  const ready = sessionReady({ ...state, promotions: state.promotions.filter(p => p.promotionId !== promotionId) }, record.context.hostSessionId);
  if (!ready.ok) return ready;
  const pointer = state.pointers.find(p => p.pointerId === record.previous.pointerId)!;
  if (pointer.promoted === null || !sameRevision(pointer.promoted, record.asset) ||
    pointer.version !== record.previous.version + 1 || canonical(pointer.snapshot) !== canonical(record.previous.snapshot)) {
    return storeFail('EFK_REVISION_CONFLICT', 'promotion pointer moved before activation');
  }
  const observed = await ports.host.observe(record.context.hostSessionId); if (!observed.ok) return observed;
  if (!observed.value.idle) return storeFail('EFK_ACTIVATION_NOT_SETTLED', 'activation needs a host safe point');
  const q = qualification(state.registry, record.asset, { ...record.context, at: ports.clock.now() }); if (!q.ok) return q;
  if (!q.value.eligible) return storeFail(q.value.reasons[0], 'activation qualification is no longer eligible');
  const authorized = effectFor(ports, record, effect); if (!authorized.ok) return authorized;
  if (effect.binding.epoch !== journal.epoch) return storeFail('EFK_LEASE_STALE', 'activation effect belongs to a stale session epoch');
  const capabilities = judgeRequirements(observed.value.capabilities, requiredCapabilities(effect));
  if (capabilities.length > 0) return { ok: false, error: capabilityGapError(capabilities, observed.value.host) };
  const pending: PromotionRecord = { ...record, status: 'pending', effect: authorized.value.effect };
  const committed = resumeIntention ? storeOk(state) : commit(ports, journal, { ...state,
    promotions: state.promotions.map(p => p.promotionId === promotionId ? pending : p) }, `activate:${promotionId}`, authorized.value.effect);
  if (!committed.ok) return committed;
  const current = ports.journal.exportSession(ports.sessionId); if (!current.ok) return current;
  const dispatched = ports.journal.dispatchEffect(ports.sessionId, { expectedRevision: current.value.revision,
    epoch: current.value.epoch, effectId: effect.effectId, claimId: `activation-claim:${effect.effectId}` }); if (!dispatched.ok) return dispatched;
  const executed = await ports.host.execute(authorized.value); if (!executed.ok) return executed;
  const retained = retainReceipt(ports, effect, executed.value); if (!retained.ok) return retained;
  return settle(ports, promotionId, retained.value);
}
export async function reconcile(ports: PromotionPorts, promotionId: string): Promise<StoreResult<PromotionRecord>> {
  const loaded = load(ports); if (!loaded.ok) return loaded;
  const record = loaded.value.state.promotions.find(p => p.promotionId === promotionId);
  if (record === undefined) return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'promotion is not registered');
  if (record.status !== 'pending') return record.status === 'applied-unqualified' ? { ok: false, error: record.error! } : storeOk(record);
  const effect = record.effect!;
  const outbox = ports.journal.outbox(ports.sessionId); if (!outbox.ok) return outbox;
  if (outbox.value.entries.find(e => e.effectId === effect.effectId)!.state === 'intended') return activate(ports, promotionId, effect);
  const receipt = loaded.value.journal.receipts.filter(r => r.effectId === effect.effectId && r.status !== 'unknown').at(-1);
  if (receipt !== undefined) return settle(ports, promotionId, receipt as Receipt);
  const result = await ports.host.reconcile({ sessionId: record.context.hostSessionId, targetIds: [effect.effectId] }); if (!result.ok) return result;
  const outcomes = result.value.filter(o => o.effectId === effect.effectId);
  if (outcomes.length !== 1 || outcomes[0].verdict !== 'resolved' || outcomes[0].receipt === null) {
    return storeFail('EFK_ACTIVATION_UNCONFIRMED', 'no unique actual outcome; activation remains pending');
  }
  const retained = retainReceipt(ports, effect, outcomes[0].receipt); if (!retained.ok) return retained;
  return settle(ports, promotionId, retained.value);
}
