import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { task } from './l2-policy-fixtures.js';
import { createContextRouter, canonicalContext } from '../dist/learning/context/index.js';

const digest = { digest: text => `sha256:${createHash('sha256').update(text).digest('hex')}` };
// A real deterministic fixture tokenizer: one token per UTF-8 byte, not a provider estimate.
const tokenizer = { id: 'fixture:utf8-byte/v1', countTokens: text => new TextEncoder().encode(text).length };
const router = createContextRouter({ digest, tokenizer });
const binding = () => ({
  sessionId: 'session-1', hostSessionId: null,
  graph: { graphId: 'graph-1', revision: 2, digest: digest.digest('graph') },
  nodeId: 'router-node', attemptId: 'router-attempt', attemptOrdinal: 1, epoch: 1, baseDigest: digest.digest('base'),
});
function artifact(id, bytes, purpose = 'evidence', over = {}) {
  const ref = {
    protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' }, id, digest: digest.digest(bytes),
    producer: { actorId: 'producer-1', kind: 'kernel', identityRef: null },
    binding: { ...binding(), nodeId: 'producer-node', attemptId: 'producer-attempt' },
    schema: { name: 'Evidence', version: '1.1.0', digest: digest.digest('schema') },
    location: `artifact://${id}`, visibility: 'internal', partition: 'not-evaluation', expiresAt: null, ...over,
  };
  return { ref, bytes, purpose, expectation: { productKind: 'node-product', schema: ref.schema, binding: ref.binding } };
}
function setup(artifacts = [], taskOver = {}) {
  const contract = task(taskOver);
  return {
    contract,
    inputs: {
      contractRef: { taskId: contract.taskId, version: contract.version, digest: digest.digest(canonicalContext(contract)) },
      binding: binding(), nodeInputRefs: artifacts.map(a => a.ref), at: 100,
      plan: { inputRefs: artifacts.map(a => a.ref), maxTokens: 60000, preserveHostResources: true, isolation: 'fresh' },
      artifacts,
    },
    window: { windowTokens: 100000, reservedOutputTokens: 4096, hostInputTokens: 0, strategy: 'compact', excerptChars: 64 },
  };
}
function build(f, window = f.window) { return router.buildContextPacket(f.contract, 'executor', f.inputs, window); }
function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
function err(result, code) {
  assert.equal(result.ok, false, 'expected typed refusal');
  assert.equal(result.error.code, code);
}

test('packet is byte-identical across repeated calls and object key ordering', () => {
  const f = setup([artifact('proof-1', '真实运行证据')]);
  const before = canonicalContext(f);
  const first = ok(build(f));
  assert.deepEqual(ok(build(f)), first);
  const reordered = Object.fromEntries(Object.entries(f.contract).reverse());
  assert.deepEqual(ok(router.buildContextPacket(reordered, 'executor', f.inputs, f.window)), first);
  assert.equal(canonicalContext(f), before, 'the router never changes caller data');
  assert.equal(first.serialized, canonicalContext(first.packet));
  assert.equal(first.tokenCount, tokenizer.countTokens(first.serialized));
});

test('evidence and explicit handoff retain producer attempt, digest, visibility and audit reason', () => {
  const evidence = artifact('proof-1', 'test output');
  const handoff = artifact('handoff-1', 'next work', 'handoff');
  const value = ok(build(setup([evidence, handoff])));
  assert.deepEqual(value.packet.entries.map(e => e.ref.id), ['proof-1', 'handoff-1']);
  assert.equal(value.packet.entries[0].ref.digest, evidence.ref.digest);
  assert.equal(value.packet.entries[0].ref.visibility, 'internal');
  assert.equal(value.packet.entries[0].ref.binding.attemptId, 'producer-attempt');
  assert.deepEqual(value.packet.audit.filter(a => a.source === 'ContextPlan.inputRefs').map(a => a.reason), ['evidence', 'handoff']);
  assert.equal(value.packet.preserveHostResources, true);
  assert.equal(value.packet.isolation, 'fresh');
});

test('long-task compaction preserves every evidence link and audit while shortening only text', () => {
  const f = setup([artifact('proof-1', '证据🙂'.repeat(10000)), artifact('handoff-1', 'trace '.repeat(10000), 'handoff')]);
  f.inputs.plan.maxTokens = 12000;
  const value = ok(build(f));
  assert.equal(value.compressed, true);
  assert.ok(value.tokenCount <= 12000);
  assert.equal(value.packet.entries.length, 2);
  for (const [index, entry] of value.packet.entries.entries()) {
    assert.equal(entry.ref.digest, f.inputs.artifacts[index].ref.digest);
    assert.equal(entry.ref.id, f.inputs.artifacts[index].ref.id);
    assert.equal(entry.ref.visibility, f.inputs.artifacts[index].ref.visibility);
    assert.equal(value.packet.audit.find(a => a.ref.id === entry.ref.id).reason, entry.purpose);
    assert.equal(entry.mode, 'excerpt');
    assert.equal(entry.text, Array.from(f.inputs.artifacts[index].bytes).slice(0, 64).join(''));
  }
});

