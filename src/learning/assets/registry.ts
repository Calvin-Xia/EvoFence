import { decode } from '../../protocol/index.js';
import { attributeProducer, verifyForConsumer } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { validateCompatibility, verifyCompatibilityEvidence } from './compatibility.js';
import { findRevision, immutable, revisionDigest } from './identity.js';
import { invalidation } from './qualification.js';
import type { AssetCategory, AssetRevision, RegistryEvent, RegistryPorts, RegistrySnapshot } from './types.js';

const kinds: Readonly<Record<AssetCategory, AssetRevision['candidate']['kind']>> = {
  'graph-template': 'template', strategy: 'memory', experience: 'memory', skill: 'skill',
  tool: 'tool-policy', 'code-patch': 'skill',
};
export function emptyRegistry(): RegistrySnapshot { return immutable({ revisions: [], history: [] }); }
export function appendEvent(snapshot: RegistrySnapshot, event: Omit<RegistryEvent, 'sequence'>): RegistrySnapshot {
  return immutable({ ...snapshot, history: [...snapshot.history, { ...event, sequence: snapshot.history.length }] });
}
/** Pure staging plan. The caller commits it through the command journal; this is not a durable store. */
export function stageRevision(snapshot: RegistrySnapshot, input: AssetRevision, ports: RegistryPorts): StoreResult<RegistrySnapshot> {
  if (typeof input !== 'object' || input === null || Object.keys(input).length !== 4 ||
    !['candidate', 'category', 'compatibility', 'createdAt'].every(k => Object.hasOwn(input, k))) {
    return storeFail('EFK_SCHEMA_INVALID', 'invalid immutable revision metadata');
  }
  const candidate = decode('CapabilityAsset', input.candidate); if (!candidate.ok) return candidate;
  const created = decode('Instant', input.createdAt); if (!created.ok) return created;
  const compat = validateCompatibility(input.compatibility); if (!compat.ok) return compat;
  const c = input.candidate;
  if (kinds[input.category] !== c.kind || c.qualification !== 'staged' || c.asset.qualificationRef !== null ||
    c.evaluationRef !== null || c.revocationRef !== null) {
    return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'new immutable revisions must enter staged with no borrowed qualification');
  }
  if (revisionDigest(input, ports.digest) !== c.asset.digest) {
    return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', 'asset digest differs from its immutable revision material');
  }
  const previous = snapshot.revisions.find(r => r.candidate.asset.assetId === c.asset.assetId && r.candidate.asset.revision === c.asset.revision);
  if (previous !== undefined) return canonical(previous) === canonical(input) ? storeOk(snapshot) :
    storeFail('EFK_IDEMPOTENCY_COLLISION', 'asset revision already exists with different immutable content');
  const revisions = snapshot.revisions.filter(r => r.candidate.asset.assetId === c.asset.assetId);
  if (c.asset.revision !== revisions.length + 1) return storeFail('EFK_REVISION_CONFLICT', 'asset revisions must append without replacing or skipping history');
  for (const dependency of c.dependencies) {
    const registered = findRevision(snapshot, dependency);
    if (registered === undefined) return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'dependency must pin an existing immutable revision');
    const invalid = invalidation(snapshot, registered, input.createdAt);
    if (invalid.length > 0) return storeFail(invalid[0], 'asset dependency is revoked or expired');
  }
  if (c.expiresAt !== null && input.createdAt >= c.expiresAt) return storeFail('EFK_ASSET_EXPIRED', 'candidate qualification has already expired');
  for (const ref of [...c.contentRefs, ...c.sourceTraces]) {
    const producer = attributeProducer(ref); if (!producer.ok) return producer;
  }
  const material = verifyForConsumer({ role: 'asset', contentRefs: c.contentRefs, sourceTraces: c.sourceTraces,
    revokedDependencies: [], at: input.createdAt }, ports.artifacts);
  if (!material.ok) return material;
  const evidence = verifyCompatibilityEvidence(input, ports); if (!evidence.ok) return evidence;
  const next = { ...snapshot, revisions: [...snapshot.revisions, input] };
  return storeOk(appendEvent(next, { asset: c.asset, at: input.createdAt, state: 'staged', evidenceRef: null, context: null, expiresAt: null }));
}
