/** Pure base/scope/conflict/writer rules. Actual paths and locks belong to the adapter. */
import { storeFail, storeOk } from '../../kernel/store/contracts.js';
import { canonical } from '../../kernel/store/identity.js';
import { grantIsLive } from '../host-port/grant.js';
import type { AuthorizedEffect, Scope, StageRequest, StoreResult, WorkspaceBase, WorkspaceChange,
  WorkspaceConflict, WorkspaceFiles, WorkspaceResources } from './types.js';

export function sameBase(a: WorkspaceBase, b: WorkspaceBase): boolean {
  return a.workspaceId === b.workspaceId && a.revision === b.revision && a.digest === b.digest;
}
/** Resources are exact relative files, or explicit directory resources ending in '/'. */
export function validPath(value: string): boolean {
  return value.length > 0 && !/[\\:\x00-\x1f]/.test(value) &&
    value.split('/').every(p => p !== '' && p !== '.' && p !== '..' &&
      !p.endsWith('.') && !p.endsWith(' ') && p.toLowerCase() !== '.git' &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
export function pathAllowed(path: string, resources: readonly string[]): boolean {
  return validPath(path) && resources.some(r => r.endsWith('/')
    ? validPath(r.slice(0, -1)) && path.startsWith(r) : r === path);
}
export function checkScope(scope: Scope, path: string, kind: 'read' | 'write', resolver: WorkspaceResources): StoreResult<void> {
  const ids = kind === 'read' ? scope.readResources : scope.writeResources;
  const paths = ids.flatMap(id => Object.hasOwn(resolver, id) ? resolver[id] : []);
  return pathAllowed(path, paths)
    ? storeOk(undefined) : storeFail('EFK_AUTHORITY_DENIED', `${kind} outside workspace scope: ${path}`);
}
export function checkStage(request: StageRequest, current: WorkspaceBase, now: number): StoreResult<void> {
  if (!grantIsLive(request.grant, now)) return storeFail(request.grant.revoked ? 'EFK_GRANT_REVOKED' : 'EFK_GRANT_EXPIRED', 'stage grant is not live');
  const locator = request.grant.scope.workspaceRef;
  if (locator === null || locator.id !== current.workspaceId || locator.digest !== request.base.digest || request.grant.scope.trustDomain !== 'same-user') {
    return storeFail('EFK_AUTHORITY_DENIED', 'workspace locator must match; a worktree is not an OS sandbox');
  }
  if (!sameBase(request.base, current) || request.binding.baseDigest !== request.base.digest) {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'stage base revision/digest does not match the current workspace or attempt');
  }
  return storeOk(undefined);
}
export function writerAdmission(authorized: AuthorizedEffect, workspaceId: string, resourceId: string,
  now: number): StoreResult<void> {
  const { effect, grant } = authorized;
  if (!grantIsLive(grant, now)) return storeFail(grant.revoked ? 'EFK_GRANT_REVOKED' : 'EFK_GRANT_EXPIRED', 'integration writer grant is not live');
  if (effect.authorityRef !== grant.grantId || grant.scope.workspaceRef?.id !== workspaceId ||
    grant.scope.workspaceRef.digest !== effect.binding.baseDigest || grant.scope.trustDomain !== 'same-user') {
    return storeFail('EFK_AUTHORITY_DENIED', 'integration writer authority/locator mismatch');
  }
  const lease = effect.leases.find(l => l.resourceId === resourceId);
  if (effect.deadline <= now || lease === undefined || lease.epoch !== effect.binding.epoch || lease.expiresAt <= now) {
    return storeFail('EFK_LEASE_STALE', 'integration writer needs the current workspace lease and deadline');
  }
  return storeOk(undefined);
}
export function changesBetween(before: WorkspaceFiles, after: WorkspaceFiles): readonly WorkspaceChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter(p => canonical(fileAt(before, p)) !== canonical(fileAt(after, p)))
    .map(path => ({ path, file: fileAt(after, path) }));
}
export function fileAt(files: WorkspaceFiles, path: string) { return Object.hasOwn(files, path) ? files[path] : null; }
export function patchConflict(proposed: WorkspaceBase, current: WorkspaceBase, changes: readonly WorkspaceChange[],
  oldFiles: WorkspaceFiles, currentFiles: WorkspaceFiles): WorkspaceConflict | null {
  if (sameBase(proposed, current)) return null;
  return { action: 'rebase/replan', files: changes.filter(c => canonical(fileAt(oldFiles, c.path)) !== canonical(fileAt(currentFiles, c.path))).map(c => c.path),
    proposedBase: proposed, currentBase: current };
}
export function applyChanges(before: WorkspaceFiles, changes: readonly WorkspaceChange[]): WorkspaceFiles {
  const next = Object.assign(Object.create(null), before) as Record<string, NonNullable<WorkspaceChange['file']>>;
  for (const change of changes) {
    if (change.file === null) delete next[change.path];
    else next[change.path] = change.file;
  }
  return { ...next };
}
