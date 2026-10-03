/**
 * Authority: the permission root is the only source of scope, and every derived grant is an
 * intersection that can only shrink (`SCHEMAS.md` S05, `OWNERSHIP.md` A06).
 *
 * Two operations live here and nothing else:
 *   - `intersectScopes` builds the ceiling `root ∩ parent ∩ task`. A task template or a graph
 *     patch that *asks* for more therefore cannot widen anything: the extra resource simply is not
 *     in the ceiling.
 *   - `deriveAuthority` checks that a node (or a patch / delegated child) requests only what that
 *     ceiling grants, and returns the effective authority. An escalation is refused with
 *     `EFK_AUTHORITY_DENIED` instead of being silently trimmed, because a caller that asked for a
 *     resource it will not get must not proceed as if it had it.
 *
 * `trustDomain` is intersected to the *weaker* value, so `same-user` never becomes `os-sandbox`
 * and `os-sandbox` is never claimed from a same-user root. Hooks and worktrees are not an OS
 * sandbox (human review R7).
 */
import { fail } from '../../protocol/index.js';
import type { ErrorEnvelope } from '../../protocol/index.js';
import type { PolicyResult, TrustDomain } from './types.js';
import type { ArtifactRef, Grant, Scope } from './wire.js';

/** Deterministic set intersection: the same inputs always yield the same byte order. */
function intersect(lists: readonly (readonly string[])[]): string[] {
  const [head, ...rest] = lists;
  if (head === undefined) return [];
  const restSets = rest.map((list) => new Set(list));
  return [...new Set(head)].filter((value) => restSets.every((set) => set.has(value))).sort();
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameArtifact(left: ArtifactRef | null, right: ArtifactRef | null): boolean {
  if (left === null || right === null) return left === right;
  return left.id === right.id && left.digest === right.digest;
}

/** `os-sandbox` survives only when both sides guarantee it; anything else is `same-user`. */
export function weakerTrustDomain(left: TrustDomain, right: TrustDomain): TrustDomain {
  return left === 'os-sandbox' && right === 'os-sandbox' ? 'os-sandbox' : 'same-user';
}

/**
 * `root ∩ parent ∩ task`: read/write/artifact scopes and workspace locator are intersected,
 * trust domain is weakened. A workspace disagreement resolves to `null` (no agreed locator), which
 * is fail-closed rather than picking one side.
 */
export function intersectScopes(scopes: readonly [Scope, ...Scope[]]): Scope {
  const [head, ...rest] = scopes;
  const all = [head, ...rest];
  const workspace = all.every((scope) => sameArtifact(scope.workspaceRef, head.workspaceRef))
    ? head.workspaceRef
    : null;
  return {
    workspaceRef: workspace,
    readResources: intersect(all.map((scope) => scope.readResources)),
    writeResources: intersect(all.map((scope) => scope.writeResources)),
    artifactScopes: intersect(all.map((scope) => scope.artifactScopes)),
    trustDomain: all.map((scope) => scope.trustDomain).reduce(weakerTrustDomain),
  };
}

/**
 * Everything `candidate` asks for that `ceiling` does not grant. An empty list means the candidate
 * is a subset. Escalating `trustDomain` to `os-sandbox` is a violation even when the ceiling is
 * same-user, because it would be a claim the system cannot back.
 */
export function scopeViolations(candidate: Scope, ceiling: Scope): string[] {
  const violations: string[] = [];
  const extra = (field: string, asked: readonly string[], granted: readonly string[]): void => {
    const allowed = new Set(granted);
    for (const value of asked) if (!allowed.has(value)) violations.push(`${field}:${value}`);
  };
  extra('readResources', candidate.readResources, ceiling.readResources);
  extra('writeResources', candidate.writeResources, ceiling.writeResources);
  extra('artifactScopes', candidate.artifactScopes, ceiling.artifactScopes);
  if (candidate.workspaceRef !== null && !sameArtifact(candidate.workspaceRef, ceiling.workspaceRef)) {
    violations.push(`workspace:${candidate.workspaceRef.id}`);
  }
  if (candidate.trustDomain === 'os-sandbox' && ceiling.trustDomain !== 'os-sandbox') {
    violations.push('trustDomain:os-sandbox');
  }
  return violations;
}

function extraCapabilities(asked: readonly string[], ceilings: readonly (readonly string[])[]): string[] {
  const allowed = new Set(intersect(ceilings));
  return asked.filter((capability) => !allowed.has(capability)).map((capability) => `capability:${capability}`);
}

function earliestInstant(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.min(...present);
}

/** What a node, graph patch or delegated child asks the kernel to authorize. */
export interface AuthorityNodeRequest {
  readonly nodeId: string;
  readonly scope: Scope;
  readonly capabilities: readonly string[];
}

export interface AuthorityRequest {
  /** Injected Clock instant; the policy layer never reads a clock. */
  readonly now: number;
  /** Current revocation generation from the permission root. */
  readonly revokedEpoch: number;
  readonly root: Grant;
  readonly parent: Grant;
  /** `TaskContract.scope`; part of the ceiling, so a template cannot widen it. */
  readonly task: Scope;
  readonly node: AuthorityNodeRequest;
}

export interface EffectiveAuthority {
  readonly scope: Scope;
  readonly capabilities: readonly string[];
  readonly nodeIds: readonly string[];
  readonly maxDelegationDepth: number;
  readonly expiresAt: number | null;
  readonly trustDomain: TrustDomain;
}

const denied = (code: 'EFK_AUTHORITY_DENIED' | 'EFK_GRANT_EXPIRED' | 'EFK_GRANT_REVOKED', message: string, ref: string): { readonly ok: false; readonly error: ErrorEnvelope } => ({
  ok: false,
  error: fail(code, message, [ref]),
});

/**
 * Verify a request against `root ∩ parent ∩ task` and return the effective authority.
 * Refusals: an expired or revoked grant, exhausted delegation depth, or any requested resource /
 * capability / node outside the ceiling.
 */
export function deriveAuthority(request: AuthorityRequest): PolicyResult<EffectiveAuthority> {
  const { root, parent, task, node } = request;

  const expiresAt = earliestInstant([root.expiresAt, parent.expiresAt]);
  if (expiresAt !== null && request.now >= expiresAt) {
    return denied('EFK_GRANT_EXPIRED', `authority grant expired at ${expiresAt}`, node.nodeId);
  }
  if (request.revokedEpoch > Math.max(root.revocationEpoch, parent.revocationEpoch)) {
    return denied('EFK_GRANT_REVOKED', 'authority grant was revoked after it was issued', node.nodeId);
  }
  if (parent.maxDelegationDepth < 1) {
    return denied('EFK_AUTHORITY_DENIED', 'delegation depth is exhausted; the parent grant may not spawn a child', node.nodeId);
  }

  const ceiling = intersectScopes([root.scope, parent.scope, task]);
  const violations = [
    ...scopeViolations(node.scope, ceiling),
    ...extraCapabilities(node.capabilities, [root.capabilities, parent.capabilities]),
  ];
  if (!root.nodeIds.includes(node.nodeId) || !parent.nodeIds.includes(node.nodeId)) {
    violations.push(`node:${node.nodeId}`);
  }
  if (violations.length > 0) {
    return denied(
      'EFK_AUTHORITY_DENIED',
      `requested authority is not a subset of the grant ceiling: ${violations.join(', ')}`,
      node.nodeId,
    );
  }

  const trustDomain = weakerTrustDomain(node.scope.trustDomain, ceiling.trustDomain);
  return {
    ok: true,
    value: {
      scope: {
        workspaceRef: node.scope.workspaceRef ?? ceiling.workspaceRef,
        readResources: sortedUnique(node.scope.readResources),
        writeResources: sortedUnique(node.scope.writeResources),
        artifactScopes: sortedUnique(node.scope.artifactScopes),
        trustDomain,
      },
      capabilities: sortedUnique(node.capabilities),
      nodeIds: [node.nodeId],
      maxDelegationDepth: Math.min(root.maxDelegationDepth, parent.maxDelegationDepth) - 1,
      expiresAt,
      trustDomain,
    },
  };
}
