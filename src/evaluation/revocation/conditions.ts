import { scopeViolations } from '../../kernel/policy/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { qualification, sameRevision } from '../../learning/assets/index.js';
import type { AssetRef, QualificationContext, RegistrySnapshot } from '../../learning/assets/index.js';
import type { QualityPolicy, QualitySignal } from './types.js';

/** Deterministic operational invalidation; does not replace evolution's statistical judgement. */
export function invalidity(registry: RegistrySnapshot, asset: AssetRef, context: QualificationContext,
  policy: QualityPolicy, signals: readonly QualitySignal[]): StoreResult<readonly string[]> {
  if (!Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs < 0 || typeof policy.requireQuality !== 'boolean' ||
    Object.values(policy.minimums).some(n => typeof n !== 'number' || !Number.isFinite(n)) ||
    (policy.requireQuality && Object.keys(policy.minimums).length === 0)) {
    return storeFail('EFK_SCHEMA_INVALID', 'monitoring needs explicit finite thresholds and signal lifetime');
  }
  const q = qualification(registry, asset, context); if (!q.ok) return q;
  const revision = registry.revisions.find(r => sameRevision(r.candidate.asset, asset))!;
  const c = revision.compatibility, reasons: string[] = [];
  if (!c.hosts.some(h => h.hostId === context.hostId && h.version === context.hostVersion &&
    canonical(h.manifestRef) === canonical(context.hostManifestRef))) reasons.push('host-changed');
  if (!c.models.some(m => canonical(m) === canonical(context.model))) reasons.push('model-changed');
  if (!c.repositories.some(r => r.repoId === context.repoId && r.baseDigest === context.baseDigest) ||
    !c.taskIds.includes(context.taskId) || scopeViolations(context.scope, asset.scope).length > 0) reasons.push('scope-changed');
  if (q.value.reasons.includes('EFK_ASSET_EXPIRED')) reasons.push('qualification-expired');
  if (q.value.reasons.includes('EFK_ASSET_REVOKED')) reasons.push('dependency-or-asset-revoked');
  for (const [metric, minimum] of Object.entries(policy.minimums)) {
    const measured = signals.filter(s => s.metric === metric).sort((a, b) => b.measuredAt - a.measuredAt);
    if (measured.length === 0) { if (policy.requireQuality) reasons.push(`quality-missing:${metric}`); continue; }
    const latest = measured.filter(s => s.measuredAt === measured[0].measuredAt);
    if (context.at - measured[0].measuredAt >= policy.maxAgeMs) reasons.push(`quality-expired:${metric}`);
    if (latest.some(s => s.value < minimum)) reasons.push(`quality-below:${metric}`);
  }
  return storeOk([...new Set(reasons)].sort());
}

/** Registry staging pins earlier revisions, so one forward pass covers the dependency DAG. */
export function dependentClosure(registry: RegistrySnapshot, root: AssetRef): readonly AssetRef[] {
  const affected: AssetRef[] = [root];
  for (const r of registry.revisions) {
    if (!affected.some(a => sameRevision(a, r.candidate.asset)) &&
      r.candidate.dependencies.some(d => affected.some(a => sameRevision(a, d)))) affected.push(r.candidate.asset);
  }
  return affected;
}
