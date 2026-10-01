import { decode, DEFS } from '../../protocol/index.js';
import { readArtifact } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import type { ArtifactRef, ActorRef, EvolutionPorts } from './types.js';

export function bytes(ref: ArtifactRef, at: number, ports: EvolutionPorts): StoreResult<string> {
  const read = readArtifact(ref, 'evaluator', at, ports.artifacts); if (!read.ok) return read;
  if (ports.digest.digest(read.value) !== ref.digest) return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', 'evaluation bytes differ from the pinned reference');
  return read;
}
export function json(ref: ArtifactRef, at: number, ports: EvolutionPorts): StoreResult<unknown> {
  const read = bytes(ref, at, ports); if (!read.ok) return read;
  try { return storeOk(JSON.parse(read.value)); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return storeFail('EFK_SCHEMA_INVALID', 'evaluation artifact is not JSON');
  }
}
export function publish(value: unknown, schema: string, issuer: ActorRef, partition: ArtifactRef['partition'],
  ports: EvolutionPorts, id?: string, expiresAt: number | null = null): StoreResult<ArtifactRef> {
  const content = canonical(value), digest = ports.digest.digest(content);
  const ref: ArtifactRef = { protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' },
    id: id === undefined ? `${schema}:${digest.slice(7, 39)}` : id, digest, producer: issuer, binding: null,
    schema: { name: schema, version: '1.1.0', digest: ports.digest.digest(canonical(Object.hasOwn(DEFS, schema)
      ? DEFS[schema as keyof typeof DEFS] : { name: schema, version: '1.1.0' })) },
    location: `evolution:${digest.slice(7)}`, visibility: 'private', expiresAt, partition };
  const valid = decode('ArtifactRef', ref); if (!valid.ok) return valid;
  const put = ports.artifacts.put(ref, content); if (!put.ok) return put;
  const proof = ports.authority.attest(ref); if (!proof.ok) return proof;
  return storeOk(ref);
}
export const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
export const sameSet = (a: readonly unknown[], b: readonly unknown[]): boolean => same(a.map(canonical).sort(), b.map(canonical).sort());
export function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && sameSet(Object.keys(value), keys);
}
export function frozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
