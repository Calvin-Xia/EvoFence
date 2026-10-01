import { decode } from '../../protocol/index.js';
import type { Decoded, DefName } from '../../protocol/index.js';
import { attributeProducer, readArtifact } from '../../kernel/artifacts/index.js';
import type { ArtifactRef } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { earliestExpiry, findRevision, sameRevision } from './identity.js';
import { globalState, invalidation, qualification } from './qualification.js';
import { appendEvent } from './registry.js';
import type { ActivationReceipt, AssetRef, AssetRevision, DecisionInput, EvaluationReceipt, RegistryPorts, RegistrySnapshot } from './types.js';

/** Registry-internal evaluation reads never flow into the public qualification response. */
function object<K extends DefName>(ref: ArtifactRef, name: K, at: number, ports: RegistryPorts): StoreResult<Decoded<K>> {
  if (ref.schema.name !== name || ref.schema.version !== '1.1.0') {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'qualification evidence schema differs from its expected contract');
  }
  const producer = attributeProducer(ref); if (!producer.ok) return producer;
  const bytes = readArtifact(ref, 'evaluator', at, ports.artifacts); if (!bytes.ok) return bytes;
  let value: unknown;
  try { value = JSON.parse(bytes.value); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return storeFail('EFK_SCHEMA_INVALID', 'qualification evidence is not JSON');
  }
  const decoded = decode(name, value);
  return decoded.ok ? decoded : storeFail(decoded.error.code, 'qualification evidence does not satisfy the frozen codec');
}
const setIdentity = (values: readonly unknown[]): string => canonical(values.map(v => canonical(v)).sort());
function evaluation(revision: AssetRevision, ref: ArtifactRef, input: DecisionInput, ports: RegistryPorts): StoreResult<EvaluationReceipt> {
  const loaded = object(ref, 'EvaluationReceipt', input.at, ports); if (!loaded.ok) return loaded;
  const receipt = loaded.value as EvaluationReceipt;
  const c = revision.compatibility;
  if (!sameRevision(receipt.candidate as AssetRef, revision.candidate.asset) ||
    receipt.baseDigest !== input.context.baseDigest || c.repositories.some(r => r.baseDigest !== receipt.baseDigest) ||
    setIdentity(receipt.dependencyRefs) !== setIdentity(revision.candidate.dependencies) ||
    canonical(receipt.protocolRef) !== canonical(c.protocolRef) ||
    setIdentity(receipt.hostManifestRefs) !== setIdentity(c.hosts.map(h => h.manifestRef)) ||
    setIdentity(receipt.modelBindings) !== setIdentity(c.models) || !receipt.usageComplete ||
    receipt.dataSplitRefs.length === 0 || receipt.evidenceRefs.length === 0 || receipt.requiredJudgements.length === 0) {
    return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'evaluation does not bind the complete asset/base/dependencies/protocol/host/model/evidence');
  }
  const judgements = receipt.requiredJudgements;
  if (judgements.some(j => j.verdict !== 'positive' || j.cellStatus !== 'complete' || j.look !== 'CONFIRMATORY_LOOK' ||
    j.guardrailCost !== 'passed' || j.guardrailWall !== 'passed' || j.guardrailTruncation !== 'passed' ||
    canonical(j.protocolRef) !== canonical(c.protocolRef))) {
    return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'required evaluation or promotion guardrails are not qualified');
  }
  const refs = [receipt.protocolRef, ...receipt.dataSplitRefs, ...receipt.hostManifestRefs, ...receipt.evidenceRefs,
    ...judgements.flatMap(j => [j.analysisRef, j.protocolRef])];
  for (const evidence of refs) {
    const available = readArtifact(evidence, 'evaluator', input.at, ports.artifacts); if (!available.ok) return available;
  }
  return storeOk(receipt);
}
export function recordDecision(snapshot: RegistrySnapshot, input: DecisionInput, ports: RegistryPorts): StoreResult<RegistrySnapshot> {
  const ref = decode('AssetRef', input.asset); if (!ref.ok) return ref;
  const time = decode('Instant', input.at); if (!time.ok) return time;
  const revision = findRevision(snapshot, input.asset);
  if (revision === undefined) return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'decision targets an unregistered asset revision');
  const q = qualification(snapshot, input.asset, input.context); if (!q.ok) return q;
  if (input.context.at !== input.at) return storeFail('EFK_SCHEMA_INVALID', 'decision and context time must be identical');
  const invalid = invalidation(snapshot, revision, input.at);
  if (invalid.length > 0) return storeFail(invalid[0], 'asset or its dependency is revoked/expired');
  if (q.value.reasons.includes('EFK_ASSET_SCOPE_DENIED')) return storeFail('EFK_ASSET_SCOPE_DENIED', 'decision context exceeds asset compatibility');
  const loaded = object(input.decisionRef, 'DecisionRecord', input.at, ports); if (!loaded.ok) return loaded;
  const d = loaded.value;
  if (d.kind === 'task' || canonical(d.issuer) !== canonical(ports.issuers[d.kind]) ||
    (d.issuer as { kind: string }).kind !== (d.kind === 'candidate' ? 'evaluator' : 'kernel') ||
    canonical(input.decisionRef.producer) !== canonical(d.issuer) ||
    d.contractRef !== null || d.taskEvidenceRef !== null ||
    !d.inputs.some(r => revision.candidate.contentRefs.some(content => canonical(content) === canonical(r)))) {
    return storeFail('EFK_DECISION_AUTHORITY_DENIED', 'asset decision must come from its registered service and bind candidate material');
  }
  const state = globalState(snapshot, input.asset);
  const expected = { candidate: 'staged', promotion: 'validated', activation: 'promoted' } as const;
  const outcomes = { candidate: 'validated', promotion: 'promoted', activation: 'active' } as const;
  if (state !== expected[d.kind] || d.outcome !== outcomes[d.kind]) {
    return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'illegal asset transition; evaluation, promotion and activation are separate');
  }
  let expiresAt = input.decisionRef.expiresAt;
  if (d.kind === 'candidate' || d.kind === 'promotion') {
    const evidence = d.evaluationReceiptRef as ArtifactRef;
    if (evidence.producer.kind !== 'evaluator' || canonical(d.evaluationProtocolRef) !== canonical(revision.compatibility.protocolRef)) {
      return storeFail('EFK_DECISION_AUTHORITY_DENIED', 'evaluation receipt/protocol must be independently attributable');
    }
    const evaluated = evaluation(revision, evidence, input, ports); if (!evaluated.ok) return evaluated;
    const e = evaluated.value;
    expiresAt = earliestExpiry([input.decisionRef, evidence, e.protocolRef, ...e.dataSplitRefs, ...e.hostManifestRefs,
      ...e.evidenceRefs, ...e.requiredJudgements.flatMap(j => [j.analysisRef, j.protocolRef])]);
    if (d.kind === 'candidate') {
      if (!evaluated.value.requiredJudgements.some(j => canonical(j) === canonical(d.capabilityJudgement))) {
        return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'candidate judgement is not in its evaluation receipt');
      }
    } else {
      for (const dep of revision.candidate.dependencies) {
        const dependency = qualification(snapshot, dep, input.context); if (!dependency.ok) return dependency;
        if (!dependency.value.eligible) return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'promotion requires qualified compatible dependencies');
      }
      const validated = snapshot.history.filter(e => sameRevision(e.asset, input.asset) && e.state === 'validated').at(-1)!;
      const candidate = object(validated.evidenceRef!, 'DecisionRecord', input.at, ports); if (!candidate.ok) return candidate;
      if (canonical(candidate.value.evaluationReceiptRef) !== canonical(evidence)) {
        return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'promotion substituted the validated evaluation receipt');
      }
      const auth = ports.authorize('promote', input.asset, input.context, null, input.at); if (!auth.ok) return auth;
    }
  } else {
    if (!q.value.eligible || d.activationReceiptRef === null) return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'activation requires a promoted compatible dependency closure');
    const receiptRef = d.activationReceiptRef as ArtifactRef;
    const receipt = object(receiptRef, 'ActivationReceipt', input.at, ports); if (!receipt.ok) return receipt;
    const a = receipt.value as ActivationReceipt;
    for (const dep of revision.candidate.dependencies) {
      const dependency = qualification(snapshot, dep, input.context); if (!dependency.ok) return dependency;
      if (!dependency.value.usable) return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'activation requires dependencies active in the same context');
    }
    const promoted = snapshot.history.filter(e => sameRevision(e.asset, input.asset) && e.state === 'promoted').at(-1)!;
    const promotion = object(promoted.evidenceRef!, 'DecisionRecord', input.at, ports); if (!promotion.ok) return promotion;
    if (receiptRef.producer.kind !== 'host-adapter' || !sameRevision(a.asset as AssetRef, input.asset) ||
      a.hostSessionId !== input.context.hostSessionId || canonical(a.scope) !== canonical(input.context.scope) ||
      canonical(a.evaluationRef) !== canonical(promotion.value.evaluationReceiptRef)) {
      return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'activation receipt differs from asset/session/scope/promoted evaluation');
    }
    if (a.actualStatus !== 'active' || a.newSnapshot === null) {
      return storeFail('EFK_ACTIVATION_UNCONFIRMED', 'activation has no confirmed actual new snapshot');
    }
    expiresAt = earliestExpiry([input.decisionRef, receiptRef, a.previousSnapshot, a.newSnapshot, a.evaluationRef]);
    for (const snapshotRef of [a.previousSnapshot, a.newSnapshot]) {
      const bytes = readArtifact(snapshotRef, 'asset-staging', input.at, ports.artifacts); if (!bytes.ok) return bytes;
    }
    const prior = snapshot.history.filter(e => sameRevision(e.asset, input.asset) && e.state === 'active' &&
      e.context!.hostSessionId === input.context.hostSessionId && canonical(e.context!.scope) === canonical(input.context.scope)).at(-1);
    if (prior !== undefined) {
      const oldDecision = object(prior.evidenceRef!, 'DecisionRecord', input.at, ports); if (!oldDecision.ok) return oldDecision;
      const oldReceipt = object(oldDecision.value.activationReceiptRef as ArtifactRef, 'ActivationReceipt', input.at, ports);
      if (!oldReceipt.ok) return oldReceipt;
      if (canonical(oldReceipt.value.newSnapshot) !== canonical(a.previousSnapshot)) {
        return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'activation must continue the recorded actual snapshot chain');
      }
    }
    const auth = ports.authorize('activate', input.asset, input.context, a.authorizationRef as string, input.at); if (!auth.ok) return auth;
  }
  return storeOk(appendEvent(snapshot, { asset: revision.candidate.asset, at: input.at, state: outcomes[d.kind],
    evidenceRef: input.decisionRef, context: d.kind === 'activation' ? input.context : null, expiresAt }));
}
export interface RevocationInput {
  readonly asset: AssetRef; readonly evidenceRef: ArtifactRef; readonly authorizationRef: string; readonly at: number;
}
export function revokeRevision(snapshot: RegistrySnapshot, input: RevocationInput, ports: RegistryPorts): StoreResult<RegistrySnapshot> {
  for (const [name, value] of [['AssetRef', input.asset], ['ArtifactRef', input.evidenceRef], ['Id', input.authorizationRef], ['Instant', input.at]] as const) {
    const result = decode(name, value); if (!result.ok) return result;
  }
  const revision = findRevision(snapshot, input.asset);
  if (revision === undefined) return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'revocation targets an unregistered revision');
  if (globalState(snapshot, input.asset) === 'revoked') return storeFail('EFK_ASSET_REVOKED', 'asset is already revoked');
  if (canonical(input.evidenceRef.producer) !== canonical(ports.issuers.revocation)) {
    return storeFail('EFK_AUTHORITY_DENIED', 'revocation evidence is not from the registered authority');
  }
  const producer = attributeProducer(input.evidenceRef); if (!producer.ok) return producer;
  const evidence = readArtifact(input.evidenceRef, 'evaluator', input.at, ports.artifacts); if (!evidence.ok) return evidence;
  if (evidence.value.length === 0) return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'revocation requires retained evidence');
  const auth = ports.authorize('revoke', input.asset, null, input.authorizationRef, input.at); if (!auth.ok) return auth;
  return storeOk(appendEvent(snapshot, { asset: revision.candidate.asset, at: input.at,
    state: 'revoked', evidenceRef: input.evidenceRef, context: null, expiresAt: null }));
}
