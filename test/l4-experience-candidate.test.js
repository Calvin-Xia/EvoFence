import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeDeterministically, verifyCandidates, collectGeneration, dispatchGeneration, prepareGeneration, generationPrompt } from '../dist/learning/proposals/index.js';
import { bindDrafts } from '../dist/learning/proposals/candidate.js';
import { fixture, limits, value, rejected, draftOf, modelFixture, digest } from './l4-experience-fixtures.test.js';

test('cp2 deterministic CandidateSpecs bind hypotheses, exact scope, counterexamples, finite bounds and zero model usage', () => {
  const f = fixture(), experience = f.experience();
  const candidates = value(proposeDeterministically(experience, f.ports));
  assert.equal(candidates.length, 2);
  for (const candidate of candidates) {
    assert.equal(candidate.qualification, 'staged'); assert.equal(candidate.claim, 'conditional-hypothesis');
    assert.deepEqual(candidate.scope, experience.traces[0].scope); assert.equal(candidate.sourceTraces[0].digest, f.ref.digest);
    assert.equal(candidate.support[0].outcome, 'success'); assert.equal(candidate.counterexamples[0].event.outcome, 'failure');
    assert.ok(candidate.conditions.length > 0); assert.ok(candidate.hypothesis.measurement.includes('unproved'));
    assert.deepEqual(candidate.generation, { method: 'deterministic', requests: 0, estimatedUsdMicros: 0, usage: [] });
    assert.ok(Buffer.byteLength(JSON.stringify(candidate)) <= limits.maxCandidateBytes);
    assert.ok(Object.isFrozen(candidate)); assert.ok(Object.isFrozen(candidate.support));
  }
  assert.deepEqual(value(verifyCandidates(candidates, experience, 1000, f.ports)), candidates);
  assert.deepEqual(f.candidates(), candidates);
});

test('cp3 refuses fabricated source lines, cross-pattern support and success disguised as a counterexample', () => {
  const f = fixture(), experience = f.experience(), [candidate] = f.candidates();
  for (const mutate of [draft => { draft.support[0].line = 999; }, draft => { draft.support[0].eventDigest = digest.digest('fake'); },
    draft => { draft.counterexamples[0].event = draft.support[0]; }, draft => { draft.patternId = 'invented'; },
    draft => { draft.support[0].traceId = 'invented'; }, draft => { draft.support[0] = experience.patterns.find(p => p.patternId !== draft.patternId).successes[0]; }]) {
    const draft = structuredClone(draftOf(candidate)); mutate(draft);
    rejected(bindDrafts([draft], experience, candidate.generation, f.ports), 'EFK_ARTIFACT_BINDING_MISMATCH');
  }
});

test('cp2 rejects unbounded or malformed drafts and proposals with no real counterexample', () => {
  const f = fixture(), experience = f.experience(), [candidate] = f.candidates();
  for (const mutate of [draft => { draft.conditions = []; }, draft => { draft.counterexamples = []; },
    draft => { draft.support = []; }, draft => { draft.qualification = 'promoted'; }, draft => { draft.hypothesis = 'always succeeds'; },
    draft => { draft.hypothesis.measurement = ''; }, draft => { draft.content = 'x'.repeat(limits.maxTextChars + 1); }]) {
    const draft = structuredClone(draftOf(candidate)); mutate(draft);
    rejected(bindDrafts([draft], experience, candidate.generation, f.ports), 'EFK_SCHEMA_INVALID');
  }
  rejected(bindDrafts([], experience, candidate.generation, f.ports), 'EFK_SCHEMA_INVALID');
  const small = fixture({ limits: { maxCandidateBytes: 1 } });
  rejected(proposeDeterministically(small.experience(), small.ports), 'EFK_SCHEMA_INVALID');
});

