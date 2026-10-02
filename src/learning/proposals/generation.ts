import { readArtifact } from '../../kernel/artifacts/index.js';
import type { ArtifactRef, Binding } from '../../kernel/artifacts/index.js';
import { usageCompleteness, usageIdentity } from '../../kernel/policy/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import { immutable } from '../assets/identity.js';
import type { SessionSeed, SessionService } from '../../runtime/session/types.js';
import { bindDrafts } from './candidate.js';
import { extractExperience, utf8Bytes } from './trace.js';
import type { CandidateSpec, Experience, GenerationAccounting, GenerationCollector, GenerationPlan,
  ProposalPorts, ProposalResult } from './types.js';

/** The prompt contains only selected operational observations, never trace bodies or terminal verdicts. */
export function generationPrompt(experience: Experience): string {
  return canonical({ instruction: 'Return a JSON array of conditional CandidateDraft hypotheses. Use only real success/failure links in each pattern. Include observed counterexamples and narrowed conditions; benefit is unproved.',
    draftFields: ['patternId', 'category', 'hypothesis:{intervention,expectedImprovement,measurement}', 'conditions', 'support', 'counterexamples:{event,limitation}', 'content'],
    patterns: experience.patterns, limits: experience.limits });
}
/** Caller commits this operation through the existing SessionService, grant, journal and outbox. */
export function prepareGeneration(
  experience: Experience, promptRef: ArtifactRef,
  tokens: { readonly count: (text: string) => number; readonly hostInputTokens: number }, ports: ProposalPorts,
): ProposalResult<GenerationPlan> {
  const prompt = generationPrompt(experience);
  const inputTokens = tokens.count(prompt) + tokens.hostInputTokens;
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(tokens.hostInputTokens) || tokens.hostInputTokens < 0 ||
      inputTokens > experience.limits.maxInputTokens) return storeFail('EFK_BUDGET_EXHAUSTED', 'complete generation input exceeds its token budget');
  if (promptRef.partition !== 'train' || !['public', 'internal'].includes(promptRef.visibility) ||
      promptRef.schema.name !== 'CandidateGenerationInput' || promptRef.digest !== ports.digest.digest(prompt)) {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'generation prompt must pin the exact visible experience projection');
  }
  const stored = ports.artifacts.put(promptRef, prompt); if (!stored.ok) return stored;
  const context = { inputRefs: [promptRef], maxTokens: experience.limits.maxInputTokens,
    preserveHostResources: true as const, isolation: 'fresh' as const };
  return storeOk(immutable({ promptRef, experienceDigest: experience.digest, operation: {
    kind: 'host.agent' as const, inputRefs: [promptRef], payload: { context, toolName: null, argumentsRef: null,
      graphRef: null, targetIds: [], assetRef: null, previousSnapshot: null, deliveryGuarantee: 'none' as const },
  } }));
}

