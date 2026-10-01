/**
 * cp3 — one consumer entry for the three artifact consumers, plus the frozen codes their error paths
 * can return. `workspace`, `evaluator` and `asset` are the consumers named by `INTERFACES.md`; each
 * is a branch of one `verifyForConsumer` call, so no consumer re-implements a check the others skip.
 *
 * Admission returns **bytes**. A consumer never receives a reference, digest or summary in place of
 * content: every admitted entry has been read through the injected `ArtifactStore`.
 *
 * Error matrix (`ARTIFACT_ERROR_MATRIX`) — code → the condition that produces it:
 *
 * | code | condition |
 * |---|---|
 * | `EFK_SCHEMA_INVALID` | malformed references/content at the codec/store boundary, or either empty asset material list (frozen minItems: 1) |
 * | `EFK_ARTIFACT_DIGEST_MISMATCH` | propagated from `ArtifactStore.put` — the bytes do not hash to the reference digest (S01/S22) |
 * | `EFK_ARTIFACT_BINDING_MISMATCH` | producer is an unattributable `human`; declared schema triple ≠ expected version; node product with no binding; session/host session, graph `graphId`/`revision`/`digest`, `nodeId`, `attemptId`, `attemptOrdinal`, `epoch` or `baseDigest` differs from the consuming attempt |
 * | `EFK_ARTIFACT_UNAVAILABLE` | at or after `expiresAt`, or the store cannot resolve the locator — the read never falls back to a summary |
 * | `EFK_PRIVACY_VIOLATION` | the audience ceiling (A13: executor/`author`/`report`/`asset-staging` stop at `internal`) is exceeded, or a `held-out`/`final` partition is read by an audience that may not see restricted partitions |
 * | `EFK_EVALUATION_PROTOCOL_MISMATCH` | asset material: a `contentRef` comes from `held-out`/`final`, or a `sourceTrace` is not from `train` (S18) |
 * | `EFK_ASSET_QUALIFICATION_INVALID` | asset material: a dependency of the qualification was revoked (S17) |
 */
import { storeFail, storeOk } from '../index.js';
import type { StoreResult } from '../index.js';
import { decode } from '../../protocol/index.js';
import type { ErrorCode } from '../../protocol/index.js';
import { isRestrictedPartition } from './access.js';
import { readArtifact } from './availability.js';
import type {
  AdmittedArtifact,
  ArtifactExpectation,
  ArtifactRef,
  ArtifactStore,
  Audience,
  ConsumerAdmission,
  ConsumerRequest,
  ConsumerRole,
} from './types.js';

/** The audience each consumer reads as. `workspace` is the executing agent (A13's executor). */
const CONSUMER_AUDIENCE: Readonly<Record<ConsumerRole, Audience>> = {
  workspace: 'author',
  evaluator: 'evaluator',
  asset: 'asset-staging',
};

export const ARTIFACT_ERROR_MATRIX: Readonly<Partial<Record<ErrorCode, string>>> = {
  EFK_SCHEMA_INVALID: 'malformed reference/content at the codec/store boundary, or an empty contentRefs/sourceTraces list',
  EFK_ARTIFACT_DIGEST_MISMATCH: 'propagated from ArtifactStore.put: bytes do not hash to the reference digest',
  EFK_ARTIFACT_BINDING_MISMATCH: 'unattributable producer, schema version mismatch, missing binding, or any session/host-session/graph/node/attempt/epoch/base field differs',
  EFK_ARTIFACT_UNAVAILABLE: 'at or after expiresAt, or the store cannot resolve the locator; a summary never substitutes',
  EFK_PRIVACY_VIOLATION: 'audience ceiling exceeded, or a held-out/final partition read by an audience that may not see it',
  EFK_EVALUATION_PROTOCOL_MISMATCH: 'asset material from a non-train source trace or a held-out/final content reference',
  EFK_ASSET_QUALIFICATION_INVALID: 'asset qualification invalidated by a revoked dependency',
};

function consumerAudience(role: ConsumerRole): Audience {
  return CONSUMER_AUDIENCE[role];
}

function admitBoundRef(
  role: 'workspace' | 'evaluator',
  ref: ArtifactRef,
  expectation: ArtifactExpectation,
  at: number,
  store: ArtifactStore,
): StoreResult<AdmittedArtifact> {
  const bytes = readArtifact(ref, consumerAudience(role), at, store, expectation);
  if (!bytes.ok) return bytes;

  return storeOk({ ref, bytes: bytes.value });
}

function admitBoundRefs(
  role: 'workspace' | 'evaluator',
  request: Extract<ConsumerRequest, { role: 'workspace' | 'evaluator' }>,
  store: ArtifactStore,
): StoreResult<ConsumerAdmission> {
  const evidence: AdmittedArtifact[] = [];
  for (const ref of request.refs) {
    const admitted = admitBoundRef(role, ref, request.expectation, request.at, store);
    if (!admitted.ok) return admitted;
    evidence.push(admitted.value);
  }
  return storeOk({ role, audience: consumerAudience(role), evidence });
}

/** Asset refusals are agent-visible too; withheld material must not be named in either field. */
function protocolMismatch(what: string): ReturnType<typeof storeFail> {
  return storeFail('EFK_EVALUATION_PROTOCOL_MISMATCH', `artifact ${what}`);
}

function admitAssetMaterial(
  request: Extract<ConsumerRequest, { role: 'asset' }>,
  store: ArtifactStore,
): StoreResult<ConsumerAdmission> {
  if (request.revokedDependencies.length > 0) {
    return storeFail(
      'EFK_ASSET_QUALIFICATION_INVALID',
      'asset qualification is invalidated by revoked dependencies',
      request.revokedDependencies,
    );
  }
  if (request.contentRefs.length === 0 || request.sourceTraces.length === 0) {
    return storeFail('EFK_SCHEMA_INVALID', 'asset contentRefs and sourceTraces must each contain at least one reference');
  }
  const audience = consumerAudience('asset');
  const evidence: AdmittedArtifact[] = [];

  for (const ref of request.contentRefs) {
    const restricted = isRestrictedPartition(ref);
    if (!restricted.ok) return restricted;
    if (restricted.value) {
      return protocolMismatch(`comes from the ${ref.partition} partition, which never becomes asset content`);
    }
    const bytes = readArtifact(ref, audience, request.at, store);
    if (!bytes.ok) return bytes;
    evidence.push({ ref, bytes: bytes.value });
  }

  for (const ref of request.sourceTraces) {
    const decoded = decode('ArtifactRef', ref);
    if (!decoded.ok) return decoded;
    if (ref.partition !== 'train') {
      return protocolMismatch(`is a source trace from the ${ref.partition} partition; asset source traces are train-only`);
    }
    const bytes = readArtifact(ref, audience, request.at, store);
    if (!bytes.ok) return bytes;
    evidence.push({ ref, bytes: bytes.value });
  }

  return storeOk({ role: 'asset', audience, evidence });
}

/** The single verification entry for workspace, evaluator and asset consumers. */
export function verifyForConsumer(request: ConsumerRequest, store: ArtifactStore): StoreResult<ConsumerAdmission> {
  switch (request.role) {
    case 'workspace':
    case 'evaluator':
      return admitBoundRefs(request.role, request, store);
    case 'asset':
      return admitAssetMaterial(request, store);
  }
}
