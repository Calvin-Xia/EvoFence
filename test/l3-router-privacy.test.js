import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { task } from './l2-policy-fixtures.js';
import { createContextRouter, canonicalContext, audienceForRole } from '../dist/learning/context/index.js';
import { withheldReason } from '../dist/kernel/artifacts/index.js';

const digest = { digest: text => `sha256:${createHash('sha256').update(text).digest('hex')}` };
const tokenizer = { id: 'fixture:utf8-byte/v1', countTokens: text => new TextEncoder().encode(text).length };
const router = createContextRouter({ digest, tokenizer });
const binding = {
  sessionId: 'session-1', hostSessionId: null, graph: { graphId: 'graph-1', revision: 2, digest: digest.digest('graph') },
  nodeId: 'node-1', attemptId: 'attempt-1', attemptOrdinal: 1, epoch: 1, baseDigest: digest.digest('base'),
};
function artifact(id, visibility = 'internal', partition = 'not-evaluation', purpose = 'evidence') {
  const bytes = `content:${id}`;
  const ref = {
    protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' }, id, digest: digest.digest(bytes),
    producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null }, binding,
    schema: { name: 'Evidence', version: '1.1.0', digest: digest.digest('schema') },
    location: `artifact://${id}`, visibility, partition, expiresAt: null,
  };
  return { ref, bytes, purpose, expectation: { productKind: 'node-product', schema: ref.schema, binding } };
}
function setup(artifacts = [], overrides = {}) {
  const contract = task(overrides);
  return {
    contract,
    inputs: {
      contractRef: { taskId: contract.taskId, version: contract.version, digest: digest.digest(canonicalContext(contract)) },
      binding, nodeInputRefs: artifacts.map(a => a.ref), at: 100,
      plan: { inputRefs: artifacts.map(a => a.ref), maxTokens: 60000, preserveHostResources: true, isolation: 'fresh' },
      artifacts,
    },
    window: { windowTokens: 100000, reservedOutputTokens: 4096, hostInputTokens: 0, strategy: 'compact', excerptChars: 64 },
  };
}
function build(f, role = 'executor', scoped = router) { return scoped.buildContextPacket(f.contract, role, f.inputs, f.window); }
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; }
function err(result, code) { assert.equal(result.ok, false, 'expected typed refusal'); assert.equal(result.error.code, code); return result.error; }
const restrictedRoles = ['executor', 'learner', 'fresh-verifier'];

test('role/visibility/partition matrix agrees with the one kernel artifact authority', () => {
  for (const role of [...restrictedRoles, 'private-evaluator']) {
    const audience = ok(audienceForRole(role));
    for (const visibility of ['public', 'internal', 'private', 'held-out', 'final']) {
      for (const partition of ['train', 'dev', 'held-out', 'final', 'not-evaluation']) {
        const item = artifact('opaque-1', visibility, partition);
        const reason = ok(withheldReason(item.ref, audience));
        const value = ok(build(setup([item]), role));
        assert.equal(value.packet.entries.length, reason === 'none' ? 1 : 0, `${role}/${visibility}/${partition}`);
      }
    }
  }
});

test('private and final refs never reach an executing or learning packet', () => {
  const hidden = [
    artifact('PRIVATE-SCORER', 'private'), artifact('HELDOUT-PATCH', 'internal', 'held-out'),
    artifact('FINAL-TASK', 'public', 'final'), artifact('CANDIDATE-TRACE', 'private', 'train'),
  ];
  for (const role of restrictedRoles) {
    const f = setup([artifact('public-output'), ...hidden]);
    const value = ok(build(f, role));
    assert.deepEqual(value.packet.entries.map(e => e.ref.id), ['public-output']);
    assert.deepEqual(value.packet.withheld, { visibility: 2, partition: 2 });
    const allOutput = JSON.stringify(value);
    for (const item of hidden) {
      for (const marker of [item.ref.id, item.bytes, item.ref.digest, item.ref.location]) assert.ok(!allOutput.includes(marker), marker);
    }
  }
});

test('private evaluator alone can consume candidate feedback and held-out/final evidence', () => {
  const items = [artifact('opaque-1', 'private', 'train', 'candidate-feedback'), artifact('opaque-2', 'final', 'final')];
  const value = ok(build(setup(items), 'private-evaluator'));
  assert.deepEqual(value.packet.entries.map(e => e.text), items.map(i => i.bytes));
  assert.deepEqual(value.packet.withheld, { visibility: 0, partition: 0 });
});

test('candidate validation feedback mislabeled public is still evaluator-only', () => {
  const f = setup([artifact('opaque-feedback', 'public', 'train', 'candidate-feedback')]);
  for (const role of restrictedRoles) {
    const failure = err(build(f, role), 'EFK_PRIVACY_VIOLATION');
    assert.deepEqual(failure.refs, []);
    assert.ok(!JSON.stringify(failure).includes('opaque-feedback'));
  }
});

test('hidden bytes cannot influence excerpts, token telemetry, digest calls or packet output', () => {
  const hidden = artifact('PRIVATE-SCORER', 'private');
  const f = setup([artifact('public-output'), hidden]);
  const digested = [];
  const counted = [];
  const scoped = createContextRouter({
    digest: { digest: text => { digested.push(text); return digest.digest(text); } },
    tokenizer: { id: tokenizer.id, countTokens: text => { counted.push(text); return tokenizer.countTokens(text); } },
  });
  const first = ok(build(f, 'executor', scoped));
  hidden.bytes = 'different private scorer source '.repeat(10000);
  const second = ok(build(f, 'executor', scoped));
  assert.deepEqual(second, first, 'even invalid private bytes are not read or hashed in this audience');
  assert.ok(digested.every(text => !text.includes(hidden.bytes) && !text.includes('content:PRIVATE-SCORER')));
  assert.ok(counted.every(text => !text.includes('PRIVATE-SCORER')));
});

