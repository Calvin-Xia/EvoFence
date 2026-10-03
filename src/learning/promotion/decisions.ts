import { decode } from '../../protocol/index.js';
import { recordDecision } from '../assets/index.js';
import type { ArtifactRef } from '../../kernel/artifacts/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { AssetRef, QualificationContext, RegistrySnapshot } from '../assets/index.js';
import { authorize } from './rules.js';
import { prepareArtifact } from './journal.js';
import type { PromotionPorts } from './types.js';

function prepareDecision(ports: PromotionPorts, registry: RegistrySnapshot, kind: 'promotion' | 'activation',
  id: string, asset: AssetRef, evaluationRef: ArtifactRef, activationRef: ArtifactRef | null,
): StoreResult<{ ref: ArtifactRef; bytes: string }> {
  const revision = registry.revisions.find(r => r.candidate.asset.assetId === asset.assetId && r.candidate.asset.revision === asset.revision)!;
  const wire = { protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' }, decisionId: id, kind,
    outcome: kind === 'promotion' ? 'promoted' : 'active', inputs: revision.candidate.contentRefs,
    contractRef: null, taskEvidenceRef: null, evaluationReceiptRef: kind === 'promotion' ? evaluationRef : null,
    activationReceiptRef: activationRef, evaluatorVersion: 'l4-promotion/1', evaluationProtocolRef: revision.compatibility.protocolRef,
    reasons: [], evidenceRefs: [], feedbackVisibility: 'internal', issuer: ports.registry.issuers[kind], capabilityJudgement: null };
  const checked = decode('DecisionRecord', wire); if (!checked.ok) return checked;
  return storeOk(prepareArtifact(ports, checked.value, 'DecisionRecord', wire.issuer));
}
/** A restore decision records actual application, without issuing a second asset qualification. */
export function writeDecision(ports: PromotionPorts, registry: RegistrySnapshot, kind: 'promotion' | 'activation',
  id: string, asset: AssetRef, evaluationRef: ArtifactRef, activationRef: ArtifactRef | null,
): StoreResult<ArtifactRef> {
  const prepared = prepareDecision(ports, registry, kind, id, asset, evaluationRef, activationRef);
  if (!prepared.ok) return prepared;
  const { ref, bytes } = prepared.value, saved = ports.registry.artifacts.put(ref, bytes);
  return saved.ok ? storeOk(ref) : saved;
}
/** Reuse the sole registry transition/evaluation judge; this module only supplies its decision. */
export function decision(ports: PromotionPorts, registry: RegistrySnapshot, kind: 'promotion' | 'activation',
  id: string, asset: AssetRef, evaluationRef: ArtifactRef, activationRef: ArtifactRef | null,
  ruleId: string, context: QualificationContext): StoreResult<{ registry: RegistrySnapshot; ref: ArtifactRef }> {
  const prepared = prepareDecision(ports, registry, kind, id, asset, evaluationRef, activationRef); if (!prepared.ok) return prepared;
  const { ref, bytes } = prepared.value;
  // The sole registry judge can read this draft, but a refused draft never reaches ArtifactStore.put.
  const artifacts = { put: ports.registry.artifacts.put.bind(ports.registry.artifacts),
    ids: ports.registry.artifacts.ids.bind(ports.registry.artifacts),
    get(request: ArtifactRef) {
      return canonical(request) === canonical(ref) ? storeOk(bytes) : ports.registry.artifacts.get(request);
    } };
  const planned = recordDecision(registry, { asset, decisionRef: ref, context, at: context.at },
    { ...ports.registry, artifacts, authorize(action, ref, _context, authorizationRef) {
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
  if (!planned.ok) return planned;
  const saved = ports.registry.artifacts.put(ref, bytes);
  return saved.ok ? storeOk({ registry: planned.value, ref }) : saved;
}
