import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness, value, node, graph, usage, bindingFor, canonical } from './l2-runtime-support.test.js';
import { edge } from './l2-scheduler-fixtures.mjs';
import { transition, event } from '../dist/runtime/session/journal.js';
import { fixture as assetFixture } from './l4-revocation-fixtures.test.js';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CLI = path.join(ROOT, 'dist/cli.js');
export const SECRETS = ['PRIVATE_HOLDOUT_CASE-l5', 'sk-testsecret-l5', 'Bearer credential-l5', 'https://user:password-l5@example.invalid'];

export async function makeReviewFixture() {
  const ids = ['lost', 'lost-again', 'bad', 'cancelled', 'done', 'ready', 'human', 'join'];
  const spec = graph({ nodes: ids.map(id => node(id, { terminal: true,
    ...(id === 'human' ? { kind: 'human' } : {}),
    ...(id === 'join' ? { kind: 'join', requiredBranches: ['bad', 'cancelled', 'done', 'lost'] } : {}) })),
    requiredJoins: ['join'], typedEdges: ['bad', 'cancelled', 'done', 'lost'].map(id => edge(`to-${id}`, 'dependency', id, 'join')) });
  const f = harness({ spec });
  const initial = f.read(), batch = f.round(initial), effects = batch.effects;
  // Seed branch intentions; the fixture supplies its join transition separately below.
  value(f.store.append({ sessionId: f.seed.sessionId, epoch: initial.epoch, expectedRevision: initial.revision,
    requestId: 'fixture-plan', effects, receipts: [], events: batch.events.filter(e => e.payload.binding?.nodeId !== 'join') }));
  for (const effect of effects) {
    const state = f.read();
    value(f.store.dispatchEffect(f.seed.sessionId, { expectedRevision: state.revision, epoch: state.epoch,
      effectId: effect.effectId, claimId: `dispatch:${effect.effectId}` }));
  }
  value(f.service.receive(f.seed.sessionId, f.receipt(effects[0], { status: 'unknown',
    usage: [usage(effects[0].reservationRef)], observability: [] })));
  function appendStates(entries) {
    const state = f.read();
    value(f.store.append({ sessionId: f.seed.sessionId, epoch: state.epoch, expectedRevision: state.revision,
      requestId: 'fixture-states', effects: [], receipts: [], events: entries.map(([id, before, after], index) =>
        transition(state, 'fixture-states', String(index), bindingFor(state, f.seed, id), before, after)) }));
  }
  appendStates([['lost-again', 'leased', 'unknown'], ['bad', null, 'failed'],
    ['cancelled', null, 'cancelled'], ['done', null, 'succeeded'], ['human', null, 'waiting'], ['join', null, 'waiting']]);
  const s = f.read();
  const queued = { ...effects[0], effectId: 'timer-future', idempotencyKey: 'timer-future', kind: 'timer.wait',
    reservationRef: null, leases: [], binding: bindingFor(s, f.seed, 'ready'), payload: { ...effects[0].payload, context: null } };
  value(f.store.append({ sessionId: f.seed.sessionId, epoch: s.epoch, expectedRevision: s.revision,
    requestId: 'future-intention', effects: [queued], receipts: [],
    events: [event(s, 'future-intention', 'timer', 'effect.intended', { binding: queued.binding, effectId: queued.effectId })] }));
  const privateRef = f.persist('private-marker', 'PrivateEvidence', { holdout: SECRETS[0], secret: SECRETS[1],
    credential: SECRETS[2], location: SECRETS[3] });
  const secretRef = { ...privateRef, visibility: 'private', partition: 'held-out' };
  const issuer = { actorId: 'fixture-evaluator', kind: 'evaluator', identityRef: null };
  function decision(purpose, kind, outcome, reasons, visibility = 'internal') {
    const record = { protocol: spec.protocol, decisionId: `review-${purpose}-${kind}`, kind, outcome, reasons,
      inputs: [privateRef], contractRef: kind === 'task' ? spec.taskContractRef : null,
      taskEvidenceRef: kind === 'task' ? privateRef : null, evaluationReceiptRef: kind !== 'task' ? privateRef : null,
      activationReceiptRef: null, evaluatorVersion: SECRETS[1], evaluationProtocolRef: null,
      evidenceRefs: [secretRef], feedbackVisibility: visibility, issuer, capabilityJudgement: kind === 'candidate' ? {
        cellStatus: 'complete', look: 'other', verdict: 'inconclusive', protocolRef: privateRef, analysisRef: privateRef,
        costBasis: 'unknown', guardrailCost: 'unknown', guardrailWall: 'unknown', guardrailTruncation: 'failed' } : null };
    return { purpose, ref: f.persist(`review-${purpose}-${kind}`, 'DecisionRecord', record, null, issuer) };
  }
  const decisionLinks = [decision('stop', 'task', 'unknown', ['host-disconnected', SECRETS[1]]),
    decision('promotion', 'promotion', 'denied', ['evaluation-insufficient']),
    decision('revocation', 'promotion', 'denied', ['asset-source-revoked']),
    decision('evaluation', 'task', 'failed', []), decision('evaluation', 'candidate', 'inconclusive', ['insufficient-evidence'])];
  const a = await assetFixture({ count: 1 });
  await a.promote(1);
  const source = { service: f.service, seed: f.seed, artifacts: f.artifacts, registry: a.state().registry,
    assetContext: { ...a.context, at: 1000 }, decisionLinks, at: 1000 };
  const session = value(f.store.exportSession(f.seed.sessionId));
  const refs = new Map();
  function collect(input, store) {
    if (input === null || typeof input !== 'object') return;
    if (input.schema && input.producer && typeof input.id === 'string') {
      refs.set(input.id, { ref: input, bytes: value(store.get(input)) });
    }
    else for (const item of Object.values(input)) collect(item, store);
  }
  collect(session, f.artifacts); collect(decisionLinks, f.artifacts); collect(privateRef, f.artifacts);
  collect(source.registry, a.artifacts); collect(source.assetContext, a.artifacts);
  const bundle = { version: 'evofence.review-export/1', seed: { ...f.seed, graph: spec }, session,
    artifacts: [...refs.values()], registry: source.registry, assetContext: source.assetContext, decisionLinks, at: source.at };
  return { ...f, source, bundle, effects, privateRef, canonical };
}

export function runReviewCli(bundle, flags = [], cli = CLI) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'evofence-l5-review-'));
  try {
    writeFileSync(path.join(cwd, 'review.json'), JSON.stringify(bundle));
    return spawnSync(process.execPath, [cli, 'session', 'view', 'review.json', ...flags], {
      cwd, encoding: 'utf8', timeout: 30000, env: { ...process.env, EVOFENCE_DEBUG: '1' },
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

if (process.argv.includes('--write-fixture')) {
  const f = await makeReviewFixture();
  writeFileSync(process.argv[process.argv.indexOf('--write-fixture') + 1], JSON.stringify(f.bundle, null, 2));
}
