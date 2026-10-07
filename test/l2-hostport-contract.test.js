/**
 * `l2_host_port` acceptance: the host port, the fake host, scoped delegation and the contract
 * verification entry points.
 *
 * Every block below asserts the failing edge as well as the passing one, because a check that
 * cannot fail proves nothing (the brief's negative-control rule). The two DoD blocks are marked
 * "DoD ①" and "DoD ②".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DSH_CAPABILITIES,
  PI_CAPABILITIES,
  capabilityStatus,
  dedupeUsage,
  delegate,
  replayView,
  revokeGrant,
  usageIsComplete,
  verifyBoardAuthority,
  verifyEffect,
  verifyReceipt,
} from '../dist/runtime/host-port/index.js';
// `createFakeHost` is intentionally absent from the barrel (audit G07): importing it is an explicit
// deep import so the published `evofence/core` surface cannot fabricate observations.
import { createFakeHost } from '../dist/runtime/host-port/host-fake.js';
import { decode } from '../dist/protocol/index.js';

const PROTOCOL = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
const ASSET_PROTOCOL = { namespace: 'evofence.assets/1', schemaVersion: '1.0.0' };
const DIGEST = `sha256:${'a'.repeat(64)}`;

const artifact = (id = 'artifact-1') => ({
  protocol: PROTOCOL,
  id,
  digest: DIGEST,
  producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null },
  binding: null,
  schema: { name: 'TaskEvidenceReport', version: '1.1.0', digest: DIGEST },
  location: `artifact://${id}`,
  visibility: 'internal',
  expiresAt: null,
  partition: 'not-evaluation',
});

const scope = {
  workspaceRef: null,
  readResources: ['res'],
  writeResources: [],
  artifactScopes: ['art'],
  trustDomain: 'same-user',
};

const budget = {
  poolId: 'pool-1',
  category: 'development',
  authorizationRef: null,
  maxRequests: 10,
  maxInputTokens: 1000,
  maxOutputTokens: 1000,
  maxUsdMicros: 100000,
  maxWallMs: 60000,
  maxConcurrentRequests: 2,
  priceRef: null,
  missingUsagePolicy: 'retain-reservation',
};

const binding = {
  sessionId: 'session-1',
  hostSessionId: 'native-1',
  graph: { graphId: 'graph-1', revision: 1, digest: DIGEST },
  nodeId: 'node-1',
  attemptId: 'attempt-1',
  attemptOrdinal: 1,
  epoch: 3,
  baseDigest: null,
};

const grant = {
  grantId: 'grant-1',
  rootAuthorityRef: 'root-1',
  scope,
  budget,
  issuedEpoch: 1,
  expiresAt: 10000,
  remainingDepth: 2,
  maxConcurrency: 2,
  revocationEpoch: 0,
  revoked: false,
};

const context = { inputRefs: [], maxTokens: 100, preserveHostResources: true, isolation: 'current' };
const graphRef = { graphId: 'sub-graph', revision: 1, digest: DIGEST };
const lease = { resourceId: 'workspace', ownerClaimId: 'claim-1', epoch: 3, fencingToken: 1, expiresAt: 9000 };
const assetRef = { protocol: ASSET_PROTOCOL, assetId: 'asset-1', revision: 1, digest: DIGEST, scope, qualificationRef: null };

/** A schema-valid `Effect`. `payload` fields that do not apply to the kind stay null. */
function effectOf(kind, options = {}) {
  const id = options.effectId ?? `effect-${kind}`;
  const payload = {
    context: null,
    toolName: null,
    argumentsRef: null,
    graphRef: null,
    targetIds: [],
    assetRef: null,
    previousSnapshot: null,
    deliveryGuarantee: 'none',
    ...options.payload,
  };
  return {
    protocol: PROTOCOL,
    effectId: id,
    idempotencyKey: options.idempotencyKey ?? `idem-${kind}`,
    binding,
    authorityRef: options.authorityRef ?? 'grant-1',
    reservationRef: options.reservationRef === undefined ? 'reservation-1' : options.reservationRef,
    leases: options.leases ?? [],
    inputRefs: [],
    deadline: options.deadline ?? 5000,
    kind,
    payload,
  };
}