test('zero-character summary still carries full evidence references and audit, never silently drops a ref', () => {
  const f = setup([artifact('proof-1', 'huge '.repeat(20000))]);
  f.window.excerptChars = 0;
  f.inputs.plan.maxTokens = 6000;
  const value = ok(build(f));
  assert.equal(value.packet.entries[0].mode, 'reference');
  assert.equal(value.packet.entries[0].text, '');
  assert.equal(value.packet.entries[0].ref.id, 'proof-1');
  assert.equal(value.packet.audit.at(-1).ref.digest, f.inputs.artifacts[0].ref.digest);
});

test('token gate is inclusive at the measured boundary and refuses one token less with reject policy', () => {
  const f = setup([artifact('proof-1', 'output')]);
  const count = ok(build(f)).tokenCount;
  f.window.strategy = 'reject';
  f.inputs.plan.maxTokens = count;
  assert.equal(ok(build(f)).tokenCount, count);
  f.inputs.plan.maxTokens = count - 1;
  err(build(f), 'EFK_BUDGET_EXHAUSTED');
});

test('unfit mandatory task/references refuse instead of emitting a partial packet', () => {
  const f = setup([artifact('proof-1', 'text'.repeat(10000))]);
  f.inputs.plan.maxTokens = 1;
  err(build(f), 'EFK_BUDGET_EXHAUSTED');
});

test('host instructions, output reservation, node limit and task input ceiling all constrain the window', () => {
  const f = setup([artifact('proof-1', 'output')]);
  const count = ok(build(f)).tokenCount;
  f.window.strategy = 'reject';
  f.window.hostInputTokens = 200;
  f.window.windowTokens = count + 200 + 4096;
  assert.equal(ok(build(f)).tokenLimit, count);
  f.window.windowTokens -= 1;
  err(build(f), 'EFK_BUDGET_EXHAUSTED');
  f.window.windowTokens = 100000;
  const g = setup([artifact('proof-1', 'output')]);
  g.window.strategy = 'reject';
  const ceiling = ok(build(g)).tokenCount;
  g.window.hostInputTokens = 60000 - ceiling + 1;
  err(build(g), 'EFK_BUDGET_EXHAUSTED');
  g.window.reservedOutputTokens = 4097;
  err(build(g), 'EFK_BUDGET_EXHAUSTED');
});

test('human and host instructions survive compression verbatim and are charged including audit', () => {
  const human = artifact('human-instruction', 'human: preserve source', 'human-instruction', {
    producer: { actorId: 'human-1', kind: 'human', identityRef: artifact('identity', 'verified').ref },
  });
  const host = artifact('host-instruction', 'host: preserve tools', 'host-instruction', {
    producer: { actorId: 'host-1', kind: 'host-adapter', identityRef: null },
  });
  const f = setup([human, host, artifact('proof-1', 'long '.repeat(20000))]);
  f.inputs.plan.maxTokens = 16000;
  const value = ok(build(f));
  assert.equal(value.compressed, true);
  assert.deepEqual(value.packet.entries.slice(0, 2).map(e => [e.text, e.mode]), [[human.bytes, 'full'], [host.bytes, 'full']]);
  f.inputs.plan.maxTokens = 1;
  err(build(f), 'EFK_BUDGET_EXHAUSTED');
});

test('an instruction cannot manufacture human or host provenance with a purpose label', () => {
  for (const purpose of ['human-instruction', 'host-instruction']) {
    err(build(setup([artifact('fake', 'fake instructions', purpose)])), 'EFK_AUTHORITY_DENIED');
  }
});

test('packet construction invokes only injected pure digest/tokenizer functions and no host I/O', () => {
  let digests = 0;
  let counts = 0;
  const scoped = createContextRouter({
    digest: { digest: text => { digests++; return digest.digest(text); } },
    tokenizer: { id: tokenizer.id, countTokens: text => { counts++; return tokenizer.countTokens(text); } },
  });
  assert.equal(digests + counts, 0, 'construction is inert');
  const f = setup([artifact('proof-1', 'run output')]);
  ok(scoped.buildContextPacket(f.contract, 'executor', f.inputs, f.window));
  assert.equal(digests, 2, 'one contract digest and one visible artifact verification');
  assert.equal(counts, 1, 'one exact dispatch count');
});

test('a non-monotonic tokenizer is remeasured at each compaction candidate', () => {
  const f = setup([artifact('proof-1', 'x'.repeat(10000))]);
  const scoped = createContextRouter({ digest, tokenizer: {
    id: 'fixture:non-monotonic/v1', countTokens: text => {
      const length = JSON.parse(text).entries[0].text.length;
      return length === 32 ? 100 : 100000;
    },
  } });
  const value = ok(scoped.buildContextPacket(f.contract, 'executor', f.inputs, f.window));
  assert.equal(value.packet.entries[0].text.length, 32);
  assert.equal(value.tokenCount, 100);
});

test('invalid tokenizer telemetry refuses without a guessed count', () => {
  const f = setup();
  for (const count of [NaN, Infinity, -1, 0.5]) {
    const scoped = createContextRouter({ digest, tokenizer: { id: 'bad', countTokens: () => count } });
    err(scoped.buildContextPacket(f.contract, 'executor', f.inputs, f.window), 'EFK_SCHEMA_INVALID');
  }
});
