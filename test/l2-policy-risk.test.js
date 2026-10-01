/**
 * The single policy decision. Order matters: authority and protocol first, then capability gaps,
 * then the trust domain, then budget, then usage completeness. Only a needed-and-absent guarantee
 * refuses; a gap that only the evolution loop needs can disable evolution and let the task run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fail } from '../dist/protocol/index.js';
import { decide } from '../dist/kernel/policy/index.js';
import * as fixtures from './l2-policy-fixtures.js';

const policy = {
  policyId: 'policy-1',
  evolutionMode: 'optional',
  evolutionCapabilities: ['evolution-cap'],
  requireTrustDomain: 'same-user',
  requireCompleteUsage: true,
};

const authorityOk = {
  ok: true,
  value: {
    scope: fixtures.scope(),
    capabilities: [],
    nodeIds: ['node-1'],
    maxDelegationDepth: 2,
    expiresAt: null,
    trustDomain: 'same-user',
  },
};

const negotiationOk = (overrides = {}) => ({
  ok: true,
  value: {
    status: 'executable',
    taskDigest: fixtures.DIGEST('1'),
    manifestDigest: fixtures.DIGEST('2'),
    satisfied: ['cap'],
    gaps: [],
    selectedAlternatives: [],
    approvalRefs: [],
    ...overrides,
  },
});

const budgetOk = (overrides = {}) => ({
  snapshot: {
    capMicros: 190940,
    settledMicros: 0,
    outstandingMicros: 0,
    remainingMicros: 190940,
    requestCount: 0,
    outstandingCount: 0,
    exhausted: false,
    ...overrides,
  },
  error: null,
});

const usageOk = (overrides = {}) => ({
  complete: true,
  knownMicros: 0,
  missingRequestIds: [],
  incompleteRequestIds: [],
  conflictingRequestIds: [],
  ...overrides,
});

const input = (overrides = {}) => ({
  policy,
  authority: authorityOk,
  negotiation: negotiationOk(),
  budget: budgetOk(),
  usage: usageOk(),
  ...overrides,
});

const gap = (capability, reason = 'missing') => ({ capability, reason, evidenceRefs: [], alternativeIds: [] });

test('an authority failure denies with its own envelope', () => {
  const result = decide(input({ authority: { ok: false, error: fail('EFK_AUTHORITY_DENIED', 'outside grant') } }));
  assert.equal(result.disposition, 'deny');
  assert.equal(result.error.code, 'EFK_AUTHORITY_DENIED');
  assert.deepEqual(result.reasons, ['authority']);
});

test('a protocol failure denies before capability or budget is considered', () => {
  const result = decide(input({ negotiation: { ok: false, error: fail('EFK_PROTOCOL_UNSUPPORTED', 'no pair') } }));
  assert.equal(result.disposition, 'deny');
  assert.equal(result.error.code, 'EFK_PROTOCOL_UNSUPPORTED');
});

test('a missing base guarantee denies', () => {
  const result = decide(input({ negotiation: negotiationOk({ status: 'unsupported', gaps: [gap('cap')] }) }));
  assert.equal(result.disposition, 'deny');
  assert.equal(result.error.code, 'EFK_CAPABILITY_UNSUPPORTED');
  assert.equal(result.confidence, 'absent');
});

// DoD: a normal task continues with evolution disabled when only the evolution guarantee is absent.
test('a missing evolution-only guarantee degrades and disables evolution instead of denying the task', () => {
  const result = decide(input({ negotiation: negotiationOk({ status: 'unsupported', gaps: [gap('evolution-cap')] }) }));
  assert.equal(result.disposition, 'degrade');
  assert.equal(result.evolution, 'disabled');
  assert.deepEqual(result.gaps.map((entry) => entry.capability), ['evolution-cap']);
});

test('a hard evolution requirement is not degraded away', () => {
  const result = decide(
    input({ policy: { ...policy, evolutionMode: 'hard' }, negotiation: negotiationOk({ status: 'unsupported', gaps: [gap('evolution-cap')] }) }),
  );
  assert.equal(result.disposition, 'deny');
  assert.equal(result.error.code, 'EFK_CAPABILITY_UNSUPPORTED');
});

test('an unapproved degradation needs authorization and is not dispatchable', () => {
  const result = decide(input({ negotiation: negotiationOk({ status: 'needs-degradation', gaps: [gap('cap', 'partial')] }) }));
  assert.equal(result.disposition, 'needs-authorization');
  assert.equal(result.error.code, 'EFK_DEGRADATION_APPROVAL_REQUIRED');
  assert.equal(result.confidence, 'partial');
});

test('requiring an OS sandbox denies a same-user trust domain', () => {
  const result = decide(input({ policy: { ...policy, requireTrustDomain: 'os-sandbox' } }));
  assert.equal(result.disposition, 'deny');
  assert.equal(result.error.code, 'EFK_AUTHORITY_DENIED');
  assert.deepEqual(result.reasons, ['trust-domain']);
});

test('a budget error or an exhausted pool denies', () => {
  const errored = decide(input({ budget: { snapshot: budgetOk().snapshot, error: fail('EFK_BUDGET_NOT_AUTHORIZED', 'no authorization') } }));
  assert.equal(errored.disposition, 'deny');
  assert.equal(errored.error.code, 'EFK_BUDGET_NOT_AUTHORIZED');

  const exhausted = decide(input({ budget: budgetOk({ exhausted: true }) }));
  assert.equal(exhausted.disposition, 'deny');
  assert.equal(exhausted.error.code, 'EFK_BUDGET_EXHAUSTED');
});

// Negative control for "missing telemetry is not zero".
test('incomplete required usage denies when the policy demands complete metering', () => {
  const result = decide(input({ usage: usageOk({ complete: false, knownMicros: null, missingRequestIds: ['r1'] }) }));
  assert.equal(result.disposition, 'deny');
  assert.equal(result.error.code, 'EFK_USAGE_INCOMPLETE');
});

test('a task with authority, budget and telemetry in order is allowed', () => {
  const result = decide(input());
  assert.equal(result.disposition, 'allow');
  assert.equal(result.evolution, 'enabled');
  assert.equal(result.confidence, 'verified');
  assert.equal(result.error, null);
});
