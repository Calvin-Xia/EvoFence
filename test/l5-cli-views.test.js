import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readKernelView, formatKernelView } from '../dist/lib/report/kernel-view.js';
import { readSessionReview as pi } from '../dist/hosts/pi/index.js';
import { readSessionReview as dsh } from '../dist/hosts/dsh/index.js';
import { COMMANDS } from '../dist/lib/cli/catalog.js';
import { openReviewExport } from '../dist/lib/cli/handlers/session.js';
import { harness, node, graph, value, bindingFor } from './l2-runtime-support.test.js';
import { edge } from './l2-scheduler-fixtures.mjs';
import { transition } from '../dist/runtime/session/journal.js';
import { makeReviewFixture, runReviewCli, ROOT, CLI, SECRETS } from './l5-cli-fixture.test.js';
import { assertCliOwnsNoClassification, assertSeven, assertPrivacy } from './l5-cli-invariants.test.js';
const unwrap = result => { assert.equal(result.ok, true, result.error?.code); return result.value; };

test('cp1: command is catalogued; whole CLI source owns zero state classification literals', () => {
  assertCliOwnsNoClassification();
  const spec = COMMANDS.find(s => s.name === 'session view');
  assert.ok(spec); assert.equal(spec.json, 'flag'); assert.deepEqual(spec.exits.map(e => e.code), [0, 1]);
  assert.equal(spec.namespace, 'evofence.runtime/1');
  assert.deepEqual(spec.flags.map(f => f.name), ['format', 'json', 'include-private']);
});
test('cp1/cp2: production read, CLI, Pi and DSH share a deeply equal seven-field projection', async () => {
  const f = await makeReviewFixture(), before = f.canonical(f.read()), calls = { ...f.calls };
  const expected = unwrap(readKernelView(f.source)); assertSeven(expected);
  const child = runReviewCli(f.bundle, ['--json']);
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), expected);
  assert.strictEqual(pi, readKernelView); assert.strictEqual(dsh, readKernelView);
  assert.deepEqual(unwrap(pi(f.source)), expected); assert.deepEqual(unwrap(dsh(f.source)), expected);
  assert.deepEqual(unwrap(readKernelView(openReviewExport(f.bundle))), expected);
  assert.equal(f.canonical(f.read()), before); assert.deepEqual(f.calls, calls, 'read executes zero host/clock/evaluator/policy calls');
  assert.deepEqual(expected.effects.nextEffects.map(e => e.effectId), unwrap(f.store.nextEffects(f.seed.sessionId)).map(e => e.effectId));
});
function decodeXml(text) {
  return text.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
}
for (const includePrivate of [false, true]) for (const format of ['text', 'json', 'sarif', 'junit']) {
  test(`cp2/cp3: CLI ${format}, references opt-in=${includePrivate}, preserves all fields without leaks`, async () => {
    const f = await makeReviewFixture(), expected = unwrap(readKernelView(f.source, { includePrivate }));
    const child = runReviewCli(f.bundle, [`--format=${format}`, ...(includePrivate ? ['--include-private'] : [])]);
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, ''); assertPrivacy(child.stdout + child.stderr);
    assert.equal(child.stdout, formatKernelView(expected, format));
    let view;
    if (format === 'text') view = JSON.parse(child.stdout.slice('EvoFence session review\n'.length));
    if (format === 'json') view = JSON.parse(child.stdout);
    if (format === 'sarif') view = JSON.parse(child.stdout).runs[0].properties.review;
    if (format === 'junit') {
      view = JSON.parse(decodeXml(child.stdout.match(/<system-out>([\s\S]*?)<\/system-out>/)[1]));
      assert.match(child.stdout, /failures="1" skipped="6"/);
      assert.match(child.stdout, /<testcase name="lost"[^>]+><skipped message="unknown"\/>/);
    }
    assert.deepEqual(view, expected); assertSeven(view);
    assert.equal(view.privateEvidence === null, !includePrivate);
    assert.equal('evidence' in view.decisions[0], includePrivate);
  });
}
test('cp3: absent, unreadable and invalid decision records and missing qualification context stay explicit gaps', async () => {
  const f = await makeReviewFixture();
  const source = { ...f.source, assetContext: null, decisionLinks: [{ purpose: 'stop', ref: null },
    { purpose: 'promotion', ref: { ...f.source.decisionLinks[0].ref, id: 'not-stored' } },
    { purpose: 'revocation', ref: f.privateRef }] };
  const view = unwrap(readKernelView(source));
  assert.deepEqual(view.decisions.map(d => [d.outcome, d.reasons, d.gap]), [[null, null, 'decision-record-missing'],
    [null, null, 'EFK_ARTIFACT_UNAVAILABLE'], [null, null, 'EFK_ARTIFACT_BINDING_MISMATCH']]);
  assert.equal(view.assets[0].qualification, null); assert.equal(view.assets[0].gap, 'qualification-context-missing');
});
test('cp3: private feedback and evaluator material stay withheld even with evidence opt-in', async () => {
  const f = await makeReviewFixture();
  const original = JSON.parse(unwrap(f.artifacts.get(f.source.decisionLinks[0].ref)));
  const privateDecision = f.persist('private-feedback', 'DecisionRecord', { ...original, feedbackVisibility: 'private',
    reasons: [SECRETS[0]] }, null, original.issuer);
  const source = { ...f.source, decisionLinks: [{ purpose: 'stop', ref: privateDecision }] };
  for (const includePrivate of [false, true]) {
    const view = unwrap(readKernelView(source, { includePrivate }));
    assert.equal(view.decisions[0].reasons, null); assert.equal(view.decisions[0].gap, 'private-feedback-withheld');
    for (const format of ['text', 'json', 'sarif', 'junit']) assertPrivacy(formatKernelView(view, format));
  }
});
test('cp3: sensitive ids inside structured frontier gaps are redacted in every format', () => {
  const f = harness({ spec: graph({ nodes: [node(SECRETS[1], { terminal: true }), node('depends', { terminal: true })],
    typedEdges: [edge('dependent', 'dependency', SECRETS[1], 'depends')] }) });
  const source = { service: f.service, seed: f.seed, artifacts: f.artifacts, registry: { revisions: [], history: [] },
    assetContext: null, decisionLinks: [], at: 1000 };
  const view = unwrap(readKernelView(source));
  assert.equal(view.frontier.blocked[0].readiness.gap.node, '[redacted]');
  for (const format of ['text', 'json', 'sarif', 'junit']) assertPrivacy(formatKernelView(view, format));
});
test('cp3: private reference metadata is withheld until opt-in, without exposing content', async () => {
  const f = await makeReviewFixture(), ref = { ...f.source.decisionLinks[0].ref, visibility: 'private' };
  const source = { ...f.source, decisionLinks: [{ purpose: 'stop', ref }] };
  assert.deepEqual(unwrap(readKernelView(source)).decisions[0].reference, { visibility: 'private', withheld: true });
  const opted = unwrap(readKernelView(source, { includePrivate: true }));
  assert.equal(opted.decisions[0].reference.digest, ref.digest);
  for (const format of ['text', 'json', 'sarif', 'junit']) assertPrivacy(formatKernelView(opted, format));
});
test('cp3: a later successful attempt retains prior failure; failed human is not an awaiting-human item', async () => {
  const f = await makeReviewFixture(), state = f.read();
  value(f.store.append({ sessionId: f.seed.sessionId, epoch: state.epoch, expectedRevision: state.revision,
    requestId: 'later-attempt', effects: [], receipts: [], events: [
      transition(state, 'later-attempt', 'repair', bindingFor(state, f.seed, 'bad', 2), null, 'succeeded'),
      transition(state, 'later-attempt', 'human', bindingFor(state, f.seed, 'human'), 'waiting', 'failed')] }));
  const view = unwrap(readKernelView(f.source));
  assert.deepEqual(view.requiredBranches[0].branches.find(b => b.nodeId === 'bad').attempts.map(a => a.state), ['failed', 'succeeded']);
  assert.ok(!view.waitingHuman.some(n => n.nodeId === 'human'));
  assert.equal(view.nodes.find(n => n.nodeId === 'human').state, 'failed');
});
test('cp3: malformed/secret-shaped input produces one safe JSON error with empty stdout', async () => {
  const f = await makeReviewFixture();
  for (const mutate of [b => { b.seed.policy = { secret: SECRETS[1] }; }, b => { b.seed.graph.nodes[0].nodeId = SECRETS[1]; },
    b => { b.session.events[2].sequence = 999; }, b => { b.extra = SECRETS[0]; }, b => { b.artifacts[0].bytes += SECRETS[2]; }]) {
    const bundle = structuredClone(f.bundle); mutate(bundle);
    const child = runReviewCli(bundle, ['--json']);
    assert.equal(child.status, 1); assert.equal(child.stdout, ''); assertPrivacy(child.stderr);
    const error = JSON.parse(child.stderr); assert.deepEqual(Object.keys(error), ['error']);
    assert.ok(error.error.code); assert.ok(error.error.message); assert.equal(error.error.details, undefined);
  }
});
test('cp1: help, unknown flags, conflicts, equals syntax and the fixed 0/1 query exit contract', async () => {
  const f = await makeReviewFixture();
  for (const flags of [['--json', '--bogus'], ['--json', '--format=text'], ['--format=json', '--include-private=yes']]) {
    const child = runReviewCli(f.bundle, flags); assert.equal(child.status, 1); assert.equal(child.stdout, '');
    assert.equal(JSON.parse(child.stderr).error.code, 'USAGE');
  }
  const help = spawnSync(process.execPath, [CLI, '--help'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(help.status, 0); assert.ok(help.stdout.includes(COMMANDS.find(s => s.name === 'session view').usage));
  assert.equal(runReviewCli(f.bundle, ['--json', '--format=json']).status, 0);
});
test('cp3: documented command recipes replay the catalog entry and actual formatter output', async () => {
  const doc = readFileSync(path.join(ROOT, 'docs/evofence-harness-kernel/L5-CLI-OBSERVABILITY-VIEWS.md'), 'utf8').replace(/\r\n/g, '\n');
  const spec = COMMANDS.find(s => s.name === 'session view'); assert.ok(doc.includes(`evofence ${spec.usage}`));
  const recipes = [...doc.matchAll(/```json cli-recipe\n([\s\S]*?)```/g)].map(m => JSON.parse(m[1]));
  assert.equal(recipes.length, 5);
  const f = await makeReviewFixture();
  for (const recipe of recipes) {
    assert.deepEqual(recipe.args.slice(0, 3), ['session', 'view', 'review.json']);
    const child = runReviewCli(f.bundle, recipe.args.slice(3)); assert.equal(child.status, recipe.exit);
    for (const text of recipe.contains) assert.ok(child.stdout.includes(text), text);
    assertPrivacy(child.stdout + child.stderr);
  }
});