const agentEffect = effectOf('host.agent', { payload: { context } });
const toolEffect = effectOf('host.tool', { payload: { toolName: 'read' } });
const delegateEffect = effectOf('host.delegate', { payload: { context, graphRef } });
const activateEffect = effectOf('host.activate', {
  payload: { assetRef, previousSnapshot: artifact('snapshot-0') },
  leases: [lease],
});

const usageRow = (over = {}) => ({
  requestId: 'req-1',
  source: 'provider',
  inputUncached: 10,
  cacheRead: null,
  cacheWrite: null,
  output: 5,
  reasoning: null,
  total: 15,
  estimatedUsdMicros: null,
  invoiceUsdMicros: null,
  complete: true,
  evidenceRefs: [],
  ...over,
});

const guarantee = (status) => ({ status, coverage: status === 'verified' ? ['native'] : [], evidenceRefs: [] });
const clockAt = (now) => ({ now: () => now });

const hostOf = (host, capabilities, options = {}) =>
  createFakeHost({
    host,
    clock: clockAt(options.now ?? 1000),
    capabilities,
    cancellation: guarantee(options.cancellation ?? 'verified'),
    recovery: guarantee(options.recovery ?? 'verified'),
    isolation: guarantee(options.isolation ?? 'unknown'),
    boardOwners: options.boardOwners,
    script: options.script,
  });

const dsh = (options = {}) => hostOf('dsh', DSH_CAPABILITIES, { cancellation: 'partial', ...options });
const pi = (options = {}) => hostOf('pi', PI_CAPABILITIES, options);