/** Read only already-applied receipts. No retry, provider call, private evaluator or independent budget ledger. */
export function collectGeneration(
  experience: Experience, plan: GenerationPlan, sessionId: string, effectId: string, at: number, ports: GenerationCollector,
): ProposalResult<readonly CandidateSpec[]> {
  if (plan.experienceDigest !== experience.digest) return storeFail('EFK_SOURCE_PIN_DRIFT', 'generation plan belongs to different source evidence');
  const current = ports.sessions.read(sessionId); if (!current.ok) return current;
  const state = current.value, effect = state.effects[effectId];
  if (effect === undefined || effect.kind !== 'host.agent' || effect.reservationRef === null ||
      canonical({ kind: effect.kind, inputRefs: effect.inputRefs, payload: effect.payload }) !== canonical(plan.operation)) {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'generation must use the exact committed host-agent operation');
  }
  if (state.epoch !== effect.binding.epoch || state.staleEffectIds.includes(effectId) ||
      state.unknownEffectIds.includes(effectId)) return storeFail('EFK_EFFECT_UNKNOWN', 'generation effect is stale or unknown');
  if (state.budget.capMicros === null || state.budget.reservePerRequest > experience.limits.maxGenerationMicros) {
    return storeFail('EFK_BUDGET_NOT_AUTHORIZED', 'generation requires a finite pool and bounded reservation');
  }
  const prompt = readArtifact(plan.promptRef, 'asset-staging', at, ports.artifacts);
  if (!prompt.ok) return prompt;
  if (prompt.value !== generationPrompt(experience)) return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', 'committed generation prompt differs from visible evidence');
  const applied = state.events.filter(e => e.type === 'receipt.applied' && e.payload.effectId === effectId)
    .map(e => state.receipts[e.payload.objectRef!.id]);
  const receipts = applied.filter(r => r.status === 'completed' && r.hostInvocationId !== null && r.error === null);
  const outputs = receipts.flatMap(r => r.artifactRefs).filter(ref => ref.schema.name === 'CandidateDrafts');
  const uniqueOutputs = [...new Map(outputs.map(ref => [canonical(ref), ref])).values()];
  if (uniqueOutputs.length !== 1 || receipts.length === 0 || new Set(receipts.map(r => r.hostInvocationId)).size !== 1) {
    return storeFail('EFK_EFFECT_UNKNOWN', 'generation needs one confirmed invocation and one unambiguous draft output');
  }
  const allUsage = applied.flatMap(r => r.usage);
  // SessionService permits later complete metering to reconcile a previously unknown charge.
  const completedRequests = new Set(allUsage.filter(row => row.complete).map(row => row.requestId));
  const usages = allUsage.filter(row => row.complete || !completedRequests.has(row.requestId));
  const completeness = usageCompleteness(usages, [effect.reservationRef]);
  if (completeness.conflictingRequestIds.length > 0) return storeFail('EFK_USAGE_CONFLICT', 'generation usage has conflicting or unreserved requests');
  const settlement = state.budget.settlements.find(s => s.requestId === effect.reservationRef);
  if (!completeness.complete || settlement === undefined || state.budget.reservations.some(r => r.requestId === effect.reservationRef)) {
    return storeFail('EFK_USAGE_INCOMPLETE', 'generation usage is incomplete; existing reservation remains outstanding');
  }
  const usage = [...new Map(usages.map(row => [row.requestId, row])).values()];
  if (settlement.digest !== usageIdentity(usage[0]) || settlement.micros !== completeness.knownMicros ||
      state.usageIssues.some(issue => issue.code !== 'EFK_USAGE_INCOMPLETE' && issue.code !== 'EFK_BUDGET_EXHAUSTED')) {
    return storeFail('EFK_USAGE_CONFLICT', 'generation usage differs from the journal-derived settlement');
  }
  if (usage.length > experience.limits.maxGenerationRequests || settlement.micros > experience.limits.maxGenerationMicros) {
    return storeFail('EFK_BUDGET_EXHAUSTED', 'actual generation usage exceeds the declared bound; spend remains recorded');
  }
  if (usage.some(row => row.inputUncached! + row.cacheRead! > experience.limits.maxInputTokens ||
      row.output! > experience.limits.maxOutputTokens)) {
    return storeFail('EFK_BUDGET_EXHAUSTED', 'actual generation tokens exceed the declared envelope; spend remains recorded');
  }
  const outputRef = uniqueOutputs[0] as ArtifactRef;
  const output = readArtifact(outputRef, 'asset-staging', at, ports.artifacts,
    { productKind: 'node-product', schema: outputRef.schema, binding: effect.binding as unknown as Binding });
  if (!output.ok) return output;
  if (ports.digest.digest(output.value) !== outputRef.digest) return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', 'draft output differs from its pin');
  if (utf8Bytes(output.value) > experience.limits.maxCandidateBytes * experience.limits.maxCandidates) {
    return storeFail('EFK_SCHEMA_INVALID', 'model output exceeds the candidate byte envelope');
  }
  let drafts: unknown;
  try { drafts = JSON.parse(output.value); }
  catch (error) {
    if (error instanceof SyntaxError) return storeFail('EFK_SCHEMA_INVALID', 'model output is not CandidateDrafts JSON');
    throw error;
  }
  const accounting: GenerationAccounting = { method: 'host-effect', poolId: state.budget.poolId, effectId,
    receiptId: receipts[receipts.length - 1].receiptId, requests: usage.length, reservedMicros: state.budget.reservePerRequest,
    estimatedUsdMicros: settlement.micros, usage, outputRef,
    grade: usage.every(row => row.source === 'synthetic') ? 'native-fixture' : 'unknown' };
  return bindDrafts(drafts, experience, accounting, ports);
}

