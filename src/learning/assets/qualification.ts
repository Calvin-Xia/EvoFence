import { decode } from '../../protocol/index.js';
import type { ErrorCode } from '../../protocol/index.js';
import { storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { canonical } from '../../kernel/store/index.js';
import { compatible, validateContext } from './compatibility.js';
import { earliestExpiry, findRevision, sameRevision } from './identity.js';
import type { AssetRef, AssetRevision, AssetState, Qualification, QualificationContext, RegistrySnapshot } from './types.js';

export function globalState(snapshot: RegistrySnapshot, ref: AssetRef): Exclude<AssetState, 'active'> {
  return snapshot.history.filter(e => sameRevision(e.asset, ref) && e.state !== 'active').at(-1)!.state as Exclude<AssetState, 'active'>;
}
/** Dependencies are pinned to already registered immutable revisions, so the graph is acyclic. */
export function invalidation(snapshot: RegistrySnapshot, revision: AssetRevision, at: number): ErrorCode[] {
  const asset = revision.candidate;
  const reasons: ErrorCode[] = [];
  if (globalState(snapshot, asset.asset) === 'revoked') reasons.push('EFK_ASSET_REVOKED');
  if (asset.expiresAt !== null && at >= asset.expiresAt) reasons.push('EFK_ASSET_EXPIRED');
  const c = revision.compatibility;
  const materialExpiry = earliestExpiry([...asset.contentRefs, ...asset.sourceTraces, c.protocolRef,
    ...c.hosts.map(h => h.manifestRef), ...c.models.map(m => m.payloadRef!),
    ...(asset.asset.scope.workspaceRef === null ? [] : [asset.asset.scope.workspaceRef])]);
  if ((materialExpiry !== null && at >= materialExpiry) || snapshot.history.some(e =>
    sameRevision(e.asset, asset.asset) && e.state !== 'active' && e.expiresAt !== null && at >= e.expiresAt)) {
    reasons.push('EFK_ASSET_EXPIRED');
  }
  for (const dep of asset.dependencies) {
    const upstream = findRevision(snapshot, dep)!;
    reasons.push(...invalidation(snapshot, upstream, at));
  }
  return [...new Set(reasons)].sort();
}
function query(snapshot: RegistrySnapshot, revision: AssetRevision, c: QualificationContext): Qualification {
  const ref = revision.candidate.asset;
  const state = globalState(snapshot, ref);
  const reasons = invalidation(snapshot, revision, c.at);
  if (!compatible(revision, c)) reasons.push('EFK_ASSET_SCOPE_DENIED');
  const deps = revision.candidate.dependencies.map(dep => query(snapshot, findRevision(snapshot, dep)!, c));
  for (const dep of deps) reasons.push(...dep.reasons);
  const eligible = (state === 'promoted') && reasons.length === 0 && deps.every(d => d.eligible);
  const active = eligible && deps.every(d => d.usable) && snapshot.history.some(e =>
    sameRevision(e.asset, ref) && e.state === 'active' && e.at <= c.at && (e.expiresAt === null || c.at < e.expiresAt) &&
    canonical({ ...e.context, at: 0 }) === canonical({ ...c, at: 0 }));
  const unknown = state === 'staged' || state === 'validated' || deps.some(d => d.validity === 'unknown');
  if (unknown) reasons.push('EFK_ASSET_QUALIFICATION_INVALID');
  return { assetId: ref.assetId, revision: ref.revision, digest: ref.digest, state: active ? 'active' : state,
    validity: reasons.some(r => r !== 'EFK_ASSET_QUALIFICATION_INVALID') ? 'invalid' : unknown ? 'unknown' : 'valid',
    eligible, usable: active, reasons: [...new Set(reasons)].sort() };
}
/** No clock/store callbacks, mutation, latest lookup or private evidence references in this read view. */
export function qualification(snapshot: RegistrySnapshot, ref: AssetRef, context: QualificationContext): StoreResult<Qualification> {
  const decoded = decode('AssetRef', ref); if (!decoded.ok) return decoded;
  const checked = validateContext(context); if (!checked.ok) return checked;
  const revision = findRevision(snapshot, ref);
  if (revision === undefined) return storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'asset revision is not registered');
  return storeOk(query(snapshot, revision, context));
}
