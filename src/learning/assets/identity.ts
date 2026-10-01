import { canonical } from '../../kernel/store/index.js';
import type { DigestPort } from '../../kernel/store/index.js';
import type { ArtifactRef } from '../../kernel/artifacts/index.js';
import type { AssetRef, AssetRevision, RegistrySnapshot } from './types.js';

/** Qualification references are observations, not part of immutable content identity. */
export function sameRevision(a: AssetRef, b: AssetRef): boolean {
  return a.assetId === b.assetId && a.revision === b.revision && a.digest === b.digest &&
    canonical(a.protocol) === canonical(b.protocol) && canonical(a.scope) === canonical(b.scope);
}
export function findRevision(snapshot: RegistrySnapshot, ref: AssetRef): AssetRevision | undefined {
  return snapshot.revisions.find(r => sameRevision(r.candidate.asset, ref));
}
export function earliestExpiry(refs: readonly ArtifactRef[]): number | null {
  const times = refs.flatMap(ref => ref.expiresAt === null ? [] : [ref.expiresAt]);
  return times.length === 0 ? null : Math.min(...times);
}
/** Digest covers all immutable content, provenance, compatibility, category and injected creation time. */
export function revisionDigest(revision: AssetRevision, digest: DigestPort): string {
  const { asset, qualification, evaluationRef, revocationRef, ...content } = revision.candidate;
  const { digest: ignoredDigest, qualificationRef, ...identity } = asset;
  return digest.digest(canonical({ ...revision, candidate: { ...content, asset: identity } }));
}
/** Clone before freezing, so caller-owned inputs are never frozen or retained by reference. */
export function immutable<T>(value: T): T {
  const copied = JSON.parse(canonical(value)) as T;
  function freeze(item: unknown): void {
    if (item !== null && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  }
  freeze(copied);
  return copied;
}