/** Dispatch only an already-committed, reserved learner effect; runtime retains sole execution/ledger ownership. */
export async function dispatchGeneration(
  experience: Experience, plan: GenerationPlan, seed: SessionSeed, effectId: string, at: number,
  ports: GenerationCollector & { readonly sessions: Pick<SessionService, 'read' | 'step'> },
): Promise<ProposalResult<readonly CandidateSpec[]>> {
  const current = ports.sessions.read(seed.sessionId); if (!current.ok) return current;
  const state = current.value, effect = state.effects[effectId];
  const seedPin = state.events.find(event => event.type === 'budget.changed')!.payload.objectRef!;
  const snapshot = { graphRef: seed.graphRef, policy: seed.policy, reservePerRequest: seed.reservePerRequest,
    operations: seed.operations, grants: seed.grants };
  if (seedPin.digest !== ports.digest.digest(canonical(snapshot)) ||
      seed.graphRef.digest !== ports.digest.digest(canonical(seed.graph.spec))) {
    return storeFail('EFK_SOURCE_PIN_DRIFT', 'dispatch seed differs from the committed graph/operation/budget snapshot');
  }
  if (seed.graph.spec.nodes.length !== 1 || seed.graph.spec.nodes[0].termination.maxAttempts !== 1 ||
      effect === undefined || effect.binding.nodeId !== seed.graph.spec.nodes[0].nodeId ||
      canonical(effect.binding.graph) !== canonical(seed.graphRef) ||
      canonical(seed.operations[effect.binding.nodeId]) !== canonical(plan.operation) ||
      canonical({ kind: effect.kind, inputRefs: effect.inputRefs, payload: effect.payload }) !== canonical(plan.operation)) {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'dispatch requires one pinned learner node and no automatic retries');
  }
  if (plan.experienceDigest !== experience.digest || seed.policy.maxInputTokens > experience.limits.maxInputTokens ||
      seed.policy.maxOutputTokens > experience.limits.maxOutputTokens || state.budget.capMicros === null ||
      state.budget.reservePerRequest > experience.limits.maxGenerationMicros ||
      state.budget.poolId !== seed.policy.poolId || effect.reservationRef === null) {
    return storeFail('EFK_BUDGET_NOT_AUTHORIZED', 'generation dispatch exceeds its input/output/reservation envelope');
  }
  const pending = state.outbox.entries.filter(entry => entry.state === 'intended');
  if (pending.length !== 1 || pending[0].effectId !== effectId ||
      !state.budget.reservations.some(r => r.requestId === effect.reservationRef)) {
    return storeFail('EFK_EFFECT_NON_IDEMPOTENT_RETRY', 'only one unstarted, already-reserved generation effect can be dispatched');
  }
  const source = extractExperience(experience.traces.map(({ ref, expectation, scope, whyVisible, grade }) =>
    ({ ref, expectation, scope, whyVisible, grade })), experience.limits, at, ports);
  if (!source.ok) return source;
  if (source.value.digest !== experience.digest) return storeFail('EFK_SOURCE_PIN_DRIFT', 'generation source changed before dispatch');
  const prompt = readArtifact(plan.promptRef, 'asset-staging', at, ports.artifacts);
  if (!prompt.ok) return prompt;
  if (prompt.value !== generationPrompt(experience)) return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', 'generation prompt changed before dispatch');
  const stepped = await ports.sessions.step(seed.sessionId); if (!stepped.ok) return stepped;
  return collectGeneration(experience, plan, seed.sessionId, effectId, at, ports);
}
