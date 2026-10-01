/**
 * Authority: a task template, a graph patch or a delegated child can only shrink the permission
 * root, and `same-user` never becomes `os-sandbox`. Every refusal is a typed `EFK_*` envelope.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveAuthority, intersectScopes, scopeViolations, weakerTrustDomain } from '../dist/kernel/policy/index.js';
import * as fixtures from './l2-policy-fixtures.js';

const baseGrant = (overrides = {}) =>
  fixtures.grant({
    nodeIds: ['node-1'],
    capabilities: ['tool:read'],
    scope: fixtures.scope({ readResources: ['a'] }),
    maxDelegationDepth: 3,
    ...overrides,
  });

const request = (overrides = {}) => ({
  now: 0,
  revokedEpoch: 0,
  root: baseGrant(),
  parent: baseGrant({ grantId: 'grant-parent' }),
  task: fixtures.scope({ readResources: ['a'] }),
  node: { nodeId: 'node-1', scope: fixtures.scope({ readResources: ['a'] }), capabilities: ['tool:read'] },
  ...overrides,
});

test('intersecting scopes keeps only what every side grants', () => {
  const ceiling = intersectScopes([
    fixtures.scope({ readResources: ['a'] }),
    fixtures.scope({ readResources: ['a', 'b'] }),
    fixtures.scope({ readResources: ['a', 'b', 'c'] }),
  ]);
  assert.deepEqual(ceiling.readResources, ['a']);
  assert.deepEqual(scopeViolations(fixtures.scope({ readResources: ['a'] }), ceiling), []);
  assert.deepEqual(scopeViolations(fixtures.scope({ readResources: ['a', 'b'] }), ceiling), ['readResources:b']);
});

// DoD 1 negative control: removing the ceiling check would let the 'b' request through as ok.
test('a task template cannot widen the root, and a node asking for the template-only resource is refused', () => {
  const widened = request({
    task: fixtures.scope({ readResources: ['a', 'b'] }),
    node: { nodeId: 'node-1', scope: fixtures.scope({ readResources: ['a', 'b'] }), capabilities: ['tool:read'] },
  });
  const refused = deriveAuthority(widened);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'EFK_AUTHORITY_DENIED');
  assert.match(refused.error.message, /readResources:b/);

  const narrowed = deriveAuthority({
    ...widened,
    node: { nodeId: 'node-1', scope: fixtures.scope({ readResources: ['a'] }), capabilities: ['tool:read'] },
  });
  assert.equal(narrowed.ok, true);
  assert.deepEqual(narrowed.value.scope.readResources, ['a']);
});

test('os-sandbox is refused rather than inferred, and same-user never upgrades', () => {
  const refused = deriveAuthority(
    request({ node: { nodeId: 'node-1', scope: fixtures.scope({ readResources: ['a'], trustDomain: 'os-sandbox' }), capabilities: ['tool:read'] } }),
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'EFK_AUTHORITY_DENIED');
  assert.match(refused.error.message, /trustDomain:os-sandbox/);

  assert.equal(weakerTrustDomain('same-user', 'os-sandbox'), 'same-user');
  assert.equal(weakerTrustDomain('os-sandbox', 'os-sandbox'), 'os-sandbox');
});

test('an expired grant is refused at the instant boundary', () => {
  const refused = deriveAuthority(request({ now: 100, root: baseGrant({ expiresAt: 100 }) }));
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'EFK_GRANT_EXPIRED');
});

test('a revoked grant is refused when the root revocation generation advanced', () => {
  const refused = deriveAuthority(request({ revokedEpoch: 1, root: baseGrant({ revocationEpoch: 0 }) }));
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'EFK_GRANT_REVOKED');
});

test('delegation depth is decremented and cannot go below zero', () => {
  const exhausted = deriveAuthority(request({ parent: baseGrant({ grantId: 'grant-parent', maxDelegationDepth: 0 }) }));
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.error.code, 'EFK_AUTHORITY_DENIED');

  const derived = deriveAuthority(request({ parent: baseGrant({ grantId: 'grant-parent', maxDelegationDepth: 2 }) }));
  assert.equal(derived.ok, true);
  assert.equal(derived.value.maxDelegationDepth, 1);
});

test('capabilities and node membership are both intersected', () => {
  const capability = deriveAuthority(
    request({ node: { nodeId: 'node-1', scope: fixtures.scope({ readResources: ['a'] }), capabilities: ['tool:write'] } }),
  );
  assert.equal(capability.ok, false);
  assert.match(capability.error.message, /capability:tool:write/);

  const node = deriveAuthority(request({ root: baseGrant({ nodeIds: ['node-2'] }) }));
  assert.equal(node.ok, false);
  assert.match(node.error.message, /node:node-1/);
});
