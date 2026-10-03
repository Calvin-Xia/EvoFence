import { createHash } from 'node:crypto';
import { DEFS, decode } from '../protocol/index.js';
import { canonical, type DigestPort } from '../kernel/store/identity.js';
import { storeOk } from '../kernel/store/contracts.js';
import { readArtifact } from '../kernel/artifacts/availability.js';
import type { ArtifactStore, StoreResult, ArtifactRef as WireArtifactRef } from '../kernel/store/contracts.js';
import type { ArtifactRef, Binding, WorkspacePatch } from '../runtime/workspace/types.js';
import type { Protocol } from '../runtime/host-port/types.js';
import { WorkspaceIOError } from './io.js';

/** Local artifact contents, carried by the existing ArtifactRef, do not extend frozen wire enums. */
export const CONTENT_SCHEMAS = {
  WorkspacePatch: { name: 'WorkspacePatch', version: 1, fields: ['base', 'binding', 'scope', 'changes'] },
  WorkspaceApplication: { name: 'WorkspaceApplication', version: 1, fields: ['effectId', 'operation', 'before', 'after', 'actualStatus', 'patchRef', 'osSandbox'] },
} as const;
export function schemaFor(name: keyof typeof CONTENT_SCHEMAS | 'Receipt', digest: DigestPort) {
  return { name, version: '1.1.0', digest: digest.digest(canonical(name === 'Receipt' ? DEFS.Receipt : CONTENT_SCHEMAS[name])) };
}
export function putArtifact(store: ArtifactStore, digest: DigestPort, protocol: Protocol, binding: Binding,
  name: keyof typeof CONTENT_SCHEMAS | 'Receipt', content: unknown, id?: string): StoreResult<ArtifactRef> {
  const bytes = canonical(content), identity = digest.digest(bytes);
  const ref: ArtifactRef = { protocol, id: id ?? `ws:${identity.slice(7, 55)}`, digest: identity,
    producer: { actorId: 'workspace-adapter', kind: 'host-adapter', identityRef: null }, binding,
    schema: schemaFor(name, digest), location: `workspace:${identity}`, visibility: 'internal', expiresAt: null, partition: 'not-evaluation' };
  const stored = store.put(ref as WireArtifactRef, bytes);
  return stored.ok ? storeOk(ref) : stored;
}
export function readBound(store: ArtifactStore, digest: DigestPort, ref: ArtifactRef, name: keyof typeof CONTENT_SCHEMAS,
  binding: Binding, now: number): StoreResult<string> {
  return readArtifact(ref, 'author', now, store, { productKind: 'node-product', schema: schemaFor(name, digest), binding });
}
export function parsePatch(bytes: string): WorkspacePatch {
  const value = JSON.parse(bytes) as WorkspacePatch;
  // Custom artifact bytes are an actual boundary; do not trust a TypeScript cast of JSON.
  if (!value || !value.base || !value.binding || !value.scope || !Array.isArray(value.changes) ||
    Object.keys(value).sort().join(',') !== 'base,binding,changes,scope' ||
    Object.keys(value.base).sort().join(',') !== 'digest,isolation,osSandbox,revision,workspaceId' ||
    value.base.osSandbox !== false || typeof value.base.revision !== 'string' || typeof value.base.digest !== 'string' ||
    typeof value.base.workspaceId !== 'string' || !['git-worktree', 'versioned-directory'].includes(value.base.isolation) ||
    value.changes.some(c => !c || typeof c.path !== 'string' || (c.file !== null &&
      (!c.file || typeof c.file.content !== 'string' || typeof c.file.executable !== 'boolean'))) ||
    new Set(value.changes.map(c => c.path.toLowerCase())).size !== value.changes.length) {
    throw new WorkspaceIOError('EFK_SCHEMA_INVALID', 'malformed workspace patch content');
  }
  for (const [name, object] of [['Binding', value.binding], ['Scope', value.scope]] as const) {
    const decoded = decode(name, object);
    if (!decoded.ok) throw new WorkspaceIOError('EFK_SCHEMA_INVALID', decoded.error.message);
  }
  return value;
}
export function applicationKey(sessionId: string, effectId: string): string {
  return createHash('sha256').update(canonical([sessionId, effectId])).digest('hex');
}
