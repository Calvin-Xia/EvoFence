import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../dist/kernel/store/index.js';
import { retrieveContext, recordUsage } from '../dist/learning/retrieval/index.js';
import { fixture, unwrap } from './l4-retrieval-fixtures.test.js';

test('cp2 candidate reuses bounded context packet, audit and declared node input shape', t => {
  const f = fixture(); f.add('experience', 'check the failing reproduction before editing');
  const result = f.retrieve(), candidate = result.candidate;
  assert.equal(result.mode, 'candidate');
  assert.equal(candidate.context, result.context);
  assert.equal(result.context.serialized, canonical(result.context.packet));
  assert.equal(result.context.tokenizerId, f.ports.tokenizer.id);
  assert.equal(result.context.packet.preserveHostResources, true);
  assert.equal(result.context.packet.binding.nodeId, 'retrieval-node');
  assert.equal(result.context.packet.entries[0].text, f.input.materials[0].bytes);
  assert.equal(result.context.packet.entries[0].ref.location, undefined);
  assert.equal(result.context.packet.audit.at(-1).source, 'ContextPlan.inputRefs');
  assert.equal(result.attribution[0].retrieved, true);
  assert.equal(result.attribution[0].disposition, 'pending');
  assert.equal(f.input.baseInputs.plan.inputRefs.length, 0);
  assert.equal(f.input.registry.history.at(-1).state, 'promoted');
  t.diagnostic(JSON.stringify({ evidenceLevel: 'synthetic-fixture', candidate, attribution: result.attribution, cost: result.cost }));
});

test('cp2 usage feedback records used and ignored with reasons without assuming retrieved means used', () => {
  const f = fixture(); f.add('applied', 'first'); f.add('unused', 'second');
  const result = f.retrieve(), before = canonical(result);
  assert.ok(result.attribution.every(a => a.disposition === 'pending'));
  const value = unwrap(recordUsage(result, result.candidate.assets.map(asset => ({ asset,
    disposition: asset.assetId === 'applied' ? 'used' : 'ignored',
    reason: asset.assetId === 'applied' ? 'reported in adopted repair path' : 'executor chose baseline strategy' }))));
  assert.equal(value.attribution.find(a => a.asset.assetId === 'applied').disposition, 'used');
  assert.equal(value.attribution.find(a => a.asset.assetId === 'unused').disposition, 'ignored');
  assert.ok(value.attribution.every(a => a.feedbackReason.length > 0));
  assert.equal(canonical(result), before);
  assert.deepEqual(value.cost, result.cost);
});

test('cp2 feedback refuses missing, duplicate, unselected and reason-free reports', () => {
  const f = fixture(); f.add('one', '1'); f.add('two', '22'); f.add('clipped', '333');
  f.input.budget.maxAssets = 2;
  const result = f.retrieve(), [one, two] = result.candidate.assets;
  const report = asset => ({ asset, disposition: 'used', reason: 'reported adopted' });
  for (const feedback of [[], [report(one), report(one)], [report(one), report({ ...two, assetId: 'unknown' })],
    [report(one), { ...report(two), reason: ' ' }], [report(one), { ...report(two), disposition: 'active' }],
    [report(one), report(result.attribution.find(a => a.asset.assetId === 'clipped').asset)]]) {
    assert.equal(recordUsage(result, feedback).error.code, 'EFK_SCHEMA_INVALID');
  }
});

test('DoD2 empty registry returns exact base execution with reproducible non-free overhead', () => {
  const f = fixture();
  const measured = [], native = f.ports.tokenizer;
  f.ports.tokenizer = { id: native.id, countTokens(text) { const count = native.countTokens(text); measured.push(count); return count; } };
  const result = f.retrieve();
  assert.equal(result.mode, 'base'); assert.equal(result.candidate, null);
  assert.equal(result.fallbackReason, 'no-eligible-assets');
  assert.equal(result.cost.tokenizerCalls, measured.length);
  assert.equal(result.cost.tokensCounted, measured.reduce((a, b) => a + b, 0));
  assert.ok(result.cost.tokensCounted > 0);
  assert.deepEqual(result.context, f.baseline());
  assert.equal(result.cost.baselineInputTokens, result.context.tokenCount);
  assert.equal(result.cost.candidateInputTokens, result.context.tokenCount);
  assert.equal(result.cost.inputTokenDelta, 0); assert.equal(result.cost.chargedAddedTokens, 0);
  assert.equal(result.cost.qualificationQueries, 0); assert.equal(result.cost.modelRequests, 0);
  assert.equal(result.cost.usdMicros, null); assert.equal(result.cost.wallMs, null);
  assert.deepEqual(unwrap(recordUsage(result, [])), result);
});