test('cp3 rejects changed content, unverified cost and stale/unavailable source pins', () => {
  const f = fixture(), experience = f.experience(), [candidate] = f.candidates();
  for (const mutate of [c => { c.content = 'different'; }, c => { c.generation.estimatedUsdMicros = 90; },
    c => { c.scope.hostId = 'different'; }, c => { c.sourceTraces = []; }, c => { c.limits.maxGenerationMicros *= 2; }]) {
    const changed = structuredClone(candidate); mutate(changed);
    rejected(verifyCandidates([changed], experience, 1000, f.ports), 'EFK_ARTIFACT_DIGEST_MISMATCH');
  }
  rejected(verifyCandidates([candidate], experience, 1000, { ...f.ports,
    artifacts: { get: () => ({ ok: false, error: { code: 'EFK_ARTIFACT_UNAVAILABLE', message: 'gone' } }) } }), 'EFK_ARTIFACT_UNAVAILABLE');
});

test('cp2/cp3 model generation follows committed host effect, reservation, applied receipt and exact usage settlement', async () => {
  const m = await modelFixture();
  const candidates = value(collectGeneration(m.experience, m.plan, m.h.seed.sessionId, m.effect.effectId, 1000, m.ports));
  assert.equal(candidates.length, 2); assert.equal(m.h.calls.execute, 1); assert.equal(m.h.calls.evaluate, 0);
  assert.equal(m.h.read().budget.reservations.length, 0); assert.equal(m.h.read().budget.settlements[0].micros, 37);
  for (const candidate of candidates) {
    assert.equal(candidate.generation.method, 'host-effect'); assert.equal(candidate.generation.requests, 1);
    assert.equal(candidate.generation.estimatedUsdMicros, 37); assert.equal(candidate.generation.reservedMicros, 100);
    assert.equal(candidate.generation.grade, 'native-fixture'); assert.equal(candidate.generation.usage[0].source, 'synthetic');
  }
  assert.deepEqual(value(collectGeneration(m.experience, m.plan, m.h.seed.sessionId, m.effect.effectId, 1000, m.ports)), candidates);
  assert.equal(m.h.read().budget.settlements.length, 1); assert.equal(m.h.calls.execute, 1);
  const model = { plan: m.plan, collector: m.ports, sessionId: m.h.seed.sessionId, effectId: m.effect.effectId };
  value(verifyCandidates([candidates[0]], m.experience, 1000, m.ports, model));
  rejected(verifyCandidates([candidates[0]], m.experience, 1000, m.ports), 'EFK_USAGE_INCOMPLETE');
});

test('cp3 missing usage retains reservation and never becomes a free model candidate', async () => {
  for (const options of [{ noUsage: true }, { usage: { complete: false, estimatedUsdMicros: 0 } }]) {
    const m = await modelFixture(options);
    rejected(collectGeneration(m.experience, m.plan, m.h.seed.sessionId, m.effect.effectId, 1000, m.ports), 'EFK_USAGE_INCOMPLETE');
    assert.equal(m.h.read().budget.reservations[0].reservedMicros, 100); assert.equal(m.h.read().budget.settlements.length, 0);
  }
});

test('cp3 unknown/failed effects cannot produce candidates or trigger another host request', async () => {
  for (const status of ['unknown', 'failed']) {
    const m = await modelFixture({ status });
    rejected(collectGeneration(m.experience, m.plan, m.h.seed.sessionId, m.effect.effectId, 1000, m.ports), 'EFK_EFFECT_UNKNOWN');
    assert.equal(m.h.calls.execute, 1); assert.equal(m.h.calls.evaluate, 0);
  }
});

test('cp3 actual overspend and token overflow stay metered but prevent staging', async () => {
  for (const usage of [{ estimatedUsdMicros: 101 }, { output: 4097, total: 4107 }]) {
    const m = await modelFixture({ usage });
    rejected(collectGeneration(m.experience, m.plan, m.h.seed.sessionId, m.effect.effectId, 1000, m.ports), 'EFK_BUDGET_EXHAUSTED');
    assert.equal(m.h.read().budget.reservations.length, 0);
    assert.equal(m.h.read().budget.settlements[0].micros, usage.estimatedUsdMicros ?? 37);
  }
});

