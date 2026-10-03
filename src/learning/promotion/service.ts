import { decode } from '../../protocol/index.js';
import { readArtifact } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { qualification, revokeRevision, sameRevision } from '../assets/index.js';
import type { QualificationContext, RegistrySnapshot, RevocationInput } from '../assets/index.js';
import { activate, reconcile } from './activation.js';
import { decision } from './decisions.js';
import { commit, load } from './journal.js';
import { authorize, comparePointer, sessionReady } from './rules.js';
import type { ActivatedVersion, ActivateInput, AssetPointer, PromoteInput, PromotionPorts, PromotionRecord,
  PromotionState, RollbackInput } from './types.js';

function replay(ports: PromotionPorts, state: PromotionState, requestId: string, input: unknown): StoreResult<PromotionRecord | null> {
  const prior = state.promotions.find(p => p.promotionId === requestId);
  if (prior === undefined) return storeOk(null);
  return prior.requestDigest === ports.registry.digest.digest(canonical(input)) ? storeOk(prior) :
    storeFail('EFK_IDEMPOTENCY_COLLISION', 'promotion request identity already binds different content');
}
function promote(ports: PromotionPorts, input: PromoteInput): StoreResult<PromotionRecord> {
  const id = decode('Id', input.requestId); if (!id.ok) return id;
  const loaded = load(ports); if (!loaded.ok) return loaded;
  const { state, journal } = loaded.value;
  const prior = replay(ports, state, input.requestId, input); if (!prior.ok) return prior;
  if (prior.value !== null) return storeOk(prior.value);
  if (!Array.isArray(input.evaluationRefs) || input.evaluationRefs.length !== 1) {
    return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'promotion needs exactly one EvaluationReceipt');
  }
  const pointer = comparePointer(state, input.expected); if (!pointer.ok) return pointer;
  const ready = sessionReady(state, pointer.value.hostSessionId); if (!ready.ok) return ready;
  const context = { ...input.context, at: ports.clock.now() };
  if (context.hostSessionId !== pointer.value.hostSessionId || canonical(context.scope) !== canonical(pointer.value.scope)) {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'promotion context differs from pointer session/scope');
  }
  // Resolve material for the decision writer; recordDecision owns transition/qualification checks.
  if (!state.registry.revisions.some(r => sameRevision(r.candidate.asset, input.asset))) {
    return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'promotion targets an unregistered revision');
  }
  const allowed = authorize(ports, input.ruleId, 'promote', input.asset, context, input.temporary); if (!allowed.ok) return allowed;
  const evaluationRef = input.evaluationRefs[0];
  if (state.promotions.some(p => p.mode === 'promotion' && p.evaluationRef.digest === evaluationRef.digest)) {
    return storeFail('EFK_IDEMPOTENCY_COLLISION', 'EvaluationReceipt was consumed by another promotion');
  }
  const planned = decision(ports, state.registry, 'promotion', `promotion:${input.requestId}`, input.asset,
    evaluationRef, null, input.ruleId, context); if (!planned.ok) return planned;
  const record: PromotionRecord = { promotionId: input.requestId, requestDigest: ports.registry.digest.digest(canonical(input)),
    mode: 'promotion', previous: pointer.value, asset: input.asset, evaluationRef, ruleId: input.ruleId,
    authorizationRef: allowed.value.authorizationRef, context, decisionRef: planned.value.ref,
    targetSnapshot: null, status: 'promoted', effect: null, hostReceipt: null, activation: null, activationRef: null, activationDecisionRef: null, error: null };
  const committed = commit(ports, journal, { registry: planned.value.registry,
    pointers: state.pointers.map(p => p.pointerId === pointer.value.pointerId ? { ...p, version: p.version + 1, promoted: input.asset } : p),
    promotions: [...state.promotions, record] }, input.requestId);
  return committed.ok ? storeOk(record) : committed;
}
function rollback(ports: PromotionPorts, input: RollbackInput): StoreResult<PromotionRecord> {
  const id = decode('Id', input.requestId); if (!id.ok) return id;
  const loaded = load(ports); if (!loaded.ok) return loaded;
  const { state, journal } = loaded.value;
  const prior = replay(ports, state, input.requestId, input); if (!prior.ok) return prior;
  if (prior.value !== null) return storeOk(prior.value);
  const pointer = comparePointer(state, input.expected); if (!pointer.ok) return pointer;
  const ready = sessionReady(state, pointer.value.hostSessionId); if (!ready.ok) return ready;
  const target = state.promotions.find(p => p.promotionId === input.targetPromotionId);
  if (target === undefined || target.status !== 'active' || target.activation!.newSnapshot === null ||
    target.previous.pointerId !== pointer.value.pointerId || target.context.hostSessionId !== pointer.value.hostSessionId ||
    canonical(target.context.scope) !== canonical(pointer.value.scope)) {
    return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'rollback target is not a confirmed snapshot of this pointer/session/scope');
  }
  const context = { ...input.context, at: ports.clock.now() };
  if (context.hostSessionId !== pointer.value.hostSessionId || canonical(context.scope) !== canonical(pointer.value.scope)) {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'rollback context differs from pointer session/scope');
  }
  const q = qualification(state.registry, target.asset, context); if (!q.ok) return q;
  if (!q.value.eligible) return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'rollback target qualification has expired or been revoked');
  const allowed = authorize(ports, input.ruleId, 'activate', target.asset, context, false); if (!allowed.ok) return allowed;
  const snapshot = readArtifact(target.activation!.newSnapshot!, 'asset-staging', context.at, ports.registry.artifacts); if (!snapshot.ok) return snapshot;
  const record: PromotionRecord = { ...target, promotionId: input.requestId, requestDigest: ports.registry.digest.digest(canonical(input)),
    mode: 'rollback', previous: pointer.value, ruleId: input.ruleId, authorizationRef: allowed.value.authorizationRef,
    context, targetSnapshot: target.activation!.newSnapshot, status: 'promoted', effect: null,
    hostReceipt: null, activation: null, activationRef: null, activationDecisionRef: null, error: null };
  const committed = commit(ports, journal, { ...state,
    pointers: state.pointers.map(p => p.pointerId === pointer.value.pointerId ? { ...p, version: p.version + 1, promoted: target.asset } : p),
    promotions: [...state.promotions, record] }, input.requestId);
  return committed.ok ? storeOk(record) : committed;
}
/** One queue per service; shared writers are fenced by the same journal CAS and pending intentions. */
export function createPromotionService(ports: PromotionPorts) {
  let tail = Promise.resolve();
  function serial<T>(action: () => T | Promise<T>): Promise<T> {
    const result = tail.then(action);
    // Keep the queue usable after a caller-visible exception; result still rejects unchanged.
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  return {
    /** Caller supplies a trusted registry projection; this dedicated session is not auto-created. */
    initialize(registry: RegistrySnapshot, pointers: readonly AssetPointer[]): Promise<StoreResult<PromotionState>> {
      return serial(() => {
        const journal = ports.journal.exportSession(ports.sessionId); if (!journal.ok) return journal;
        if (journal.value.events.some(e => e.type === 'asset.transition' && e.payload.objectRef?.schema.name === 'PromotionState')) {
          return storeFail('EFK_IDEMPOTENCY_COLLISION', 'promotion projection is already initialized');
        }
        if (new Set(pointers.map(p => p.pointerId)).size !== pointers.length) return storeFail('EFK_SCHEMA_INVALID', 'pointer identities must be unique');
        for (const pointer of pointers) {
          for (const [name, value] of [['Id', pointer.pointerId], ['Id', pointer.hostSessionId], ['Scope', pointer.scope]] as const) {
            const checked = decode(name, value); if (!checked.ok) return checked;
          }
          if (pointer.version !== 0 || pointer.active !== null || pointer.promoted !== null) {
            return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'new pointers require an explicit base snapshot and no asset activation');
          }
          const bytes = readArtifact(pointer.snapshot, 'asset-staging', ports.clock.now(), ports.registry.artifacts); if (!bytes.ok) return bytes;
        }
        return commit(ports, journal.value, { registry, pointers, promotions: [] }, 'promotion-initialize');
      });
    },
    promote(input: PromoteInput) { return serial(() => promote(ports, input)); },
    activate(input: ActivateInput) { return serial(() => activate(ports, input.promotionId, input.effect)); },
    reconcile(promotionId: string) { return serial(() => reconcile(ports, promotionId)); },
    rollback(input: RollbackInput) { return serial(() => rollback(ports, input)); },
    revoke(input: RevocationInput, ruleId: string, context: QualificationContext): Promise<StoreResult<PromotionState>> {
      return serial(() => {
        const loaded = load(ports); if (!loaded.ok) return loaded;
        const at = ports.clock.now(), current = { ...context, at };
        const allowed = authorize(ports, ruleId, 'revoke', input.asset, current, false); if (!allowed.ok) return allowed;
        if (input.authorizationRef !== allowed.value.authorizationRef) return storeFail('EFK_AUTHORITY_DENIED', 'revocation authorization differs from preauthorization');
        // Revocation invalidates qualification even while a host outcome is unresolved.
        const registry = revokeRevision(loaded.value.state.registry, { ...input, at }, ports.registry); if (!registry.ok) return registry;
        return commit(ports, loaded.value.journal, { ...loaded.value.state, registry: registry.value }, `revoke:${input.evidenceRef.id}`);
      });
    },
    inspect(): StoreResult<PromotionState> { const loaded = load(ports); return loaded.ok ? storeOk(loaded.value.state) : loaded; },
    /** Actual pointers, filtered by the next task's eligibility; no private evaluation references. */
    activatedVersions(context: QualificationContext): StoreResult<readonly ActivatedVersion[]> {
      const loaded = load(ports); if (!loaded.ok) return loaded;
      const ready = sessionReady(loaded.value.state, context.hostSessionId); if (!ready.ok) return ready;
      const versions: ActivatedVersion[] = [];
      for (const p of loaded.value.state.pointers) {
        if (p.hostSessionId !== context.hostSessionId || canonical(p.scope) !== canonical(context.scope) || p.active === null) continue;
        const applied = loaded.value.state.promotions.filter(r => r.previous.pointerId === p.pointerId &&
          r.activation?.actualStatus === 'active' && canonical(r.activation.newSnapshot) === canonical(p.snapshot)).at(-1);
        if (applied?.status === 'applied-unqualified') return { ok: false, error: applied.error! };
        const q = qualification(loaded.value.state.registry, p.active, { ...context, at: ports.clock.now() }); if (!q.ok) return q;
        const snapshot = readArtifact(p.snapshot, 'asset-staging', ports.clock.now(), ports.registry.artifacts); if (!snapshot.ok) return snapshot;
        if (q.value.eligible) versions.push({ pointerId: p.pointerId, pointerVersion: p.version,
          asset: { ...p.active, qualificationRef: null }, snapshot: p.snapshot });
      }
      return storeOk(versions.sort((a, b) => a.pointerId < b.pointerId ? -1 : a.pointerId > b.pointerId ? 1 : 0));
    },
  };
}
