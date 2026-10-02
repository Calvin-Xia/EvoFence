import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMemoryArtifactStore, createMemoryEventStore } from '../dist/storage/index.js';
import { createSessionService, planRound, bindingFor } from '../dist/runtime/session/index.js';
import { canonical } from '../dist/kernel/store/index.js';
import { extractExperience, proposeDeterministically, generationPrompt, prepareGeneration } from '../dist/learning/proposals/index.js';
import { harness, node, graph, usage } from './l2-runtime-support.test.js';

export const digest = { digest: bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
export const protocol = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
export const limits = { maxTraces: 8, maxTraceBytes: 4_000_000, maxEvents: 4000, maxPatterns: 32, maxCandidates: 5,
  maxCandidateBytes: 65536, maxTextChars: 2000, maxInputTokens: 60000, maxOutputTokens: 4096,
  maxGenerationRequests: 1, maxGenerationMicros: 100 };
export const scope = { projectId: 'fixture-project', hostId: 'fixture-host', modelId: 'fixture/model', taskId: 'fixture-task' };
export function value(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; }
export function rejected(result, code) { assert.equal(result.ok, false); assert.equal(result.error.code, code); return result.error; }
export function fixture(options = {}) {
  const artifacts = createMemoryArtifactStore({ digest });
  let ordinal = 0;
  function artifact(bytes, overrides = {}) {
    const id = `experience-${++ordinal}`;
    const ref = { protocol, id, digest: digest.digest(bytes), producer: { actorId: 'source', kind: 'host-adapter', identityRef: null },
      binding: null, schema: { name: 'VisibleTaskTrace', version: '1.0.0', digest: digest.digest('VisibleTaskTrace') },
      location: `fixture:${id}`, visibility: 'internal', partition: 'train', expiresAt: null, ...overrides };
    value(artifacts.put(ref, bytes)); return ref;
  }
  function selection(ref, overrides = {}) {
    return { ref, expectation: { productKind: 'pre-source', schema: ref.schema, binding: null }, scope,
      grade: 'native-fixture', whyVisible: 'Explicit operational training trace selected by the task owner.', ...overrides };
  }
  const rows = options.rows ?? [{ type: 'check', label: 'fresh-verify:focused:1', code: 1 },
    { type: 'check', label: 'finish:focused:1', code: 0 }, { type: 'fatal', message: 'driver fixture failure' },
    { type: 'same-session-recovery' }, { type: 'final-result', message: 'FINAL_SENTINEL', score: 999 }];
  const bytes = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  const ref = artifact(bytes, options.ref);
  const selections = [selection(ref, options.selection)];
  const ports = { artifacts, digest };
  const experience = () => value(extractExperience(selections, { ...limits, ...options.limits }, 1000, ports));
  const candidates = () => value(proposeDeterministically(experience(), ports));
  return { artifacts, artifact, selection, ports, ref, bytes, rows, selections, experience, candidates };
}
export const draftOf = ({ patternId, category, hypothesis, conditions, support, counterexamples, content }) =>
  ({ patternId, category, hypothesis, conditions, support, counterexamples, content });

/** Real SessionService + EventStore transitions; only native/provider execution is synthetic. */
export async function modelFixture(options = {}) {
  const f = fixture(), experience = f.experience();
  const drafts = structuredClone(f.candidates().map(draftOf));
  const outputSchema = { name: 'CandidateDrafts', version: '1.0.0', digest: digest.digest('CandidateDrafts') };
  const learner = node('learner', { terminal: true, outputSchemas: [outputSchema] });
  learner.termination.maxAttempts = 1;
  const h = harness({ spec: graph({ nodes: [learner] }),
    budget: { maxUsdMicros: 800, priceRef: f.ref } });
  h.artifacts = createMemoryArtifactStore({ digest });
  h.ports.artifacts = h.artifacts;
  const prompt = generationPrompt(experience);
  const promptRef = { ...f.ref, id: 'generation-prompt', schema: { ...f.ref.schema, name: 'CandidateGenerationInput' },
    location: 'fixture:generation-prompt', digest: digest.digest(prompt) };
  const ports = { artifacts: h.artifacts, digest };
  // Source bytes are admitted into the same store used by the runtime, without a second budget pool in this lane.
  value(h.artifacts.put(f.ref, f.bytes));
  const plan = value(prepareGeneration(experience, promptRef, { count: text => Math.ceil(text.length / 4), hostInputTokens: 10 }, ports));
  h.seed.operations.learner = plan.operation;
  // Register the final seed once in a fresh fixture store; no mutation of a committed seed.
  h.ports.store = createMemoryEventStore({ digest });
  h.service = createSessionService(h.ports);
  value(h.service.create({ ...h.seed, epoch: 1, protocol }));
  h.read = () => value(h.service.read(h.seed.sessionId));
  const rawOutput = options.rawOutput ?? canonical(options.drafts ? options.drafts(drafts) : drafts);
  let effect, outputRef;
  const originalExecute = h.ports.host.execute;
  h.ports.host.execute = async authorized => {
    // These observations verify reserve + journal/outbox claim precede any host effect.
    assert.equal(h.read().budget.reservations.length, 1);
    assert.equal(h.read().outbox.entries[0].state, 'dispatched');
    effect = authorized.effect;
    outputRef = { ...f.ref, id: 'generated-drafts', digest: digest.digest(rawOutput), schema: outputSchema,
      binding: effect.binding, location: 'fixture:generated-drafts' };
    value(h.artifacts.put(outputRef, rawOutput));
    h.script.outcomes[effect.effectId] = options.status ?? 'completed';
    h.script.usage[effect.effectId] = options.noUsage || options.status === 'unknown' ? [] : [usage(effect.reservationRef, { source: 'synthetic', ...options.usage })];
    const result = await originalExecute(authorized);
    return result.ok ? { ok: true, value: { ...result.value, artifactRefs: [outputRef] } } : result;
  };
  if (options.deferDispatch) {
    const state = h.read(), now = 1000;
    const admissions = Object.fromEntries(h.seed.graph.spec.nodes.map(n => [n.nodeId,
      h.ports.policy.inspect(h.seed, n, bindingFor(state, h.seed, n.nodeId), now)]));
    const batch = value(planRound(state, h.seed, { ...h.ports, now }, admissions, 'plan-generation'));
    value(h.ports.store.append({ sessionId: h.seed.sessionId, requestId: 'plan-generation',
      expectedRevision: state.revision, epoch: state.epoch, ...batch }));
    [effect] = batch.effects;
  } else value(await h.service.step(h.seed.sessionId));
  return { f, experience, drafts, h, plan, ports: { ...ports, sessions: h.service }, effect, outputRef };
}
