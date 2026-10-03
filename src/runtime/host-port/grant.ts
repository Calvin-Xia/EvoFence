/**
 * Scoped delegation: a child grant is the intersection with its parent, and nothing else.
 *
 * `SCHEMAS.md` S05 / `OWNERSHIP.md` A06 are the rules: `Grant = 权限根 ∩ 父grant ∩ task ∩ node`;
 * the scope must be a subset, the remaining depth must strictly decrease, and a revoked or
 * expired grant is unusable. `adr_0001` (still **proposed**) promises in-harness lifecycle and
 * subgraph delegation; this module implements the *data rule* only. It does **not** mint a
 * permission root — that is `PolicyPort`'s role (`OWNERSHIP.md` §3), and a `HostPort` that
 * created its own root would be exactly the authority escalation A06 forbids.
 */
import { fail } from '../../protocol/index.js';
import { err, ok, type BudgetPolicy, type Clock, type DelegationGrant, type HostResult, type Scope } from './types.js';

/** The shrink request. Every field must be ≤ its parent's; equality is allowed, growth is not. */
export interface DelegationRequest {
  readonly grantId: string;
  readonly scope: Scope;
  readonly budget: BudgetPolicy;
  readonly expiresAt: DelegationGrant['expiresAt'];
  readonly remainingDepth: number;
  readonly maxConcurrency: number;
}

const DENIED = (message: string, refs: readonly string[]) => fail('EFK_AUTHORITY_DENIED', message, refs);

/** True when every member of `child` is in `parent`; order is irrelevant. */
function isSubset(child: readonly string[], parent: readonly string[]): boolean {
  return child.every((item) => parent.includes(item));
}

/** A workspace locator may not be invented: `null` parent admits only `null` child. */
function workspaceWithin(child: ArtifactOrNull, parent: ArtifactOrNull): boolean {
  if (parent === null) return child === null;
  return child !== null && child.id === parent.id && child.digest === parent.digest;
}
type ArtifactOrNull = Scope['workspaceRef'];

/** Scope ⊆ parent scope. `trustDomain` must match: isolation may not appear to strengthen. */
export function scopeWithin(child: Scope, parent: Scope): boolean {
  return (
    workspaceWithin(child.workspaceRef, parent.workspaceRef) &&
    isSubset(child.readResources, parent.readResources) &&
    isSubset(child.writeResources, parent.writeResources) &&
    isSubset(child.artifactScopes, parent.artifactScopes) &&
    child.trustDomain === parent.trustDomain
  );
}

/** `null` means "no ceiling"; a ceilinged parent cannot hand out an uncapped child. */
function usdWithin(parent: BudgetPolicy['maxUsdMicros'], child: BudgetPolicy['maxUsdMicros']): boolean {
  if (parent === null) return true;
  return child !== null && child <= parent;
}

/** The shared ledger rule: same pool, same category, no ceiling above the parent's. */
export function budgetWithin(child: BudgetPolicy, parent: BudgetPolicy): boolean {
  return (
    child.poolId === parent.poolId &&
    child.category === parent.category &&
    child.maxRequests <= parent.maxRequests &&
    child.maxInputTokens <= parent.maxInputTokens &&
    child.maxOutputTokens <= parent.maxOutputTokens &&
    usdWithin(parent.maxUsdMicros, child.maxUsdMicros) &&
    child.maxWallMs <= parent.maxWallMs &&
    child.maxConcurrentRequests <= parent.maxConcurrentRequests
  );
}

/** A grant is live only while it is unrevoked and unexpired. Callers pass the clock. */
export function grantIsLive(grant: Readonly<{ revoked: boolean; expiresAt: DelegationGrant['expiresAt'] }>, now: DelegationGrant['expiresAt']): boolean {
  return !grant.revoked && now < grant.expiresAt;
}

/**
 * Narrow `parent` into a child grant. Every failure is a typed refusal naming the exact bound
 * that was broken; the child is never silently clamped to the parent's limits.
 */
export function delegate(parent: DelegationGrant, request: DelegationRequest, now: DelegationGrant['expiresAt']): HostResult<DelegationGrant> {
  const refs = [parent.grantId, request.grantId];
  if (parent.revoked) return err(fail('EFK_GRANT_REVOKED', `grant ${parent.grantId} is revoked`, refs));
  if (now >= parent.expiresAt) return err(fail('EFK_GRANT_EXPIRED', `grant ${parent.grantId} expired at ${parent.expiresAt}`, refs));
  if (parent.remainingDepth < 1) return err(DENIED('grant has no remaining delegation depth', refs));
  if (request.remainingDepth >= parent.remainingDepth) {
    return err(DENIED(`child depth ${request.remainingDepth} must be below parent depth ${parent.remainingDepth}`, refs));
  }
  if (request.expiresAt > parent.expiresAt) {
    return err(DENIED(`child expiry ${request.expiresAt} is beyond parent expiry ${parent.expiresAt}`, refs));
  }
  if (request.maxConcurrency < 1 || request.maxConcurrency > parent.maxConcurrency) {
    return err(DENIED(`child concurrency ${request.maxConcurrency} is outside 1..${parent.maxConcurrency}`, refs));
  }
  if (!scopeWithin(request.scope, parent.scope)) return err(DENIED('child scope is not a subset of the parent scope', refs));
  if (!budgetWithin(request.budget, parent.budget)) return err(DENIED('child budget is not a subset of the parent budget (pool/category/ceilings)', refs));
  if (request.budget.category === 'controlled-experiment' && request.budget.authorizationRef === null) {
    return err(fail('EFK_BUDGET_NOT_AUTHORIZED', 'controlled-experiment budget needs an authorizationRef', refs));
  }
  return ok({
    grantId: request.grantId,
    rootAuthorityRef: parent.rootAuthorityRef,
    scope: request.scope,
    budget: request.budget,
    issuedEpoch: parent.issuedEpoch,
    expiresAt: request.expiresAt,
    remainingDepth: request.remainingDepth,
    maxConcurrency: request.maxConcurrency,
    revocationEpoch: parent.revocationEpoch,
    revoked: false,
  });
}

/** Revocation is monotonic: a lower epoch cannot un-revoke. */
export function revokeGrant(grant: DelegationGrant, revocationEpoch: number): DelegationGrant {
  if (grant.revoked && revocationEpoch <= grant.revocationEpoch) return grant;
  return { ...grant, revoked: true, revocationEpoch: Math.max(revocationEpoch, grant.revocationEpoch + 1) };
}

/** True when `scope` is inside the grant's range and the grant is live at `now`. */
export function grantCovers(grant: DelegationGrant, scope: Scope, now: DelegationGrant['expiresAt']): boolean {
  return grantIsLive(grant, now) && scopeWithin(scope, grant.scope);
}

/** Convenience for callers that hold a `Clock` rather than a raw instant. */
export function liveAt(grant: DelegationGrant, clock: Clock): boolean {
  return grantIsLive(grant, clock.now());
}
