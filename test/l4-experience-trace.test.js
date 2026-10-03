import test from 'node:test';
import assert from 'node:assert/strict';
import { extractExperience, generationPrompt, proposeDeterministically } from '../dist/learning/proposals/index.js';
import { fixture, limits, value, rejected, digest } from './l4-experience-fixtures.test.js';

test('cp1 extracts bounded success/failure patterns with exact source-line byte pins', () => {
  const f = fixture(), experience = f.experience();
  assert.equal(experience.traces.length, 1); assert.equal(experience.traces[0].events.length, 4);
  assert.equal(experience.patterns.length, 2);
  const check = experience.patterns.find(p => p.facet === 'visible-check');
  assert.deepEqual([check.successes[0].line, check.failures[0].line], [2, 1]);
  assert.equal(check.successes[0].eventDigest, digest.digest(JSON.stringify(f.rows[1])));
  assert.equal(check.successes[0].traceDigest, f.ref.digest);
  assert.ok(Object.isFrozen(experience.patterns));
  assert.equal(generationPrompt(experience).includes('FINAL_SENTINEL'), false);
  assert.equal(JSON.stringify(experience).includes('FINAL_SENTINEL'), false);
});

test('DoD2 rejects final/held-out/private trace axes before any store reads', () => {
  const f = fixture(); let reads = 0;
  const ports = { ...f.ports, artifacts: { get() { reads++; throw Error('restricted trace read'); } } };
  for (const overrides of [{ partition: 'final' }, { partition: 'held-out' }, { visibility: 'private' },
    { visibility: 'final' }, { visibility: 'held-out' }]) {
    const selection = f.selection({ ...f.ref, ...overrides });
    const error = rejected(extractExperience([f.selections[0], selection], limits, 1000, ports), 'EFK_SCHEMA_INVALID');
    assert.ok(!JSON.stringify(error).includes('FINAL_SENTINEL'));
    // Distinct IDs exercise privacy rather than duplicate-selection validation.
    rejected(extractExperience([f.selection({ ...f.ref, id: 'restricted', ...overrides })], limits, 1000, ports), 'EFK_PRIVACY_VIOLATION');
  }
  assert.equal(reads, 0);
});

test('DoD2 preflights every selected trace before reading an earlier visible trace', () => {
  const f = fixture(); let reads = 0;
  const selection = f.selection({ ...f.ref, id: 'final-source', partition: 'final' });
  rejected(extractExperience([f.selections[0], selection], limits, 1000,
    { ...f.ports, artifacts: { get() { reads++; throw Error('read before privacy gate'); } } }), 'EFK_PRIVACY_VIOLATION');
  assert.equal(reads, 0);
});

test('cp1 train-only inputs refuse dev/not-evaluation and missing visibility or scope', () => {
  const f = fixture();
  for (const partition of ['dev', 'not-evaluation']) rejected(extractExperience(
    [f.selection({ ...f.ref, partition })], limits, 1000, f.ports), 'EFK_EVALUATION_PROTOCOL_MISMATCH');
  for (const overrides of [{ whyVisible: '' }, { grade: 'pretend-live' }, { scope: { projectId: 'only-one' } }]) {
    rejected(extractExperience([f.selection(f.ref, overrides)], limits, 1000, f.ports), 'EFK_SCHEMA_INVALID');
  }
});

test('cp1 refuses malformed JSONL, missing/expired evidence and wrong source digest', () => {
  const f = fixture();
  const malformed = f.artifact('{invalid\n');
  rejected(extractExperience([f.selection(malformed)], limits, 1000, f.ports), 'EFK_SCHEMA_INVALID');
  rejected(extractExperience([f.selection({ ...f.ref, expiresAt: 1000 })], limits, 1000, f.ports), 'EFK_ARTIFACT_UNAVAILABLE');
  rejected(extractExperience([f.selection({ ...f.ref, id: 'missing', location: 'missing' })], limits, 1000, f.ports), 'EFK_ARTIFACT_UNAVAILABLE');
  rejected(extractExperience(f.selections, limits, 1000,
    { ...f.ports, artifacts: { get: () => ({ ok: true, value: 'different bytes' }) } }), 'EFK_ARTIFACT_DIGEST_MISMATCH');
});

test('DoD2 rejects restricted event labels inside an otherwise visible source', () => {
  for (const row of [{ type: 'check', label: 'FINAL_SENTINEL', code: 0, partition: 'final' },
    { type: 'check', label: 'FINAL_SENTINEL', code: 0, visibility: 'private' }]) {
    const f = fixture({ rows: [row] });
    const error = rejected(extractExperience(f.selections, limits, 1000, f.ports), 'EFK_PRIVACY_VIOLATION');
    assert.equal(JSON.stringify(error).includes('FINAL_SENTINEL'), false);
  }
});

test('cp1 finite trace/event/pattern/label limits refuse overflow rather than truncating evidence', () => {
  const f = fixture();
  for (const override of [{ maxTraceBytes: 1 }, { maxEvents: 1 }, { maxPatterns: 1 }, { maxTextChars: 2 }]) {
    rejected(extractExperience(f.selections, { ...limits, ...override }, 1000, f.ports), 'EFK_SCHEMA_INVALID');
  }
  for (const override of [{ maxEvents: Infinity }, { maxTraces: 0 }, { maxGenerationMicros: -1 }, { maxOutputTokens: 1.5 }]) {
    rejected(extractExperience(f.selections, { ...limits, ...override }, 1000, f.ports), 'EFK_SCHEMA_INVALID');
  }
  rejected(extractExperience([], limits, 1000, f.ports), 'EFK_SCHEMA_INVALID');
});

test('cp1 separates host/model/task scopes and never turns a single success into a candidate', () => {
  const f = fixture({ rows: [{ type: 'check', label: 'single success', code: 0 }] });
  rejected(proposeDeterministically(f.experience(), f.ports), 'EFK_CAPABILITY_EVIDENCE_INSUFFICIENT');
  const failure = f.artifact(JSON.stringify({ type: 'check', label: 'other host fails', code: 1 }));
  const experience = value(extractExperience([...f.selections, f.selection(failure,
    { scope: { ...f.selections[0].scope, hostId: 'other-host' } })], limits, 1000, f.ports));
  assert.equal(experience.patterns.length, 2);
  rejected(proposeDeterministically(experience, f.ports), 'EFK_CAPABILITY_EVIDENCE_INSUFFICIENT');
});
