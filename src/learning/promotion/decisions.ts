import { decode } from '../../protocol/index.js';
import { recordDecision } from '../assets/index.js';
import type { ArtifactRef } from '../../kernel/artifacts/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { storeFail } from '../../kernel/store/index.js';
import type { AssetRef, QualificationContext, RegistrySnapshot } from '../assets/index.js';
import { authorize } from './rules.js';
import { publish } from './journal.js';
import type { PromotionPorts } from './types.js';

/** A restore decision records actual application, without issuing a second asset qualification. */
export function writeDecision(ports: PromotionPorts, registry: RegistrySnapshot, kind: 'promotion' | 'activation',
  id: string, asset: AssetRef, evaluationRef: ArtifactRef, activationRef: ArtifactRef | null,
): StoreResult<ArtifactRef> {
  const revision = registry.revisions.find(r => r.candidate.asset.assetId === asset.assetId && r.candidate.asset.revision === asset.revision)!;
  const wire = { protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' }, decisionId: id, kind,
    outcome: kind === 'promotion' ? 'promoted' : 'active', inputs: revision.candidate.contentRefs,
    contractRef: null, taskEvidenceRef: null, evaluationReceiptRef: kind === 'promotion' ? evaluationRef : null,
    activationReceiptRef: activationRef, evaluatorVersion: 'l4-promotion/1', evaluationProtocolRef: revision.compatibility.protocolRef,
    reasons: [], evidenceRefs: [], feedbackVisibility: 'internal', issuer: ports.registry.issuers[kind], capabilityJudgement: null };
  const checked = decode('DecisionRecord', wire); if (!checked.ok) return checked;
  return publish(ports, checked.value, 'DecisionRecord', wire.issuer);
}
/** Reuse the sole registry transition/evaluation judge; this module only supplies its decision. */
export function decision(ports: PromotionPorts, registry: RegistrySnapshot, kind: 'promotion' | 'activation',
  id: string, asset: AssetRef, evaluationRef: ArtifactRef, activationRef: ArtifactRef | null,
  ruleId: string, context: QualificationContext): StoreResult<{ registry: RegistrySnapshot; ref: ArtifactRef }> {
  const saved = writeDecision(ports, registry, kind, id, asset, evaluationRef, activationRef); if (!saved.ok) return saved;
  const planned = recordDecision(registry, { asset, decisionRef: saved.value, context, at: context.at },
    { ...ports.registry, authorize(action, ref, _context, authorizationRef) {
      // Promotion was authorized in the same synchronous plan. Activation crossed a host await,
      // so its current permission root must be checked again at the registry commit point.
      if (action === 'activate') {
        const allowed = authorize(ports, ruleId, action, ref, context, false); if (!allowed.ok) return allowed;
        if (authorizationRef !== allowed.value.authorizationRef) {
          return storeFail('EFK_AUTHORITY_DENIED', 'activation authorization differs from preauthorization');
        }
      }
      return ports.registry.authorize(action, ref, context, authorizationRef, context.at);
    } });
  return planned.ok ? { ok: true, value: { registry: planned.value, ref: saved.value } } : planned;
}