test('withheld ids, content hashes, producer names and locators do not create a shadow channel', () => {
  const hidden = artifact('PRIVATE-ORIGINAL', 'private');
  const f = setup([artifact('public-output'), hidden]);
  const first = ok(build(f));
  hidden.bytes = 'new hidden content';
  hidden.ref.id = 'PRIVATE-RENAMED';
  hidden.ref.location = 'artifact://PRIVATE-FILENAME';
  hidden.ref.digest = digest.digest(hidden.bytes);
  hidden.ref.producer.actorId = 'PRIVATE-PRODUCER';
  hidden.ref.schema.digest = digest.digest('private schema variant');
  assert.deepEqual(ok(build(f)), first);
});

test('TaskContract embedded refs are projected in checks, budget, nested grants and degradations', () => {
  const privateRef = artifact('SECRET-CHECK', 'private').ref;
  const f = setup();
  f.contract.acceptance.checkRefs = [privateRef];
  f.contract.acceptance.protocolRef = privateRef;
  f.contract.budget.priceRef = privateRef;
  f.contract.authorityGrant.actor.identityRef = privateRef;
  f.contract.authorityGrant.approvalRef = privateRef;
  f.contract.scope.workspaceRef = privateRef;
  f.contract.degradations = [{
    alternativeId: 'alt-1', replacesCapability: 'cap', requirements: f.contract.requiredGuarantees,
    tradeoff: 'authorized alternative', approvalRef: privateRef,
  }];
  f.inputs.contractRef.digest = digest.digest(canonicalContext(f.contract));
  const value = ok(build(f));
  assert.deepEqual(value.packet.task.acceptance.checkRefs, []);
  assert.equal(value.packet.task.acceptance.protocolRef, null);
  assert.equal(value.packet.task.budget.priceRef, null);
  assert.equal(value.packet.task.authorityGrant.actor.identityRef, null);
  assert.equal(value.packet.withheld.visibility, 7);
  assert.ok(!JSON.stringify(value).includes(privateRef.id));
  assert.ok(!JSON.stringify(value).includes(privateRef.digest));
  assert.ok(!JSON.stringify(value).includes(f.inputs.contractRef.digest), 'full contract hash is not a shadow channel');
});

test('nested private producer identity does not hitchhike on a visible handoff reference', () => {
  const item = artifact('public-handoff', 'public', 'train', 'handoff');
  item.ref.producer.identityRef = artifact('PRIVATE-IDENTITY', 'private').ref;
  const value = ok(build(setup([item])));
  assert.ok(!JSON.stringify(value).includes('PRIVATE-IDENTITY'));
  assert.equal(value.packet.entries[0].ref.producer.actorId, 'kernel-1');
  assert.ok(!Object.hasOwn(value.packet.entries[0].ref, 'location'));
});

test('a private task is withheld as a whole from executor/learner and allowed for its evaluator', () => {
  const f = setup();
  f.contract.privacy.visibility = 'private';
  f.inputs.contractRef.digest = digest.digest(canonicalContext(f.contract));
  for (const role of restrictedRoles) err(build(f, role), 'EFK_PRIVACY_VIOLATION');
  ok(build(f, 'private-evaluator'));
});

test('fresh verifier refuses a current transcript instead of inheriting author chat', () => {
  const f = setup();
  f.inputs.plan.isolation = 'current';
  err(build(f, 'fresh-verifier'), 'EFK_PRIVACY_VIOLATION');
  ok(build(f, 'executor'));
  f.inputs.plan.isolation = 'fresh';
  ok(build(f, 'fresh-verifier'));
});

test('unknown roles, input purposes and visibility enums fail typed without echoing private input', () => {
  for (const role of ['PRIVATE-ROLE', '__proto__', null]) err(build(setup(), role), 'EFK_SCHEMA_INVALID');
  const missing = setup();
  err(router.buildContextPacket(missing.contract, undefined, missing.inputs, missing.window), 'EFK_SCHEMA_INVALID');
  const f = setup([artifact('opaque-1')]);
  f.inputs.artifacts[0].purpose = 'PRIVATE-PURPOSE';
  const failure = err(build(f), 'EFK_SCHEMA_INVALID');
  assert.ok(!JSON.stringify(failure).includes('PRIVATE-PURPOSE'));
  const g = setup([artifact('opaque-1', 'PRIVATE-ENUM')]);
  const unknown = err(build(g), 'EFK_SCHEMA_INVALID');
  assert.ok(!JSON.stringify(unknown).includes('PRIVATE-ENUM'));
});

test('a missing private locator/expired private artifact neither discloses its name nor blocks public work', () => {
  const hidden = artifact('PRIVATE-EXPIRED', 'private');
  hidden.ref.expiresAt = 99;
  const f = setup([artifact('public-output'), hidden]);
  f.inputs.artifacts = [f.inputs.artifacts[0]];
  const value = ok(build(f));
  assert.equal(value.packet.entries.length, 1);
  assert.ok(!JSON.stringify(value).includes('PRIVATE-EXPIRED'));
});
