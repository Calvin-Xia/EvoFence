/**
 * `l2_graph_model` — bounded loops (example 7) and the pure predicate AST.
 *
 * Example 7's two claims are the tests: a loop's consumption is cumulative across iterations (never
 * per-round), and recovery resumes at the last settled boundary without replaying settled work. The
 * predicate half pins the `INTERFACES.md §4` rules — exact scalar comparison, no coercion, and a
 * missing or undeclared path never matching.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evalPredicate,
  exhaustedBound,
  loopBoundKinds,
  loopStop,
  outcomeEnv,
  readPath,
  resumeLoop,
  settleIteration,
  validatePredicate,
} from '../dist/kernel/graph/index.js';
import * as fx from './l2-graph-fixtures.mjs';

const zero = { iterations: 0, wallClockMs: 0, tokens: 0, usdMicros: 0 };
const delta = { wallClockMs: 1000, tokens: 500, usdMicros: 0 };

test('loopBoundKinds reports the declared bound kinds in declaration order', () => {
  assert.deepEqual(loopBoundKinds(fx.loop({ maxIterations: 3, maxWallClock: 60000 })), ['maxIterations', 'maxWallClock']);
  assert.deepEqual(loopBoundKinds(fx.loop({ maxIterations: 3, maxTokensOrCost: { tokens: 100, usdMicros: null } })), [
    'maxIterations',
    'maxTokensOrCost',
  ]);
});

test('example 7 — iteration consumption is cumulative, never reset per iteration', () => {
  const once = settleIteration(zero, delta);
  const twice = settleIteration(once, delta);
  assert.equal(once.iterations, 1);
  assert.equal(twice.iterations, 2);
  assert.equal(twice.tokens, 1000);
  assert.equal(twice.wallClockMs, 2000);
});

test('example 7 — recovery resumes at the settled boundary without replay', () => {
  const crashed = { iterations: 3, wallClockMs: 3000, tokens: 1500, usdMicros: 0 };
  const resumed = resumeLoop(crashed);
  assert.equal(resumed.iteration, 3);
  assert.deepEqual(resumed.progress, crashed);
  // Negative control: restarting from iteration 0 is the违约 the example names.
  assert.notEqual(resumed.iteration, 0);
});

test('example 7 — the token bound is the whole-loop total, not per iteration', () => {
  const loop = fx.loop({ maxIterations: 4, maxTokensOrCost: { tokens: 1000, usdMicros: null } });
  assert.equal(exhaustedBound(loop, { ...zero, iterations: 1, tokens: 999 }), null);
  assert.equal(exhaustedBound(loop, { ...zero, iterations: 2, tokens: 1000 }), 'maxTokensOrCost');
});

test('exhaustedBound reports the iteration bound and respects the USD alternative', () => {
  const loop = fx.loop({ maxIterations: 2, maxTokensOrCost: { tokens: null, usdMicros: 500 } });
  assert.equal(exhaustedBound(loop, { ...zero, iterations: 2 }), 'maxIterations');
  assert.equal(exhaustedBound(loop, { ...zero, iterations: 1, usdMicros: 500 }), 'maxTokensOrCost');
});

test('loopStop — bounds win, then body success, then an explicit irreparable failure', () => {
  const loop = fx.loop({ maxIterations: 2, maxWallClock: 60000, stop: ['body-success', 'bound-exhausted', 'irreparable-failure'] });
  assert.deepEqual(loopStop(loop, { ...zero, iterations: 2 }, { succeeded: true, irreparable: false }), {
    stop: 'bound-exhausted',
    bound: 'maxIterations',
  });
  assert.deepEqual(loopStop(loop, zero, { succeeded: true, irreparable: false }), { stop: 'body-success', bound: null });
  assert.deepEqual(loopStop(loop, zero, { succeeded: false, irreparable: true }), { stop: 'irreparable-failure', bound: null });
  assert.deepEqual(loopStop(loop, zero, { succeeded: false, irreparable: false }), { stop: 'continue' });
});

test('loopStop — a stop the loop did not declare cannot end it', () => {
  const loop = fx.loop({ maxIterations: 2, maxWallClock: 60000, stop: ['bound-exhausted'] });
  assert.deepEqual(loopStop(loop, zero, { succeeded: true, irreparable: false }), { stop: 'continue' });
});

test('predicate — eq/neq compare by exact scalar type with no coercion', () => {
  const env = outcomeEnv({ ok: true, reason: '', decision: 'completed' });
  assert.equal(evalPredicate(fx.predicate('eq', 'decision.outcome', 'completed'), env), true);
  assert.equal(evalPredicate(fx.predicate('neq', 'decision.outcome', 'repair'), env), true);
  assert.equal(evalPredicate(fx.predicate('eq', 'decision.outcome', 'repair'), env), false);
  assert.equal(evalPredicate(fx.predicate('eq', 'self.failed', true), env), false);
  assert.equal(evalPredicate(fx.predicate('eq', 'self.failed', 'false'), env), false);
});

test('predicate — a missing or undeclared path never matches', () => {
  const env = outcomeEnv({ ok: false, reason: 'x', decision: 'failed' });
  assert.equal(evalPredicate(fx.predicate('eq', 'self.absent', true), env), false);
  assert.equal(evalPredicate(fx.predicate('neq', 'self.absent', true), env), false);
  assert.equal(evalPredicate(fx.predicate('eq', 'host.brand', 'pi'), env), false);
  assert.equal(readPath('host.brand', env).ok, false);
  assert.equal(readPath('env.tool', env).ok, false);
  assert.deepEqual(readPath('env', env).value, {});
});

test('predicate — compound operators are all/any/not/true', () => {
  const env = outcomeEnv({ ok: false, reason: 'tool-unavailable', decision: 'failed' });
  const composite = fx.predicate('all', null, null, [
    fx.predicate('eq', 'self.failed', true),
    fx.predicate('eq', 'self.reason', 'tool-unavailable'),
  ]);
  assert.equal(evalPredicate(composite, env), true);
  assert.equal(evalPredicate(fx.predicate('not', null, null, [composite]), env), false);
  assert.equal(evalPredicate(fx.predicate('any', null, null, [fx.predicate('true'), composite]), env), true);
  assert.equal(evalPredicate(fx.predicate('true'), env), true);
});

test('predicate — a null value only matches a present null path', () => {
  const env = { outcome: null, reason: null, self: {}, decision: {}, env: {} };
  assert.equal(evalPredicate(fx.predicate('eq', 'outcome', null), env), true);
  assert.equal(evalPredicate(fx.predicate('neq', 'self.missing', null), env), false);
});

test('validatePredicate rejects malformed ASTs and accepts well-formed ones', () => {
  assert.equal(validatePredicate(fx.predicate('eq'), 'p').code, 'EFK_SCHEMA_INVALID');
  assert.equal(validatePredicate(fx.predicate('all', null, null, []), 'p').code, 'EFK_SCHEMA_INVALID');
  assert.equal(validatePredicate(fx.predicate('not', null, null, [fx.predicate('true'), fx.predicate('true')]), 'p').code, 'EFK_SCHEMA_INVALID');
  assert.equal(validatePredicate(fx.predicate('true', 'x'), 'p').code, 'EFK_SCHEMA_INVALID');
  assert.equal(validatePredicate(fx.predicate('true'), 'p'), null);
  assert.equal(validatePredicate(fx.predicate('eq', 'self.failed', true), 'p'), null);
});

test('outcomeEnv exposes exactly the predicates the spec allows', () => {
  const env = outcomeEnv({ ok: false, reason: 'boom', decision: 'failed' }, { hasTool: false });
  assert.deepEqual(env.self, { failed: true, reason: 'boom' });
  assert.deepEqual(env.decision, { outcome: 'failed' });
  assert.equal(env.outcome, 'failed');
  assert.equal(env.reason, 'boom');
  assert.deepEqual(env.env, { hasTool: false });
});