const unwrap = (result) => {
  assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result.error)}`);
  return result.value;
};
const failure = (result, code) => {
  assert.equal(result.ok, false, `expected a typed failure ${code}`);
  assert.equal(result.error.code, code, `expected ${code}, got ${result.error.code}: ${result.error.message}`);
  return result.error;
};

test('the fake matrices are the probe manifests, not a more optimistic retelling', () => {
  const probes = [
    { host: 'dsh', matrix: DSH_CAPABILITIES, file: '../docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json' },
    { host: 'pi', matrix: PI_CAPABILITIES, file: '../docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json' },
  ];
  for (const { host, matrix, file } of probes) {
    const manifest = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
    const keys = Object.keys(manifest.capabilities).sort();
    assert.deepEqual(Object.keys(matrix).sort(), keys, `${host}: matrix keys must equal the probe keys`);
    for (const key of keys) {
      assert.equal(capabilityStatus(matrix, key), manifest.capabilities[key].status, `${host}.${key} status`);
    }
  }
  const dshManifest = JSON.parse(readFileSync(new URL(probes[0].file, import.meta.url), 'utf8'));
  assert.equal(dshManifest.capabilityStatusCounts.unknown, 13);
  assert.equal(Object.values(DSH_CAPABILITIES).filter((entry) => entry.status === 'unknown').length, 13);
  assert.equal(capabilityStatus(DSH_CAPABILITIES, 'teamMessageDelivery'), 'unknown');
  assert.equal(capabilityStatus(PI_CAPABILITIES, 'reasoningHighGuarantee'), 'partial');
  assert.equal(capabilityStatus(PI_CAPABILITIES, 'osSandbox'), 'absent');
  assert.equal(capabilityStatus(PI_CAPABILITIES, 'not-in-any-probe'), 'unknown', 'a missing probe key is unknown, never verified');
});

test('DoD ①: verifyEffect binds epoch, idempotency, authority and budget for every effect kind', () => {
  const kinds = ['host.agent', 'host.tool', 'host.delegate', 'host.cancel', 'host.activate', 'host.reconcile', 'timer.wait'];
  for (const kind of kinds) {
    const authorized = unwrap(verifyEffect(effectOf(kind, { leases: kind === 'host.activate' ? [lease] : [] }), { grants: [grant], now: 1000 }));
    assert.equal(authorized.effect.kind, kind);
    assert.equal(authorized.effect.binding.epoch, 3, `${kind}: epoch association`);
    assert.equal(authorized.effect.idempotencyKey, `idem-${kind}`, `${kind}: idempotency association`);
    assert.equal(authorized.grant.grantId, 'grant-1', `${kind}: authority association`);
    assert.equal(authorized.effect.reservationRef, 'reservation-1', `${kind}: budget association`);
  }
});

test('DoD ① negative controls: each association can actually fail', () => {
  const ctx = { grants: [grant], now: 1000 };
  const noBinding = effectOf('host.tool');
  delete noBinding.binding;
  failure(verifyEffect(noBinding, ctx), 'EFK_SCHEMA_INVALID');

  const noKey = effectOf('host.tool');
  delete noKey.idempotencyKey;
  failure(verifyEffect(noKey, ctx), 'EFK_SCHEMA_INVALID');

  failure(verifyEffect(effectOf('host.tool', { authorityRef: 'grant-none' }), ctx), 'EFK_AUTHORITY_DENIED');
  failure(verifyEffect(effectOf('host.tool'), { grants: [revokeGrant(grant, 1)], now: 1000 }), 'EFK_GRANT_REVOKED');
  failure(verifyEffect(effectOf('host.tool'), { grants: [{ ...grant, expiresAt: 500 }], now: 1000 }), 'EFK_GRANT_EXPIRED');
  failure(verifyEffect(effectOf('host.agent', { reservationRef: null }), ctx), 'EFK_BUDGET_NOT_AUTHORIZED');
  failure(verifyEffect(effectOf('host.activate', { payload: { assetRef, previousSnapshot: artifact() } }), ctx), 'EFK_AUTHORITY_DENIED');
  failure(verifyEffect(effectOf('host.tool', { authorityRef: 'grant-epoch' }), { grants: [{ ...grant, grantId: 'grant-epoch', issuedEpoch: 5 }], now: 1000 }), 'EFK_AUTHORITY_DENIED');
  const zeroEpoch = effectOf('host.tool');
  zeroEpoch.binding = { ...binding, epoch: 0 };
  failure(verifyEffect(zeroEpoch, ctx), 'EFK_SCHEMA_INVALID');
});

test('DoD ①: every refusal is the frozen ErrorEnvelope, decodable by the protocol layer', () => {
  const refused = verifyEffect(effectOf('host.tool', { reservationRef: null, authorityRef: 'missing' }), { grants: [], now: 1000 });
  assert.equal(refused.ok, false);
  assert.equal(unwrap(decode('ErrorEnvelope', refused.error)).code, 'EFK_AUTHORITY_DENIED');
});

test('DoD ②: an unprovable capability is typed unsupported and records nothing', async () => {
  const durable = effectOf('host.delegate', { payload: { context, graphRef, deliveryGuarantee: 'acknowledged-durable' } });
  const host = dsh();
  const refused = failure(await host.execute({ effect: durable, grant }), 'EFK_CAPABILITY_UNSUPPORTED');
  assert.deepEqual(refused.refs, ['teamMessageDelivery']);
  assert.equal(host.stats().invocations, 0, 'no native call for an unsupported effect');
  assert.equal(host.receiptFor(durable.effectId), null, 'no receipt invented');
});

test('DoD ② negative control: the gate reads the matrix, it is not hard-coded', async () => {
  const durable = effectOf('host.delegate', { payload: { context, graphRef, deliveryGuarantee: 'acknowledged-durable' } });
  const permissive = hostOf('dsh', { ...DSH_CAPABILITIES, teamMessageDelivery: { status: 'verified' } });
  assert.equal(unwrap(await permissive.execute({ effect: durable, grant })).status, 'completed');

  const crippled = hostOf('dsh', { ...DSH_CAPABILITIES, toolRequestGate: { status: 'absent' } });
  failure(await crippled.execute({ effect: toolEffect, grant }), 'EFK_CAPABILITY_UNSUPPORTED');
  assert.equal(unwrap(await dsh().execute({ effect: toolEffect, grant })).status, 'completed');
});

test('DoD ②: a partial guarantee satisfies only the demand that accepts partial', async () => {
  const host = pi();
  const payloadDemand = [{ capability: 'reasoningHighGuarantee', accepts: ['verified', 'partial'], because: 'payload accepted is enough when approved' }];
  const tierDemand = [{ capability: 'reasoningHighGuarantee', accepts: ['verified'], because: 'a server-tier guarantee was demanded' }];
  const first = effectOf('host.agent', { effectId: 'effect-a', payload: { context } });
  const second = effectOf('host.agent', { effectId: 'effect-b', idempotencyKey: 'idem-b', payload: { context } });
  assert.equal(unwrap(await host.execute({ effect: first, grant, demands: payloadDemand })).status, 'completed');
  failure(await host.execute({ effect: second, grant, demands: tierDemand }), 'EFK_CAPABILITY_UNSUPPORTED');
});

test('R6: a multi-target cancel is never refused; unconfirmed targets keep it unknown', async () => {
  const outgoing = effectOf('host.delegate', { effectId: 'effect-delegate', payload: { context, graphRef } });
  for (const [name, host] of [
    ['dsh', dsh()],
    ['pi', pi()],
  ]) {
    unwrap(await host.execute({ effect: agentEffect, grant }));
    unwrap(await host.execute({ effect: outgoing, grant }));
    const outcome = await host.cancel({ sessionId: 'session-1', targetIds: [agentEffect.effectId, outgoing.effectId] });
    assert.equal(outcome.ok, true, `${name}: the cancel action itself is never a capability refusal`);
    assert.equal(outcome.value.status, 'unknown');
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.value.error.code, 'EFK_CANCEL_UNCONFIRMED');
    const byTarget = Object.fromEntries(outcome.value.targets.map((target) => [target.targetId, target.confirmation]));
    assert.equal(byTarget[outgoing.effectId], 'unconfirmed', `${name}: a delegated child needs parentChildCancellation`);
  }
  // negative control: no path here produces EFK_CAPABILITY_UNSUPPORTED
  const host = dsh();
  unwrap(await host.execute({ effect: agentEffect, grant }));
  const outcome = await host.cancel({ sessionId: 'session-1', targetIds: [agentEffect.effectId, 'effect-never'] });
  assert.notEqual(outcome.error?.code ?? null, 'EFK_CAPABILITY_UNSUPPORTED');
  assert.equal(outcome.value.targets.find((target) => target.targetId === 'effect-never').confirmation, 'not-executed');
});

test('executing a host.cancel effect carries R6 semantics, not a generic success', async () => {
  const host = dsh();
  unwrap(await host.execute({ effect: agentEffect, grant }));
  const cancelEffect = effectOf('host.cancel', { effectId: 'effect-cancel', payload: { targetIds: [agentEffect.effectId] } });
  const receipt = unwrap(await host.execute({ effect: cancelEffect, grant }));
  assert.equal(receipt.status, 'unknown');
  assert.equal(receipt.error.code, 'EFK_CANCEL_UNCONFIRMED');
  assert.equal(host.stats().invocations, 1, 'a cancel does not enter the model/tool invocation path');
});

test('R6: an unconfirmed cancel stays unknown, a confirmed one or a never-dispatched target does not', async () => {
  const host = dsh();
  unwrap(await host.execute({ effect: agentEffect, grant }));
  const cancelled = unwrap(await host.cancel({ sessionId: 'session-1', targetIds: [agentEffect.effectId] }));
  assert.equal(cancelled.status, 'unknown');
  assert.equal(cancelled.error.code, 'EFK_CANCEL_UNCONFIRMED');
  assert.equal(cancelled.targets[0].confirmation, 'unconfirmed');
  assert.deepEqual(cancelled.targets[0].observability, []);

  const untouched = unwrap(await host.cancel({ sessionId: 'session-1', targetIds: ['effect-never'] }));
  assert.equal(untouched.status, 'cancelled');
  assert.equal(untouched.targets[0].confirmation, 'not-executed');

  const piHost = pi();
  unwrap(await piHost.execute({ effect: agentEffect, grant }));
  const confirmed = unwrap(await piHost.cancel({ sessionId: 'session-1', targetIds: [agentEffect.effectId] }));
  assert.equal(confirmed.status, 'cancelled');
  assert.equal(confirmed.error, null);
  assert.equal(confirmed.targets[0].confirmation, 'native-ack');
});

test('invariant 5: a re-delivered request applies once; a conflicting identity is refused', async () => {
  const host = dsh();
  const first = unwrap(await host.execute({ effect: agentEffect, grant }));
  const second = unwrap(await host.execute({ effect: agentEffect, grant }));
  assert.equal(first.receiptId, second.receiptId);
  assert.equal(host.stats().invocations, 1);

  const impostor = effectOf('host.agent', { effectId: 'effect-impostor', idempotencyKey: agentEffect.idempotencyKey });
  failure(await host.execute({ effect: impostor, grant }), 'EFK_IDEMPOTENCY_COLLISION');

  const mutated = { ...agentEffect, payload: { ...agentEffect.payload, context: { ...context, maxTokens: 50 } } };
  failure(await host.execute({ effect: mutated, grant }), 'EFK_IDEMPOTENCY_COLLISION');
});

test('invariant 5: usage dedupes identical deliveries and refuses contradictions', () => {
  assert.equal(unwrap(dedupeUsage([usageRow(), usageRow()])).length, 1);
  failure(dedupeUsage([usageRow(), usageRow({ output: 6 })]), 'EFK_USAGE_CONFLICT');
  assert.equal(usageIsComplete([]), false, 'an empty meter is not a free request');
  assert.equal(usageIsComplete([usageRow({ complete: false })]), false);
  assert.equal(usageIsComplete([usageRow()]), true);
  assert.equal(usageIsComplete([usageRow({ output: 1, reasoning: 2 })]), false, 'reasoning is a subset of output');
});

test('invariant 6: unknown is reconciled, never blindly retried', async () => {
  const unknownEffect = effectOf('host.agent', { effectId: 'effect-unknown', idempotencyKey: 'idem-unknown', payload: { context } });
  const host = dsh({ script: { outcomes: { 'effect-unknown': 'unknown' } } });
  const receipt = unwrap(await host.execute({ effect: unknownEffect, grant }));
  assert.equal(receipt.status, 'unknown');
  assert.equal(receipt.hostInvocationId, null);
  assert.deepEqual(receipt.observability, []);

  failure(await host.execute({ effect: { ...unknownEffect, idempotencyKey: 'idem-retry' }, grant }), 'EFK_EFFECT_NON_IDEMPOTENT_RETRY');

  const before = host.stats().invocations;
  const outcomes = unwrap(await host.reconcile({ sessionId: 'session-1', targetIds: ['effect-unknown'] }));
  assert.equal(outcomes[0].verdict, 'unknown');
  assert.equal(outcomes[0].error.code, 'EFK_EFFECT_UNKNOWN');
  assert.equal(host.stats().invocations, before, 'reconcile without evidence does not re-dispatch');

  const resolving = dsh({ script: { outcomes: { 'effect-unknown': 'unknown' }, reconcile: { 'effect-unknown': 'completed' } } });
  unwrap(await resolving.execute({ effect: unknownEffect, grant }));
  const dispatched = resolving.stats().invocations;
  const resolved = unwrap(await resolving.reconcile({ sessionId: 'session-1', targetIds: ['effect-unknown'] }));
  assert.equal(resolved[0].verdict, 'resolved');
  assert.equal(resolved[0].receipt.status, 'completed');
  assert.equal(resolving.stats().invocations, dispatched, 'reconcile reads evidence, it does not re-run the effect');
});

test('invariant 10: replay rebuilds the view and the unknown list without dispatching', async () => {
  const unknownEffect = effectOf('host.agent', { effectId: 'effect-unknown', idempotencyKey: 'idem-unknown', payload: { context } });
  const host = dsh({ script: { outcomes: { 'effect-unknown': 'unknown' } } });
  unwrap(await host.execute({ effect: agentEffect, grant }));
  unwrap(await host.execute({ effect: unknownEffect, grant }));
  const before = host.stats().invocations;

  const view = replayView(host.journal());
  assert.equal(host.stats().invocations, before, 'replay invoked nothing');
  assert.equal(view.byEffect[agentEffect.effectId], 'completed');
  assert.deepEqual(view.unknowns, [unknownEffect.effectId]);

  const fresh = effectOf('host.agent', { effectId: 'effect-fresh', idempotencyKey: 'idem-fresh', payload: { context } });
  unwrap(await host.execute({ effect: fresh, grant }));
  assert.equal(host.stats().invocations, before + 1, 'the counter is live, so a flat counter is evidence');
});

test('the receipt the fake emits is a decodable protocol Receipt', async () => {
  const receipt = unwrap(await dsh().execute({ effect: agentEffect, grant }));
  const decoded = decode('Receipt', receipt);
  assert.equal(decoded.ok, true, JSON.stringify(decoded.error));
  assert.equal(decoded.value.status, 'completed');
  assert.equal(decoded.value.effectId, agentEffect.effectId);
});

test('stale receipts are archived, foreign receipts are refused', async () => {
  const host = dsh();
  const receipt = unwrap(await host.execute({ effect: agentEffect, grant }));
  assert.equal(unwrap(verifyReceipt(receipt, agentEffect)).disposition, 'current');
  const movedOn = { ...agentEffect, binding: { ...binding, epoch: 4 } };
  assert.equal(unwrap(verifyReceipt(receipt, movedOn)).disposition, 'archived');
  const baseChanged = { ...agentEffect, binding: { ...binding, baseDigest: `sha256:${'b'.repeat(64)}` } };
  const archivedBase = unwrap(verifyReceipt(receipt, baseChanged));
  assert.equal(archivedBase.disposition, 'archived', 'a receipt for a different workspace base must not apply');
  assert.match(archivedBase.reason, /base/);
  const graphMoved = { ...agentEffect, binding: { ...binding, graph: { ...binding.graph, revision: 2 } } };
  assert.equal(unwrap(verifyReceipt(receipt, graphMoved)).disposition, 'archived');
  failure(verifyReceipt(receipt, { ...agentEffect, effectId: 'effect-other' }), 'EFK_ARTIFACT_BINDING_MISMATCH');
});

test('replayView reports each unknown effect once', () => {
  const record = (effectId, status) => ({ effectId, receipt: { status } });
  const view = replayView([record('e-dup', 'unknown'), record('e-dup', 'unknown'), record('e-ok', 'completed')]);
  assert.deepEqual(view.unknowns, ['e-dup']);
  assert.equal(view.byEffect['e-dup'], 'unknown');
  assert.equal(view.byEffect['e-ok'], 'completed');
});

test('A15: a native board owner with no matching kernel claim is a conflict', async () => {
  const host = dsh({ boardOwners: [{ nodeId: 'node-1', attemptId: 'attempt-1', ownerClaimId: 'claim-1' }] });
  const observation = unwrap(await host.observe('session-1'));
  assert.deepEqual(unwrap(verifyBoardAuthority(observation, [{ nodeId: 'node-1', attemptId: 'attempt-1', ownerClaimId: 'claim-1' }])), []);
  failure(verifyBoardAuthority(observation, [{ nodeId: 'node-1', attemptId: 'attempt-1', ownerClaimId: 'claim-other' }]), 'EFK_HOST_BOARD_AUTHORITY_CONFLICT');
  failure(verifyBoardAuthority(observation, []), 'EFK_HOST_BOARD_AUTHORITY_CONFLICT');
});

test('a child grant only shrinks; every growth path is refused', () => {
  const child = {
    grantId: 'grant-child',
    scope,
    budget: { ...budget, maxRequests: 5, maxUsdMicros: 50000 },
    expiresAt: 9000,
    remainingDepth: 1,
    maxConcurrency: 1,
  };
  assert.equal(unwrap(delegate(grant, child, 1000)).grantId, 'grant-child');

  failure(delegate(grant, { ...child, scope: { ...scope, writeResources: ['res'] } }, 1000), 'EFK_AUTHORITY_DENIED');
  failure(delegate(grant, { ...child, remainingDepth: 2 }, 1000), 'EFK_AUTHORITY_DENIED');
  failure(delegate(grant, { ...child, expiresAt: 20000 }, 1000), 'EFK_AUTHORITY_DENIED');
  failure(delegate(grant, { ...child, maxConcurrency: 5 }, 1000), 'EFK_AUTHORITY_DENIED');
  failure(delegate(grant, { ...child, budget: { ...child.budget, poolId: 'pool-2' } }, 1000), 'EFK_AUTHORITY_DENIED');
  failure(delegate(grant, { ...child, budget: { ...child.budget, maxUsdMicros: 2000000 } }, 1000), 'EFK_AUTHORITY_DENIED');
  failure(delegate(grant, { ...child, scope: { ...scope, trustDomain: 'os-sandbox' } }, 1000), 'EFK_AUTHORITY_DENIED');
  failure(delegate({ ...grant, revoked: true }, child, 1000), 'EFK_GRANT_REVOKED');
  failure(delegate(grant, child, 10000), 'EFK_GRANT_EXPIRED');

  const wider = { ...grant, scope: { ...scope, writeResources: ['res'] } };
  assert.equal(unwrap(delegate(wider, { ...child, scope: { ...scope, writeResources: ['res'] } }, 1000)).grantId, 'grant-child');
  assert.equal(revokeGrant(grant, 1).revoked, true);
  assert.equal(revokeGrant(revokeGrant(grant, 4), 2).revocationEpoch, 4, 'revocation is monotonic');
});

test('context injection reports what happened and refuses a demand it cannot meet', async () => {
  const plan = { inputRefs: [artifact()], maxTokens: 100, preserveHostResources: true, isolation: 'current' };
  const injection = unwrap(await dsh().context({ sessionId: 'session-1', plan }));
  assert.equal(injection.preservedHostResources, true);
  assert.equal(injection.injectedRefs.length, 1);

  const noChild = hostOf('dsh', { ...DSH_CAPABILITIES, sdkChildSessionIsolation: { status: 'absent' } });
  failure(await noChild.context({ sessionId: 'session-1', plan: { ...plan, isolation: 'fresh' } }), 'EFK_CAPABILITY_UNSUPPORTED');
  assert.equal(unwrap(await noChild.context({ sessionId: 'session-1', plan })).isolation, 'current');
});

test('a deadline that has already passed is not-executed, not a completed effect', async () => {
  const late = effectOf('host.agent', { effectId: 'effect-late', idempotencyKey: 'idem-late', payload: { context }, deadline: 500 });
  const host = dsh({ now: 1000 });
  const receipt = unwrap(await host.execute({ effect: late, grant }));
  assert.equal(receipt.status, 'not-executed');
  assert.equal(host.stats().invocations, 0);
});

test('usage lookup never turns a missing meter into zero', async () => {
  const host = dsh({ script: { usage: { 'effect-usage': [usageRow()] } } });
  const report = unwrap(await host.usage({ effectId: 'effect-usage', requestIds: [] }));
  assert.equal(report.complete, true);
  assert.equal(report.usage.length, 1);
  const missing = unwrap(await host.usage({ effectId: 'effect-nope', requestIds: [] }));
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.usage, []);
});
