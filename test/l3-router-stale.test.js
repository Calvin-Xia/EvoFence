import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { task } from './l2-policy-fixtures.js';
import { createContextRouter, canonicalContext } from '../dist/learning/context/index.js';

const digest = { digest: text => `sha256:${createHash('sha256').update(text).digest('hex')}` };
const router = createContextRouter({ digest, tokenizer: {
  id: 'fixture:utf8-byte/v1', countTokens: text => new TextEncoder().encode(text).length,
} });
function setup() {
  const contract = task();
  const binding = {
    sessionId: 'session-1', hostSessionId: null, graph: { graphId: 'graph-1', revision: 2, digest: digest.digest('graph') },
    nodeId: 'consumer-1', attemptId: 'consumer-attempt-1', attemptOrdinal: 1, epoch: 2, baseDigest: digest.digest('base'),
  };
  const bytes = 'actual test evidence';
  const ref = {
    protocol: contract.protocol, id: 'artifact-1', digest: digest.digest(bytes),
    producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null },
    binding: { ...structuredClone(binding), nodeId: 'producer-1', attemptId: 'producer-attempt-1' },
    schema: { name: 'Evidence', version: '1.1.0', digest: digest.digest('schema') },
    location: 'artifact://opaque-1', visibility: 'internal', expiresAt: null, partition: 'not-evaluation',
  };
  return {
    contract,
    inputs: {
      contractRef: { taskId: contract.taskId, version: 1, digest: digest.digest(canonicalContext(contract)) },
      binding, nodeInputRefs: [ref], at: 100,
      plan: { inputRefs: [ref], maxTokens: 60000, preserveHostResources: true, isolation: 'fresh' },
      artifacts: [{ ref, bytes, purpose: 'evidence', expectation: {
        productKind: 'node-product', schema: { ...ref.schema }, binding: structuredClone(ref.binding),
      } }],
    },
    window: { windowTokens: 100000, reservedOutputTokens: 4096, hostInputTokens: 0, strategy: 'compact', excerptChars: 64 },
  };
}
function build(f) { return router.buildContextPacket(f.contract, 'executor', f.inputs, f.window); }
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; }
function err(result, code) { assert.equal(result.ok, false, 'expected typed refusal'); assert.equal(result.error.code, code); return result.error; }

test('expiry is checked at the injected instant with an inclusive deadline', () => {
  const f = setup();
  f.inputs.artifacts[0].ref.expiresAt = 101;
  ok(build(f));
  f.inputs.at = 101;
  err(build(f), 'EFK_ARTIFACT_UNAVAILABLE');
});

test('old contract revision, task identity or digest refuses context before handoff', () => {
  for (const edit of [
    f => { f.contract.version = 2; }, f => { f.contract.taskId = 'other-task'; },
    f => { f.contract.goal = 'a revised goal at the same version'; },
  ]) {
    const f = setup();
    edit(f);
    err(build(f), 'EFK_SOURCE_PIN_DRIFT');
  }
});

test('producer binding mismatch cannot be hidden in a long-task summary', () => {
  for (const edit of [
    b => { b.sessionId = 'other-session'; }, b => { b.hostSessionId = 'old-host'; },
    b => { b.nodeId = 'old-producer'; }, b => { b.attemptId = 'old-attempt'; },
    b => { b.attemptOrdinal = 9; }, b => { b.epoch = 1; },
    b => { b.baseDigest = digest.digest('old-base'); }, b => { b.graph.revision = 1; },
    b => { b.graph.graphId = 'old-graph'; }, b => { b.graph.digest = digest.digest('old-graph'); },
  ]) {
    const f = setup();
    const item = f.inputs.artifacts[0];
    item.bytes = 'long evidence '.repeat(10000);
    item.ref.digest = digest.digest(item.bytes);
    edit(item.ref.binding);
    err(build(f), 'EFK_ARTIFACT_BINDING_MISMATCH');
  }
});

test('even a self-consistent old producer expectation cannot revive an old graph/base/epoch', () => {
  for (const edit of [
    b => { b.epoch = 1; }, b => { b.graph.revision = 1; },
    b => { b.baseDigest = digest.digest('old-base'); }, b => { b.hostSessionId = 'old-host'; },
  ]) {
    const f = setup();
    edit(f.inputs.artifacts[0].ref.binding);
    f.inputs.artifacts[0].expectation.binding = structuredClone(f.inputs.artifacts[0].ref.binding);
    err(build(f), 'EFK_ARTIFACT_BINDING_MISMATCH');
  }
});