test('cp2 computational overhead includes ignored trial packets and token delta includes links and audit', () => {
  const f = fixture(); f.add('experience', '正文🙂');
  const measured = [], native = f.ports.tokenizer;
  f.ports.tokenizer = { id: native.id, countTokens(text) { const count = native.countTokens(text); measured.push(count); return count; } };
  const result = f.retrieve();
  assert.equal(result.cost.tokenizerCalls, measured.length);
  assert.equal(result.cost.tokensCounted, measured.reduce((a, b) => a + b, 0));
  assert.equal(result.attribution[0].contentTokens, native.countTokens(f.input.materials[0].bytes));
  assert.ok(result.cost.chargedAddedTokens > result.attribution[0].contentTokens);
  assert.equal(result.cost.inputTokenDelta, result.context.tokenCount - result.cost.baselineInputTokens);
  assert.equal(result.cost.materialReads, 2); assert.equal(result.cost.qualificationQueries, 1);
  measured.length = 0; f.input.budget.maxAddedTokens = 0;
  const ignored = f.retrieve();
  assert.equal(ignored.mode, 'base'); assert.equal(ignored.cost.inputTokenDelta, 0);
  assert.equal(ignored.cost.tokenizerCalls, measured.length);
  assert.equal(ignored.cost.tokensCounted, measured.reduce((a, b) => a + b, 0));
  assert.ok(ignored.cost.tokenizerCalls >= 3);
});

test('cp2 router compression and host window limits are preserved, including reference-only entries', () => {
  const f = fixture(); f.add('large', 'training '.repeat(20000));
  f.input.window.strategy = 'compact'; f.input.window.excerptChars = 0;
  const result = f.retrieve();
  assert.equal(result.context.compressed, true);
  assert.equal(result.context.packet.entries[0].mode, 'reference');
  assert.equal(result.context.packet.entries[0].text, '');
  assert.equal(result.attribution[0].disposition, 'pending');
  assert.ok(result.context.tokenCount <= result.context.tokenLimit);
  f.input.window.windowTokens = f.baseline().tokenCount + f.input.window.hostInputTokens + f.input.window.reservedOutputTokens;
  const clipped = f.retrieve();
  assert.equal(clipped.mode, 'base'); assert.equal(clipped.fallbackReason, 'no-assets-fit');
  assert.deepEqual(clipped.attribution[0].reasons, ['context-window-budget']);
});

test('cp2 a non-monotonic tokenizer retains the signed delta and never invents a negative charge', () => {
  const f = fixture(); f.add('experience', 'x');
  f.ports.tokenizer = { id: 'fixture:non-monotonic/v1', countTokens(text) {
    return text.startsWith('{') ? JSON.parse(text).entries.length === 0 ? 5000 : 4000 : 1;
  } };
  f.input.budget.maxAddedTokens = 0;
  const result = f.retrieve();
  assert.equal(result.mode, 'candidate'); assert.equal(result.cost.inputTokenDelta, -1000);
  assert.equal(result.cost.chargedAddedTokens, 0);
});

test('cp2 invalid ranking tokenizer telemetry refuses without a guessed token cost', () => {
  const f = fixture(); f.add('experience', 'x');
  for (const bad of [NaN, Infinity, -1, 0.5]) {
    const ports = { ...f.ports, tokenizer: { id: 'fixture:bad/v1', countTokens(text) {
      return text.startsWith('{') ? f.ports.tokenizer.countTokens(text) : bad;
    } } };
    assert.equal(retrieveContext(f.input, ports).error.code, 'EFK_SCHEMA_INVALID');
  }
});