test('cp2 exact prompt projection and full host input obey the finite token envelope', () => {
  const f = fixture(), experience = f.experience(), prompt = generationPrompt(experience);
  const ref = f.artifact(prompt, { schema: { ...f.ref.schema, name: 'CandidateGenerationInput' } });
  rejected(prepareGeneration(experience, ref, { count: () => limits.maxInputTokens, hostInputTokens: 1 }, f.ports), 'EFK_BUDGET_EXHAUSTED');
  rejected(prepareGeneration(experience, { ...ref, digest: digest.digest('other') }, { count: () => 10, hostInputTokens: 0 }, f.ports), 'EFK_ARTIFACT_BINDING_MISMATCH');
  const plan = value(prepareGeneration(experience, ref, { count: () => 10, hostInputTokens: 0 }, f.ports));
  assert.equal(plan.operation.kind, 'host.agent'); assert.equal(plan.operation.payload.context.isolation, 'fresh');
});

test('cp3 malformed model output and invented model counterexamples reject after usage is settled', async () => {
  const malformed = await modelFixture({ rawOutput: '{invalid' });
  rejected(collectGeneration(malformed.experience, malformed.plan, malformed.h.seed.sessionId, malformed.effect.effectId, 1000, malformed.ports), 'EFK_SCHEMA_INVALID');
  const invented = await modelFixture({ drafts: drafts => { drafts[0].counterexamples[0].event.line = 999; return drafts; } });
  rejected(collectGeneration(invented.experience, invented.plan, invented.h.seed.sessionId, invented.effect.effectId, 1000, invented.ports), 'EFK_ARTIFACT_BINDING_MISMATCH');
  assert.equal(invented.h.read().budget.settlements[0].micros, 37);
});

test('cp2 dispatchGeneration uses the existing committed reservation and HostPort exactly once', async () => {
  const m = await modelFixture({ deferDispatch: true });
  assert.equal(m.h.calls.execute, 0); assert.equal(m.h.read().budget.reservations.length, 1);
  const candidates = value(await dispatchGeneration(m.experience, m.plan, m.h.seed, m.effect.effectId, 1000, m.ports));
  assert.equal(candidates.length, 2); assert.equal(m.h.calls.execute, 1);
  rejected(await dispatchGeneration(m.experience, m.plan, m.h.seed, m.effect.effectId, 1000, m.ports), 'EFK_EFFECT_NON_IDEMPOTENT_RETRY');
  assert.equal(m.h.calls.execute, 1);
});

test('cp2 pre-dispatch token/reservation/source gates prevent any host request', async () => {
  for (const change of [m => ({ ...m.h.seed, policy: { ...m.h.seed.policy, maxOutputTokens: 4097 } }),
    m => ({ ...m.h.seed, operations: { learner: { ...m.plan.operation, kind: 'host.tool' } } })]) {
    const m = await modelFixture({ deferDispatch: true });
    assert.equal((await dispatchGeneration(m.experience, m.plan, change(m), m.effect.effectId, 1000, m.ports)).ok, false);
    assert.equal(m.h.calls.execute, 0); assert.equal(m.h.read().budget.reservations.length, 1);
  }
});

test('cp3 a later complete receipt reconciles incomplete usage without a fresh request or a zero charge', async () => {
  const m = await modelFixture({ usage: { complete: false, estimatedUsdMicros: 0 } });
  const previous = Object.values(m.h.read().receipts)[0];
  const complete = { ...previous, receiptId: 'later-complete', usage: [{ ...previous.usage[0], complete: true, estimatedUsdMicros: 37 }] };
  value(m.h.service.receive(m.h.seed.sessionId, complete));
  const candidates = value(collectGeneration(m.experience, m.plan, m.h.seed.sessionId, m.effect.effectId, 1000, m.ports));
  assert.equal(candidates[0].generation.estimatedUsdMicros, 37); assert.equal(m.h.calls.execute, 1);
  assert.equal(m.h.read().budget.reservations.length, 0); assert.equal(m.h.read().budget.settlements.length, 1);
});
