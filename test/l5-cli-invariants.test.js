import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SECRETS, ROOT } from './l5-cli-fixture.test.js';
const ts = createRequire(import.meta.url)('typescript6');

/** Read production CLI source. Types/comments/prose are not state classification literals. */
export function assertCliOwnsNoClassification(directory = path.join(ROOT, 'src/lib/cli')) {
  const vocabulary = new Set(['pending', 'ready', 'leased', 'running', 'verifying', 'succeeded', 'failed',
    'waiting', 'unknown', 'cancelling', 'cancelled', 'inconclusive']);
  const found = [];
  function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (file.endsWith('.ts')) {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        function scan(n) {
          if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && vocabulary.has(n.text)) found.push([file, n.text]);
          ts.forEachChild(n, scan);
        }
        scan(source);
      }
    }
  }
  walk(directory);
  assert.deepEqual(found, [], 'CLI must contain zero domain classification literals');
}
export function assertUnknown(view) {
  assert.deepEqual(view.effects.unknown.map(e => e.effectId), ['effect:plan-1:n0', 'effect:plan-1:n1']);
  assert.ok(view.effects.unknown.every(e => e.status === 'unknown'));
  assert.equal(view.nodes.find(n => n.nodeId === 'lost').state, 'unknown');
  assert.equal(view.decisions.find(d => d.purpose === 'stop').outcome, 'unknown');
}
export function assertBranches(view) {
  assert.deepEqual(view.requiredBranches[0].requiredBranches, ['bad', 'cancelled', 'done', 'lost']);
  assert.deepEqual(view.requiredBranches[0].branches.map(b => [b.nodeId, b.state]),
    [['bad', 'failed'], ['cancelled', 'cancelled'], ['done', 'succeeded'], ['lost', 'unknown']]);
  assert.equal(view.nodes.find(n => n.nodeId === 'bad').state, 'failed');
  assert.equal(view.nodeStates.find(n => n.nodeId === 'cancelled').state, 'cancelled');
}
export function assertPrivacy(text) {
  for (const secret of SECRETS) assert.ok(!text.includes(secret), 'surface contains synthetic sensitive material');
  assert.ok(!text.includes('fixture-evaluator'), 'evaluator identity must stay private');
  assert.ok(!text.includes('PrivateEvidence') || text.includes('referencesOnly'), 'private evidence needs explicit opt-in');
}
export function assertSeven(view) {
  assert.equal(view.graph.revision, 1); assert.equal(view.revision, 7);
  assert.deepEqual(view.frontier.ready.map(e => e.nodeId), ['ready']);
  assert.deepEqual(view.frontier.unknown.map(e => e.nodeId), ['lost', 'lost-again']);
  assert.deepEqual(view.frontier.blocked.map(e => e.nodeId), ['bad', 'human', 'join']);
  assert.equal(view.usage.unit, 'micro-USD'); assert.equal(view.usage.settledMicros, 37);
  assert.equal(view.usage.outstandingMicros, 100); assert.equal(view.usage.outstandingCount, 1);
  assert.equal(view.usage.reservations[0].requestId, 'node1:a1:e1');
  assert.equal(view.usage.settlements[0].micros, 37);
  assert.equal(view.usage.measurements[0].invoiceUsdMicros, null);
  assertUnknown(view); assertBranches(view);
  assert.deepEqual(view.effects.nextEffects, [{ effectId: 'timer-future', kind: 'timer.wait', nodeId: 'ready', status: 'intended' }]);
  assert.equal(view.assets[0].assetId, 'strategy'); assert.equal(view.assets[0].revision, 1);
  assert.equal(view.assets[0].sourceTraces[0].partition, 'train');
  assert.equal(view.assets[0].qualification.state, 'promoted'); assert.equal(view.assets[0].qualification.eligible, true);
  assert.equal(view.assets[0].qualification.usable, false);
  assert.ok(view.waitingHuman.some(n => n.nodeId === 'human' && n.state === 'waiting'));
  for (const purpose of ['stop', 'promotion', 'revocation']) {
    const record = view.decisions.find(d => d.purpose === purpose);
    assert.ok(record.reasons.length > 0); assert.ok(record.outcome); assert.equal(record.gap, null);
  }
  assert.ok(view.gaps.some(d => d.gap === 'decision-reasons-missing'));
  const capability = view.decisions.find(d => d.kind === 'candidate');
  assert.equal(capability.outcome, 'inconclusive'); assert.equal(capability.capabilityJudgement.verdict, 'inconclusive');
}