test('an unbound pre-source may be consumed, a node product may not discard its binding', () => {
  const f = setup();
  f.inputs.artifacts[0].ref.binding = null;
  err(build(f), 'EFK_ARTIFACT_BINDING_MISMATCH');
  f.inputs.artifacts[0].expectation = { productKind: 'pre-source', schema: f.inputs.artifacts[0].ref.schema, binding: null };
  ok(build(f));
  const g = setup();
  g.inputs.artifacts[0].expectation.binding = null;
  err(build(g), 'EFK_SCHEMA_INVALID');
  g.inputs.artifacts[0].expectation.productKind = 'pre-source';
  err(build(g), 'EFK_ARTIFACT_BINDING_MISMATCH');
});

test('bytes and schema are verified, no supplied summary may stand in for a missing artifact', () => {
  const f = setup();
  f.inputs.artifacts[0].bytes = 'corrupted bytes';
  err(build(f), 'EFK_ARTIFACT_DIGEST_MISMATCH');
  const g = setup();
  g.inputs.artifacts[0].expectation.schema.version = '2';
  err(build(g), 'EFK_ARTIFACT_BINDING_MISMATCH');
  const h = setup();
  h.inputs.artifacts = [];
  err(build(h), 'EFK_ARTIFACT_UNAVAILABLE');
  const j = setup();
  delete j.inputs.artifacts[0].bytes;
  j.inputs.artifacts[0].summary = 'looks fine';
  err(build(j), 'EFK_SCHEMA_INVALID');
});

test('undeclared input, duplicate id and substitution at either declaration boundary fail closed', () => {
  const f = setup();
  f.inputs.nodeInputRefs = [];
  err(build(f), 'EFK_GRAPH_INPUT_STALE');
  const g = setup();
  g.inputs.plan.inputRefs = [];
  err(build(g), 'EFK_GRAPH_INPUT_STALE');
  const h = setup();
  h.inputs.artifacts.push(h.inputs.artifacts[0]);
  err(build(h), 'EFK_GRAPH_INPUT_STALE');
  const j = setup();
  j.inputs.artifacts[0].ref = { ...j.inputs.artifacts[0].ref, digest: digest.digest('substitute') };
  err(build(j), 'EFK_GRAPH_INPUT_STALE');
  const k = setup();
  k.inputs.plan.inputRefs = [{ ...k.inputs.plan.inputRefs[0], partition: 'train' }];
  err(build(k), 'EFK_GRAPH_INPUT_STALE');
});

test('downgrading only the hydrated held-out ref cannot bypass the declared provenance', () => {
  const f = setup();
  f.inputs.artifacts[0].ref.partition = 'held-out';
  f.inputs.artifacts[0].ref = { ...f.inputs.artifacts[0].ref, partition: 'train' };
  err(build(f), 'EFK_GRAPH_INPUT_STALE');
});

test('unknown/missing local fields and missing budgets are typed boundary refusals', () => {
  for (const edit of [
    f => { f.inputs.chat = 'inherited chat'; }, f => { delete f.inputs.at; },
    f => { f.window.strategy = 'silently-drop'; }, f => { delete f.window.hostInputTokens; },
    f => { f.window.excerptChars = -1; }, f => { f.window.windowTokens = NaN; },
    f => { f.inputs.plan.preserveHostResources = false; }, f => { f.inputs.plan.maxTokens = 0; },
    f => { f.inputs.artifacts[0].expectation.productKind = 'guess-latest'; },
    f => { delete f.contract.budget; }, f => { f.contract.unknown = true; },
  ]) {
    const f = setup();
    edit(f);
    err(build(f), 'EFK_SCHEMA_INVALID');
  }
  const f = setup();
  err(router.buildContextPacket(f.contract, 'executor', null, f.window), 'EFK_SCHEMA_INVALID');
  err(router.buildContextPacket(f.contract, 'executor', f.inputs, null), 'EFK_SCHEMA_INVALID');
});

test('public contract references expire too, and receive audit links without loading their contents', () => {
  const f = setup();
  const publicRef = structuredClone(f.inputs.artifacts[0].ref);
  publicRef.id = 'public-check';
  publicRef.expiresAt = 101;
  f.contract.acceptance.checkRefs = [publicRef];
  f.inputs.contractRef.digest = digest.digest(canonicalContext(f.contract));
  const value = ok(build(f));
  assert.equal(value.packet.audit.find(a => a.ref.id === 'public-check').source, 'TaskContract');
  f.inputs.at = 101;
  err(build(f), 'EFK_ARTIFACT_UNAVAILABLE');
});
