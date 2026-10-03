import { decode } from '../../protocol/index.js';
import { attributeProducer, readArtifact } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { scopeViolations } from '../../kernel/policy/authority.js';
import type { AssetRevision, Compatibility, QualificationContext, RegistryPorts } from './types.js';

const shape = (x: unknown, keys: readonly string[]): boolean => typeof x === 'object' && x !== null &&
  !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const nonempty = (x: unknown): x is readonly unknown[] => Array.isArray(x) && x.length > 0;

/** Boundary validation of local metadata; frozen DTOs use their existing codec. */
export function validateCompatibility(c: Compatibility): StoreResult<true> {
  const invalid = () => storeFail('EFK_SCHEMA_INVALID', 'asset compatibility must pin host/model/repository/task/protocol');
  if (!shape(c, ['hosts', 'models', 'repositories', 'taskIds', 'protocolRef']) ||
    !nonempty(c.hosts) || !nonempty(c.models) || !nonempty(c.repositories) || !nonempty(c.taskIds)) return invalid();
  for (const host of c.hosts) {
    if (!shape(host, ['hostId', 'version', 'manifestRef']) || typeof host.version !== 'string' || host.version.length === 0) return invalid();
    for (const [name, value] of [['Id', host.hostId], ['ArtifactRef', host.manifestRef]] as const) {
      const result = decode(name, value); if (!result.ok) return result;
    }
  }
  for (const model of c.models) {
    const result = decode('ModelRequirement', model); if (!result.ok) return result;
    if (model.providerModel === null || model.payloadRef === null) return invalid();
  }
  for (const repo of c.repositories) {
    if (!shape(repo, ['repoId', 'baseDigest'])) return invalid();
    for (const [name, value] of [['Id', repo.repoId], ['Digest', repo.baseDigest]] as const) {
      const result = decode(name, value); if (!result.ok) return result;
    }
  }
  for (const task of c.taskIds) { const result = decode('Id', task); if (!result.ok) return result; }
  const protocol = decode('ArtifactRef', c.protocolRef);
  return protocol.ok ? storeOk(true) : protocol;
}
export function validateContext(c: QualificationContext): StoreResult<true> {
  if (!shape(c, ['hostId', 'hostVersion', 'hostManifestRef', 'hostSessionId', 'model', 'repoId', 'baseDigest', 'taskId', 'scope', 'at']) ||
    typeof c.hostVersion !== 'string' || c.hostVersion.length === 0) return storeFail('EFK_SCHEMA_INVALID', 'invalid asset qualification context');
  for (const [name, value] of [
    ['Id', c.hostId], ['Id', c.hostSessionId], ['ArtifactRef', c.hostManifestRef], ['ModelRequirement', c.model],
    ['Id', c.repoId], ['Digest', c.baseDigest], ['Id', c.taskId], ['Scope', c.scope], ['Instant', c.at],
  ] as const) { const result = decode(name, value); if (!result.ok) return result; }
  return storeOk(true);
}
export function compatible(revision: AssetRevision, c: QualificationContext): boolean {
  const allowed = revision.compatibility;
  return allowed.hosts.some(h => h.hostId === c.hostId && h.version === c.hostVersion && canonical(h.manifestRef) === canonical(c.hostManifestRef)) &&
    allowed.models.some(m => canonical(m) === canonical(c.model)) &&
    allowed.repositories.some(r => r.repoId === c.repoId && r.baseDigest === c.baseDigest) &&
    allowed.taskIds.includes(c.taskId) && scopeViolations(c.scope, revision.candidate.asset.scope).length === 0;
}
export function verifyCompatibilityEvidence(revision: AssetRevision, ports: RegistryPorts): StoreResult<true> {
  const c = revision.compatibility;
  const refs = [...c.hosts.map(h => h.manifestRef), ...c.models.map(m => m.payloadRef!), c.protocolRef];
  if (revision.candidate.asset.scope.workspaceRef !== null) refs.push(revision.candidate.asset.scope.workspaceRef);
  for (const ref of refs) {
    const producer = attributeProducer(ref); if (!producer.ok) return producer;
    const bytes = readArtifact(ref, 'asset-staging', revision.createdAt, ports.artifacts); if (!bytes.ok) return bytes;
  }
  return storeOk(true);
}
